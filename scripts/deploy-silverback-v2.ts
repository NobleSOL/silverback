import hre from "hardhat";
import { ethers } from "hardhat";

// Usage examples:
//   pnpm hardhat run scripts/deploy-silverback-v2.ts --network base-sepolia
//   pnpm hardhat run scripts/deploy-silverback-v2.ts --network base-sepolia -- 0xWETH_ADDRESS 0xFEE_TO
// Defaults:
//   WETH (Base/Mainnet and Base/Sepolia): 0x4200000000000000000000000000000000000006
// Notes:
// - This deploys SilverbackFactory (feeToSetter=deployer) and SilverbackRouter (factory, WETH)
// - If FEE_TO is provided, the script will set it on the factory

const DEFAULT_WETH = "0x4200000000000000000000000000000000000006";

async function main() {
  const [wethArg, feeToArg] = process.argv.slice(2);
  const WETH = wethArg || DEFAULT_WETH;

  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  console.log("Deployer:", deployerAddr);

  // Deploy Factory
  const FactoryCF = await ethers.getContractFactory(
    "contractsV2/SilverbackFactory.sol:SilverbackFactory",
  );
  console.log("Deploying SilverbackFactory...", { feeToSetter: deployerAddr });
  const factory = await FactoryCF.deploy(deployerAddr);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("Factory:", factoryAddr);

  // Optionally set feeTo
  if (feeToArg) {
    console.log("Setting feeTo...", feeToArg);
    const tx = await factory.setFeeTo(feeToArg);
    await tx.wait();
  }

  // Deploy Router
  const RouterCF = await ethers.getContractFactory(
    "contractsV2/SilverbackRouter.sol:SilverbackRouter",
  );
  console.log("Deploying SilverbackRouter...", { factory: factoryAddr, WETH });
  const router = await RouterCF.deploy(factoryAddr, WETH);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("Router:", routerAddr);

  // Output verify commands
  console.log("\nVerify commands:");
  console.log(
    `pnpm hardhat verify --network ${hre.network.name} ${factoryAddr} ${deployerAddr}`,
  );
  if (feeToArg) {
    console.log(
      "Factory feeTo set via runtime tx; no constructor arg for feeTo",
    );
  }
  console.log(
    `pnpm hardhat verify --network ${hre.network.name} ${routerAddr} ${factoryAddr} ${WETH}`,
  );

  console.log("\nFully-qualified names:");
  console.log(
    "Factory:",
    "contractsV2/SilverbackFactory.sol:SilverbackFactory",
  );
  console.log("Router:", "contractsV2/SilverbackRouter.sol:SilverbackRouter");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
