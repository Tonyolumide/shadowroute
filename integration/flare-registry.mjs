import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import { FLARE_CONTRACT_REGISTRY, publicClient } from "./network.mjs";

export async function getContractAddressByName(name, client = publicClient) {
  return client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: coston2.iFlareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name]
  });
}

export async function getFlareIntegrationAddresses(client = publicClient) {
  const names = [
    "AssetManagerFXRP",
    "MasterAccountController",
    "FdcHub",
    "FdcVerification",
    "FlareSystemsManager",
    "Relay",
    "FtsoV2"
  ];
  const resolved = await Promise.all(names.map((name) => getContractAddressByName(name, client)));
  return Object.fromEntries(names.map((name, index) => [name, resolved[index]]));
}
