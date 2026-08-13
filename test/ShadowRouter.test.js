const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ShadowRouter", function () {
  async function deployFixture() {
    const [deployer, user, teeSigner, keeper, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const fxrp = await Token.deploy("Mock FXRP", "mFXRP");
    const usdt = await Token.deploy("Mock USDT", "mUSDT");

    const Router = await ethers.getContractFactory("ShadowRouter");
    const router = await Router.deploy(deployer.address, teeSigner.address);

    const Adapter = await ethers.getContractFactory("MockRouteAdapter");
    const adapter = await Adapter.deploy(await router.getAddress());
    await router.setAdapter(await adapter.getAddress(), true);

    await fxrp.mint(user.address, ethers.parseEther("1000"));
    await usdt.mint(await adapter.getAddress(), ethers.parseEther("5000"));

    return { deployer, user, teeSigner, keeper, attacker, fxrp, usdt, router, adapter };
  }

  async function createAndFund(ctx) {
    const amount = ethers.parseEther("100");
    const ciphertextHash = ethers.keccak256(ethers.toUtf8Bytes("encrypted private constraints"));
    const expiry = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
    const nonce = await ctx.router.nextIntentNonce(ctx.user.address);
    const intentId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "bytes32", "uint64", "uint64"],
        [ctx.user.address, await ctx.fxrp.getAddress(), amount, ciphertextHash, expiry, nonce]
      )
    );

    await ctx.router.connect(ctx.user).createIntent(await ctx.fxrp.getAddress(), amount, ciphertextHash, expiry);
    await ctx.fxrp.connect(ctx.user).approve(await ctx.router.getAddress(), amount);
    await ctx.router.connect(ctx.user).fundIntent(intentId);
    return { intentId, amount, expiry, nonce, ciphertextHash };
  }

  function authorizationTypes() {
    return {
      RouteAuthorization: [
        { name: "intentId", type: "bytes32" },
        { name: "owner", type: "address" },
        { name: "tokenIn", type: "address" },
        { name: "maximumAmount", type: "uint256" },
        { name: "intentCommitment", type: "bytes32" },
        { name: "adapter", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "actionHash", type: "bytes32" },
        { name: "minimumOutput", type: "uint256" },
        { name: "intentNonce", type: "uint64" },
        { name: "deadline", type: "uint64" }
      ]
    };
  }

  it("creates and funds an intent without publishing plaintext constraints", async function () {
    const ctx = await deployFixture();
    const { intentId, amount } = await createAndFund(ctx);
    const intent = await ctx.router.intents(intentId);

    expect(intent.owner).to.equal(ctx.user.address);
    expect(intent.amount).to.equal(amount);
    expect(intent.status).to.equal(2n);
    expect(await ctx.fxrp.balanceOf(await ctx.router.getAddress())).to.equal(amount);
  });

  it("executes only a TEE-authorized allowlisted route", async function () {
    const ctx = await deployFixture();
    const { intentId, amount, nonce, ciphertextHash } = await createAndFund(ctx);
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256"],
      [await ctx.usdt.getAddress(), 2n, 1n]
    );
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 1200);
    const authorization = {
      intentId,
      owner: ctx.user.address,
      tokenIn: await ctx.fxrp.getAddress(),
      maximumAmount: amount,
      intentCommitment: ciphertextHash,
      adapter: await ctx.adapter.getAddress(),
      tokenOut: await ctx.usdt.getAddress(),
      actionHash: ethers.keccak256(adapterData),
      minimumOutput: ethers.parseEther("199"),
      intentNonce: nonce,
      deadline
    };
    const domain = {
      name: "ShadowRouter",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await ctx.router.getAddress()
    };
    const signature = await ctx.teeSigner.signTypedData(domain, authorizationTypes(), authorization);

    await ctx.router.connect(ctx.keeper).executeIntent(authorization, signature, adapterData);

    expect(await ctx.usdt.balanceOf(ctx.user.address)).to.equal(ethers.parseEther("200"));
    expect((await ctx.router.intents(intentId)).status).to.equal(3n);
  });

  it("rejects a forged authorization", async function () {
    const ctx = await deployFixture();
    const { intentId, amount, nonce, ciphertextHash } = await createAndFund(ctx);
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256"],
      [await ctx.usdt.getAddress(), 2n, 1n]
    );
    const authorization = {
      intentId,
      owner: ctx.user.address,
      tokenIn: await ctx.fxrp.getAddress(),
      maximumAmount: amount,
      intentCommitment: ciphertextHash,
      adapter: await ctx.adapter.getAddress(),
      tokenOut: await ctx.usdt.getAddress(),
      actionHash: ethers.keccak256(adapterData),
      minimumOutput: 1n,
      intentNonce: nonce,
      deadline: BigInt((await ethers.provider.getBlock("latest")).timestamp + 1200)
    };
    const domain = {
      name: "ShadowRouter",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await ctx.router.getAddress()
    };
    const forged = await ctx.attacker.signTypedData(domain, authorizationTypes(), authorization);

    let rejected = false;
    try {
      await ctx.router.connect(ctx.keeper).executeIntent(authorization, forged, adapterData);
    } catch (error) {
      rejected = String(error).includes("InvalidAuthorization");
    }
    expect(rejected).to.equal(true);
  });

  it("rejects a valid TEE signature when the private-policy commitment does not match the intent", async function () {
    const ctx = await deployFixture();
    const { intentId, amount, nonce } = await createAndFund(ctx);
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256"],
      [await ctx.usdt.getAddress(), 2n, 1n]
    );
    const authorization = {
      intentId,
      owner: ctx.user.address,
      tokenIn: await ctx.fxrp.getAddress(),
      maximumAmount: amount,
      intentCommitment: ethers.keccak256(ethers.toUtf8Bytes("attacker-selected policy")),
      adapter: await ctx.adapter.getAddress(),
      tokenOut: await ctx.usdt.getAddress(),
      actionHash: ethers.keccak256(adapterData),
      minimumOutput: 0n,
      intentNonce: nonce,
      deadline: BigInt((await ethers.provider.getBlock("latest")).timestamp + 1200)
    };
    const signature = await ctx.teeSigner.signTypedData({
      name: "ShadowRouter",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await ctx.router.getAddress()
    }, authorizationTypes(), authorization);

    let rejected = false;
    try {
      await ctx.router.connect(ctx.keeper).executeIntent(authorization, signature, adapterData);
    } catch (error) {
      rejected = String(error).includes("InvalidAuthorization");
    }
    expect(rejected).to.equal(true);
  });

  it("returns funded assets when the owner cancels", async function () {
    const ctx = await deployFixture();
    const { intentId } = await createAndFund(ctx);

    await ctx.router.connect(ctx.user).cancelIntent(intentId);
    expect(await ctx.fxrp.balanceOf(ctx.user.address)).to.equal(ethers.parseEther("1000"));
    expect((await ctx.router.intents(intentId)).status).to.equal(4n);
  });

  it("creates and funds atomically for the Smart Account mint-and-deposit path", async function () {
    const ctx = await deployFixture();
    const amount = ethers.parseEther("25");
    const ciphertextHash = ethers.keccak256(ethers.toUtf8Bytes("smart-account private constraints"));
    const expiry = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
    const nonce = await ctx.router.nextIntentNonce(ctx.user.address);
    const intentId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "bytes32", "uint64", "uint64"],
      [ctx.user.address, await ctx.fxrp.getAddress(), amount, ciphertextHash, expiry, nonce]
    ));

    await ctx.fxrp.connect(ctx.user).approve(await ctx.router.getAddress(), amount);
    await ctx.router.connect(ctx.user).createAndFundIntent(
      await ctx.fxrp.getAddress(), amount, ciphertextHash, expiry
    );

    expect((await ctx.router.intents(intentId)).status).to.equal(2n);
    expect(await ctx.fxrp.balanceOf(await ctx.router.getAddress())).to.equal(amount);
  });
});
