/**
 * Deploy contracts to Base Mainnet
 * - Pair: 0.25% fee
 * - Router: 0.05% fee (to specific recipient)
 *
 * IMPORTANT: Update PRIVATE_KEY in .env to your mainnet key before running
 */

const hre = require("hardhat");

const WETH = "0x4200000000000000000000000000000000000006";
const FEE_RECIPIENT = "0xD34411a70EffbDd000c529bbF572082ffDcF1794";
const FEE_BPS = 5; // 0.05%

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║            Deploying Contracts to Base Mainnet                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();

  const [deployer] = await hre.ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Fee recipient:", FEE_RECIPIENT);
  console.log("Router feeBps:", FEE_BPS, "(0.05%)");
  console.log();

  // Check deployer balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer ETH balance:", hre.ethers.formatEther(balance), "ETH");
  console.log();

  // Safety check
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 8453n) {
    throw new Error("NOT ON BASE MAINNET! Current chainId: " + network.chainId);
  }
  console.log("✅ Confirmed on Base Mainnet (chainId: 8453)");
  console.log();

  // Deploy Factory
  console.log("📦 Deploying SilverbackFactory...");
  const Factory = await hre.ethers.getContractFactory("SilverbackFactory");
  const factory = await Factory.deploy(deployer.address); // feeToSetter
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log("✅ Factory deployed:", factoryAddress);
  console.log("   feeToSetter:", deployer.address);
  console.log();

  // Wait for contract to be indexed
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Deploy Router
  console.log("📦 Deploying SilverbackRouter...");
  const Router = await hre.ethers.getContractFactory("SilverbackRouter");
  const router = await Router.deploy(
    FEE_RECIPIENT,
    FEE_BPS,
    factoryAddress,
    WETH
  );
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  console.log("✅ Router deployed:", routerAddress);
  console.log("   feeRecipient:", FEE_RECIPIENT);
  console.log("   feeBps:", FEE_BPS);
  console.log("   factory:", factoryAddress);
  console.log("   WETH:", WETH);
  console.log();

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                    DEPLOYMENT COMPLETE                           ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("📋 Contract Addresses (BASE MAINNET):");
  console.log("─".repeat(70));
  console.log("Factory:", factoryAddress);
  console.log("Router: ", routerAddress);
  console.log();

  console.log("💡 Fee Structure:");
  console.log("─".repeat(70));
  console.log("Pair fee:   0.25% (goes to LP holders)");
  console.log("Router fee: 0.05% (goes to", FEE_RECIPIENT + ")");
  console.log("Total:      0.30%");
  console.log();

  console.log("Next steps:");
  console.log("1. Verify contracts on Basescan:");
  console.log("   npx hardhat verify --network base", factoryAddress, `"${deployer.address}"`);
  console.log("   npx hardhat verify --network base --contract contracts/SilverbackRouter.sol:SilverbackRouter", routerAddress, `"${FEE_RECIPIENT}" "${FEE_BPS}" "${factoryAddress}" "${WETH}"`);
  console.log("2. Update frontend with new contract addresses");
  console.log("3. Test with small liquidity pool");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
