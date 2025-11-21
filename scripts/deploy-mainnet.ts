import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// MAINNET DEPLOYMENT SCRIPT - USE WITH CAUTION
// This deploys to Base Mainnet (Chain ID: 8453)

async function main() {
  console.log("🚀 Silverback DEX - Base Mainnet Deployment");
  console.log("==========================================\n");

  // Load environment variables
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const RPC_URL = process.env.MAINNET_RPC_URL || "https://mainnet.base.org";
  const FEE_RECIPIENT = process.env.FEE_RECIPIENT || process.env.DEPLOYER_ADDRESS;

  if (!PRIVATE_KEY || PRIVATE_KEY.length < 60) {
    throw new Error("❌ PRIVATE_KEY not set in .env or invalid");
  }

  if (!FEE_RECIPIENT) {
    throw new Error("❌ FEE_RECIPIENT not set in .env");
  }

  // Connect to Base Mainnet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const deployer = await wallet.getAddress();

  // Verify network
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 8453) {
    throw new Error(`❌ Wrong network! Expected Base Mainnet (8453), got ${network.chainId}`);
  }

  console.log("📍 Network: Base Mainnet (Chain ID: 8453)");
  console.log(`👤 Deployer: ${deployer}`);
  console.log(`💰 Fee Recipient: ${FEE_RECIPIENT}`);

  const balance = await provider.getBalance(deployer);
  console.log(`💵 Balance: ${ethers.formatEther(balance)} ETH\n`);

  if (balance < ethers.parseEther("0.01")) {
    throw new Error("❌ Insufficient balance! Need at least 0.01 ETH for deployment");
  }

  // WETH address on Base Mainnet
  const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

  // Fee settings (0.3% = 30 basis points)
  const FEE_BPS = 30;

  console.log("⚙️  Deployment Configuration:");
  console.log(`   WETH: ${WETH_ADDRESS}`);
  console.log(`   Fee: ${FEE_BPS / 100}% (${FEE_BPS} bps)\n`);

  // Confirmation prompt
  console.log("⚠️  WARNING: This will deploy to MAINNET with REAL ETH!");
  console.log("   Estimated cost: ~0.005 ETH (~$20 at current prices)");
  console.log("   Contracts will be immutable after deployment\n");

  // Load compiled contracts
  const factoryArtifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../artifacts/contracts/SilverbackFactory.sol/SilverbackFactory.json"),
      "utf8"
    )
  );

  const routerArtifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../artifacts/contracts/SilverbackUnifiedRouter.sol/SilverbackUnifiedRouter.json"),
      "utf8"
    )
  );

  // Step 1: Deploy Factory
  console.log("📦 Step 1: Deploying SilverbackFactory...");
  const FactoryFactory = new ethers.ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    wallet
  );

  const factory = await FactoryFactory.deploy(FEE_RECIPIENT);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log(`✅ Factory deployed: ${factoryAddress}\n`);

  // Step 2: Deploy UnifiedRouter
  console.log("📦 Step 2: Deploying SilverbackUnifiedRouter...");
  const RouterFactory = new ethers.ContractFactory(
    routerArtifact.abi,
    routerArtifact.bytecode,
    wallet
  );

  const router = await RouterFactory.deploy(
    FEE_RECIPIENT,
    FEE_BPS,
    factoryAddress,
    WETH_ADDRESS
  );
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  console.log(`✅ UnifiedRouter deployed: ${routerAddress}\n`);

  // Verify deployment
  console.log("🔍 Verifying deployment...");
  const feeRecipient = await router.feeRecipient();
  const feeBps = await router.feeBps();
  const routerFactory = await router.factory();
  const routerWeth = await router.WETH();

  console.log(`   Fee Recipient: ${feeRecipient} ${feeRecipient === FEE_RECIPIENT ? "✅" : "❌"}`);
  console.log(`   Fee BPS: ${feeBps} ${feeBps === BigInt(FEE_BPS) ? "✅" : "❌"}`);
  console.log(`   Factory: ${routerFactory} ${routerFactory === factoryAddress ? "✅" : "❌"}`);
  console.log(`   WETH: ${routerWeth} ${routerWeth === WETH_ADDRESS ? "✅" : "❌"}\n`);

  // Summary
  console.log("🎉 DEPLOYMENT SUCCESSFUL!");
  console.log("========================\n");
  console.log("📋 Deployed Contracts (Base Mainnet):");
  console.log(`   Factory: ${factoryAddress}`);
  console.log(`   Router: ${routerAddress}`);
  console.log(`   Fee Recipient: ${FEE_RECIPIENT}`);
  console.log(`   Fee: 0.3% (30 bps)\n`);

  console.log("🔗 Basescan Links:");
  console.log(`   Factory: https://basescan.org/address/${factoryAddress}`);
  console.log(`   Router: https://basescan.org/address/${routerAddress}\n`);

  console.log("📝 Environment Variables (.env):");
  console.log(`   VITE_SB_V2_FACTORY=${factoryAddress}`);
  console.log(`   VITE_SB_UNIFIED_ROUTER=${routerAddress}`);
  console.log(`   VITE_SB_V2_ROUTER=${routerAddress}\n`);

  console.log("⚠️  Next Steps:");
  console.log("   1. Update .env with new addresses");
  console.log("   2. Verify contracts on Basescan:");
  console.log(`      npx hardhat verify --network base ${factoryAddress} "${FEE_RECIPIENT}"`);
  console.log(`      npx hardhat verify --network base ${routerAddress} "${FEE_RECIPIENT}" ${FEE_BPS} "${factoryAddress}" "${WETH_ADDRESS}"`);
  console.log("   3. Test with small amounts first!");
  console.log("   4. Update frontend to point to mainnet\n");

  // Save deployment info
  const deploymentInfo = {
    network: "base-mainnet",
    chainId: 8453,
    deployer,
    timestamp: new Date().toISOString(),
    contracts: {
      factory: factoryAddress,
      router: routerAddress,
      weth: WETH_ADDRESS,
    },
    config: {
      feeRecipient: FEE_RECIPIENT,
      feeBps: FEE_BPS,
    },
  };

  fs.writeFileSync(
    path.join(__dirname, "../deployment-mainnet.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("💾 Deployment info saved to deployment-mainnet.json\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
