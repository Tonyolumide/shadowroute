import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import { Wallet } from "xrpl";
import { createWalletClient, decodeEventLog, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mkdir, writeFile } from "node:fs/promises";
import { getContractAddressByName } from "./flare-registry.mjs";
import { coston2Chain, publicClient } from "./network.mjs";

const amountUBA = BigInt(process.argv[2] || "5000000");
if (!process.env.DEPLOYER_PRIVATE_KEY || !process.env.XRPL_SEED) throw new Error("Missing wallet environment variables");
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const recipient = Wallet.fromSeed(process.env.XRPL_SEED).address;
const walletClient = createWalletClient({ account, chain: coston2Chain, transport: http(process.env.COSTON2_RPC_URL) });
const assetManager = await getContractAddressByName("AssetManagerFXRP");
const fxrp = await publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "fAsset" });
const erc20 = parseAbi(["function balanceOf(address) view returns(uint256)"]);
const [balance, minimum] = await Promise.all([
  publicClient.readContract({ address: fxrp, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "minimumRedeemAmountUBA" })
]);
if (amountUBA < minimum || balance < amountUBA) throw new Error(`Redemption precondition failed: balance=${balance}, minimum=${minimum}`);
await publicClient.simulateContract({ account, address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "redeemAmount", args: [amountUBA, recipient, account.address] });
const hash = await walletClient.writeContract({ account, address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "redeemAmount", args: [amountUBA, recipient, account.address] });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const events = [];
for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({ abi: coston2.iAssetManagerAbi, data: log.data, topics: log.topics });
    if (/Redemption/i.test(decoded.eventName)) events.push({ name: decoded.eventName, args: JSON.parse(JSON.stringify(decoded.args, (_, value) => typeof value === "bigint" ? value.toString() : value)) });
  } catch {}
}
const remaining = await publicClient.readContract({ address: fxrp, abi: erc20, functionName: "balanceOf", args: [account.address] });
const record = { network: "coston2", assetManager, fxrp, redeemer: account.address, xrplRecipient: recipient, amountUBA: amountUBA.toString(), transactionHash: hash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, remainingFXRP: remaining.toString(), redemptionEvents: events };
await mkdir("deployments", { recursive: true });
await writeFile("deployments/coston2-redemption-request.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
