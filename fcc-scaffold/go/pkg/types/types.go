// Package types contains ShadowRoute's FCC request, response, and state types.
package types

import "github.com/ethereum/go-ethereum/common"

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
	ValidUntil     uint64 `json:"validUntil"`
}

type EvaluateRequest struct {
	IntentID   string      `json:"intentId"`
	Router     string      `json:"router"`
	ChainID    string      `json:"chainId"`
	Owner      string      `json:"owner"`
	TokenIn    string      `json:"tokenIn"`
	Amount     string      `json:"amount"`
	Nonce      uint64      `json:"nonce"`
	Expiry     uint64      `json:"expiry"`
	Deadline   uint64      `json:"deadline"`
	Constraints Constraints `json:"constraints"`
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

type State struct {
	Service         string `json:"service"`
	OPType          string `json:"opType"`
	OPCommand       string `json:"opCommand"`
	EvaluationCount uint64 `json:"evaluationCount"`
}

// --- DO NOT MODIFY below this line. ---
type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
