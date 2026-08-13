import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Interface, JsonRpcProvider, getAddress } from "ethers";

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
const extension = JSON.parse(await readFile(resolve(root, "deployments", "coston2-fcc-extension.json"), "utf8"));
const sender = getAddress(extension.instructionSender);
const provider = new JsonRpcProvider(env.CHAIN_URL);
const latest = await provider.getBlockNumber();
const iface = new Interface(["function sendEvaluation(bytes message)"]);
const matches = [];

for (let end = latest; end > Math.max(0, latest - 600); end -= 25) {
  const start = Math.max(0, end - 24);
  const blocks = await Promise.all(Array.from({ length: end - start + 1 }, (_, i) => provider.getBlock(start + i, true)));
  for (const block of blocks) {
    for (const tx of block.prefetchedTransactions ?? []) {
      if (tx.to && getAddress(tx.to) === sender && tx.data.startsWith(iface.getFunction("sendEvaluation").selector)) {
        const receipt = await provider.getTransactionReceipt(tx.hash);
        matches.push({ blockNumber: block.number, transactionHash: tx.hash, status: receipt?.status, firstLogTopics: receipt?.logs[0]?.topics ?? [], firstLogData: receipt?.logs[0]?.data });
      }
    }
  }
}

console.log(JSON.stringify({ latestBlock: latest, submissions: matches.slice(-10) }, null, 2));
console.log("SECRET_VALUES_PRINTED=NO");
