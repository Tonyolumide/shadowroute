import { encodeAbiParameters, keccak256 } from "viem";

export function encodeV2Route({ path, amountOutMin, deadline }) {
  if (!Array.isArray(path) || path.length < 2 || path.length > 4) throw new Error("path must contain 2 to 4 tokens");
  if (new Set(path.map((address) => address.toLowerCase())).size !== path.length) throw new Error("path cannot repeat a token");
  if (BigInt(amountOutMin) <= 0n) throw new Error("amountOutMin must be positive");
  if (BigInt(deadline) <= 0n) throw new Error("deadline must be positive");
  const actionData = encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint256" }, { type: "uint256" }],
    [path, BigInt(amountOutMin), BigInt(deadline)]
  );
  return { actionData, actionHash: keccak256(actionData) };
}

if (process.argv[1]?.endsWith("v2-route.mjs") && process.argv.length >= 5) {
  const [, , pathValue, amountOutMin, deadline] = process.argv;
  console.log(JSON.stringify(encodeV2Route({ path: pathValue.split(","), amountOutMin, deadline }), null, 2));
}
