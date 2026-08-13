# ShadowRoute source inventory

Audit date: 2026-08-10

## Authority order

1. Deployed/test runtime and fresh executable tests
2. Contracts and service implementation
3. Deployment evidence under `deployments/`
4. Integration and deployment scripts
5. README and scaffold notes

## Sources

| Source | Classification | What it proves | Limits |
|---|---|---|---|
| `contracts/ShadowRouter.sol` | Primary implementation | Intent lifecycle, EIP-712 authorization, adapter allowlist, settlement, cancellation, admin controls | Not independently audited |
| `contracts/UniswapV2RouteAdapter.sol` | Primary implementation | Venue-pinned V2 execution constraints | Only one venue shape; no production audit |
| `contracts/ShadowRouteInstructionSender.sol` | Primary implementation | FCC instruction submission contract | No result polling or settlement orchestration |
| `fcc-extension/main.go` | Primary implementation | Route filtering and EIP-712 signing | Accepts caller-supplied intent facts; no ciphertext decryption/binding or chain read |
| `fcc-scaffold/` | Integration foundation | Official FCC wire/container shape and Coston2 address config | Registration and live proxy operation require credentials and deployment authority |
| `integration/` | Executable support | FDC request, Smart Account memo/UserOp, V2 payload, mint/deposit and redemption tooling | Most live paths depend on testnet state and credentials |
| `deployments/*.json` | Historical runtime evidence | Prior Coston2 mint, liquidity, execution, and redemption records | Snapshot evidence, not fresh end-to-end proof |
| `web/` | Presentation runtime | Read-only evidence viewer and local commitment preview | Does not submit, encrypt, poll FCC, fund, execute, cancel, or redeem |
| `test/`, `integration/*.test.mjs`, `fcc-extension/*_test.go` | Fresh automated proof | Core local contracts, encoding helpers, decision/signature path | No browser E2E, live FCC, role/permission, or failure-recovery proof |
| `README.md` | Product narrative | Intended scope, commands, security caveats, live evidence references | Contains historical claims that require revalidation before release |

## Repository state caveat

The supplied directory is not a Git worktree (`git status` reports no repository), so revision provenance and uncommitted-change analysis are UNVERIFIED.
