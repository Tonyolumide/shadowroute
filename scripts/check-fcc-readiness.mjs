import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";

const root = resolve(import.meta.dirname, "..");
const scaffold = resolve(root, "fcc-scaffold");

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return [];
    const index = line.indexOf("=");
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[line.slice(0, index).trim(), value]];
  }));
}

const env = parseEnv(await readFile(resolve(scaffold, ".env"), "utf8"));
const provider = new JsonRpcProvider(env.CHAIN_URL);
const wallet = new Wallet(`0x${env.DEPLOYMENT_PRIVATE_KEY.replace(/^0x/, "")}`, provider);
const network = await provider.getNetwork();
const balance = await provider.getBalance(wallet.address);
const manager = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE";
const managerCode = await provider.getCode(manager);

for (const relative of [
  "config/proxy/extension_proxy.coston2.docker.toml",
  "config/proxy/extension_proxy.coston2.toml",
  "config/coston2/deployed-addresses.json",
]) await access(resolve(scaffold, relative));

console.log(`CHAIN_ID=${network.chainId}`);
console.log(`DEPLOYER_ADDRESS=${wallet.address}`);
console.log(`C2FLR_BALANCE=${formatEther(balance)}`);
console.log(`CURRENT_TEE_MANAGER_CODE=${managerCode === "0x" ? "MISSING" : "PRESENT"}`);
console.log(`EXT_PROXY_HOST=${new URL(env.EXT_PROXY_URL).host}`);
console.log("SECRET_VALUES_PRINTED=NO");
