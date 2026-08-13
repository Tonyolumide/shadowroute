import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";
import { formatUnits, parseAbi } from "viem";
import { getFlareIntegrationAddresses } from "./flare-registry.mjs";
import { publicClient } from "./network.mjs";

const erc20MetadataAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
]);

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== 114) throw new Error(`Expected Coston2 chain id 114, received ${chainId}`);

  const blockNumber = await publicClient.getBlockNumber();
  const addresses = await getFlareIntegrationAddresses();
  for (const [name, address] of Object.entries(addresses)) {
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") throw new Error(`${name} resolved to an address without code: ${address}`);
  }

  const fxrp = await publicClient.readContract({
    address: addresses.AssetManagerFXRP,
    abi: coston2.iAssetManagerAbi,
    functionName: "fAsset"
  });
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    publicClient.readContract({ address: fxrp, abi: erc20MetadataAbi, functionName: "name" }),
    publicClient.readContract({ address: fxrp, abi: erc20MetadataAbi, functionName: "symbol" }),
    publicClient.readContract({ address: fxrp, abi: erc20MetadataAbi, functionName: "decimals" }),
    publicClient.readContract({ address: fxrp, abi: erc20MetadataAbi, functionName: "totalSupply" })
  ]);

  console.log(JSON.stringify({
    network: "Flare Testnet Coston2",
    chainId,
    blockNumber: blockNumber.toString(),
    addresses,
    fxrp: { address: fxrp, name, symbol, decimals, totalSupply: formatUnits(totalSupply, decimals) }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
