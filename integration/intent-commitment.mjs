import { concatHex, encodeAbiParameters, keccak256, stringToHex } from "viem";

export const PRIVATE_INTENT_POLICY_TYPE = "PrivateIntentPolicy(uint256 chainId,address router,address owner,address tokenIn,uint256 amount,uint64 nonce,uint64 expiry,bytes32 allowedAdaptersHash,uint8 maximumRisk,uint256 minimumOutput)";
export const PRIVATE_INTENT_POLICY_TYPEHASH = keccak256(stringToHex(PRIVATE_INTENT_POLICY_TYPE));

export function privatePolicyCommitment({
  chainId,
  router,
  owner,
  tokenIn,
  amount,
  nonce,
  expiry,
  allowedAdapters,
  maximumRisk,
  minimumOutput
}) {
  if (!Array.isArray(allowedAdapters) || allowedAdapters.length === 0) {
    throw new Error("at least one allowed adapter is required");
  }
  const adapterWords = allowedAdapters.map((adapter) => encodeAbiParameters([{ type: "address" }], [adapter]));
  const allowedAdaptersHash = keccak256(concatHex(adapterWords));
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" },
    { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "uint64" },
    { type: "bytes32" }, { type: "uint8" }, { type: "uint256" }
  ], [
    PRIVATE_INTENT_POLICY_TYPEHASH, BigInt(chainId), router, owner, tokenIn, BigInt(amount),
    BigInt(nonce), BigInt(expiry), allowedAdaptersHash, Number(maximumRisk), BigInt(minimumOutput)
  ]));
}
