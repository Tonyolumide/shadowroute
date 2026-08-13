import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  Contract,
  JsonRpcProvider,
  computeAddress,
  getAddress,
} from "ethers";

const root = resolve(import.meta.dirname, "..");

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return [];
    const index = line.indexOf("=");
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return [[line.slice(0, index).trim(), value]];
  }));
}

const deployment = JSON.parse(await readFile(
  resolve(root, "deployments", "coston2-fcc-extension.json"),
  "utf8",
));
const env = parseEnv(await readFile(resolve(root, "fcc-scaffold", ".env"), "utf8"));
const provider = new JsonRpcProvider(env.CHAIN_URL);
const manager = new Contract(deployment.flareTeeManager, [
  "function getTeeMachine(address) view returns ((address,address,string))",
  "function getTeeMachineStatus(address) view returns (uint8)",
], provider);

const publicUrl = `https://${deployment.proxyHost}/info`;
const response = await fetch(publicUrl);
if (!response.ok) throw new Error(`Public proxy returned HTTP ${response.status}`);
const info = await response.json();
const { x, y } = info.machineData.publicKey;
const publicTeeId = getAddress(computeAddress(`0x04${x.slice(2)}${y.slice(2)}`));
const expectedTeeId = getAddress(deployment.teeId);
const [machine, status] = await Promise.all([
  manager.getTeeMachine(expectedTeeId),
  manager.getTeeMachineStatus(expectedTeeId),
]);

console.log(`PUBLIC_PROXY_HTTP=${response.status}`);
console.log(`PUBLIC_TEE_ID=${publicTeeId}`);
console.log(`REGISTERED_TEE_ID=${expectedTeeId}`);
console.log(`PUBLIC_TEE_ID_MATCH=${publicTeeId === expectedTeeId ? "YES" : "NO"}`);
console.log(`ONCHAIN_TEE_ID_MATCH=${getAddress(machine[0]) === expectedTeeId ? "YES" : "NO"}`);
console.log(`ONCHAIN_PROXY_HOST=${new URL(machine[2]).host}`);
console.log(`ONCHAIN_STATUS=${status}`);
console.log("SECRET_VALUES_PRINTED=NO");

if (publicTeeId !== expectedTeeId || getAddress(machine[0]) !== expectedTeeId ||
    new URL(machine[2]).host !== deployment.proxyHost || status !== 2n) {
  process.exitCode = 1;
}
