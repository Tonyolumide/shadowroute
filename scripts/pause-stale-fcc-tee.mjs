import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";

const root = resolve(import.meta.dirname, "..");
function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return [];
    const index = line.indexOf("=");
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[line.slice(0, index).trim(), value]];
  }));
}

const env = parseEnv(await readFile(resolve(root, "fcc-scaffold", ".env"), "utf8"));
const deployment = JSON.parse(await readFile(resolve(root, "deployments", "coston2-fcc-extension.json"), "utf8"));
const provider = new JsonRpcProvider(env.CHAIN_URL);
if ((await provider.getNetwork()).chainId !== 114n) throw new Error("Refusing to transact outside Coston2");
const wallet = new Wallet(env.DEPLOYMENT_PRIVATE_KEY, provider);
const manager = new Contract(deployment.flareTeeManager, [
  "function getTeeMachineOwner(address) view returns (address)",
  "function getTeeMachineStatus(address) view returns (uint8)",
  "function getActiveTeeMachines(uint256) view returns (address[] teeIds,string[] urls)",
  "function pause(address)",
], wallet);

const current = getAddress(deployment.teeId);
const stale = getAddress(deployment.previousTeeIds.at(-1));
const [activeBefore, staleOwner, staleStatus, currentStatus] = await Promise.all([
  manager.getActiveTeeMachines(BigInt(deployment.extensionIdDecimal)),
  manager.getTeeMachineOwner(stale),
  manager.getTeeMachineStatus(stale),
  manager.getTeeMachineStatus(current),
]);
const activeIds = activeBefore.teeIds.map(getAddress);
if (!activeIds.includes(current) || !activeIds.includes(stale)) throw new Error("Expected both current and stale TEE in active pool");
if (getAddress(staleOwner) !== getAddress(wallet.address)) throw new Error("Configured deployer does not own stale TEE");
if (staleStatus !== 2n || currentStatus !== 2n) throw new Error("Unexpected pre-pause TEE status");

const tx = await manager.pause(stale);
const receipt = await tx.wait();
if (receipt.status !== 1) throw new Error("Stale TEE pause failed");
const activeAfter = await manager.getActiveTeeMachines(BigInt(deployment.extensionIdDecimal));
const afterIds = activeAfter.teeIds.map(getAddress);
if (!afterIds.includes(current) || afterIds.includes(stale)) throw new Error("Active TEE pool was not cleaned up correctly");

const evidence = {
  network: "coston2",
  extensionId: deployment.extensionIdDecimal,
  staleTeeId: stale,
  currentTeeId: current,
  pauseTransactionHash: receipt.hash,
  activeTeeIdsAfter: afterIds,
};
await writeFile(resolve(root, "deployments", "coston2-fcc-stale-tee-pause.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
console.log("SECRET_VALUES_PRINTED=NO");
