package extension

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"extension-scaffold/pkg/types"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

type Decrypter interface {
	Decrypt(context.Context, []byte) ([]byte, error)
}
type IntentReader interface {
	ChainID(context.Context) (string, error)
	Intent(context.Context, string, string) (OnchainIntent, bool, error)
	AdapterAllowed(context.Context, string, string) (bool, error)
}
type QuoteSource interface {
	Quotes(context.Context, types.EvaluateRequest) ([]types.Route, error)
}

type OnchainIntent struct {
	Owner, TokenIn, Amount, Commitment string
	Expiry, Nonce                      uint64
	Status                             uint8
}

type nodeDecrypter struct {
	endpoint string
	client   *http.Client
}

func newNodeDecrypter(signPort int) Decrypter {
	return &nodeDecrypter{endpoint: fmt.Sprintf("http://127.0.0.1:%d/decrypt", signPort), client: &http.Client{Timeout: 5 * time.Second}}
}
func (d *nodeDecrypter) Decrypt(ctx context.Context, ciphertext []byte) ([]byte, error) {
	body, _ := json.Marshal(map[string]string{"encryptedMessage": base64.StdEncoding.EncodeToString(ciphertext)})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, errors.New("tee decrypt unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("tee decrypt rejected ciphertext")
	}
	var result struct {
		DecryptedMessage string `json:"decryptedMessage"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil || result.DecryptedMessage == "" {
		return nil, errors.New("invalid tee decrypt response")
	}
	plaintext, err := base64.StdEncoding.DecodeString(result.DecryptedMessage)
	if err != nil {
		return nil, errors.New("invalid tee decrypt encoding")
	}
	return plaintext, nil
}

type rpcIntentReader struct {
	endpoint string
	client   *http.Client
}

func newRPCIntentReader() IntentReader {
	endpoint := os.Getenv("COSTON2_RPC_URL")
	if endpoint == "" {
		endpoint = os.Getenv("CHAIN_URL")
	}
	return &rpcIntentReader{endpoint: endpoint, client: &http.Client{Timeout: 8 * time.Second}}
}
func (r *rpcIntentReader) call(ctx context.Context, to, data string) ([]byte, error) {
	if r.endpoint == "" {
		return nil, errors.New("COSTON2_RPC_URL is required")
	}
	payload, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": []any{map[string]string{"to": to, "data": data}, "latest"}})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, r.endpoint, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, errors.New("chain read unavailable")
	}
	defer resp.Body.Close()
	var result struct {
		Result string `json:"result"`
		Error  any    `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil || result.Error != nil {
		return nil, errors.New("chain read failed")
	}
	return hex.DecodeString(strings.TrimPrefix(result.Result, "0x"))
}
func (r *rpcIntentReader) ChainID(ctx context.Context) (string, error) {
	if r.endpoint == "" {
		return "", errors.New("COSTON2_RPC_URL is required")
	}
	payload, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []any{}})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, r.endpoint, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return "", errors.New("chain read unavailable")
	}
	defer resp.Body.Close()
	var result struct {
		Result string `json:"result"`
		Error  any    `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result) != nil || result.Error != nil {
		return "", errors.New("chain id read failed")
	}
	id, ok := new(big.Int).SetString(strings.TrimPrefix(result.Result, "0x"), 16)
	if !ok {
		return "", errors.New("invalid chain id")
	}
	return id.String(), nil
}
func (r *rpcIntentReader) Intent(ctx context.Context, router, intentID string) (OnchainIntent, bool, error) {
	if !common.IsHexAddress(router) || len(strings.TrimPrefix(intentID, "0x")) != 64 {
		return OnchainIntent{}, false, errors.New("invalid intent lookup")
	}
	data := "0x" + hex.EncodeToString(append(crypto.Keccak256([]byte("intents(bytes32)"))[:4], common.HexToHash(intentID).Bytes()...))
	out, err := r.call(ctx, router, data)
	if err != nil {
		return OnchainIntent{}, false, err
	}
	if len(out) < 224 {
		return OnchainIntent{}, false, errors.New("invalid intent response")
	}
	word := func(i int) []byte { return out[i*32 : (i+1)*32] }
	status := word(6)[31]
	if status == 0 {
		return OnchainIntent{}, false, nil
	}
	toBig := func(w []byte) *big.Int { return new(big.Int).SetBytes(w) }
	return OnchainIntent{Owner: common.BytesToAddress(word(0)[12:]).Hex(), TokenIn: common.BytesToAddress(word(1)[12:]).Hex(), Amount: toBig(word(2)).String(), Commitment: common.BytesToHash(word(3)).Hex(), Expiry: toBig(word(4)).Uint64(), Nonce: toBig(word(5)).Uint64(), Status: status}, true, nil
}
func (r *rpcIntentReader) AdapterAllowed(ctx context.Context, router, adapter string) (bool, error) {
	if !common.IsHexAddress(adapter) {
		return false, errors.New("invalid adapter lookup")
	}
	selector := crypto.Keccak256([]byte("allowedAdapters(address)"))[:4]
	arg := common.LeftPadBytes(common.HexToAddress(adapter).Bytes(), 32)
	out, err := r.call(ctx, router, "0x"+hex.EncodeToString(append(selector, arg...)))
	if err != nil {
		return false, err
	}
	if len(out) < 32 {
		return false, errors.New("invalid adapter response")
	}
	return out[len(out)-1] == 1, nil
}

type staticQuoteSource struct {
	routes []types.Route
	err    error
}

func newStaticQuoteSource() QuoteSource {
	var routes []types.Route
	raw := os.Getenv("SHADOW_TRUSTED_QUOTES_JSON")
	if raw == "" {
		return &staticQuoteSource{err: errors.New("SHADOW_TRUSTED_QUOTES_JSON is required")}
	}
	err := json.Unmarshal([]byte(raw), &routes)
	return &staticQuoteSource{routes: routes, err: err}
}
func (s *staticQuoteSource) Quotes(context.Context, types.EvaluateRequest) ([]types.Route, error) {
	if s.err != nil {
		return nil, errors.New("trusted quote source unavailable")
	}
	return append([]types.Route(nil), s.routes...), nil
}

type v2RouteConfig struct {
	Adapter        string   `json:"adapter"`
	ExchangeRouter string   `json:"exchangeRouter"`
	Path           []string `json:"path"`
	Risk           uint8    `json:"risk"`
}
type v2QuoteSource struct {
	endpoint string
	client   *http.Client
	routes   []v2RouteConfig
	err      error
}

func newQuoteSource() QuoteSource {
	if strings.TrimSpace(os.Getenv("SHADOW_V2_ROUTES_JSON")) != "" {
		return newV2QuoteSource()
	}
	return newStaticQuoteSource()
}
func newV2QuoteSource() QuoteSource {
	endpoint := os.Getenv("COSTON2_RPC_URL")
	if endpoint == "" {
		endpoint = os.Getenv("CHAIN_URL")
	}
	var routes []v2RouteConfig
	err := json.Unmarshal([]byte(os.Getenv("SHADOW_V2_ROUTES_JSON")), &routes)
	if err == nil && len(routes) == 0 {
		err = errors.New("at least one V2 route is required")
	}
	return &v2QuoteSource{endpoint: endpoint, client: &http.Client{Timeout: 8 * time.Second}, routes: routes, err: err}
}
func (s *v2QuoteSource) Quotes(ctx context.Context, req types.EvaluateRequest) ([]types.Route, error) {
	if s.err != nil || s.endpoint == "" {
		return nil, errors.New("live V2 quote source unavailable")
	}
	amount, ok := new(big.Int).SetString(req.Amount, 10)
	if !ok || amount.Sign() <= 0 {
		return nil, errors.New("invalid quote amount")
	}
	minimum, ok := new(big.Int).SetString(req.Constraints.MinimumOutput, 10)
	if !ok || minimum.Sign() <= 0 {
		return nil, errors.New("invalid quote minimum")
	}
	parsed, err := abi.JSON(strings.NewReader(`[{"name":"getAmountsOut","type":"function","stateMutability":"view","inputs":[{"name":"amountIn","type":"uint256"},{"name":"path","type":"address[]"}],"outputs":[{"name":"amounts","type":"uint256[]"}]}]`))
	if err != nil {
		return nil, err
	}
	actionArgs := abi.Arguments{{Type: mustABIType("address[]")}, {Type: mustABIType("uint256")}, {Type: mustABIType("uint256")}}
	result := make([]types.Route, 0, len(s.routes))
	for _, cfg := range s.routes {
		if !common.IsHexAddress(cfg.Adapter) || !common.IsHexAddress(cfg.ExchangeRouter) || len(cfg.Path) < 2 || len(cfg.Path) > 4 {
			continue
		}
		path := make([]common.Address, len(cfg.Path))
		valid := true
		for i, v := range cfg.Path {
			if !common.IsHexAddress(v) {
				valid = false
				break
			}
			path[i] = common.HexToAddress(v)
		}
		if !valid || path[0] != common.HexToAddress(req.TokenIn) {
			continue
		}
		data, _ := parsed.Pack("getAmountsOut", amount, path)
		out, callErr := rpcEthCall(ctx, s.client, s.endpoint, cfg.ExchangeRouter, "0x"+hex.EncodeToString(data))
		if callErr != nil {
			continue
		}
		values, unpackErr := parsed.Unpack("getAmountsOut", out)
		if unpackErr != nil || len(values) != 1 {
			continue
		}
		amounts, castOK := values[0].([]*big.Int)
		if !castOK || len(amounts) != len(path) {
			continue
		}
		actionData, packErr := actionArgs.Pack(path, minimum, new(big.Int).SetUint64(req.Deadline))
		if packErr != nil {
			continue
		}
		result = append(result, types.Route{Adapter: cfg.Adapter, TokenOut: path[len(path)-1].Hex(), ExpectedOutput: amounts[len(amounts)-1].String(), Risk: cfg.Risk, ActionData: "0x" + hex.EncodeToString(actionData), ValidUntil: req.Deadline})
	}
	if len(result) == 0 {
		return nil, errors.New("no live V2 quote available")
	}
	return result, nil
}
func mustABIType(name string) abi.Type {
	t, err := abi.NewType(name, "", nil)
	if err != nil {
		panic(err)
	}
	return t
}
func rpcEthCall(ctx context.Context, client *http.Client, endpoint, to, data string) ([]byte, error) {
	payload, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": []any{map[string]string{"to": to, "data": data}, "latest"}})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var result struct {
		Result string `json:"result"`
		Error  any    `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result) != nil || result.Error != nil {
		return nil, errors.New("V2 quote call failed")
	}
	return hex.DecodeString(strings.TrimPrefix(result.Result, "0x"))
}
