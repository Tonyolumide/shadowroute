# ShadowRoute — Flare Summer Signal Submission

## Selected bounties

- Interoperable Asset Products
- Confidential Compute Apps

## Short description

ShadowRoute turns an XRPL payment into a privately evaluated DeFi route on Flare. FDC proves the payment, FXRP is minted directly into a Smart Account-funded intent, and a Flare Confidential Compute extension evaluates encrypted minimum-output and risk constraints. ShadowRouter accepts only the TEE's exact EIP-712 authorization and executes through an allowlisted Pangolin adapter.

## Target user

XRP holders, wallet teams and XRPFi applications that want access to Flare liquidity without exposing route constraints before execution.

## Try it

- Live app: https://shadowroute.vercel.app
- Source: https://github.com/Tonyolumide/shadowroute
- Coston2 router: `0x3b9D9EaFf4D79A51505918c03989A16D5F84b511`

Judges can choose **Explore verified execution** without a wallet. **Preview my private intent** is deliberately gated behind an EVM wallet connected to Coston2, chain ID 114. Both paths are read-only in the public demo and never submit a transaction.

## Why this is useful

Public mempools reveal slippage limits, venue preferences and execution strategies. That leakage makes larger or more sophisticated cross-chain orders easier to anticipate and exploit. ShadowRoute keeps the policy private until a trusted FCC evaluator has selected an allowed route, while leaving funding, authorization and final settlement publicly verifiable.

## Meaningful Flare integration

| Flare capability | Role in ShadowRoute |
| --- | --- |
| FDC | Proves the originating XRPL payment and memo. |
| FAssets / FXRP | Brings XRP-derived liquidity into Flare DeFi. |
| Smart Accounts | Atomically approves and deposits directly minted FXRP into the intent. |
| FCC | Decrypts and evaluates the private route policy and signs the exact authorization. |
| EVM contracts | Enforce signer, commitment, nonce, deadline, adapter, calldata and minimum output. |

Removing any one of these changes the product rather than merely changing infrastructure.

## Live result

- XRPL payment: `27135C1598F4A1D64D9CA70B484FEE19311F9D34CA39D0C8451E93BAA7E3962A`
- Atomic FXRP mint and funding: `0x2bb9fc9a8fa793a998e24b1d7bc385e7cfab2e8e0f4647d96afb24075c45415d`
- Encrypted FCC evaluation: `0xd6f0d0a63637f90ef2d481ee9e22e25fb731f90bd656bbf7a207c4a150292a53`
- Pangolin execution: `0xaed6ef40cc308c8c76425f50acc24a19aff1e00c9a6a2817621d1482aff2d598`
- Result: `1 FXRP` funded and `0.594003 USDT0` delivered against a signed `0.560000 USDT0` minimum.

Machine-readable evidence is committed under `deployments/` and exposed read-only at https://shadowroute.vercel.app/api/evidence.

## What was newly built

During Summer Signal, the project implemented the router, private-policy commitment, FCC evaluator port, encrypted instruction flow, Smart Account mint-and-deposit integration, constrained Pangolin adapter, Coston2 deployments, live executions, test coverage and public judge interface. The official Flare FCC scaffold and Flare protocol packages are upstream dependencies rather than claimed original work.

## Technical quality

- 8 Solidity tests covering funding, authorization, forgery rejection, commitment mismatch, cancellation and adapter constraints.
- 7 integration tests covering FDC request construction, policy commitments, Smart Account memo encoding and constrained routes.
- FCC Go tests pass for the evaluator runtime; one tooling-only Windows permission test is platform-specific and documented separately.
- Secrets, indexer credentials and signer keys are excluded from the public repository.

## Roadmap

1. Browser-driven XRPL payment initiation and resumable progress tracking.
2. Independent security review, multisig ownership and timelocked administration.
3. Additional allowlisted venues, private order types and evaluator redundancy.
4. Production FAssets deployment and a wallet/application intent SDK.

## Safety and scope

This is an unaudited Coston2 prototype. The public application is read-only and does not request asset transfers or transaction signatures. Settlement remains publicly visible even though route decisions are confidential.
