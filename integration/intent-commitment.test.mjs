import assert from "node:assert/strict";
import test from "node:test";
import { privatePolicyCommitment } from "./intent-commitment.mjs";

const vector = {
  chainId: 114n,
  router: "0x1000000000000000000000000000000000000001",
  owner: "0x2000000000000000000000000000000000000002",
  tokenIn: "0x3000000000000000000000000000000000000003",
  amount: 100n,
  nonce: 2n,
  expiry: 2_000_000_000n,
  allowedAdapters: [
    "0x4000000000000000000000000000000000000004",
    "0x5000000000000000000000000000000000000005"
  ],
  maximumRisk: 3,
  minimumOutput: 190n
};

test("computes the canonical private-policy commitment", () => {
  assert.equal(privatePolicyCommitment(vector), "0x57523e0501795698b377318e74d004dac1b129bea3062e57eddafcada2822614");
});

test("binds adapter order and private constraints", () => {
  const original = privatePolicyCommitment(vector);
  assert.notEqual(privatePolicyCommitment({ ...vector, minimumOutput: 191n }), original);
  assert.notEqual(privatePolicyCommitment({ ...vector, allowedAdapters: [...vector.allowedAdapters].reverse() }), original);
});
