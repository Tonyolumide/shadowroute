import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import { decodeAbiParameters, stringToHex } from "viem";
import { getContractAddressByName } from "./flare-registry.mjs";
import { FDC_DA_LAYER_URL, FDC_VERIFIER_BASE_URL, PUBLIC_FDC_API_KEY, publicClient } from "./network.mjs";

export function normalizeTransactionId(transactionId) {
  const normalized = transactionId.startsWith("0x") ? transactionId : `0x${transactionId}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("XRPL transaction id must be 32-byte hex");
  return normalized.toLowerCase();
}

export function buildXrpPaymentRequest(transactionId, proofOwner) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(proofOwner)) throw new Error("proofOwner must be an EVM address");
  return {
    attestationType: stringToHex("XRPPayment", { size: 32 }),
    sourceId: stringToHex("testXRP", { size: 32 }),
    requestBody: { transactionId: normalizeTransactionId(transactionId), proofOwner }
  };
}

export async function prepareXrpPaymentRequest({
  transactionId,
  proofOwner,
  verifierBaseUrl = FDC_VERIFIER_BASE_URL,
  apiKey = process.env.FDC_VERIFIER_API_KEY || PUBLIC_FDC_API_KEY,
  fetchImpl = fetch
}) {
  const url = `${verifierBaseUrl.replace(/\/$/, "")}/verifier/xrp/XRPPayment/prepareRequest`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify(buildXrpPaymentRequest(transactionId, proofOwner))
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`FDC verifier returned ${response.status}: ${body}`);
  const parsed = JSON.parse(body);
  if (!parsed.abiEncodedRequest) throw new Error(`Verifier response missing abiEncodedRequest: ${body}`);
  return parsed;
}

export async function submitAttestationRequest({ walletClient, account, abiEncodedRequest, client = publicClient }) {
  const fdcHub = await getContractAddressByName("FdcHub", client);
  const feeConfiguration = await client.readContract({
    address: fdcHub,
    abi: coston2.iFdcHubAbi,
    functionName: "fdcRequestFeeConfigurations"
  });
  const requestFee = await client.readContract({
    address: feeConfiguration,
    abi: coston2.iFdcRequestFeeConfigurationsAbi,
    functionName: "getRequestFee",
    args: [abiEncodedRequest]
  });
  const hash = await walletClient.writeContract({
    account,
    address: fdcHub,
    abi: coston2.iFdcHubAbi,
    functionName: "requestAttestation",
    args: [abiEncodedRequest],
    value: requestFee
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const manager = await getContractAddressByName("FlareSystemsManager", client);
  const [start, duration] = await Promise.all([
    client.readContract({ address: manager, abi: coston2.iFlareSystemsManagerAbi, functionName: "firstVotingRoundStartTs" }),
    client.readContract({ address: manager, abi: coston2.iFlareSystemsManagerAbi, functionName: "votingEpochDurationSeconds" })
  ]);
  return { hash, receipt, roundId: Number((block.timestamp - start) / duration) };
}

function xrpResponseParameter() {
  const fragment = coston2.ixrpPaymentVerificationAbi.find(
    (entry) => entry.type === "function" && entry.name === "verifyXRPPayment"
  );
  const parameter = fragment?.inputs?.[0]?.components?.[1];
  if (!parameter) throw new Error("XRPPayment response ABI is unavailable");
  return parameter;
}

export async function retrieveXrpPaymentProof({
  abiEncodedRequest,
  roundId,
  client = publicClient,
  daLayerUrl = FDC_DA_LAYER_URL,
  pollIntervalMs = 10_000,
  maximumAttempts = 24,
  fetchImpl = fetch
}) {
  const [relay, verification] = await Promise.all([
    getContractAddressByName("Relay", client),
    getContractAddressByName("FdcVerification", client)
  ]);
  const protocolId = await client.readContract({
    address: verification,
    abi: coston2.iFdcVerificationAbi,
    functionName: "fdcProtocolId"
  });
  for (let attempt = 0; attempt < maximumAttempts; attempt++) {
    const finalized = await client.readContract({
      address: relay,
      abi: coston2.iRelayAbi,
      functionName: "isFinalized",
      args: [BigInt(protocolId), BigInt(roundId)]
    });
    if (finalized) break;
    if (attempt === maximumAttempts - 1) throw new Error(`FDC round ${roundId} did not finalize in time`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  const url = `${daLayerUrl.replace(/\/$/, "")}/api/v1/fdc/proof-by-request-round-raw`;
  for (let attempt = 0; attempt < maximumAttempts; attempt++) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ votingRoundId: roundId, requestBytes: abiEncodedRequest })
    });
    const raw = await response.json();
    if (raw.response_hex) {
      const [data] = decodeAbiParameters([xrpResponseParameter()], raw.response_hex);
      return { merkleProof: raw.proof || [], data };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`FDC proof for round ${roundId} was not available in time`);
}

export async function executeDirectMintingWithData({
  walletClient,
  account,
  proof,
  data,
  value = 0n,
  client = publicClient
}) {
  const assetManager = await getContractAddressByName("AssetManagerFXRP", client);
  const hash = await walletClient.writeContract({
    account,
    address: assetManager,
    abi: coston2.iDirectMintingAbi,
    functionName: "executeDirectMintingWithData",
    args: [proof, data],
    value
  });
  return { hash, receipt: await client.waitForTransactionReceipt({ hash }) };
}

if (process.argv[1]?.endsWith("fdc-xrp.mjs") && process.argv.length > 3) {
  prepareXrpPaymentRequest({ transactionId: process.argv[2], proofOwner: process.argv[3] })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
