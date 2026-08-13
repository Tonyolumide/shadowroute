const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("UniswapV2RouteAdapter", function () {
  async function fixture() {
    const [owner, tee, user, executor] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const input = await Token.deploy("Input", "IN");
    const output = await Token.deploy("Output", "OUT");
    const Router = await ethers.getContractFactory("ShadowRouter");
    const router = await Router.deploy(owner.address, tee.address);
    const Venue = await ethers.getContractFactory("MockV2Router");
    const venue = await Venue.deploy(2, 1);
    const Adapter = await ethers.getContractFactory("UniswapV2RouteAdapter");
    const adapter = await Adapter.deploy(await router.getAddress(), await venue.getAddress());
    await router.setAdapter(await adapter.getAddress(), true);
    await input.mint(user.address, ethers.parseEther("100"));
    await output.mint(await venue.getAddress(), ethers.parseEther("1000"));
    return { owner, tee, user, executor, input, output, router, venue, adapter };
  }

  it("executes a TEE-authorized swap through the pinned venue", async function () {
    const { tee, user, executor, input, output, router, venue, adapter } = await fixture();
    const amount = ethers.parseEther("100");
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const expiry = now + 3600;
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("private constraints"));
    await input.connect(user).approve(await router.getAddress(), amount);
    const intentId = await router.connect(user).createAndFundIntent.staticCall(await input.getAddress(), amount, commitment, expiry);
    await router.connect(user).createAndFundIntent(await input.getAddress(), amount, commitment, expiry);
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256", "uint256"],
      [[await input.getAddress(), await output.getAddress()], ethers.parseEther("190"), expiry]
    );
    const authorization = { intentId, owner: user.address, tokenIn: await input.getAddress(), maximumAmount: amount, intentCommitment: commitment, adapter: await adapter.getAddress(), tokenOut: await output.getAddress(), actionHash: ethers.keccak256(adapterData), minimumOutput: ethers.parseEther("190"), intentNonce: 0, deadline: expiry };
    const signature = await tee.signTypedData(
      { name: "ShadowRouter", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await router.getAddress() },
      { RouteAuthorization: [{name:"intentId",type:"bytes32"},{name:"owner",type:"address"},{name:"tokenIn",type:"address"},{name:"maximumAmount",type:"uint256"},{name:"intentCommitment",type:"bytes32"},{name:"adapter",type:"address"},{name:"tokenOut",type:"address"},{name:"actionHash",type:"bytes32"},{name:"minimumOutput",type:"uint256"},{name:"intentNonce",type:"uint64"},{name:"deadline",type:"uint64"}] }, authorization
    );
    await (await router.connect(executor).executeIntent(authorization, signature, adapterData)).wait();
    expect(await output.balanceOf(user.address)).to.equal(ethers.parseEther("200"));
    expect(await input.allowance(await adapter.getAddress(), await venue.getAddress())).to.equal(0n);
  });

  it("rejects direct callers and malformed paths", async function () {
    const { user, input, output, adapter } = await fixture();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const data = ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256", "uint256"], [[await output.getAddress(), await input.getAddress()], 1, now + 100]);
    let reverted = false;
    try { await adapter.connect(user).execute(await input.getAddress(), 1, data); } catch { reverted = true; }
    expect(reverted).to.equal(true);
  });
});
