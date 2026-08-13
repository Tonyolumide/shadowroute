const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const shadowRouter = process.env.SHADOW_ROUTER_ADDRESS;
  const exchangeRouter = process.env.V2_EXCHANGE_ROUTER;
  if (!ethers.isAddress(shadowRouter) || !ethers.isAddress(exchangeRouter)) throw new Error("Set valid SHADOW_ROUTER_ADDRESS and V2_EXCHANGE_ROUTER values");
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 114n) throw new Error(`Refusing adapter deployment on chain ${chainId}; expected Coston2 (114)`);
  const [deployer] = await ethers.getSigners();
  const [shadowCode, exchangeCode] = await Promise.all([ethers.provider.getCode(shadowRouter), ethers.provider.getCode(exchangeRouter)]);
  if (shadowCode === "0x" || exchangeCode === "0x") throw new Error("Both configured addresses must contain contract bytecode");
  const router = await ethers.getContractAt("ShadowRouter", shadowRouter);
  if ((await router.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("Deployer is not the ShadowRouter owner");

  const Adapter = await ethers.getContractFactory("UniswapV2RouteAdapter");
  const adapter = await Adapter.deploy(shadowRouter, exchangeRouter);
  await adapter.waitForDeployment();
  const permission = await router.setAdapter(await adapter.getAddress(), true);
  await permission.wait();
  console.log(JSON.stringify({ network: "coston2", shadowRouter, exchangeRouter, adapter: await adapter.getAddress(), deployTransactionHash: adapter.deploymentTransaction().hash, allowlistTransactionHash: permission.hash }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
