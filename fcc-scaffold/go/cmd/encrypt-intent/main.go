package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto/ecies"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
)

func main() {
	proxy := flag.String("proxy", os.Getenv("EXT_PROXY_URL"), "FCC extension proxy URL")
	input := flag.String("in", "", "private intent JSON file (defaults to stdin)")
	flag.Parse()
	if *proxy == "" {
		fatal("--proxy or EXT_PROXY_URL is required")
	}
	var plaintext []byte
	var err error
	if *input == "" {
		plaintext, err = io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	} else {
		plaintext, err = os.ReadFile(*input)
	}
	if err != nil || len(plaintext) == 0 {
		fatal("read private intent: %v", err)
	}
	var check any
	if json.Unmarshal(plaintext, &check) != nil {
		fatal("private intent must be valid JSON")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Get(strings.TrimRight(*proxy, "/") + "/info")
	if err != nil {
		fatal("fetch TEE info: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		fatal("fetch TEE info: HTTP %d", response.StatusCode)
	}
	var info struct {
		MachineData struct {
			PublicKey teetypes.PublicKey `json:"publicKey"`
		} `json:"machineData"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&info) != nil || (info.MachineData.PublicKey.X == [32]byte{} && info.MachineData.PublicKey.Y == [32]byte{}) {
		fatal("TEE info has no machineData.publicKey")
	}
	pub, err := teetypes.ParsePubKey(info.MachineData.PublicKey)
	if err != nil {
		fatal("parse TEE public key: %v", err)
	}
	ecPub := &ecies.PublicKey{X: pub.X, Y: pub.Y, Curve: ecies.DefaultCurve, Params: ecies.ECIES_AES128_SHA256}
	ciphertext, err := ecies.Encrypt(rand.Reader, ecPub, plaintext, nil, nil)
	if err != nil {
		fatal("encrypt private intent: %v", err)
	}
	fmt.Println(base64.StdEncoding.EncodeToString(ciphertext))
}
func fatal(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...); os.Exit(1) }
