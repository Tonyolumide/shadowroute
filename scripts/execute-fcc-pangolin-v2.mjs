import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  getBytes,
  keccak256,
  toUtf8String,
  verifyTypedData,
} from "ethers";

const root = resolve(import.meta.dirname, "..");
const instructionId = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(instructionId ?? "")) throw new Error("Pass the successful FCC instruction ID");
const rpc = process.env.COSTON2_RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rpc || !privateKey) throw new Error("COSTON2_RPC_URL and DEPLOYER_PRIVATE_KEY are required");

const live = JSON.parse(await readFile(resolve(root, "deployments", "coston2-mint-deposit-v2.json"), "utf8"));
const provider = new JsonRpcProvider(rpc);
if ((await provider.getNetwork()).chainId !== 114n) throw new Error("Refusing to transact outside Coston2");
const signer = new Wallet(privateKey, provider);
const router = new Contract(live.router, [
  "function teeSigner() view returns (address)",
  "function allowedAdapters(address) view returns (bool)",
  "function intents(bytes32) view returns (address owner,address tokenIn,uint256 amount,bytes32 ciphertextHash,uint64 expiry,uint64 nonce,uint8 status)",
  "function authorizationDigest((bytes32 intentId,address owner,address tokenIn,uint256 maximumAmount,bytes32 intentCommitment,address adapter,address tokenOut,bytes32 actionHash,uint256 minimumOutput,uint64 intentNonce,uint64 deadline) authorization) view returns (bytes32)",
  "function executeIntent((bytes32 intentId,address owner,address tokenIn,uint256 maximumAmount,bytes32 intentCommitment,address adapter,address tokenOut,bytes32 actionHash,uint256 minimumOutput,uint64 intentNonce,uint64 deadline) authorization,bytes signature,bytes adapterData) returns (address,uint256)",
], signer);

const resultResponse = await fetch(`https://canal-headlamp-uncover.ngrok-free.dev/action/result/${instructionId}`);
if (!resultResponse.ok) throw new Error(`FCC result returned HTTP ${resultResponse.status}`);
const action = await resultResponse.json();
if (action.result?.status !== 1) throw new Error(`FCC evaluation did not succeed: ${action.result?.log ?? "unknown"}`);
const decision = JSON.parse(toUtf8String(getBytes(action.result.data)));
const intent = await router.intents(live.intentId);
const authorization = {
  intentId: decision.intentId,
  owner: decision.owner,
  tokenIn: decision.tokenIn,
  maximumAmount: BigInt(decision.maximumAmount),
  intentCommitment: decision.intentCommitment,
  adapter: decision.adapter,
  tokenOut: decision.tokenOut,
  actionHash: keccak256(decision.actionData),
  minimumOutput: BigInt(decision.minimumOutput),
  intentNonce: BigInt(decision.intentNonce),
  deadline: BigInt(decision.deadline),
};
const same = (a, b) => getAddress(a) === getAddress(b);
if (decision.intentId.toLowerCase() !== live.intentId.toLowerCase() ||
    !same(decision.owner, live.personalAccount) || !same(decision.tokenIn, live.fxrp) ||
    BigInt(decision.maximumAmount) !== BigInt(live.amountUBA) ||
    decision.intentCommitment.toLowerCase() !== live.ciphertextHash.toLowerCase() ||
    !same(decision.adapter, live.allowedAdapter) ||
    BigInt(decision.minimumOutput) !== BigInt(live.minimumOutputUBA) ||
    BigInt(decision.intentNonce) !== BigInt(live.intentNonce)) {
  throw new Error("FCC decision does not match the funded private intent evidence");
}
if (!same(intent.owner, live.personalAccount) || !same(intent.tokenIn, live.fxrp) ||
    intent.amount !== BigInt(live.amountUBA) || intent.ciphertextHash.toLowerCase() !== live.ciphertextHash.toLowerCase() ||
    intent.nonce !== BigInt(live.intentNonce) || intent.status !== 2n) {
  throw new Error("On-chain intent is not the expected funded intent");
}
const now = BigInt(Math.floor(Date.now() / 1000));
if (intent.expiry <= now || authorization.deadline < now || authorization.deadline > intent.expiry) throw new Error("Authorization or intent has expired");
if (!(await router.allowedAdapters(authorization.adapter))) throw new Error("FCC-selected adapter is not allowlisted");
const trustedSigner = await router.teeSigner();
const types = { RouteAuthorization: [
  { name: "intentId", type: "bytes32" }, { name: "owner", type: "address" },
  { name: "tokenIn", type: "address" }, { name: "maximumAmount", type: "uint256" },
  { name: "intentCommitment", type: "bytes32" }, { name: "adapter", type: "address" },
  { name: "tokenOut", type: "address" }, { name: "actionHash", type: "bytes32" },
  { name: "minimumOutput", type: "uint256" }, { name: "intentNonce", type: "uint64" },
  { name: "deadline", type: "uint64" },
] };
const domain = { name: "ShadowRouter", version: "1", chainId: 114, verifyingContract: live.router };
const recovered = verifyTypedData(domain, types, authorization, decision.signature);
const onchainDigest = await router.authorizationDigest(authorization);
if (!same(recovered, trustedSigner) || onchainDigest.toLowerCase() !== decision.authorizationDigest.toLowerCase()) {
  throw new Error("FCC authorization signature or digest is invalid");
}

const tokenOut = new Contract(decision.tokenOut, ["function balanceOf(address) view returns (uint256)"], provider);
const balanceBefore = await tokenOut.balanceOf(live.personalAccount);
await router.executeIntent.staticCall(authorization, decision.signature, decision.actionData);
const tx = await router.executeIntent(authorization, decision.signature, decision.actionData);
const receipt = await tx.wait();
if (receipt.status !== 1) throw new Error("Pangolin execution reverted");
const [finalIntent, balanceAfter] = await Promise.all([
  router.intents(live.intentId),
  tokenOut.balanceOf(live.personalAccount),
]);
const delivered = balanceAfter - balanceBefore;
if (finalIntent.status !== 3n || delivered < BigInt(decision.minimumOutput)) throw new Error("Post-execution delivery invariant failed");

const evidence = {
  network: "coston2",
  instructionId,
  intentId: live.intentId,
  router: live.router,
  authorizationSigner: recovered,
  authorizationDigest: onchainDigest,
  adapter: decision.adapter,
  tokenOut: decision.tokenOut,
  expectedOutput: decision.expectedOutput,
  minimumOutput: decision.minimumOutput,
  deliveredOutput: delivered.toString(),
  executionTransactionHash: receipt.hash,
  finalIntentStatus: "Executed",
  decision,
};
await writeFile(resolve(root, "deployments", "coston2-fcc-evaluation-v2.json"), `${JSON.stringify({ network: "coston2", instructionId, intentId: live.intentId, router: live.router, decision }, null, 2)}\n`, { mode: 0o600 });
await writeFile(resolve(root, "deployments", "coston2-pangolin-execution-v2.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...evidence, decision: undefined }, null, 2));
console.log("SECRET_VALUES_PRINTED=NO");
