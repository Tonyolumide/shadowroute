const hre = require("hardhat");
const { ethers } = hre;
const { mkdir, writeFile } = require("node:fs/promises");

const PANGOLIN_ROUTER = "0x1435422E3765898D3bD167DC06b36e9a8AEf4784";
const PANGOLIN_FACTORY = "0x4a2ba0812a92c78b3975bA25509b08b49972dFFa";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const amountFXRP = 5_000_000n;
const amountUSDT0 = 5_000_000n;

const routerAbi = [
  "function factory() view returns(address)",
  "function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns(uint amountA,uint amountB,uint liquidity)"
];
const factoryAbi = ["function getPair(address,address) view returns(address)"];
const tokenAbi = ["function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function allowance(address,address) view returns(uint256)"];
const pairAbi = ["function token0() view returns(address)", "function token1() view returns(address)", "function getReserves() view returns(uint112,uint112,uint32)", "function balanceOf(address) view returns(uint256)"];

async function main() {
  if ((await ethers.provider.getNetwork()).chainId !== 114n) throw new Error("Coston2 only");
  const [deployer] = await ethers.getSigners();
  const router = new ethers.Contract(PANGOLIN_ROUTER, routerAbi, deployer);
  const factory = new ethers.Contract(PANGOLIN_FACTORY, factoryAbi, deployer);
  if ((await router.factory()).toLowerCase() !== PANGOLIN_FACTORY.toLowerCase()) throw new Error("Pangolin router/factory mismatch");
  const existingPair = await factory.getPair(FXRP, USDT0);
  if (existingPair !== ethers.ZeroAddress) throw new Error(`Pair already exists at ${existingPair}; inspect its ratio before adding liquidity`);
  const fxrp = new ethers.Contract(FXRP, tokenAbi, deployer);
  const usdt0 = new ethers.Contract(USDT0, tokenAbi, deployer);
  const [fxrpBalance, usdtBalance] = await Promise.all([fxrp.balanceOf(deployer.address), usdt0.balanceOf(deployer.address)]);
  if (fxrpBalance < amountFXRP || usdtBalance < amountUSDT0) throw new Error("Insufficient faucet token balances");

  await (await fxrp.approve(PANGOLIN_ROUTER, amountFXRP)).wait();
  await (await usdt0.approve(PANGOLIN_ROUTER, amountUSDT0)).wait();
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const liquidityTx = await router.addLiquidity(FXRP, USDT0, amountFXRP, amountUSDT0, amountFXRP, amountUSDT0, deployer.address, deadline);
  const receipt = await liquidityTx.wait();
  await (await fxrp.approve(PANGOLIN_ROUTER, 0)).wait();
  await (await usdt0.approve(PANGOLIN_ROUTER, 0)).wait();

  const pairAddress = await factory.getPair(FXRP, USDT0);
  if (pairAddress === ethers.ZeroAddress) throw new Error("Pair was not created");
  const pair = new ethers.Contract(pairAddress, pairAbi, deployer);
  const [token0, token1, reserves, lpBalance, fxrpAllowance, usdtAllowance] = await Promise.all([
    pair.token0(), pair.token1(), pair.getReserves(), pair.balanceOf(deployer.address),
    fxrp.allowance(deployer.address, PANGOLIN_ROUTER), usdt0.allowance(deployer.address, PANGOLIN_ROUTER)
  ]);
  if (reserves[0] === 0n || reserves[1] === 0n || lpBalance === 0n) throw new Error("Liquidity verification failed");
  if (fxrpAllowance !== 0n || usdtAllowance !== 0n) throw new Error("Router approval was not revoked");
  const record = { network: "coston2", venue: "Pangolin", router: PANGOLIN_ROUTER, factory: PANGOLIN_FACTORY, pair: pairAddress, token0, token1, reserve0: reserves[0].toString(), reserve1: reserves[1].toString(), lpOwner: deployer.address, lpBalance: lpBalance.toString(), liquidityTransactionHash: receipt.hash };
  await mkdir("deployments", { recursive: true });
  await writeFile("deployments/coston2-pangolin-liquidity.json", JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
