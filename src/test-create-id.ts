import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const TREASURY_SEED = process.env.TREASURY_SEED!;
const treasury = KeetaNet.lib.Account.fromSeed(TREASURY_SEED, 0);
const treasuryClient = KeetaNet.UserClient.fromNetwork('test', treasury);

async function main() {
  console.log("Testing CREATE_IDENTIFIER with plain string...");
  try {
    const block1 = new KeetaNet.lib.Block.Builder()
      .addOperation({
        type: KeetaNet.lib.Block.OperationType.CREATE_IDENTIFIER,
        identifier: "silverback-test-" + Date.now(),
        createArguments: { type: 'SIMPLE' }
      })
      .seal(treasury);

    const staple1 = await treasuryClient.publish(block1);
    console.log("✅ String identifier worked. Staple:", staple1.hash);
  } catch (e: any) {
    console.error("❌ String identifier failed:", e.message || e);
  }

  console.log("\nTesting CREATE_IDENTIFIER with object {name,type}...");
  try {
    const block2 = new KeetaNet.lib.Block.Builder()
      .addOperation({
        type: KeetaNet.lib.Block.OperationType.CREATE_IDENTIFIER,
        identifier: {
          name: "silverback-test-" + Date.now(),
          type: "SIMPLE"
        },
        createArguments: { type: 'SIMPLE' }
      })
      .seal(treasury);

    const staple2 = await treasuryClient.publish(block2);
    console.log("✅ Object identifier worked. Staple:", staple2.hash);
  } catch (e: any) {
    console.error("❌ Object identifier failed:", e.message || e);
  }
}

main().catch(err => console.error(err));
