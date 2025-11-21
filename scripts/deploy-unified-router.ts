import { ethers } from "ethers";
import fs from "fs";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
  const WETH_ADDRESS = process.env.WETH_ADDRESS;
  const FEE_RECIPIENT = process.env.FEE_RECIPIENT;
  const FEE_BPS = parseInt(process.env.FEE_BPS || "30");

  if (!RPC_URL || !PRIVATE_KEY || !FACTORY_ADDRESS || !WETH_ADDRESS || !FEE_RECIPIENT) {
    throw new Error("Missing required environment variables");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const artifactPath = resolve(
    __dirname,
    "../artifacts/contracts/SilverbackUnifiedRouter.sol/SilverbackUnifiedRouter.json"
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found. Please run: npx hardhat compile --config hardhat.config.cjs`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log("🚀 Deploying Silverback Unified Router...");
  console.log("=====================================");
  console.log("Deployer:", wallet.address);
  console.log("Fee Recipient:", FEE_RECIPIENT);
  console.log("Fee BPS:", FEE_BPS, "(", FEE_BPS / 100, "%)");
  console.log("Factory:", FACTORY_ADDRESS);
  console.log("WETH:", WETH_ADDRESS);
  console.log("");

  const contract = await factory.deploy(
    FEE_RECIPIENT,
    FEE_BPS,
    FACTORY_ADDRESS,
    WETH_ADDRESS
  );

  console.log("📜 Transaction hash:", contract.deploymentTransaction()?.hash);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log("✅ Silverback Unified Router deployed at:", addr);
  console.log("");

  // Update .env file
  const envPath = resolve(__dirname, "../.env");
  let env = fs.readFileSync(envPath, "utf8");

  // Add or update UNIFIED_ROUTER_ADDRESS
  if (env.includes("UNIFIED_ROUTER_ADDRESS=")) {
    env = env.replace(/UNIFIED_ROUTER_ADDRESS=.*/g, `UNIFIED_ROUTER_ADDRESS=${addr}`);
  } else {
    env += `\nUNIFIED_ROUTER_ADDRESS=${addr}\n`;
  }

  fs.writeFileSync(envPath, env);
  console.log("📝 Updated .env with UNIFIED_ROUTER_ADDRESS");
  console.log("");
  console.log("🎯 Next steps:");
  console.log("1. Add VITE_SB_UNIFIED_ROUTER=" + addr + " to your .env");
  console.log("2. Restart your frontend dev server");
  console.log("3. Test swaps through the UI");
}

main().catch((e) => {
  console.error("❌ Deployment failed:", e);
  process.exit(1);
});
