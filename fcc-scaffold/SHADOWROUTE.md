# ShadowRoute FCC extension

This scaffold now hosts the Go implementation of ShadowRoute's signed route evaluator.
It decrypts the `SHADOW_ROUTE/EVALUATE` instruction through tee-node's internal
`POST /decrypt` boundary, verifies the request against the live funded intent, obtains
routes from trusted runtime configuration, and returns the exact EIP-712 authorization
consumed by the deployed `ShadowRouter`. Plaintext instructions and caller-supplied
routes are rejected.

## Client encryption

The encryption key is runtime-specific. Fetch `machineData.publicKey` from the active
extension proxy's `/info` endpoint; never copy or hard-code a key from documentation.
The included client uses secp256k1 ECIES with `ECIES_AES128_SHA256`, matching Flare's
reference extension:

```bash
cd go
go run ./cmd/encrypt-intent --proxy "$EXT_PROXY_URL" --in private-intent.json
```

It writes only base64 ciphertext to stdout. Keep the plaintext off-chain.

## Trusted runtime configuration

Set `TEE_SIGNER_PRIVATE_KEY` only in the extension TEE runtime. Its derived address must
match the deployed router's `teeSigner`. Never expose the key through the extension proxy,
the browser, an image, or a committed environment file.

Set `CHAIN_URL` (or `COSTON2_RPC_URL`) to the read-only Coston2 RPC endpoint. For local or
simulated runs, `SHADOW_TRUSTED_QUOTES_JSON` supplies operator-controlled quote records;
every record must include `adapter`, `tokenOut`, `expectedOutput`, `risk`, `actionData`,
and `validUntil`, and `validUntil` must cover the authorization deadline. Replace this
static source only for local tests. For live V2 quotes, set `SHADOW_V2_ROUTES_JSON` to
trusted bindings of the form below inside the TEE runtime:

```json
[{"adapter":"0x...","exchangeRouter":"0x...","path":["0xTokenIn","0xTokenOut"],"risk":1}]
```

The extension calls `getAmountsOut` on the configured router for every evaluation and
constructs the narrow adapter calldata itself; the caller cannot inject a quote or call.

The Coston2 deployment and registration commands continue to use the official addresses
in `config/coston2/deployed-addresses.json`. Before live setup, configure:

- private read-only Coston2 indexer credentials in the proxy config;
- a public HTTPS URL for the extension proxy;
- funded deployment/proxy keys and the TEE governance values outside source control.

Then regenerate the Solidity binding and run the scaffold verification layers:

```bash
./scripts/generate-bindings.sh
./scripts/test-unit.sh
cd tools && go build ./...
```

Do not submit another XRPL payment or FXRP redemption while configuring FCC. The existing
testnet evidence is preserved in the parent project's `deployments/` directory.
