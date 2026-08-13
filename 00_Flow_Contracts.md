# ShadowRoute flow contracts

Updated: 2026-08-10

## Canonical private-policy commitment (version 1)

The intent owner commits the following ordered policy fields before funding:

```text
PrivateIntentPolicy(
  uint256 chainId,
  address router,
  address owner,
  address tokenIn,
  uint256 amount,
  uint64 nonce,
  uint64 expiry,
  bytes32 allowedAdaptersHash,
  uint8 maximumRisk,
  uint256 minimumOutput
)
```

`allowedAdaptersHash` is `keccak256` of the ordered concatenation of each adapter encoded as one 32-byte ABI address word. The final commitment is `keccak256(abi.encode(typehash, fields...))`. Adapter order is significant. At least one adapter and a positive minimum output are required.

Reference vector:

```text
chainId: 114
router: 0x1000000000000000000000000000000000000001
owner: 0x2000000000000000000000000000000000000002
tokenIn: 0x3000000000000000000000000000000000000003
amount: 100
nonce: 2
expiry: 2000000000
allowedAdapters:
  - 0x4000000000000000000000000000000000000004
  - 0x5000000000000000000000000000000000000005
maximumRisk: 3
minimumOutput: 190
commitment: 0x57523e0501795698b377318e74d004dac1b129bea3062e57eddafcada2822614
```

Node and both Go FCC implementations assert this vector.

## Intent creation contract

- The commitment is stored in the existing `Intent.ciphertextHash` field.
- Intent identity remains `keccak256(abi.encode(owner, tokenIn, amount, ciphertextHash, expiry, nonce))`.
- Dynamic route candidates and quotes are deliberately outside the policy commitment.

## Route authorization contract

`RouteAuthorization` now includes `bytes32 intentCommitment` after `maximumAmount`. The router rejects a correctly signed authorization unless `intentCommitment == intent.ciphertextHash`.

The FCC computes `intentCommitment` from the decoded request; callers do not supply the signed commitment as an independent assertion. Changing chain, router, owner, token, amount, nonce, expiry, adapter policy, risk ceiling, or minimum output changes the commitment and makes execution against the funded intent fail.

## Remaining trust-boundary work

- The scaffold FCC path decrypts every instruction through tee-node's internal base64 `/decrypt` contract and rejects plaintext/decryption failure.
- FCC reads chain ID, the funded intent, and the live adapter allowlist through a read-only RPC adapter before signing.
- Caller-supplied routes are rejected. A trusted runtime quote-source interface supplies freshness-bounded routes; the current concrete source is static JSON for local/simulated use only.
- Client-side encryption is still blocked on the registered TEE public-key discovery and supported FCC encryption format; the supplied scaffold documents decryption but does not expose an authoritative client encryption helper.
- The static quote source must be replaced by a reviewed authenticated venue quote adapter before production.
- The historical Coston2 router uses the old EIP-712 schema and cannot accept bound authorizations; redeployment is required.
