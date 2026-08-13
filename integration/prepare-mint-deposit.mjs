import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import { getAddress, isAddress, parseAbi } from "viem";
import { getContractAddressByName } from "./flare-registry.mjs";
import { publicClient } from "./network.mjs";
import { buildMintAndDepositCalls, encodeHashInstructionMemo } from "./smart-account.mjs";
import { privatePolicyCommitment } from "./intent-commitment.mjs";

const [xrplAddress, routerInput, amountInput = "1000000"] = process.argv.slice(2);
if (!xrplAddress || !routerInput || !isAddress(routerInput)) {
  console.error("Usage: node integration/prepare-mint-deposit.mjs <XRPL_ADDRESS> <SHADOW_ROUTER_ADDRESS> [FXRP_BASE_UNITS]");
  process.exit(1);
}

const router = getAddress(routerInput);
if (!process.env.SHADOW_ALLOWED_ADAPTER || !isAddress(process.env.SHADOW_ALLOWED_ADAPTER)) {
  throw new Error("SHADOW_ALLOWED_ADAPTER must be the reviewed adapter committed by the private policy");
}
const allowedAdapter = getAddress(process.env.SHADOW_ALLOWED_ADAPTER);
const [controller, assetManager] = await Promise.all([
  getContractAddressByName("MasterAccountController"),
  getContractAddressByName("AssetManagerFXRP")
]);
const [personalAccount, fxrp] = await Promise.all([
  publicClient.readContract({
    address: controller,
    abi: coston2.iMasterAccountControllerAbi,
    functionName: "getPersonalAccount",
    args: [xrplAddress]
  }),
  publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "fAsset" })
]);

const memoNonceAbi = parseAbi(["function getNonce(address personalAccount) view returns (uint256)"]);
const nonce = await publicClient.readContract({
  address: controller,
  abi: memoNonceAbi,
  functionName: "getNonce",
  args: [personalAccount]
});
const amount = BigInt(amountInput);
const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
const intentNonce = await publicClient.readContract({
  address: router,
  abi: parseAbi(["function nextIntentNonce(address owner) view returns (uint64)"]),
  functionName: "nextIntentNonce",
  args: [personalAccount]
});
const ciphertextHash = privatePolicyCommitment({
  chainId: 114n, router, owner: personalAccount, tokenIn: fxrp, amount,
  nonce: intentNonce, expiry, allowedAdapters: [allowedAdapter], maximumRisk: 3, minimumOutput: amount
});
const calls = buildMintAndDepositCalls({ fxrp, router, amount, ciphertextHash, expiry });
const encoded = encodeHashInstructionMemo({ calls, sender: personalAccount, nonce });

console.log(JSON.stringify({
  network: "coston2",
  xrplAddress,
  personalAccount,
  assetManager,
  fxrp,
  router,
  amount: amount.toString(),
  nonce: nonce.toString(),
  intentNonce: intentNonce.toString(),
  allowedAdapters: [allowedAdapter],
  ciphertextHash,
  expiry: expiry.toString(),
  memoData: encoded.memoData,
  packedUserOperation: encoded.data,
  userOpHash: encoded.userOpHash,
  warning: "Preparation only: no XRPL payment or Flare transaction was sent."
}, null, 2));
