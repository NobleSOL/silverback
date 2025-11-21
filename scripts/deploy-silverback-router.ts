import { ethers } from "ethers";
import fs from "fs";
import path from "path";

// Usage (example):
//   node scripts/deploy-silverback-router.ts <RPC_URL> <PRIVATE_KEY> [FEE_BPS]
// Example (Base mainnet):
//   node scripts/deploy-silverback-router.ts https://mainnet.base.org 0xabc123... 30

async function main() {
  const [rpcUrl, pk, feeBpsArg] = process.argv.slice(2);
  if (!rpcUrl || !pk) {
    throw new Error("Args: <RPC_URL> <PRIVATE_KEY> [FEE_BPS]");
  }
  const FEE_RECIPIENT = "0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7"; // Silverback fee address
  const FEE_BPS = feeBpsArg ? parseInt(feeBpsArg, 10) : 30; // 0.30% by default

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  // Compile externally and place the artifact JSON next to this script, or use a monorepo build step.
  // Expecting artifacts at artifacts/contracts/SilverbackRouter.sol/SilverbackRouter.json
  const artifactPath = path.resolve(
    __dirname,
    "../artifacts/contracts/SilverbackRouter.sol/SilverbackRouter.json",
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet,
  );
  console.log("Deploying SilverbackRouter...", {
    feeRecipient: FEE_RECIPIENT,
    feeBps: FEE_BPS,
  });
  const contract = await factory.deploy(FEE_RECIPIENT, FEE_BPS);
  console.log("tx:", contract.deploymentTransaction()?.hash);
  const addr = await contract.getAddress();
  console.log("SilverbackRouter deployed:", addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
