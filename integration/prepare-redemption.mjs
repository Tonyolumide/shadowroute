import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import { Wallet } from "xrpl";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits, parseAbi } from "viem";
import { getContractAddressByName } from "./flare-registry.mjs";
import { publicClient } from "./network.mjs";

const amountUBA = BigInt(process.argv[2] || "1000000");
if (amountUBA <= 0n) throw new Error("Redemption amount must be positive base units");
if (!process.env.DEPLOYER_PRIVATE_KEY || !process.env.XRPL_SEED) throw new Error("Missing wallet environment variables");
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const xrplAddress = Wallet.fromSeed(process.env.XRPL_SEED).address;
const assetManager = await getContractAddressByName("AssetManagerFXRP");
const fxrp = await publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "fAsset" });
const [balance, minimumRedeemAmountUBA, coreVaultMinimumLots, feeBIPS] = await Promise.all([
  publicClient.readContract({ address: fxrp, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "minimumRedeemAmountUBA" }),
  publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "getCoreVaultMinimumRedeemLots" }),
  publicClient.readContract({ address: assetManager, abi: coston2.iAssetManagerAbi, functionName: "getCoreVaultRedemptionFeeBIPS" })
]);
if (balance < amountUBA) throw new Error(`Insufficient FXRP: have ${formatUnits(balance, 6)}, requested ${formatUnits(amountUBA, 6)}`);
if (amountUBA < minimumRedeemAmountUBA) throw new Error(`Amount is below protocol minimum ${minimumRedeemAmountUBA}`);

let simulation;
try {
  const result = await publicClient.simulateContract({
    account,
    address: assetManager,
    abi: coston2.iAssetManagerAbi,
    functionName: "redeemAmount",
    args: [amountUBA, xrplAddress, account.address]
  });
  simulation = { successful: true, requestResult: JSON.stringify(result.result, (_, value) => typeof value === "bigint" ? value.toString() : value) };
} catch (error) {
  simulation = { successful: false, reason: error.shortMessage || error.message };
}

console.log(JSON.stringify({ network: "coston2", account: account.address, xrplRecipient: xrplAddress, assetManager, fxrp, amountUBA: amountUBA.toString(), amountFXRP: formatUnits(amountUBA, 6), walletBalanceFXRP: formatUnits(balance, 6), minimumRedeemAmountUBA: minimumRedeemAmountUBA.toString(), coreVaultMinimumRedeemLots: coreVaultMinimumLots.toString(), coreVaultRedemptionFeeBIPS: feeBIPS.toString(), simulation }, null, 2));
