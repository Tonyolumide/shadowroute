import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import { mkdir, writeFile } from "node:fs/promises";
import { Client, Wallet, dropsToXrp, xrpToDrops } from "xrpl";
import {
  createWalletClient,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  executeDirectMintingWithData,
  prepareXrpPaymentRequest,
  retrieveXrpPaymentProof,
  submitAttestationRequest
} from "./fdc-xrp.mjs";
import { getContractAddressByName } from "./flare-registry.mjs";
import { coston2Chain, publicClient } from "./network.mjs";
import { buildMintAndDepositCalls, encodeHashInstructionMemo } from "./smart-account.mjs";
import { privatePolicyCommitment } from "./intent-commitment.mjs";

const router = process.argv[2];
const netMintUBA = BigInt(process.argv[3] || "1000000");
if (!process.argv[4] || !/^\d+$/.test(process.argv[4])) {
  throw new Error("Usage: node integration/run-mint-deposit.mjs <ROUTER_ADDRESS> <NET_MINT_UBA> <MINIMUM_OUTPUT_UBA>");
}
const minimumOutputUBA = BigInt(process.argv[4]);
if (!/^0x[0-9a-fA-F]{40}$/.test(router || "")) {
  throw new Error("Usage: node integration/run-mint-deposit.mjs <ROUTER_ADDRESS> [NET_MINT_UBA]");
}
if (!process.env.DEPLOYER_PRIVATE_KEY || !process.env.XRPL_SEED) {
  throw new Error("DEPLOYER_PRIVATE_KEY and XRPL_SEED must be loaded from .env");
}
if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.SHADOW_ALLOWED_ADAPTER || "")) {
  throw new Error("SHADOW_ALLOWED_ADAPTER must be the reviewed adapter committed by the private policy");
}

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: coston2Chain, transport: http(process.env.COSTON2_RPC_URL) });
const xrplWallet = Wallet.fromSeed(process.env.XRPL_SEED);
const xrplClient = new Client(process.env.XRPL_TESTNET_RPC_URL);

async function waitForXrplConfirmations(transactionLedger, confirmations = 3) {
  const target = transactionLedger + confirmations;
  while (true) {
    const response = await xrplClient.request({ command: "ledger", ledger_index: "validated" });
    if (response.result.ledger_index >= target) return response.result.ledger_index;
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

async function main() {
  const [assetManager, controller] = await Promise.all([
    getContractAddressByName("AssetManagerFXRP"),
    getContractAddressByName("MasterAccountController")
  ]);
  const [fxrp, coreVault, executorFeeUBA, feeBIPS, minimumFeeUBA, personalAccount] = await Promise.all([
    publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "fAsset" }),
    publicClient.readContract({ address: assetManager, abi: coston2.iDirectMintingAbi, functionName: "directMintingPaymentAddress" }),
    publicClient.readContract({ address: assetManager, abi: coston2.iDirectMintingSettingsAbi, functionName: "getDirectMintingExecutorFeeUBA" }),
    publicClient.readContract({ address: assetManager, abi: coston2.iDirectMintingSettingsAbi, functionName: "getDirectMintingFeeBIPS" }),
    publicClient.readContract({ address: assetManager, abi: coston2.iDirectMintingSettingsAbi, functionName: "getDirectMintingMinimumFeeUBA" }),
    publicClient.readContract({
      address: controller,
      abi: coston2.iMasterAccountControllerAbi,
      functionName: "getPersonalAccount",
      args: [xrplWallet.address]
    })
  ]);
  const nonce = await publicClient.readContract({
    address: controller,
    abi: parseAbi(["function getNonce(address personalAccount) view returns (uint256)"]),
    functionName: "getNonce",
    args: [personalAccount]
  });
  const intentNonce = await publicClient.readContract({
    address: router,
    abi: parseAbi(["function nextIntentNonce(address owner) view returns (uint64)"]),
    functionName: "nextIntentNonce",
    args: [personalAccount]
  });
  const proportionalFee = netMintUBA * feeBIPS / 10_000n;
  const mintingFeeUBA = proportionalFee > minimumFeeUBA ? proportionalFee : minimumFeeUBA;
  const grossUBA = netMintUBA + mintingFeeUBA + executorFeeUBA;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 7_200);
  const ciphertextHash = privatePolicyCommitment({
    chainId: 114n, router, owner: personalAccount, tokenIn: fxrp, amount: netMintUBA,
    nonce: intentNonce, expiry, allowedAdapters: [process.env.SHADOW_ALLOWED_ADAPTER],
    maximumRisk: 2, minimumOutput: minimumOutputUBA
  });
  const calls = buildMintAndDepositCalls({ fxrp, router, amount: netMintUBA, ciphertextHash, expiry });
  const encoded = encodeHashInstructionMemo({ calls, sender: personalAccount, nonce });
  const intentId = keccak256(encodeAbiParameters(
    [
      { type: "address" }, { type: "address" }, { type: "uint256" },
      { type: "bytes32" }, { type: "uint64" }, { type: "uint64" }
    ],
    [personalAccount, fxrp, netMintUBA, ciphertextHash, expiry, intentNonce]
  ));

  await xrplClient.connect();
  const balance = await xrplClient.getXrpBalance(xrplWallet.address);
  const grossXrp = dropsToXrp(grossUBA.toString());
  if (Number(balance) <= Number(grossXrp)) throw new Error(`Insufficient XRPL testnet balance: ${balance} XRP`);

  const prepared = await xrplClient.autofill({
    TransactionType: "Payment",
    Account: xrplWallet.address,
    Destination: coreVault,
    Amount: xrpToDrops(grossXrp),
    Memos: [{ Memo: { MemoData: encoded.memoData.slice(2).toUpperCase() } }]
  });
  const signed = xrplWallet.sign(prepared);
  const submitted = await xrplClient.submitAndWait(signed.tx_blob);
  if (submitted.result.meta?.TransactionResult !== "tesSUCCESS") {
    throw new Error(`XRPL payment failed: ${submitted.result.meta?.TransactionResult}`);
  }
  const xrplTransactionHash = submitted.result.hash;
  await waitForXrplConfirmations(submitted.result.ledger_index, 3);

  const preparedProof = await prepareXrpPaymentRequest({
    transactionId: xrplTransactionHash,
    proofOwner: account.address
  });
  const attestation = await submitAttestationRequest({
    walletClient,
    account,
    abiEncodedRequest: preparedProof.abiEncodedRequest
  });
  const proof = await retrieveXrpPaymentProof({
    abiEncodedRequest: preparedProof.abiEncodedRequest,
    roundId: attestation.roundId
  });
  const mint = await executeDirectMintingWithData({
    walletClient,
    account,
    proof,
    data: encoded.data,
    value: 0n
  });

  const record = {
    network: "coston2",
    router,
    fxrp,
    personalAccount,
    netMintFXRP: formatUnits(netMintUBA, 6),
    amountUBA: netMintUBA.toString(),
    grossPaymentXRP: grossXrp,
    ciphertextHash,
    intentId,
    intentExpiry: expiry.toString(),
    intentNonce: intentNonce.toString(),
    minimumOutputUBA: minimumOutputUBA.toString(),
    maximumRisk: 2,
    allowedAdapter: process.env.SHADOW_ALLOWED_ADAPTER,
    userOpHash: encoded.userOpHash,
    xrplTransactionHash,
    fdcRequestTransactionHash: attestation.hash,
    fdcRoundId: attestation.roundId,
    flareMintTransactionHash: mint.hash
  };
  await mkdir("deployments", { recursive: true });
  await writeFile("deployments/coston2-mint-deposit-v2.json", JSON.stringify(record, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(record, null, 2));
}

try {
  await main();
} finally {
  if (xrplClient.isConnected()) await xrplClient.disconnect();
}
