package main

import (
	"crypto/rand"
	"encoding/json"
	"flag"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"extension-scaffold/tools/pkg/configs"
	"extension-scaffold/tools/pkg/fccutils"
	"extension-scaffold/tools/pkg/support"
	instrutils "extension-scaffold/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto/ecies"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	"github.com/pkg/errors"
)

type decision struct {
	IntentID            string `json:"intentId"`
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

type liveIntentRecord struct {
	Router           string `json:"router"`
	FXRP             string `json:"fxrp"`
	PersonalAccount  string `json:"personalAccount"`
	AmountUBA        string `json:"amountUBA"`
	IntentID         string `json:"intentId"`
	IntentExpiry     string `json:"intentExpiry"`
	IntentNonce      string `json:"intentNonce"`
	MinimumOutputUBA string `json:"minimumOutputUBA"`
	MaximumRisk      uint8  `json:"maximumRisk"`
	AllowedAdapter   string `json:"allowedAdapter"`
}

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	instructionSenderF := flag.String("instructionSender", "", "instructionSender address")
	flag.Parse()

	instructionSenderAddress := common.HexToAddress(*instructionSenderF)
	testSupport, err := support.DefaultSupport(*af, *cf)
	if err != nil { fccutils.FatalWithCause(err) }

	logger.Infof("Setting extension ID on instruction sender...")
	if err = instrutils.SetExtensionId(testSupport, instructionSenderAddress); err != nil {
		if strings.Contains(err.Error(), "already set") || strings.Contains(err.Error(), "Extension ID already set") {
			logger.Infof("Extension ID already set on contract, continuing")
		} else {
			fccutils.FatalWithCause(errors.Errorf("setExtensionId failed: %s", err))
		}
	}

	recordPath := os.Getenv("SHADOW_LIVE_INTENT_RECORD")
	if recordPath == "" { recordPath = "../../deployments/coston2-mint-deposit-v2.json" }
	recordBytes, err := os.ReadFile(recordPath)
	if err != nil { fccutils.FatalWithCause(errors.Wrap(err, "read live intent record")) }
	var live liveIntentRecord
	if err := json.Unmarshal(recordBytes, &live); err != nil { fccutils.FatalWithCause(errors.Wrap(err, "decode live intent record")) }
	if len(strings.TrimPrefix(live.IntentID, "0x")) != 64 || !common.IsHexAddress(live.Router) || !common.IsHexAddress(live.AllowedAdapter) {
		fccutils.FatalWithCause(errors.New("live intent evidence is incomplete; placeholder live submissions are disabled"))
	}
	expiry, err := strconv.ParseUint(live.IntentExpiry, 10, 64)
	if err != nil || expiry <= uint64(time.Now().Add(2*time.Minute).Unix()) {
		fccutils.FatalWithCause(errors.New("SHADOW_LIVE_INTENT_EXPIRY must be a future Unix timestamp with at least two minutes remaining"))
	}
	deadline := uint64(time.Now().Add(15 * time.Minute).Unix())
	if deadline > expiry { deadline = expiry }
	nonce, err := strconv.ParseUint(live.IntentNonce, 10, 64)
	if err != nil { fccutils.FatalWithCause(errors.New("invalid live intent nonce")) }
	request := map[string]any{
		"intentId": live.IntentID,
		"router": live.Router,
		"chainId": "114",
		"owner": live.PersonalAccount,
		"tokenIn": live.FXRP,
		"amount": live.AmountUBA,
		"nonce": nonce,
		"expiry": expiry,
		"deadline": deadline,
		"constraints": map[string]any{
			"allowedAdapters": []string{live.AllowedAdapter},
			"maximumRisk": live.MaximumRisk,
			"minimumOutput": live.MinimumOutputUBA,
		},
	}
	payload, err := json.Marshal(request)
	if err != nil { fccutils.FatalWithCause(err) }
	ciphertext, err := encryptForTEE(*pf, payload)
	if err != nil { fccutils.FatalWithCause(err) }

	logger.Infof("Sending encrypted SHADOW_ROUTE/EVALUATE instruction...")
	instructionID, txHash, err := instrutils.SendEvaluation(testSupport, instructionSenderAddress, ciphertext)
	if err != nil { fccutils.FatalWithCause(err) }
	logger.Infof("Instruction sent. ID: %s", instructionID.Hex())

	actionResponse, err := fccutils.ActionResult(*pf, instructionID)
	if err != nil { fccutils.FatalWithCause(err) }
	result := actionResponse.Result
	if result.Status != 1 { fccutils.FatalWithCause(errors.Errorf("evaluation failed: %s", result.Log)) }
	var response decision
	if err := json.Unmarshal(result.Data, &response); err != nil { fccutils.FatalWithCause(err) }
	if response.Adapter == "" || response.ExpectedOutput == "" || len(response.AuthorizationDigest) != 66 || len(response.Signature) != 132 {
		fccutils.FatalWithCause(errors.New("evaluation result is missing signed authorization fields"))
	}
	evidence, _ := json.MarshalIndent(map[string]any{"network":"coston2", "instructionId":instructionID.Hex(), "transactionHash":txHash.Hex(), "intentId":live.IntentID, "router":live.Router, "decision":response}, "", "  ")
	evidencePath := filepath.Join(filepath.Dir(recordPath), "coston2-fcc-evaluation-v2.json")
	if err := os.WriteFile(evidencePath, append(evidence, '\n'), 0o600); err != nil {
		fccutils.FatalWithCause(errors.Wrap(err, "write evaluation evidence"))
	}
	logger.Infof("ShadowRoute FCC evaluation passed; adapter=%s expectedOutput=%s", response.Adapter, response.ExpectedOutput)
}

func encryptForTEE(proxy string, plaintext []byte) ([]byte, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Get(strings.TrimRight(proxy, "/") + "/info")
	if err != nil { return nil, errors.Wrap(err, "fetch TEE info") }
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK { return nil, errors.Errorf("fetch TEE info: HTTP %d", response.StatusCode) }
	var info struct {
		MachineData struct { PublicKey teetypes.PublicKey `json:"publicKey"` } `json:"machineData"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&info); err != nil {
		return nil, errors.Wrap(err, "decode TEE info")
	}
	pub, err := teetypes.ParsePubKey(info.MachineData.PublicKey)
	if err != nil { return nil, errors.Wrap(err, "parse TEE public key") }
	ecPub := &ecies.PublicKey{X: pub.X, Y: pub.Y, Curve: ecies.DefaultCurve, Params: ecies.ECIES_AES128_SHA256}
	return ecies.Encrypt(rand.Reader, ecPub, plaintext, nil, nil)
}
