import assert from "node:assert/strict";
import test from "node:test";
import { buildXrpPaymentRequest, prepareXrpPaymentRequest } from "./fdc-xrp.mjs";

test("builds the official Coston2 XRPPayment request shape", () => {
  const request = buildXrpPaymentRequest("AB".repeat(32), `0x${"12".repeat(20)}`);
  assert.equal(request.attestationType.length, 66);
  assert.equal(request.sourceId.length, 66);
  assert.equal(request.requestBody.transactionId, `0x${"ab".repeat(32)}`);
});

test("posts to the official XRPPayment prepareRequest path", async () => {
  let captured;
  const result = await prepareXrpPaymentRequest({
    transactionId: "AB".repeat(32),
    proofOwner: `0x${"12".repeat(20)}`,
    verifierBaseUrl: "https://example.test",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ abiEncodedRequest: "0x1234" }) };
    }
  });
  assert.equal(captured.url, "https://example.test/verifier/xrp/XRPPayment/prepareRequest");
  assert.equal(result.abiEncodedRequest, "0x1234");
});
