const { ethers } = require("hardhat");

function privatePolicyCommitment({ chainId, router, owner, tokenIn, amount, nonce, expiry, allowedAdapters, maximumRisk, minimumOutput }) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const typehash = ethers.keccak256(ethers.toUtf8Bytes("PrivateIntentPolicy(uint256 chainId,address router,address owner,address tokenIn,uint256 amount,uint64 nonce,uint64 expiry,bytes32 allowedAdaptersHash,uint8 maximumRisk,uint256 minimumOutput)"));
  const allowedAdaptersHash = ethers.keccak256(ethers.concat(allowedAdapters.map((adapter) => coder.encode(["address"], [adapter]))));
  return ethers.keccak256(coder.encode(
    ["bytes32","uint256","address","address","address","uint256","uint64","uint64","bytes32","uint8","uint256"],
    [typehash, chainId, router, owner, tokenIn, amount, nonce, expiry, allowedAdaptersHash, maximumRisk, minimumOutput]
  ));
}

async function main() {
  const [deployer, user, teeSigner, keeper] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const fxrp = await Token.deploy("Mock FXRP", "mFXRP");
  const usdt = await Token.deploy("Mock USDT", "mUSDT");
  const Router = await ethers.getContractFactory("ShadowRouter");
  const router = await Router.deploy(deployer.address, teeSigner.address);
  const Adapter = await ethers.getContractFactory("MockRouteAdapter");
  const adapter = await Adapter.deploy(await router.getAddress());
  await router.setAdapter(await adapter.getAddress(), true);

  const amount = ethers.parseEther("100");
  await fxrp.mint(user.address, amount);
  await usdt.mint(await adapter.getAddress(), ethers.parseEther("1000"));

  const latest = await ethers.provider.getBlock("latest");
  const expiry = BigInt(latest.timestamp + 3600);
  const nonce = await router.nextIntentNonce(user.address);
  const ciphertextHash = privatePolicyCommitment({
    chainId: (await ethers.provider.getNetwork()).chainId,
    router: await router.getAddress(), owner: user.address, tokenIn: await fxrp.getAddress(),
    amount, nonce, expiry, allowedAdapters: [await adapter.getAddress()], maximumRisk: 3,
    minimumOutput: ethers.parseEther("199")
  });
  const intentId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "bytes32", "uint64", "uint64"],
    [user.address, await fxrp.getAddress(), amount, ciphertextHash, expiry, nonce]
  ));

  await router.connect(user).createIntent(await fxrp.getAddress(), amount, ciphertextHash, expiry);
  await fxrp.connect(user).approve(await router.getAddress(), amount);
  await router.connect(user).fundIntent(intentId);

  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint256"], [await usdt.getAddress(), 2n, 1n]
  );
  const authorization = {
    intentId,
    owner: user.address,
    tokenIn: await fxrp.getAddress(),
    maximumAmount: amount,
    intentCommitment: ciphertextHash,
    adapter: await adapter.getAddress(),
    tokenOut: await usdt.getAddress(),
    actionHash: ethers.keccak256(adapterData),
    minimumOutput: ethers.parseEther("199"),
    intentNonce: nonce,
    deadline: BigInt(latest.timestamp + 1200)
  };
  const domain = {
    name: "ShadowRouter", version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await router.getAddress()
  };
  const types = { RouteAuthorization: [
    { name: "intentId", type: "bytes32" }, { name: "owner", type: "address" },
    { name: "tokenIn", type: "address" }, { name: "maximumAmount", type: "uint256" },
    { name: "intentCommitment", type: "bytes32" },
    { name: "adapter", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "actionHash", type: "bytes32" }, { name: "minimumOutput", type: "uint256" },
    { name: "intentNonce", type: "uint64" }, { name: "deadline", type: "uint64" }
  ] };
  const signature = await teeSigner.signTypedData(domain, types, authorization);
  await router.connect(keeper).executeIntent(authorization, signature, adapterData);

  console.log(JSON.stringify({
    intentId,
    router: await router.getAddress(),
    status: "Executed",
    userOutput: ethers.formatEther(await usdt.balanceOf(user.address)) + " mUSDT"
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
