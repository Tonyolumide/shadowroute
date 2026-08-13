# ShadowRoute surface coverage

Audit date: 2026-08-10

## Route-by-role matrix

| Actor | Goal / entry | Owned implementation surface | Status |
|---|---|---|---|
| XRP holder | Preview a private route | `web/index.html` -> `web/app.js#prepare` | PARTIAL: hashes local JSON only |
| XRP holder / Smart Account | Mint FXRP and atomically fund intent | `integration/run-mint-deposit.mjs`, `resume-mint-deposit.mjs` -> `createAndFundIntent` | PARTIAL: script-driven; historical live proof |
| Intent owner | Create and fund an ERC-20 intent | `createIntent`, `fundIntent`, `createAndFundIntent` | WORKS locally |
| Intent owner | Cancel and recover funds | `cancelIntent` | WORKS locally; absent from UI |
| FCC/TEE | Evaluate private constraints and sign route | `/action`, `/action/evaluate` -> `chooseRoute` -> `signDecision` | PARTIAL: wire/signing works, trust binding incomplete |
| Keeper / any caller | Execute an authorized intent | `executeIntent` -> allowlisted adapter | WORKS locally and has historical Coston2 proof |
| Router owner | Allowlist adapters, rotate signer, pause, transfer ownership | `setAdapter`, `setTeeSigner`, `setPaused`, `transferOwnership` | UNVERIFIED as an operational flow |
| FXRP holder | Redeem FXRP to XRPL | `prepare-redemption.mjs`, `execute-redemption.mjs` | PARTIAL: script-driven; historical live proof |
| Viewer | Inspect testnet evidence | `/`, `/api/evidence`, explorer links | WORKS statically; browser runtime not freshly driven |

## Trigger-to-handler matrix

| Trigger | Handler / contract | Downstream transition | Coverage |
|---|---|---|---|
| Preview button | browser SHA-256 | Shows a non-transactional digest | No automated test |
| Smart Account UserOp | `createAndFundIntent` | Created -> Funded | Contract + encoding tests |
| Direct owner calls | `createIntent`, `fundIntent` | None -> Created -> Funded | Contract tests |
| FCC instruction | `sendEvaluation` -> proxy `/action` | Signed `Decision` result | Unit wire test only |
| Route execution tx | `executeIntent` -> adapter `execute` | Funded -> Executed | Contract tests + historical evidence |
| Owner cancellation | `cancelIntent` | Created/Funded -> Cancelled | Contract test |
| Admin transaction | owner setters | Permission/control mutation | No explicit tests located |
| Redemption scripts | FAsset redemption calls | FXRP -> XRPL payment | Historical evidence only |

## Classification

- Primary product flows: preview/commit, mint-and-fund, confidential evaluation, execute, cancel/recover, redeem.
- Internal/operator flows: deployment, dependency verification, adapter deployment/allowlisting, signer rotation, pause, FCC registration.
- Duplicate transitional surface: standalone `fcc-extension/` and scaffold-hosted extension implementation must converge on one deployable source.
- No dead routes were proven. Generated artifacts, caches, and dependencies are out of audit scope.
