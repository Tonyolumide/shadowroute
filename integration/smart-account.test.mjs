import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { buildMintAndDepositCalls, encodeHashInstructionMemo } from "./smart-account.mjs";

test("encodes a 42-byte 0xFE memo committed to the PackedUserOperation", () => {
  const calls = buildMintAndDepositCalls({
    fxrp: `0x${"11".repeat(20)}`,
    router: `0x${"22".repeat(20)}`,
    amount: 10n,
    ciphertextHash: `0x${"33".repeat(32)}`,
    expiry: 2_000_000_000n
  });
  const encoded = encodeHashInstructionMemo({
    calls,
    sender: `0x${"44".repeat(20)}`,
    nonce: 7n
  });
  assert.equal((encoded.memoData.length - 2) / 2, 42);
  assert.equal(encoded.memoData.slice(0, 4), "0xFE");
  assert.equal(encoded.userOpHash, keccak256(encoded.data));
  assert.equal(encoded.memoData.slice(-64), encoded.userOpHash.slice(2));
  assert.equal(encoded.calls.length, 2);
});
