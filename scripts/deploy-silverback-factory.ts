import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;

  if (!RPC_URL || !PRIVATE_KEY) {
    throw new Error("Missing RPC_URL or PRIVATE_KEY in .env");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const artifactPath = path.resolve(
    __dirname,
    "../artifacts/contracts/SilverbackFactory.sol/SilverbackFactory.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  // Factory constructor usually takes a feeToSetter (the deployer)
  console.log("🚀 Deploying Silverback Factory...");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(wallet.address);
  console.log("📜 Transaction hash:", contract.deploymentTransaction()?.hash);

  const addr = await contract.getAddress();
  console.log("✅ Silverback Factory deployed at:", addr);

  // Write to .env for next steps
  const envPath = path.resolve(__dirname, "../.env");
  const env = fs.readFileSync(envPath, "utf8");
  const newEnv = env.replace(/FACTORY_ADDRESS=.*/g, `FACTORY_ADDRESS=${addr}`);
  fs.writeFileSync(envPath, newEnv);
  console.log("📝 Updated .env with FACTORY_ADDRESS.");
}

main().catch((e) => {
  console.error("❌ Deployment failed:", e);
  process.exit(1);
});
