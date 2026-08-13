import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Wallet, isAddress } from "ethers";

const root = resolve(import.meta.dirname, "..");
const scaffold = resolve(root, "fcc-scaffold");
const proxyURLArg = process.argv.find((arg) => arg.startsWith("--proxy-url="));
const routerArg = process.argv.find((arg) => arg.startsWith("--router="));
const adapterArg = process.argv.find((arg) => arg.startsWith("--adapter="));

function parseEnv(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function requireValue(values, key) {
  const value = values.get(key);
  if (!value || /^<.*>$/.test(value)) throw new Error(`${key} is missing or still a placeholder`);
  return value;
}

function quoteEnv(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function quoteToml(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function setEnv(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
}

const rootEnvPath = resolve(root, ".env");
let rootEnvSource = await readFile(rootEnvPath, "utf8");
const initialValues = parseEnv(rootEnvSource);
const suppliedProxyURL = proxyURLArg?.slice("--proxy-url=".length);
if (suppliedProxyURL) {
  const parsed = new URL(suppliedProxyURL);
  if (parsed.protocol !== "https:") throw new Error("--proxy-url must be HTTPS");
  rootEnvSource = setEnv(rootEnvSource, "EXT_PROXY_URL", suppliedProxyURL.replace(/\/$/, ""));
  await writeFile(rootEnvPath, rootEnvSource, { encoding: "utf8", mode: 0o600 });
}
const suppliedRouter = routerArg?.slice("--router=".length);
const suppliedAdapter = adapterArg?.slice("--adapter=".length);
if ((suppliedRouter && !isAddress(suppliedRouter)) || (suppliedAdapter && !isAddress(suppliedAdapter))) {
  throw new Error("--router and --adapter must be valid EVM addresses");
}
if (suppliedRouter) rootEnvSource = setEnv(rootEnvSource, "SHADOW_ROUTER_ADDRESS", suppliedRouter);
if (suppliedAdapter) rootEnvSource = setEnv(rootEnvSource, "SHADOW_ALLOWED_ADAPTER", suppliedAdapter);
if (suppliedRouter || suppliedAdapter) await writeFile(rootEnvPath, rootEnvSource, { encoding: "utf8", mode: 0o600 });

const values = parseEnv(rootEnvSource);
const deployerKey = requireValue(values, "DEPLOYER_PRIVATE_KEY").replace(/^0x/, "");
const initialOwner = new Wallet(`0x${deployerKey}`).address;
const teeSignerKey = requireValue(values, "TEE_SIGNER_PRIVATE_KEY").replace(/^0x/, "");
const rpcURL = requireValue(values, "COSTON2_RPC_URL");
const proxyURL = requireValue(values, "EXT_PROXY_URL");
const indexerHost = requireValue(values, "INDEXER_HOST");
const indexerPort = requireValue(values, "INDEXER_PORT");
const indexerDatabase = requireValue(values, "INDEXER_DATABASE");
const indexerUsername = requireValue(values, "INDEXER_USERNAME");
const indexerPassword = requireValue(values, "INDEXER_PASSWORD");
const shadowRouter = requireValue(values, "SHADOW_ROUTER_ADDRESS");
const shadowAdapter = requireValue(values, "SHADOW_ALLOWED_ADAPTER");
const v2Routes = JSON.stringify([{ adapter: shadowAdapter, exchangeRouter: "0x1435422E3765898D3bD167DC06b36e9a8AEf4784", path: ["0x0b6A3645c240605887a5532109323A3E12273dc7", "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F"], risk: 2 }]);

if (!/^\d+$/.test(indexerPort)) throw new Error("INDEXER_PORT must be numeric");
if (new URL(proxyURL).protocol !== "https:") throw new Error("EXT_PROXY_URL must be HTTPS");

const scaffoldEnv = [
  "LANGUAGE=go",
  `INITIAL_OWNER=${quoteEnv(initialOwner)}`,
  `DEPLOYMENT_PRIVATE_KEY=${quoteEnv(deployerKey)}`,
  `PROXY_PRIVATE_KEY=${quoteEnv(deployerKey)}`,
  `TEE_SIGNER_PRIVATE_KEY=${quoteEnv(teeSignerKey)}`,
  `CHAIN_URL=${rpcURL}`,
  `COSTON2_RPC_URL=${rpcURL}`,
  `SHADOW_V2_ROUTES_JSON=${quoteEnv(v2Routes)}`,
  "ADDRESSES_FILE=./config/coston2/deployed-addresses.json",
  "LOCAL_MODE=false",
  "SIMULATED_TEE=true",
  "NORMAL_PROXY_URL=https://tee-proxy-coston2-1.flare.rocks",
  `EXT_PROXY_URL=${proxyURL.replace(/\/$/, "")}`,
  "REGISTER_TEE_COMMAND=rRap",
  "CHAIN_ID=114",
  "",
].join("\n");

await writeFile(resolve(scaffold, ".env"), scaffoldEnv, { encoding: "utf8", mode: 0o600 });

for (const name of ["extension_proxy.coston2.docker.toml", "extension_proxy.coston2.toml"]) {
  const examplePath = resolve(scaffold, "config", "proxy", `${name}.example`);
  let config = await readFile(examplePath, "utf8");
  config = config
    .replace('host = "<indexer-db-host>"', `host = ${quoteToml(indexerHost)}`)
    .replace("port = 3306", `port = ${indexerPort}`)
    .replace('database = "<indexer-db-name>"', `database = ${quoteToml(indexerDatabase)}`)
    .replace('username = "<indexer-db-user>"', `username = ${quoteToml(indexerUsername)}`)
    .replace('password = "<indexer-db-password>"', `password = ${quoteToml(indexerPassword)}`);
  if (config.includes("<indexer-db-")) throw new Error(`${name} still contains an indexer placeholder`);
  await writeFile(resolve(scaffold, "config", "proxy", name), config, { encoding: "utf8", mode: 0o600 });
}

console.log("FCC_CONFIG=READY");
console.log("SECRETS_PRINTED=NO");
console.log("CHAIN_ID=114");
console.log(`EXT_PROXY_HOST=${new URL(proxyURL).host}`);
