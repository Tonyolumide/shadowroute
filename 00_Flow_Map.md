# ShadowRoute flow map and audit

Audit date: 2026-08-10
Paradigm: web + smart contracts + FCC service + operator automation
Depth: Deep, self-reviewed (independent agents were not authorized)

## Product outcome

An XRP holder should be able to define encrypted route constraints, mint FXRP, fund an on-chain intent, receive a TEE-authorized allowlisted execution, and optionally redeem back to XRPL without publishing strategy constraints.

## Flow status

### F1 — Define and commit private intent: PARTIAL / policy binding implemented

- Entry: demo form.
- Current exit: local SHA-256 preview.
- Expected exit: encrypted payload plus an on-chain commitment that is deterministically bound to the FCC-decrypted request.
- Implemented: a documented cross-language canonical policy commitment now binds chain, router, owner, token, amount, nonce, expiry, ordered allowed adapters, maximum risk and minimum output.
- Gap: the browser neither encrypts nor submits and has not yet been migrated from its read-only preview.

### F2 — Mint FXRP and fund intent: PARTIAL

- Entry: XRPL account and router address.
- Path: 0xFE memo -> FDC proof -> direct mint -> Smart Account UserOp -> `createAndFundIntent`.
- Success: atomic funding is contract-tested and historically proven on Coston2.
- Gaps: CLI-only, credential/state dependent, no unified retry state, and no UI status/recovery.
- Critical recovery invariant: resume existing XRPL/FDC transactions; never repay after interruption.

### F3 — Evaluate confidential route: PARTIAL / secure local adapters implemented

- Entry: FCC `SHADOW_ROUTE/EVALUATE` action.
- Path: decode request -> filter allowed adapters/risk/output -> rank -> sign EIP-712 authorization.
- Success: envelope parsing, selection, and signature recovery are unit-tested.
- Implemented: FCC recomputes the private-policy commitment and signs it; the router rejects any authorization whose commitment differs from the funded intent.
- Implemented in the scaffold: mandatory tee-node `/decrypt`, RPC chain-ID and funded-intent verification, live adapter allowlist verification, rejection of caller-supplied routes, and freshness-bounded trusted quote sourcing.
- Gaps: no client encryption helper/public-key discovery, no attested managed signing key, and the concrete quote source is static trusted-runtime JSON rather than an authenticated venue integration.

### F4 — Execute and settle: WORKS locally / PARTIAL operationally

- Entry: signed decision and adapter payload.
- Path: verify funded status, expiry, allowlist, intent facts, action hash and signer -> transfer input -> adapter -> measure output -> enforce minimum -> transfer to owner.
- Success: forged signatures and malformed adapter calls are rejected in tests; historical Coston2 execution exists.
- Gaps: no durable result-to-transaction orchestrator, no idempotent keeper/retry state, no fresh live FCC execution proof, no contract security audit.

### F5 — Cancel and recover: WORKS locally / missing product surface

- Entry: owner with Created or Funded intent.
- Exit: Cancelled, with funded input refunded.
- Gap: no browser/operator recovery surface and no interruption/status guidance.

### F6 — Redeem to XRPL: PARTIAL

- Entry: FXRP holder and XRPL destination.
- Path: prepare/execute redemption scripts -> FAsset redemption -> validated XRPL payment.
- Success: historical Coston2 evidence.
- Gaps: no unified product surface; stuck-mint recovery is called out but not implemented; fresh runtime proof not run.

### F7 — Govern the trust boundary: UNVERIFIED / high risk

- Actor: router/FCC operator.
- Goals: deploy, allowlist adapter, register TEE, rotate signer, pause safely, transfer ownership, monitor health.
- Gaps: single-key ownership, no timelock/multisig, no explicit admin tests/runbook, live registration requires external credentials, and standalone/scaffold service duplication creates deployment drift risk.

## Regression impact map

Changes to the next batch affect: `ShadowRouter` intent fields and EIP-712 schema; FCC request/decision types; browser commitment encoding; instruction sender/proxy payload; Smart Account mint/deposit encoding; execution scripts; contract/Go/integration tests; deployment evidence schema; signer rotation and cancellation/retry behavior. Existing mint, cancellation, adapter allowlisting, measured-output enforcement, and redemption tooling must remain unchanged.

## Verification gates

| Gate | Result | Evidence |
|---|---|---|
| Contract automated proof | PASS | `npm test`: 7 passing |
| Encoding/integration automated proof | PASS | `npm run test:integration`: 5 passing |
| FCC service automated proof | PASS | `go test ./...`: passing |
| Fresh browser pathway | UNVERIFIED | Server/UI not driven in a browser during this audit |
| Fresh live Coston2/FCC pathway | UNVERIFIED | Credentials, registration, spending, and live mutation not authorized |
| Security audit | FAIL for release readiness | Repository labels contracts unaudited; trust-binding gap remains |
| Revision provenance | UNVERIFIED | Supplied directory is not a Git worktree |
