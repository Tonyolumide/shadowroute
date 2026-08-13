import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import { Client, Wallet } from "xrpl";
import { createWalletClient, http, keccak256, parseAbi, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mkdir, writeFile } from "node:fs/promises";
import { executeDirectMintingWithData, prepareXrpPaymentRequest, retrieveXrpPaymentProof } from "./fdc-xrp.mjs";
import { getContractAddressByName } from "./flare-registry.mjs";
import { coston2Chain, publicClient } from "./network.mjs";
import { buildMintAndDepositCalls, encodeHashInstructionMemo } from "./smart-account.mjs";

const [router, xrplHash, fdcHash] = process.argv.slice(2);
const netMintUBA = BigInt(process.argv[5] || "1000000");
if (!/^0x[0-9a-fA-F]{40}$/.test(router || "") || !/^[0-9A-Fa-f]{64}$/.test(xrplHash || "") || !/^0x[0-9A-Fa-f]{64}$/.test(fdcHash || "")) {
  throw new Error("Usage: node integration/resume-mint-deposit.mjs <ROUTER> <XRPL_HASH> <FDC_TX_HASH> [NET_MINT_UBA]");
}
if (!process.env.DEPLOYER_PRIVATE_KEY || !process.env.XRPL_SEED) throw new Error("Missing wallet environment variables");

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: coston2Chain, transport: http(process.env.COSTON2_RPC_URL) });
const xrplWallet = Wallet.fromSeed(process.env.XRPL_SEED);
const xrplClient = new Client(process.env.XRPL_TESTNET_RPC_URL);

async function main() {
  await xrplClient.connect();
  const xrplTx = (await xrplClient.request({ command: "tx", transaction: xrplHash, binary: false })).result;
  const memoHex = xrplTx.tx_json?.Memos?.[0]?.Memo?.MemoData || xrplTx.Memos?.[0]?.Memo?.MemoData;
  if (!memoHex?.toUpperCase().startsWith("FE")) throw new Error("The XRPL transaction has no 0xFE instruction memo");
  const committedHash = `0x${memoHex.slice(20)}`.toLowerCase();
  const txUnixTime = Number(xrplTx.tx_json?.date ?? xrplTx.date) + 946684800;

  const [assetManager, controller] = await Promise.all([
    getContractAddressByName("AssetManagerFXRP"), getContractAddressByName("MasterAccountController")
  ]);
  const [fxrp, personalAccount] = await Promise.all([
    publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "fAsset" }),
    publicClient.readContract({ address: controller, abi: coston2.iMasterAccountControllerAbi, functionName: "getPersonalAccount", args: [xrplWallet.address] })
  ]);
  const ciphertextHash = keccak256(stringToHex(JSON.stringify({ version: 1, objective: "best-allowed-route", maximumRisk: 3, minimumOutput: netMintUBA.toString() })));
  let recovered;
  for (let delta = -120; delta <= 120 && !recovered; delta++) {
    const expiry = BigInt(txUnixTime + 7200 + delta);
    const calls = buildMintAndDepositCalls({ fxrp, router, amount: netMintUBA, ciphertextHash, expiry });
    const encoded = encodeHashInstructionMemo({ calls, sender: personalAccount, nonce: 0n });
    if (encoded.userOpHash.toLowerCase() === committedHash) recovered = { expiry, ...encoded };
  }
  if (!recovered) throw new Error(`Could not recover committed operation near XRPL time ${txUnixTime}`);

  const receipt = await publicClient.getTransactionReceipt({ hash: fdcHash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const manager = await getContractAddressByName("FlareSystemsManager");
  const [start, duration] = await Promise.all([
    publicClient.readContract({ address: manager, abi: coston2.iFlareSystemsManagerAbi, functionName: "firstVotingRoundStartTs" }),
    publicClient.readContract({ address: manager, abi: coston2.iFlareSystemsManagerAbi, functionName: "votingEpochDurationSeconds" })
  ]);
  const roundId = Number((block.timestamp - start) / duration);
  const prepared = await prepareXrpPaymentRequest({ transactionId: xrplHash, proofOwner: account.address });
  console.log(`Recovered payload; retrieving finalized FDC proof for round ${roundId}...`);
  const proof = await retrieveXrpPaymentProof({ abiEncodedRequest: prepared.abiEncodedRequest, roundId, maximumAttempts: 36 });
  const mint = await executeDirectMintingWithData({ walletClient, account, proof, data: recovered.data });
  const routerAbi = parseAbi(["function nextIntentNonce(address) view returns (uint64)"]);
  const [routerBalance, intentNonce] = await Promise.all([
    publicClient.readContract({ address: fxrp, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [router] }),
    publicClient.readContract({ address: router, abi: routerAbi, functionName: "nextIntentNonce", args: [personalAccount] })
  ]);
  const record = { network: "coston2", router, fxrp, personalAccount, netMintUBA: netMintUBA.toString(), ciphertextHash, expiry: recovered.expiry.toString(), userOpHash: recovered.userOpHash, xrplTransactionHash: xrplHash, fdcRequestTransactionHash: fdcHash, fdcRoundId: roundId, flareMintTransactionHash: mint.hash, routerBalanceUBA: routerBalance.toString(), nextIntentNonce: intentNonce.toString() };
  await mkdir("deployments", { recursive: true });
  await writeFile("deployments/coston2-mint-deposit.json", JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(record, null, 2));
}

try { await main(); } finally { if (xrplClient.isConnected()) await xrplClient.disconnect(); }
