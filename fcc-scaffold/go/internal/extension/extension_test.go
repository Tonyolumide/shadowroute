package extension

import (
	"context"
	"encoding/json"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/types"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

func TestNodeDecrypterUsesBase64WireContract(t *testing.T) {
	server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){var request map[string]string; _=json.NewDecoder(r.Body).Decode(&request); decoded,err:=base64.StdEncoding.DecodeString(request["encryptedMessage"]); if err!=nil||string(decoded)!="ciphertext"{t.Errorf("unexpected decrypt request")}; _=json.NewEncoder(w).Encode(map[string]string{"decryptedMessage":base64.StdEncoding.EncodeToString([]byte("plaintext"))})})); defer server.Close()
	client:=&nodeDecrypter{endpoint:server.URL,client:server.Client()}; plaintext,err:=client.Decrypt(context.Background(),[]byte("ciphertext")); if err!=nil||string(plaintext)!="plaintext"{t.Fatalf("decrypt failed: %q %v",plaintext,err)}
}

type fakeDecrypter struct { plaintext []byte; err error }
func (f fakeDecrypter) Decrypt(context.Context, []byte)([]byte,error){ return f.plaintext,f.err }
type fakeIntentReader struct { intent OnchainIntent; chainID string; exists, allowed bool; err error }
func (f fakeIntentReader) ChainID(context.Context)(string,error){if f.chainID==""{return "114",f.err};return f.chainID,f.err}
func (f fakeIntentReader) Intent(context.Context,string,string)(OnchainIntent,bool,error){return f.intent,f.exists,f.err}
func (f fakeIntentReader) AdapterAllowed(context.Context,string,string)(bool,error){return f.allowed,f.err}
type fakeQuoteSource struct { routes []types.Route; err error }
func (f fakeQuoteSource) Quotes(context.Context,types.EvaluateRequest)([]types.Route,error){return f.routes,f.err}

func secureExtension(req types.EvaluateRequest) *Extension {
	payload,_:=json.Marshal(req); commitment,_:=privatePolicyCommitment(req)
	key,_:=crypto.HexToECDSA(testSignerKey)
	return &Extension{signingKey:key,decrypter:fakeDecrypter{plaintext:payload},intentReader:fakeIntentReader{exists:true,allowed:true,intent:OnchainIntent{Owner:req.Owner,TokenIn:req.TokenIn,Amount:req.Amount,Commitment:commitment.Hex(),Expiry:req.Expiry,Nonce:req.Nonce,Status:2}},quoteSource:fakeQuoteSource{routes:trustedRoutes(req)}}
}
func trustedRoutes(req types.EvaluateRequest)[]types.Route{return []types.Route{{Adapter:req.Constraints.AllowedAdapters[0],TokenOut:"0x5000000000000000000000000000000000000005",ExpectedOutput:"200",Risk:2,ActionData:"0x01",ValidUntil:req.Expiry}}}

const testSignerKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func buildTestAction(opType, opCommand common.Hash, original []byte) teetypes.Action {
	type fixed struct { InstructionID common.Hash `json:"instructionId"`; TeeID common.Address `json:"teeId"`; Timestamp uint64 `json:"timestamp"`; RewardEpochID uint32 `json:"rewardEpochId"`; OPType common.Hash `json:"opType"`; OPCommand common.Hash `json:"opCommand"`; Cosigners []string `json:"cosigners"`; CosignersThreshold uint64 `json:"cosignersThreshold"`; OriginalMessage hexutil.Bytes `json:"originalMessage"` }
	msg, _ := json.Marshal(fixed{OPType:opType, OPCommand:opCommand, OriginalMessage:original})
	return teetypes.Action{Data:teetypes.ActionData{ID:common.HexToHash("0x1234"), SubmissionTag:"submit", Message:msg}}
}

func validRequest() types.EvaluateRequest {
	expiry := uint64(time.Now().Add(2*time.Hour).Unix())
	return types.EvaluateRequest{IntentID:"0x"+strings.Repeat("11",32), Router:"0x1000000000000000000000000000000000000001", ChainID:"114", Owner:"0x2000000000000000000000000000000000000002", TokenIn:"0x3000000000000000000000000000000000000003", Amount:"100", Nonce:2, Expiry:expiry, Deadline:expiry-3600, Constraints:types.Constraints{AllowedAdapters:[]string{"0x4000000000000000000000000000000000000004"}, MaximumRisk:3, MinimumOutput:"190"}}
}

func TestPolicyCommitmentMatchesNodeVector(t *testing.T) {
	req := types.EvaluateRequest{Router:"0x1000000000000000000000000000000000000001", ChainID:"114", Owner:"0x2000000000000000000000000000000000000002", TokenIn:"0x3000000000000000000000000000000000000003", Amount:"100", Nonce:2, Expiry:2_000_000_000, Constraints:types.Constraints{AllowedAdapters:[]string{"0x4000000000000000000000000000000000000004","0x5000000000000000000000000000000000000005"}, MaximumRisk:3, MinimumOutput:"190"}}
	commitment, err := privatePolicyCommitment(req); if err != nil { t.Fatal(err) }
	if commitment.Hex() != "0x57523e0501795698b377318e74d004dac1b129bea3062e57eddafcada2822614" { t.Fatalf("cross-language commitment mismatch: %s", commitment.Hex()) }
}

func TestEvaluateSelectsAndSignsEligibleRoute(t *testing.T) {
	key, _ := crypto.HexToECDSA(testSignerKey)
	req:=validRequest(); e := secureExtension(req)
	status, body := e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute), teeutils.ToHash(config.OPCommandEvaluate), []byte("encrypted")))
	if status != http.StatusOK { t.Fatalf("status %d: %s", status, body) }
	var result teetypes.ActionResult; if err := json.Unmarshal(body, &result); err != nil { t.Fatal(err) }
	if result.Status != 1 { t.Fatalf("evaluation failed: %s", result.Log) }
	var decision types.Decision; if err := json.Unmarshal(result.Data, &decision); err != nil { t.Fatal(err) }
	if decision.ExpectedOutput != "200" || len(decision.Signature) != 132 { t.Fatalf("unexpected decision: %+v", decision) }
	sig, _ := hexutil.Decode(decision.Signature); sig[64] -= 27
	pub, err := crypto.SigToPub(common.HexToHash(decision.AuthorizationDigest).Bytes(), sig); if err != nil { t.Fatal(err) }
	if crypto.PubkeyToAddress(*pub) != crypto.PubkeyToAddress(key.PublicKey) { t.Fatal("signature recovered wrong signer") }
}

func TestEvaluateRejectsMissingRuntimeSigner(t *testing.T) {
	req:=validRequest(); e:=secureExtension(req); e.signingKey=nil
	_, body := e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute), teeutils.ToHash(config.OPCommandEvaluate), []byte("encrypted")))
	var result teetypes.ActionResult; _ = json.Unmarshal(body, &result)
	if result.Status != 0 || !strings.Contains(result.Log, "TEE_SIGNER_PRIVATE_KEY") { t.Fatalf("unexpected result: %+v", result) }
}

func TestEvaluateRejectsIneligibleRoutes(t *testing.T) {
	req := validRequest(); req.Constraints.MinimumOutput = "201"
	if _, err := chooseRoute(req, trustedRoutes(req)); err == nil { t.Fatal("expected no eligible route") }
}

func TestEvaluateRejectsPlaintextWhenDecryptionFails(t *testing.T) {
	req:=validRequest(); e:=secureExtension(req); e.decrypter=fakeDecrypter{err:errors.New("decrypt failed")}
	payload,_:=json.Marshal(req); _,body:=e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute),teeutils.ToHash(config.OPCommandEvaluate),payload))
	var result teetypes.ActionResult; _=json.Unmarshal(body,&result); if result.Status!=0||!strings.Contains(result.Log,"decrypt failed"){t.Fatalf("unexpected result: %+v",result)}
}

func TestEvaluateRejectsMismatchedFundedIntent(t *testing.T) {
	req:=validRequest(); e:=secureExtension(req); reader:=e.intentReader.(fakeIntentReader); reader.intent.Amount="101"; e.intentReader=reader
	_,body:=e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute),teeutils.ToHash(config.OPCommandEvaluate),[]byte("encrypted")))
	var result teetypes.ActionResult; _=json.Unmarshal(body,&result); if result.Status!=0||!strings.Contains(result.Log,"does not match funded intent"){t.Fatalf("unexpected result: %+v",result)}
}

func TestEvaluateRejectsWrongRPCChain(t *testing.T) {
	req:=validRequest(); e:=secureExtension(req); reader:=e.intentReader.(fakeIntentReader); reader.chainID="16"; e.intentReader=reader
	_,body:=e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute),teeutils.ToHash(config.OPCommandEvaluate),[]byte("encrypted"))); var result teetypes.ActionResult; _=json.Unmarshal(body,&result)
	if result.Status!=0||!strings.Contains(result.Log,"configured RPC"){t.Fatalf("unexpected result: %+v",result)}
}

func TestEvaluateIgnoresRequesterRoutesAndUsesTrustedQuotes(t *testing.T) {
	req:=validRequest()
	e:=secureExtension(req); trusted:=types.Route{Adapter:req.Constraints.AllowedAdapters[0],TokenOut:"0x5000000000000000000000000000000000000005",ExpectedOutput:"200",Risk:2,ActionData:"0x01",ValidUntil:req.Expiry}; e.quoteSource=fakeQuoteSource{routes:[]types.Route{trusted}}
	_,body:=e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute),teeutils.ToHash(config.OPCommandEvaluate),[]byte("encrypted"))); var result teetypes.ActionResult; _=json.Unmarshal(body,&result); var decision types.Decision; _=json.Unmarshal(result.Data,&decision)
	if result.Status!=1||decision.Adapter!=trusted.Adapter{t.Fatalf("requester route influenced decision: %+v",decision)}
}

func TestEvaluateRejectsCallerSuppliedRoutes(t *testing.T) {
	req:=validRequest(); e:=secureExtension(req); payload,_:=json.Marshal(req); hostile:=strings.TrimSuffix(string(payload),"}")+`,"routes":[{"adapter":"0x6000000000000000000000000000000000000006"}]}`; e.decrypter=fakeDecrypter{plaintext:[]byte(hostile)}
	_,body:=e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute),teeutils.ToHash(config.OPCommandEvaluate),[]byte("encrypted"))); var result teetypes.ActionResult; _=json.Unmarshal(body,&result)
	if result.Status!=0||!strings.Contains(result.Log,"unknown field"){t.Fatalf("caller-supplied routes were not rejected: %+v",result)}
}

func TestEvaluateRejectsStaleTrustedQuote(t *testing.T) {
	req:=validRequest(); e:=secureExtension(req); stale:=trustedRoutes(req); stale[0].ValidUntil=req.Deadline-1; e.quoteSource=fakeQuoteSource{routes:stale}
	_,body:=e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute),teeutils.ToHash(config.OPCommandEvaluate),[]byte("encrypted"))); var result teetypes.ActionResult; _=json.Unmarshal(body,&result)
	if result.Status!=0||!strings.Contains(result.Log,"no route satisfies"){t.Fatalf("stale quote was accepted: %+v",result)}
}

func TestEvaluateRejectsAdapterRemovedFromOnchainAllowlist(t *testing.T) {
	req:=validRequest(); e:=secureExtension(req); reader:=e.intentReader.(fakeIntentReader); reader.allowed=false; e.intentReader=reader
	_,body:=e.processAction(buildTestAction(teeutils.ToHash(config.OPTypeShadowRoute),teeutils.ToHash(config.OPCommandEvaluate),[]byte("encrypted"))); var result teetypes.ActionResult; _=json.Unmarshal(body,&result)
	if result.Status!=0||!strings.Contains(result.Log,"not allowlisted"){t.Fatalf("removed adapter was accepted: %+v",result)}
}

func TestUnknownOperationDiagnostics(t *testing.T) {
	status, body := (&Extension{}).processAction(buildTestAction(teeutils.ToHash("UNKNOWN"), teeutils.ToHash(config.OPCommandEvaluate), nil))
	if status != http.StatusNotImplemented || !strings.Contains(string(body), config.OPTypeShadowRoute) { t.Fatalf("unexpected diagnostic: %d %s", status, body) }
}
