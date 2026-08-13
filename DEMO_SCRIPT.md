# ShadowRoute Demo Script

Target length: 2 minutes 30 seconds. Record at 1080p with the browser zoom at 100%.

## 0:00–0:20 — Problem

Open https://shadowroute.vercel.app.

Say: “XRP holders can enter Flare DeFi through FXRP, but a public route reveals minimum output, risk tolerance and venue preferences. ShadowRoute keeps that strategy private while preserving public settlement.”

## 0:20–0:40 — Product

Point to the three stages and the live testnet result.

Say: “The user defines an intent, Flare interoperates with XRPL through FDC and FAssets, then FCC authorizes an approved route.”

## 0:40–1:20 — Wallet-free judge path

Click **Explore verified execution**.

1. On **01 Intent**, show the on-chain policy commitment and explain that plaintext constraints are not published.
2. On **02 Interoperate**, point out XRPL proof, atomic FXRP mint and the FCC-signed authorization.
3. On **03 Route**, show `0.594003 USDT0` delivered above the signed `0.560000 USDT0` minimum.
4. Open the Coston2 execution proof in a new tab, then return to the app.

## 1:20–1:45 — Authorization boundary

Close the dialog and click **Preview my private intent** in a browser without a wallet, or cancel the connection prompt.

Say: “Judges can inspect evidence without a wallet, but a custom intent is blocked until an EVM account is connected to Coston2. The public demo never submits a transaction.”

## 1:45–2:15 — Architecture

Open the GitHub README architecture diagram.

Say: “FDC proves the XRPL payment. FXRP is minted through a Smart Account directly into ShadowRouter. The encrypted policy reaches a registered FCC TEE. Its EIP-712 authorization binds the commitment, exact adapter calldata, output token, nonce, deadline and minimum output. Only the allowlisted Pangolin adapter can execute.”

## 2:15–2:30 — Close

Say: “ShadowRoute makes XRP interoperable without making the execution strategy public. The full Coston2 evidence, contracts and tests are available in the repository.”

## Recording checklist

- Confirm the live app, `/api/evidence`, Coston2 explorer and GitHub are reachable.
- Confirm the FCC proxy and registered TEE report production status.
- Use a clean browser profile with notifications hidden.
- Do not expose `.env`, terminals containing credentials, wallet private keys or indexer configuration.
- Do not repeat an XRPL payment, mint, FCC transaction or redemption for the recording.
