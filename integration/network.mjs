import { createPublicClient, defineChain, http } from "viem";

export const COSTON2_RPC_URL = process.env.COSTON2_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
export const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
export const PUBLIC_FDC_API_KEY = process.env.FDC_VERIFIER_API_KEY || "";
export const FDC_VERIFIER_BASE_URL = process.env.FDC_VERIFIER_BASE_URL || "https://fdc-verifiers-testnet.flare.network";
export const FDC_DA_LAYER_URL = process.env.FDC_DA_LAYER_URL || "https://ctn2-data-availability.flare.network";

export const coston2Chain = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [COSTON2_RPC_URL] } },
  blockExplorers: { default: { name: "Coston2 Explorer", url: "https://coston2-explorer.flare.network" } },
  testnet: true,
});

export const publicClient = createPublicClient({ chain: coston2Chain, transport: http(COSTON2_RPC_URL) });
