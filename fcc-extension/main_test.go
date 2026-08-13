package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"github.com/ethereum/go-ethereum/crypto"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestPlaintextModeRequiresExplicitOptIn(t *testing.T) {
	if os.Getenv("SHADOWROUTE_ALLOW_PLAINTEXT_TEST_MODE") == "true" {
		t.Fatal("plaintext test mode must not be enabled by default")
	}
}

const testSignerKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func validRequest() EvaluateRequest {
	expiry := uint64(time.Now().Add(2 * time.Hour).Unix())
	return EvaluateRequest{IntentID: "0x" + stringsRepeat("11", 32), Router: "0x1000000000000000000000000000000000000001", ChainID: "114", Owner: "0x2000000000000000000000000000000000000002", TokenIn: "0x3000000000000000000000000000000000000003", Amount: "100", Nonce: 2, Expiry: expiry, Deadline: expiry - 3600, Constraints: Constraints{AllowedAdapters: []string{"0x4000000000000000000000000000000000000004"}, MaximumRisk: 3, MinimumOutput: "190"}, Routes: []Route{{Adapter: "0x4000000000000000000000000000000000000004", TokenOut: "0x5000000000000000000000000000000000000005", ExpectedOutput: "200", Risk: 2, ActionData: "0x01"}}}
}

func TestChooseRouteFiltersPrivateConstraintsAndRanksOutput(t *testing.T) {
	req := EvaluateRequest{
		IntentID: "0xintent", Router: "router", ChainID: "114", Owner: "0xowner", TokenIn: "0xfxrp", Amount: "100",
		Nonce: 2, Expiry: uint64(time.Now().Add(2 * time.Hour).Unix()), Deadline: uint64(time.Now().Add(time.Hour).Unix()),
		Constraints: Constraints{
			AllowedAdapters: []string{"safe", "risky"}, MaximumRisk: 3, MinimumOutput: "190",
		},
		Routes: []Route{
			{Adapter: "safe", TokenOut: "0xusdt", ExpectedOutput: "200", Risk: 2, ActionData: "0x01"},
			{Adapter: "risky", TokenOut: "0xusdt", ExpectedOutput: "220", Risk: 5, ActionData: "0x02"},
			{Adapter: "unknown", TokenOut: "0xusdt", ExpectedOutput: "500", Risk: 1, ActionData: "0x03"},
		},
	}

	decision, err := chooseRoute(req)
	if err != nil {
		t.Fatalf("chooseRoute returned error: %v", err)
	}
	if decision.Adapter != "safe" || decision.ExpectedOutput != "200" {
		t.Fatalf("unexpected route selected: %+v", decision)
	}
}

func TestOfficialFCCActionEnvelope(t *testing.T) {
	request := validRequest()
	payload, _ := json.Marshal(request)
	fixed := dataFixed{
		InstructionID: bytes32Hex("instruction"), TeeID: "0x" + stringsRepeat("11", 20),
		OPType: bytes32Hex("SHADOW_ROUTE"), OPCommand: bytes32Hex("EVALUATE"),
		OriginalMessage: "0x" + hex.EncodeToString(payload), AdditionalFixedMessage: "0x",
	}
	fixedJSON, _ := json.Marshal(fixed)
	action := actionEnvelope{AdditionalVariableMessages: []string{}, Timestamps: []uint64{}, AdditionalActionData: "0x", Signatures: []string{}}
	action.Data.ID = bytes32Hex("action")
	action.Data.Type = "instruction"
	action.Data.SubmissionTag = "submit"
	action.Data.Message = "0x" + hex.EncodeToString(fixedJSON)
	body, _ := json.Marshal(action)

	recorder := httptest.NewRecorder()
	key, _ := crypto.HexToECDSA(testSignerKey)
	handleFCCAction(recorder, httptest.NewRequest(http.MethodPost, "/action", bytes.NewReader(body)), key)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d, %s", recorder.Code, recorder.Body.String())
	}
	var result actionResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != 1 || result.Log != "ok" || result.Version != extensionVersion {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestDecisionSignatureRecoversTeeSigner(t *testing.T) {
	req := validRequest()
	decision, err := chooseRoute(req)
	if err != nil {
		t.Fatal(err)
	}
	key, _ := crypto.HexToECDSA(testSignerKey)
	signed, err := signDecision(req, decision, key)
	if err != nil {
		t.Fatal(err)
	}
	sig, _ := decodeHex(signed.Signature)
	sig[64] -= 27
	pub, err := crypto.SigToPub(commonHashBytes(signed.AuthorizationDigest), sig)
	if err != nil {
		t.Fatal(err)
	}
	if crypto.PubkeyToAddress(*pub) != crypto.PubkeyToAddress(key.PublicKey) {
		t.Fatal("signature recovered the wrong signer")
	}
}

func commonHashBytes(value string) []byte { decoded, _ := decodeHex(value); return decoded }

func stringsRepeat(value string, count int) string {
	var output bytes.Buffer
	for i := 0; i < count; i++ {
		output.WriteString(value)
	}
	return output.String()
}

func TestChooseRouteRejectsWhenNoRouteIsEligible(t *testing.T) {
	req := EvaluateRequest{
		IntentID: "0xintent", Router: "router", ChainID: "114", Owner: "0xowner", TokenIn: "0xfxrp", Amount: "100",
		Expiry: uint64(time.Now().Add(2 * time.Hour).Unix()), Deadline: uint64(time.Now().Add(time.Hour).Unix()),
		Constraints: Constraints{AllowedAdapters: []string{"safe"}, MaximumRisk: 1, MinimumOutput: "250"},
		Routes:      []Route{{Adapter: "safe", TokenOut: "0xusdt", ExpectedOutput: "200", Risk: 2}},
	}

	if _, err := chooseRoute(req); err == nil {
		t.Fatal("expected an error when no route satisfies constraints")
	}
}

func TestPrivatePolicyCommitmentIsDeterministicAndPolicyBound(t *testing.T) {
	req := validRequest()
	first, err := privatePolicyCommitment(req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := privatePolicyCommitment(req)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatal("same policy produced different commitments")
	}
	req.Constraints.MinimumOutput = "191"
	changed, err := privatePolicyCommitment(req)
	if err != nil {
		t.Fatal(err)
	}
	if first == changed {
		t.Fatal("changed policy produced the same commitment")
	}
}

func TestPrivatePolicyCommitmentMatchesNodeVector(t *testing.T) {
	req := EvaluateRequest{
		Router: "0x1000000000000000000000000000000000000001", ChainID: "114",
		Owner: "0x2000000000000000000000000000000000000002", TokenIn: "0x3000000000000000000000000000000000000003",
		Amount: "100", Nonce: 2, Expiry: 2_000_000_000,
		Constraints: Constraints{AllowedAdapters: []string{"0x4000000000000000000000000000000000000004", "0x5000000000000000000000000000000000000005"}, MaximumRisk: 3, MinimumOutput: "190"},
	}
	commitment, err := privatePolicyCommitment(req)
	if err != nil {
		t.Fatal(err)
	}
	if commitment.Hex() != "0x57523e0501795698b377318e74d004dac1b129bea3062e57eddafcada2822614" {
		t.Fatalf("cross-language commitment mismatch: %s", commitment.Hex())
	}
}
