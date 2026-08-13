const hre = require("hardhat");
const { ethers } = hre;
const { mkdir, writeFile } = require("node:fs/promises");

const SHADOW_ROUTER = "0x33d9BC1d038194138803a95D1C92BC4809C0bD54";
const ADAPTER = "0x8AA5Cc1B39b8E9d76F0883F8102fe326A753E36D";
const PANGOLIN_ROUTER = "0x1435422E3765898D3bD167DC06b36e9a8AEf4784";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const INTENT_OWNER = "0xc9DdAC13F3CEc34355ACB3578E6c94ce7B521D61";
const CIPHERTEXT_HASH = "0x580f93d7417edc38f6027aa4e44e44d79e3c53c8bf36aa23fc4092b72e2af037";
const INTENT_EXPIRY = 1785768914n;
const AMOUNT_IN = 1_000_000n;
const INTENT_NONCE = 0n;

async function main() {
  if (!process.env.TEE_SIGNER_PRIVATE_KEY) throw new Error("TEE_SIGNER_PRIVATE_KEY is required");
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 114n) throw new Error("Coston2 only");
  const [executor] = await ethers.getSigners();
  const tee = new ethers.Wallet(process.env.TEE_SIGNER_PRIVATE_KEY);
  const router = await ethers.getContractAt("ShadowRouter", SHADOW_ROUTER, executor);
  if ((await router.teeSigner()).toLowerCase() !== tee.address.toLowerCase()) throw new Error("TEE key does not match router signer");
  if (!(await router.allowedAdapters(ADAPTER))) throw new Error("Adapter is not allowlisted");

  const intentId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "bytes32", "uint64", "uint64"],
    [INTENT_OWNER, FXRP, AMOUNT_IN, CIPHERTEXT_HASH, INTENT_EXPIRY, INTENT_NONCE]
  ));
  const intent = await router.intents(intentId);
  if (intent.status !== 2n) throw new Error(`Intent is not funded; status=${intent.status}`);
  const block = await ethers.provider.getBlock("latest");
  if (BigInt(block.timestamp) >= INTENT_EXPIRY) throw new Error("Intent has expired");

  const venue = new ethers.Contract(PANGOLIN_ROUTER, ["function getAmountsOut(uint256,address[]) view returns(uint256[])"] , executor);
  const path = [FXRP, USDT0];
  const amounts = await venue.getAmountsOut(AMOUNT_IN, path);
  const quotedOutput = amounts[amounts.length - 1];
  const minimumOutput = quotedOutput * 98n / 100n;
  const deadline = BigInt(Math.min(Number(INTENT_EXPIRY), block.timestamp + 600));
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256", "uint256"], [path, minimumOutput, deadline]);
  const authorization = { intentId, owner: INTENT_OWNER, tokenIn: FXRP, maximumAmount: AMOUNT_IN, intentCommitment: intent.ciphertextHash, adapter: ADAPTER, tokenOut: USDT0, actionHash: ethers.keccak256(adapterData), minimumOutput, intentNonce: INTENT_NONCE, deadline };
  const types = { RouteAuthorization: [
    {name:"intentId",type:"bytes32"},{name:"owner",type:"address"},{name:"tokenIn",type:"address"},{name:"maximumAmount",type:"uint256"},{name:"intentCommitment",type:"bytes32"},{name:"adapter",type:"address"},{name:"tokenOut",type:"address"},{name:"actionHash",type:"bytes32"},{name:"minimumOutput",type:"uint256"},{name:"intentNonce",type:"uint64"},{name:"deadline",type:"uint64"}
  ]};
  const signature = await tee.signTypedData({ name: "ShadowRouter", version: "1", chainId: 114, verifyingContract: SHADOW_ROUTER }, types, authorization);
  const token = new ethers.Contract(USDT0, ["function balanceOf(address) view returns(uint256)"], executor);
  const before = await token.balanceOf(INTENT_OWNER);
  const transaction = await router.executeIntent(authorization, signature, adapterData);
  const receipt = await transaction.wait();
  const after = await token.balanceOf(INTENT_OWNER);
  const finalIntent = await router.intents(intentId);
  if (finalIntent.status !== 3n || after <= before) throw new Error("Post-execution verification failed");
  const record = { network: "coston2", venue: "Pangolin", intentId, owner: INTENT_OWNER, adapter: ADAPTER, tokenIn: FXRP, tokenOut: USDT0, amountIn: AMOUNT_IN.toString(), quotedOutput: quotedOutput.toString(), minimumOutput: minimumOutput.toString(), actualOutput: (after - before).toString(), transactionHash: receipt.hash, finalStatus: "Executed" };
  await mkdir("deployments", { recursive: true });
  await writeFile("deployments/coston2-pangolin-execution.json", JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
