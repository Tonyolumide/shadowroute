import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters } from "viem";
import { encodeV2Route } from "./v2-route.mjs";

test("encodes the constrained V2 adapter payload and commitment", () => {
  const path = ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"];
  const encoded = encodeV2Route({ path, amountOutMin: 190n, deadline: 12345n });
  const [decodedPath, minimum, deadline] = decodeAbiParameters([{type:"address[]"},{type:"uint256"},{type:"uint256"}], encoded.actionData);
  assert.deepEqual(decodedPath.map(x => x.toLowerCase()), path);
  assert.equal(minimum, 190n);
  assert.equal(deadline, 12345n);
  assert.match(encoded.actionHash, /^0x[0-9a-f]{64}$/);
});

test("rejects cyclic token paths", () => {
  const token = "0x0000000000000000000000000000000000000001";
  assert.throws(() => encodeV2Route({ path: [token, token], amountOutMin: 1n, deadline: 2n }), /repeat/);
});
