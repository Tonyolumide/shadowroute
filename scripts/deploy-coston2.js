const { ethers } = require("hardhat");
const { mkdir, writeFile } = require("node:fs/promises");

async function main() {
  const [deployer] = await ethers.getSigners();
  const teeSigner = process.env.TEE_SIGNER_ADDRESS;
  if (!teeSigner || !ethers.isAddress(teeSigner)) {
    throw new Error("Set TEE_SIGNER_ADDRESS to a valid address before deployment");
  }

  const Router = await ethers.getContractFactory("ShadowRouter");
  const router = await Router.deploy(deployer.address, teeSigner);
  await router.waitForDeployment();
  const record = {
    network: "coston2",
    deployer: deployer.address,
    teeSigner,
    shadowRouter: await router.getAddress(),
    deploymentTransactionHash: router.deploymentTransaction().hash,
    authorizationSchema: "RouteAuthorization-v2"
  };
  await mkdir("deployments", { recursive: true });
  await writeFile("deployments/coston2-shadowrouter-v2.json", JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
