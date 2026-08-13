# Next implementation batch — bind the confidential intent end to end

## Recommendation

Do not start with a richer transaction UI. First make one canonical encrypted-intent path prove that the bytes committed on-chain are the bytes decrypted and authorized inside FCC. This is the smallest batch that converts the current collection of proven components into a credible confidential-routing flow.

Risk: R3 (authorization, sensitive strategy data, signing key, cross-chain persistence).

## Batch exit criterion

Using disposable Coston2 data, one user can create an encrypted intent, atomically fund its commitment, submit it through the registered FCC proxy, obtain a decision that is cryptographically and on-chain bound to that intent, execute once through the allowlisted adapter, and recover by cancelling if evaluation/execution expires. The transcript must prove no plaintext constraints were placed on-chain or logged outside the trusted boundary.

## Dependency-ordered slices

### 1. Lock the canonical intent envelope and commitment — IMPLEMENTED LOCALLY

- Implemented canonical ABI policy encoding for chain ID, router, owner, token, amount, nonce, expiry, ordered allowed adapters, maximum risk and minimum output.
- Implemented EIP-712 `intentCommitment` binding and router equality enforcement against `Intent.ciphertextHash`.
- Added fixed Node/Go vector and mismatch rejection coverage. Intent status remains the single-use boundary.
- Encryption-envelope versioning and browser encryption remain in slice 2 because ciphertext transport is not yet implemented.

### 2. Make FCC verify before signing — IMPLEMENTED LOCALLY, LIVE ACTIVATION PENDING

- Implemented mandatory scaffold decryption, configured-chain checks, funded-intent field/commitment verification and live adapter allowlist checks.
- Implemented rejection of caller-supplied routes and a trusted quote-source interface with deadline freshness enforcement.
- Implemented bounded HTTP/RPC responses and non-secret boundary errors.
- Pending: registered TEE public-key discovery/client encryption, authenticated live venue quotes, attested key management and live Coston2 proof.

### 3. Converge on one deployable FCC service

- Move the signed evaluator into `fcc-scaffold/go` (or import it as one module) and retire duplicate deployment code.
- Add health/readiness checks that distinguish process health, chain connectivity, signer availability, and registration readiness without exposing key material.
- Add registration/config validation against `config/coston2/deployed-addresses.json`.

### 4. Add a durable submit/poll/execute coordinator

- Persist correlation keys: intent ID, instruction ID, action/result status, authorization digest, execution tx, terminal failure.
- Make retries idempotent and distinguish retryable FCC/indexer/chain failures from terminal policy rejection or expiry.
- Re-read intent state before execution; treat already Executed/Cancelled as terminal success/conflict, not a blind retry.
- Preserve the existing “resume, do not repay” invariant for XRPL/FDC interruption.

### 5. Add the minimal product surface after interaction approval

- Prototype the states first with `flow-prototype`: encrypting, wallet approval, XRPL payment required, FDC pending, funded, confidential evaluation pending/rejected, authorization ready, executing, completed, expired, cancellation/refund, and resume.
- Obtain explicit approval before production UI changes.
- Then connect the existing form to encryption/submission/polling and add cancellation/recovery; keep explorer evidence secondary to live state.

### 6. Prove and review

- Contract tests: admin authorization, pause matrix, expiry boundaries, commitment mismatch, signer rotation, malicious tokens/adapters, same-token behavior, reentrancy, and invariant/fuzz coverage.
- Go tests: chain-read mismatch, decrypt failure, replay, hostile route input, canonical vectors, log redaction, time boundaries, and malformed FCC envelopes.
- Coordinator tests: crash/restart at every external boundary and duplicate callback/transaction behavior.
- Browser accessibility and failure recovery tests after the approved prototype.
- Run an independent smart-contract/security review before any real assets.

## Explicitly deferred

- Production funds or mainnet deployment.
- Multivenue optimization and richer strategy controls.
- Polished dashboard work beyond the approved golden flow.
- Production governance migration (multisig/timelock) may be designed in parallel but requires separate authority to activate.

## Authority/inputs required for live completion

- Read-only Coston2 indexer credentials and registered FCC proxy/TEE configuration.
- A disposable funded testnet actor and approval to spend testnet assets/gas.
- Explicit approval of the flow prototype before production UI implementation.
