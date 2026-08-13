package main

import (
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

type Constraints struct {
	AllowedAdapters []string `json:"allowedAdapters"`
	MaximumRisk     uint8    `json:"maximumRisk"`
	MinimumOutput   string   `json:"minimumOutput"`
}

type Route struct {
	Adapter        string `json:"adapter"`
	TokenOut       string `json:"tokenOut"`
	ExpectedOutput string `json:"expectedOutput"`
	Risk           uint8  `json:"risk"`
	ActionData     string `json:"actionData"`
}

type EvaluateRequest struct {
	IntentID    string      `json:"intentId"`
	Router      string      `json:"router"`
	ChainID     string      `json:"chainId"`
	Owner       string      `json:"owner"`
	TokenIn     string      `json:"tokenIn"`
	Amount      string      `json:"amount"`
	Nonce       uint64      `json:"nonce"`
	Expiry      uint64      `json:"expiry"`
	Deadline    uint64      `json:"deadline"`
	Constraints Constraints `json:"constraints"`
	Routes      []Route     `json:"routes"`
}

type Decision struct {
	IntentID            string `json:"intentId"`
	Owner               string `json:"owner"`
	TokenIn             string `json:"tokenIn"`
	MaximumAmount       string `json:"maximumAmount"`
	IntentCommitment    string `json:"intentCommitment"`
	Adapter             string `json:"adapter"`
	TokenOut            string `json:"tokenOut"`
	ActionData          string `json:"actionData"`
	MinimumOutput       string `json:"minimumOutput"`
	IntentNonce         uint64 `json:"intentNonce"`
	Deadline            uint64 `json:"deadline"`
	ExpectedOutput      string `json:"expectedOutput"`
	AuthorizationDigest string `json:"authorizationDigest"`
	Signature           string `json:"signature"`
}

type actionEnvelope struct {
	Data struct {
		ID            string `json:"id"`
		Type          string `json:"type"`
		SubmissionTag string `json:"submissionTag"`
		Message       string `json:"message"`
	} `json:"data"`
	AdditionalVariableMessages []string `json:"additionalVariableMessages"`
	Timestamps                 []uint64 `json:"timestamps"`
	AdditionalActionData       string   `json:"additionalActionData"`
	Signatures                 []string `json:"signatures"`
}

type dataFixed struct {
	InstructionID          string   `json:"instructionId"`
	TeeID                  string   `json:"teeId"`
	Timestamp              uint64   `json:"timestamp"`
	RewardEpochID          uint32   `json:"rewardEpochId"`
	OPType                 string   `json:"opType"`
	OPCommand              string   `json:"opCommand"`
	Cosigners              []string `json:"cosigners"`
	CosignersThreshold     uint64   `json:"cosignersThreshold"`
	OriginalMessage        string   `json:"originalMessage"`
	AdditionalFixedMessage string   `json:"additionalFixedMessage"`
}

type actionResult struct {
	ID                     string `json:"id"`
	SubmissionTag          string `json:"submissionTag"`
	Status                 uint8  `json:"status"`
	Log                    string `json:"log"`
	OPType                 string `json:"opType"`
	OPCommand              string `json:"opCommand"`
	AdditionalResultStatus string `json:"additionalResultStatus"`
	Version                string `json:"version"`
	Data                   string `json:"data"`
}

const extensionVersion = "0.1.0"

var routeAuthorizationTypeHash = crypto.Keccak256Hash([]byte("RouteAuthorization(bytes32 intentId,address owner,address tokenIn,uint256 maximumAmount,bytes32 intentCommitment,address adapter,address tokenOut,bytes32 actionHash,uint256 minimumOutput,uint64 intentNonce,uint64 deadline)"))
var privateIntentPolicyTypeHash = crypto.Keccak256Hash([]byte("PrivateIntentPolicy(uint256 chainId,address router,address owner,address tokenIn,uint256 amount,uint64 nonce,uint64 expiry,bytes32 allowedAdaptersHash,uint8 maximumRisk,uint256 minimumOutput)"))
var domainTypeHash = crypto.Keccak256Hash([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))

func chooseRoute(req EvaluateRequest) (Decision, error) {
	if req.IntentID == "" || req.Owner == "" || req.TokenIn == "" || req.Amount == "" || req.Router == "" || req.ChainID == "" {
		return Decision{}, errors.New("missing intent identity or funding fields")
	}
	if req.Deadline <= uint64(time.Now().Unix()) {
		return Decision{}, errors.New("intent deadline has passed")
	}
	if req.Expiry <= uint64(time.Now().Unix()) || req.Deadline > req.Expiry {
		return Decision{}, errors.New("intent expiry is invalid")
	}

	allowed := make(map[string]bool, len(req.Constraints.AllowedAdapters))
	for _, adapter := range req.Constraints.AllowedAdapters {
		allowed[adapter] = true
	}

	candidates := make([]Route, 0, len(req.Routes))
	minimumOutput, ok := new(big.Int).SetString(req.Constraints.MinimumOutput, 10)
	if !ok || minimumOutput.Sign() <= 0 {
		return Decision{}, errors.New("minimum output must be a positive base-10 integer")
	}
	for _, route := range req.Routes {
		expectedOutput, valid := new(big.Int).SetString(route.ExpectedOutput, 10)
		if !valid {
			continue
		}
		if allowed[route.Adapter] && route.Risk <= req.Constraints.MaximumRisk && expectedOutput.Cmp(minimumOutput) >= 0 {
			candidates = append(candidates, route)
		}
	}
	if len(candidates) == 0 {
		return Decision{}, errors.New("no route satisfies the private constraints")
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		left, _ := new(big.Int).SetString(candidates[i].ExpectedOutput, 10)
		right, _ := new(big.Int).SetString(candidates[j].ExpectedOutput, 10)
		return left.Cmp(right) > 0
	})
	selected := candidates[0]

	return Decision{
		IntentID:       req.IntentID,
		Owner:          req.Owner,
		TokenIn:        req.TokenIn,
		MaximumAmount:  req.Amount,
		Adapter:        selected.Adapter,
		TokenOut:       selected.TokenOut,
		ActionData:     selected.ActionData,
		MinimumOutput:  req.Constraints.MinimumOutput,
		IntentNonce:    req.Nonce,
		Deadline:       req.Deadline,
		ExpectedOutput: selected.ExpectedOutput,
	}, nil
}

func signDecision(req EvaluateRequest, decision Decision, key *ecdsa.PrivateKey) (Decision, error) {
	if !common.IsHexAddress(req.Router) || !common.IsHexAddress(decision.Owner) || !common.IsHexAddress(decision.TokenIn) || !common.IsHexAddress(decision.Adapter) || !common.IsHexAddress(decision.TokenOut) {
		return Decision{}, errors.New("router and authorization addresses must be valid EVM addresses")
	}
	intentID := common.HexToHash(decision.IntentID)
	if intentID == (common.Hash{}) || len(strings.TrimPrefix(decision.IntentID, "0x")) != 64 {
		return Decision{}, errors.New("intentId must be bytes32")
	}
	amount, ok := new(big.Int).SetString(decision.MaximumAmount, 10)
	if !ok || amount.Sign() <= 0 {
		return Decision{}, errors.New("maximumAmount must be positive")
	}
	minimum, ok := new(big.Int).SetString(decision.MinimumOutput, 10)
	if !ok || minimum.Sign() < 0 {
		return Decision{}, errors.New("minimumOutput must be non-negative")
	}
	chainID, ok := new(big.Int).SetString(req.ChainID, 10)
	if !ok || chainID.Sign() <= 0 {
		return Decision{}, errors.New("chainId must be positive")
	}
	commitment, err := privatePolicyCommitment(req)
	if err != nil {
		return Decision{}, err
	}
	decision.IntentCommitment = commitment.Hex()
	actionData, err := decodeHex(decision.ActionData)
	if err != nil {
		return Decision{}, fmt.Errorf("actionData: %w", err)
	}
	actionHash := crypto.Keccak256Hash(actionData)
	structHash := crypto.Keccak256Hash(concatWords(
		routeAuthorizationTypeHash.Bytes(), intentID.Bytes(), addressWord(decision.Owner), addressWord(decision.TokenIn), uintWord(amount), commitment.Bytes(),
		addressWord(decision.Adapter), addressWord(decision.TokenOut), actionHash.Bytes(), uintWord(minimum), uintWord(new(big.Int).SetUint64(decision.IntentNonce)), uintWord(new(big.Int).SetUint64(decision.Deadline)),
	))
	domainHash := crypto.Keccak256Hash(concatWords(domainTypeHash.Bytes(), crypto.Keccak256Hash([]byte("ShadowRouter")).Bytes(), crypto.Keccak256Hash([]byte("1")).Bytes(), uintWord(chainID), addressWord(req.Router)))
	digest := crypto.Keccak256Hash([]byte{0x19, 0x01}, domainHash.Bytes(), structHash.Bytes())
	signature, err := crypto.Sign(digest.Bytes(), key)
	if err != nil {
		return Decision{}, err
	}
	signature[64] += 27
	decision.AuthorizationDigest = digest.Hex()
	decision.Signature = "0x" + hex.EncodeToString(signature)
	return decision, nil
}

func privatePolicyCommitment(req EvaluateRequest) (common.Hash, error) {
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
	if req.Expiry == 0 {
		return common.Hash{}, errors.New("expiry is required")
	}
	adapterWords := make([][]byte, 0, len(req.Constraints.AllowedAdapters))
	if len(req.Constraints.AllowedAdapters) == 0 {
		return common.Hash{}, errors.New("at least one allowed adapter is required")
	}
	for _, adapter := range req.Constraints.AllowedAdapters {
		if !common.IsHexAddress(adapter) {
			return common.Hash{}, errors.New("allowed adapter must be a valid EVM address")
		}
		adapterWords = append(adapterWords, addressWord(adapter))
	}
	allowedAdaptersHash := crypto.Keccak256Hash(concatWords(adapterWords...))
	return crypto.Keccak256Hash(concatWords(
		privateIntentPolicyTypeHash.Bytes(), uintWord(chainID), addressWord(req.Router), addressWord(req.Owner),
		addressWord(req.TokenIn), uintWord(amount), uintWord(new(big.Int).SetUint64(req.Nonce)),
		uintWord(new(big.Int).SetUint64(req.Expiry)), allowedAdaptersHash.Bytes(),
		uintWord(new(big.Int).SetUint64(uint64(req.Constraints.MaximumRisk))), uintWord(minimum),
	)), nil
}

func concatWords(words ...[]byte) []byte {
	var out []byte
	for _, word := range words {
		out = append(out, word...)
	}
	return out
}
func addressWord(value string) []byte {
	return common.LeftPadBytes(common.HexToAddress(value).Bytes(), 32)
}
func uintWord(value *big.Int) []byte { return common.LeftPadBytes(value.Bytes(), 32) }

func loadSigningKey() (*ecdsa.PrivateKey, error) {
	value := strings.TrimPrefix(os.Getenv("TEE_SIGNER_PRIVATE_KEY"), "0x")
	if value == "" {
		return nil, errors.New("TEE_SIGNER_PRIVATE_KEY is required inside the trusted runtime")
	}
	return crypto.HexToECDSA(value)
}

func main() {
	signingKey, err := loadSigningKey()
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	allowPlaintextTestMode := os.Getenv("SHADOWROUTE_ALLOW_PLAINTEXT_TEST_MODE") == "true"
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /action/evaluate", func(w http.ResponseWriter, r *http.Request) {
		if !allowPlaintextTestMode {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "plaintext evaluator disabled; use the secured FCC scaffold"})
			return
		}
		defer r.Body.Close()
		var request EvaluateRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		decision, err := chooseRoute(request)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		decision, err = signDecision(request, decision, signingKey)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, decision)
	})
	mux.HandleFunc("POST /action", func(w http.ResponseWriter, r *http.Request) {
		if !allowPlaintextTestMode {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "plaintext evaluator disabled; use the secured FCC scaffold"})
			return
		}
		handleFCCAction(w, r, signingKey)
	})
	mux.HandleFunc("GET /state", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"stateVersion": bytes32Hex(extensionVersion),
			"state":        map[string]string{"service": "shadowroute", "opType": "SHADOW_ROUTE", "opCommand": "EVALUATE"},
		})
	})

	address := os.Getenv("SHADOWROUTE_LISTEN_ADDR")
	if address == "" {
		address = ":8080"
	}
	log.Printf("ShadowRoute FCC extension listening on %s", address)
	log.Fatal(http.ListenAndServe(address, mux))
}

func handleFCCAction(w http.ResponseWriter, r *http.Request, signingKey *ecdsa.PrivateKey) {
	defer r.Body.Close()
	var action actionEnvelope
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&action); err != nil {
		http.Error(w, "decoding action: "+err.Error(), http.StatusBadRequest)
		return
	}
	message, err := decodeHex(action.Data.Message)
	if err != nil {
		http.Error(w, "decoding data.message: "+err.Error(), http.StatusBadRequest)
		return
	}
	var fixed dataFixed
	if err := json.Unmarshal(message, &fixed); err != nil {
		http.Error(w, "decoding fixed data: "+err.Error(), http.StatusBadRequest)
		return
	}
	if fixed.OPType != bytes32Hex("SHADOW_ROUTE") || fixed.OPCommand != bytes32Hex("EVALUATE") {
		http.Error(w, "unsupported op type or command", http.StatusNotImplemented)
		return
	}
	payload, err := decodeHex(fixed.OriginalMessage)
	if err != nil {
		http.Error(w, "decoding original message: "+err.Error(), http.StatusBadRequest)
		return
	}
	var request EvaluateRequest
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusOK, newActionResult(action, fixed, nil, err))
		return
	}
	decision, err := chooseRoute(request)
	if err != nil {
		writeJSON(w, http.StatusOK, newActionResult(action, fixed, nil, err))
		return
	}
	decision, err = signDecision(request, decision, signingKey)
	if err != nil {
		writeJSON(w, http.StatusOK, newActionResult(action, fixed, nil, err))
		return
	}
	data, _ := json.Marshal(decision)
	writeJSON(w, http.StatusOK, newActionResult(action, fixed, data, nil))
}

func newActionResult(action actionEnvelope, fixed dataFixed, data []byte, resultErr error) actionResult {
	result := actionResult{
		ID: action.Data.ID, SubmissionTag: action.Data.SubmissionTag,
		OPType: fixed.OPType, OPCommand: fixed.OPCommand,
		AdditionalResultStatus: "0x", Version: extensionVersion, Data: "0x",
	}
	if resultErr != nil {
		result.Status = 0
		result.Log = "error: " + resultErr.Error()
		return result
	}
	result.Status = 1
	result.Log = "ok"
	result.Data = "0x" + hex.EncodeToString(data)
	return result
}

func decodeHex(value string) ([]byte, error) {
	return hex.DecodeString(strings.TrimPrefix(value, "0x"))
}

func bytes32Hex(value string) string {
	bytes := make([]byte, 32)
	copy(bytes, []byte(value))
	return "0x" + hex.EncodeToString(bytes)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
