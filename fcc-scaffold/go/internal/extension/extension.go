package extension

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/tee-node/pkg/processorutils"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

var routeAuthorizationTypeHash = crypto.Keccak256Hash([]byte("RouteAuthorization(bytes32 intentId,address owner,address tokenIn,uint256 maximumAmount,bytes32 intentCommitment,address adapter,address tokenOut,bytes32 actionHash,uint256 minimumOutput,uint64 intentNonce,uint64 deadline)"))
var privateIntentPolicyTypeHash = crypto.Keccak256Hash([]byte("PrivateIntentPolicy(uint256 chainId,address router,address owner,address tokenIn,uint256 amount,uint64 nonce,uint64 expiry,bytes32 allowedAdaptersHash,uint8 maximumRisk,uint256 minimumOutput)"))
var domainTypeHash = crypto.Keccak256Hash([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))

type Extension struct {
	mu              sync.RWMutex
	Server          *http.Server
	signingKey      *ecdsa.PrivateKey
	evaluationCount uint64
	decrypter       Decrypter
	intentReader    IntentReader
	quoteSource     QuoteSource
}

func New(extensionPort, signPort int) *Extension {
	return NewWithDependencies(extensionPort, signPort, newNodeDecrypter(signPort), newRPCIntentReader(), newQuoteSource())
}

func NewWithDependencies(extensionPort, signPort int, decrypter Decrypter, intentReader IntentReader, quoteSource QuoteSource) *Extension {
	e := &Extension{decrypter: decrypter, intentReader: intentReader, quoteSource: quoteSource}
	if value := strings.TrimPrefix(os.Getenv("TEE_SIGNER_PRIVATE_KEY"), "0x"); value != "" {
		e.signingKey, _ = crypto.HexToECDSA(value)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)
	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	e.mu.RLock()
	state := types.State{Service: "shadowroute", OPType: config.OPTypeShadowRoute, OPCommand: config.OPCommandEvaluate, EvaluationCount: e.evaluationCount}
	e.mu.RUnlock()
	if err := json.NewEncoder(w).Encode(types.StateResponse{StateVersion: teeutils.ToHash(config.Version), State: state}); err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
	}
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	df, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}
	if df.OPType != teeutils.ToHash(config.OPTypeShadowRoute) {
		return http.StatusNotImplemented, []byte(fmt.Sprintf("unsupported op type: received %s, expected %s (%s)", df.OPType.Hex(), teeutils.ToHash(config.OPTypeShadowRoute).Hex(), config.OPTypeShadowRoute))
	}
	if df.OPCommand != teeutils.ToHash(config.OPCommandEvaluate) {
		return http.StatusNotImplemented, []byte(fmt.Sprintf("unsupported op command: received %s, expected %s (%s)", df.OPCommand.Hex(), teeutils.ToHash(config.OPCommandEvaluate).Hex(), config.OPCommandEvaluate))
	}
	ar := e.processEvaluate(action, df)
	b, _ := json.Marshal(ar)
	return http.StatusOK, b
}

func (e *Extension) processEvaluate(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if e.decrypter == nil || e.intentReader == nil || e.quoteSource == nil {
		return buildResult(action, df, nil, 0, errors.New("secure evaluation dependencies are unavailable"))
	}
	plaintext, decryptErr := e.decrypter.Decrypt(context.Background(), df.OriginalMessage)
	if decryptErr != nil {
		return buildResult(action, df, nil, 0, decryptErr)
	}
	var req types.EvaluateRequest
	dec := json.NewDecoder(bytes.NewReader(plaintext))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding request: %w", err))
	}
	liveChainID, err := e.intentReader.ChainID(context.Background())
	if err == nil && liveChainID != req.ChainID {
		err = errors.New("request chain does not match configured RPC")
	}
	intent, exists := OnchainIntent{}, false
	if err == nil {
		intent, exists, err = e.intentReader.Intent(context.Background(), req.Router, req.IntentID)
	}
	if err == nil && !exists {
		err = errors.New("funded intent not found")
	}
	if err == nil {
		err = verifyFundedIntent(req, intent)
	}
	var routes []types.Route
	if err == nil {
		routes, err = e.quoteSource.Quotes(context.Background(), req)
	}
	decision := types.Decision{}
	if err == nil {
		decision, err = chooseRoute(req, routes)
	}
	if err == nil {
		var allowed bool
		allowed, err = e.intentReader.AdapterAllowed(context.Background(), req.Router, decision.Adapter)
		if err == nil && !allowed {
			err = errors.New("selected adapter is not allowlisted on-chain")
		}
	}
	if err == nil {
		if e.signingKey == nil {
			err = errors.New("TEE_SIGNER_PRIVATE_KEY is required inside the trusted runtime")
		} else {
			decision, err = signDecision(req, decision, e.signingKey)
		}
	}
	if err != nil {
		return buildResult(action, df, nil, 0, err)
	}
	e.mu.Lock()
	e.evaluationCount++
	e.mu.Unlock()
	data, _ := json.Marshal(decision)
	return buildResult(action, df, data, 1, nil)
}

func chooseRoute(req types.EvaluateRequest, routes []types.Route) (types.Decision, error) {
	if req.IntentID == "" || req.Owner == "" || req.TokenIn == "" || req.Amount == "" || req.Router == "" || req.ChainID == "" {
		return types.Decision{}, errors.New("missing intent identity or funding fields")
	}
	if req.Deadline <= uint64(time.Now().Unix()) {
		return types.Decision{}, errors.New("intent deadline has passed")
	}
	if req.Expiry <= uint64(time.Now().Unix()) || req.Deadline > req.Expiry {
		return types.Decision{}, errors.New("intent expiry is invalid")
	}
	minimum, ok := new(big.Int).SetString(req.Constraints.MinimumOutput, 10)
	if !ok || minimum.Sign() <= 0 {
		return types.Decision{}, errors.New("minimum output must be a positive base-10 integer")
	}
	allowed := make(map[string]bool, len(req.Constraints.AllowedAdapters))
	for _, a := range req.Constraints.AllowedAdapters {
		allowed[strings.ToLower(a)] = true
	}
	candidates := make([]types.Route, 0, len(routes))
	for _, route := range routes {
		expected, valid := new(big.Int).SetString(route.ExpectedOutput, 10)
		if valid && route.ValidUntil >= req.Deadline && allowed[strings.ToLower(route.Adapter)] && route.Risk <= req.Constraints.MaximumRisk && expected.Cmp(minimum) >= 0 {
			candidates = append(candidates, route)
		}
	}
	if len(candidates) == 0 {
		return types.Decision{}, errors.New("no route satisfies the private constraints")
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		a, _ := new(big.Int).SetString(candidates[i].ExpectedOutput, 10)
		b, _ := new(big.Int).SetString(candidates[j].ExpectedOutput, 10)
		return a.Cmp(b) > 0
	})
	r := candidates[0]
	return types.Decision{IntentID: req.IntentID, Owner: req.Owner, TokenIn: req.TokenIn, MaximumAmount: req.Amount, Adapter: r.Adapter, TokenOut: r.TokenOut, ActionData: r.ActionData, MinimumOutput: req.Constraints.MinimumOutput, IntentNonce: req.Nonce, Deadline: req.Deadline, ExpectedOutput: r.ExpectedOutput}, nil
}

func verifyFundedIntent(req types.EvaluateRequest, intent OnchainIntent) error {
	if intent.Status != 2 {
		return errors.New("intent is not funded")
	}
	if !strings.EqualFold(intent.Owner, req.Owner) || !strings.EqualFold(intent.TokenIn, req.TokenIn) || intent.Amount != req.Amount || intent.Nonce != req.Nonce || intent.Expiry != req.Expiry {
		return errors.New("request does not match funded intent")
	}
	commitment, err := privatePolicyCommitment(req)
	if err != nil {
		return err
	}
	if !strings.EqualFold(intent.Commitment, commitment.Hex()) {
		return errors.New("private policy does not match funded intent")
	}
	return nil
}

func signDecision(req types.EvaluateRequest, d types.Decision, key *ecdsa.PrivateKey) (types.Decision, error) {
	if !common.IsHexAddress(req.Router) || !common.IsHexAddress(d.Owner) || !common.IsHexAddress(d.TokenIn) || !common.IsHexAddress(d.Adapter) || !common.IsHexAddress(d.TokenOut) {
		return types.Decision{}, errors.New("router and authorization addresses must be valid EVM addresses")
	}
	intentID := common.HexToHash(d.IntentID)
	if intentID == (common.Hash{}) || len(strings.TrimPrefix(d.IntentID, "0x")) != 64 {
		return types.Decision{}, errors.New("intentId must be bytes32")
	}
	amount, ok := new(big.Int).SetString(d.MaximumAmount, 10)
	if !ok || amount.Sign() <= 0 {
		return types.Decision{}, errors.New("maximumAmount must be positive")
	}
	minimum, ok := new(big.Int).SetString(d.MinimumOutput, 10)
	if !ok || minimum.Sign() < 0 {
		return types.Decision{}, errors.New("minimumOutput must be non-negative")
	}
	chainID, ok := new(big.Int).SetString(req.ChainID, 10)
	if !ok || chainID.Sign() <= 0 {
		return types.Decision{}, errors.New("chainId must be positive")
	}
	commitment, err := privatePolicyCommitment(req)
	if err != nil {
		return types.Decision{}, err
	}
	d.IntentCommitment = commitment.Hex()
	actionData, err := hex.DecodeString(strings.TrimPrefix(d.ActionData, "0x"))
	if err != nil {
		return types.Decision{}, fmt.Errorf("actionData: %w", err)
	}
	structHash := crypto.Keccak256Hash(concatWords(routeAuthorizationTypeHash.Bytes(), intentID.Bytes(), addressWord(d.Owner), addressWord(d.TokenIn), uintWord(amount), commitment.Bytes(), addressWord(d.Adapter), addressWord(d.TokenOut), crypto.Keccak256Hash(actionData).Bytes(), uintWord(minimum), uintWord(new(big.Int).SetUint64(d.IntentNonce)), uintWord(new(big.Int).SetUint64(d.Deadline))))
	domainHash := crypto.Keccak256Hash(concatWords(domainTypeHash.Bytes(), crypto.Keccak256Hash([]byte("ShadowRouter")).Bytes(), crypto.Keccak256Hash([]byte("1")).Bytes(), uintWord(chainID), addressWord(req.Router)))
	digest := crypto.Keccak256Hash([]byte{0x19, 0x01}, domainHash.Bytes(), structHash.Bytes())
	sig, err := crypto.Sign(digest.Bytes(), key)
	if err != nil {
		return types.Decision{}, err
	}
	sig[64] += 27
	d.AuthorizationDigest = digest.Hex()
	d.Signature = "0x" + hex.EncodeToString(sig)
	return d, nil
}

func privatePolicyCommitment(req types.EvaluateRequest) (common.Hash, error) {
	if !common.IsHexAddress(req.Router) || !common.IsHexAddress(req.Owner) || !common.IsHexAddress(req.TokenIn) {
		return common.Hash{}, errors.New("policy router, owner and tokenIn must be valid EVM addresses")
	}
	chainID, ok := new(big.Int).SetString(req.ChainID, 10)
	if !ok || chainID.Sign() <= 0 {
		return common.Hash{}, errors.New("chainId must be positive")
	}
	amount, ok := new(big.Int).SetString(req.Amount, 10)
	if !ok || amount.Sign() <= 0 {
		return common.Hash{}, errors.New("amount must be positive")
	}
	minimum, ok := new(big.Int).SetString(req.Constraints.MinimumOutput, 10)
	if !ok || minimum.Sign() <= 0 {
		return common.Hash{}, errors.New("minimumOutput must be positive")
	}
	if req.Expiry == 0 || len(req.Constraints.AllowedAdapters) == 0 {
		return common.Hash{}, errors.New("expiry and at least one allowed adapter are required")
	}
	adapterWords := make([][]byte, 0, len(req.Constraints.AllowedAdapters))
	for _, adapter := range req.Constraints.AllowedAdapters {
		if !common.IsHexAddress(adapter) {
			return common.Hash{}, errors.New("allowed adapter must be a valid EVM address")
		}
		adapterWords = append(adapterWords, addressWord(adapter))
	}
	allowedAdaptersHash := crypto.Keccak256Hash(concatWords(adapterWords...))
	return crypto.Keccak256Hash(concatWords(privateIntentPolicyTypeHash.Bytes(), uintWord(chainID), addressWord(req.Router), addressWord(req.Owner), addressWord(req.TokenIn), uintWord(amount), uintWord(new(big.Int).SetUint64(req.Nonce)), uintWord(new(big.Int).SetUint64(req.Expiry)), allowedAdaptersHash.Bytes(), uintWord(new(big.Int).SetUint64(uint64(req.Constraints.MaximumRisk))), uintWord(minimum))), nil
}

func concatWords(words ...[]byte) []byte {
	var out []byte
	for _, w := range words {
		out = append(out, w...)
	}
	return out
}
func addressWord(v string) []byte { return common.LeftPadBytes(common.HexToAddress(v).Bytes(), 32) }
func uintWord(v *big.Int) []byte  { return common.LeftPadBytes(v.Bytes(), 32) }
