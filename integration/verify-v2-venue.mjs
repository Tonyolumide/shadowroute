import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { coston2Chain } from "./network.mjs";

const [routerArg, pathArg, amountArg = "1000000"] = process.argv.slice(2);
if (!routerArg || !pathArg) throw new Error("Usage: node integration/verify-v2-venue.mjs <ROUTER> <TOKEN_IN,TOKEN_OUT[,TOKEN]> [AMOUNT_IN]");
const router = getAddress(routerArg);
const path = pathArg.split(",").map((address) => getAddress(address));
const amountIn = BigInt(amountArg);
if (path.length < 2 || path.length > 4 || amountIn <= 0n) throw new Error("Use 2-4 path tokens and a positive amount");

const client = createPublicClient({ chain: coston2Chain, transport: http(process.env.COSTON2_RPC_URL) });
const routerAbi = parseAbi([
  "function factory() view returns (address)",
  "function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)"
]);
const wrappedNativeAbis = ["WETH", "WAVAX", "WFLR"].map((name) => ({
  name,
  abi: parseAbi([`function ${name}() view returns (address)`])
}));
const factoryAbi = parseAbi(["function getPair(address tokenA,address tokenB) view returns (address pair)"]);
const pairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)"
]);

const chainId = await client.getChainId();
if (chainId !== 114) throw new Error(`RPC is chain ${chainId}; expected Coston2 (114)`);
const routerCode = await client.getCode({ address: router });
if (!routerCode || routerCode === "0x") throw new Error("Router address has no bytecode");

const factory = await client.readContract({ address: router, abi: routerAbi, functionName: "factory" });
let wrappedNative;
let wrappedNativeGetter;
for (const candidate of wrappedNativeAbis) {
  try {
    wrappedNative = await client.readContract({ address: router, abi: candidate.abi, functionName: candidate.name });
    wrappedNativeGetter = candidate.name;
    break;
  } catch {}
}
if (!wrappedNative) throw new Error("Router exposes none of WETH(), WAVAX(), or WFLR()");
if ((await client.getCode({ address: factory })) === "0x") throw new Error("Router factory has no bytecode");

const pairs = [];
for (let i = 0; i < path.length - 1; i++) {
  const pair = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPair", args: [path[i], path[i + 1]] });
  if (/^0x0{40}$/i.test(pair)) throw new Error(`No pair exists for hop ${i + 1}`);
  if ((await client.getCode({ address: pair })) === "0x") throw new Error(`Pair ${pair} has no bytecode`);
  const [token0, token1, reserves] = await Promise.all([
    client.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
    client.readContract({ address: pair, abi: pairAbi, functionName: "token1" }),
    client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" })
  ]);
  if (reserves[0] === 0n || reserves[1] === 0n) throw new Error(`Pair ${pair} has zero reserves`);
  pairs.push({ pair, token0, token1, reserve0: reserves[0].toString(), reserve1: reserves[1].toString() });
}

const quote = await client.readContract({ address: router, abi: routerAbi, functionName: "getAmountsOut", args: [amountIn, path] });
console.log(JSON.stringify({ verified: true, network: "coston2", chainId, router, routerBytecodeBytes: (routerCode.length - 2) / 2, factory, wrappedNative, wrappedNativeGetter, path, amountIn: amountIn.toString(), quotedAmountOut: quote.at(-1).toString(), pairs }, null, 2));
