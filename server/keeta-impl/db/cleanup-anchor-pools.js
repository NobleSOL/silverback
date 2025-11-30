// Cleanup unfunded anchor pools - keep only the funded KTA/WAVE pool
import { getAnchorRepository } from './anchor-repository.js';

const POOLS_TO_DELETE = [
  'keeta_ar625ggl42fqb5tbtgmcw5abd277xpujg6odgjfypmdlq6c53xztzptkssoja', // KTA/ROCK - unfunded
  'keeta_aqqvchwui4oftmsn6wlesseymdu6z5wfrjycabsenywsxzh7bjvjssf6vstgi', // KTA/RIDE - unfunded
  'keeta_aqncunhoohmuvsbxswiu22uxxivojwy33rwnyycrzededjlythl75tqkrhyns'  // RIDE/WAVE - unfunded
];

const POOL_TO_KEEP = 'keeta_atarbm5jjcgnujxkkc3mbxo6tvzpjg33xil27we3y4g4r7lssb5yckvqneqsk'; // KTA/WAVE - funded

async function cleanupPools() {
  const repo = getAnchorRepository();

  console.log('🗑️  Cleaning up unfunded anchor pools...\n');

  for (const poolAddress of POOLS_TO_DELETE) {
    try {
      const pool = await repo.getAnchorPoolByAddress(poolAddress);
      if (pool) {
        console.log(`Deleting pool: ${poolAddress.slice(-12)}`);
        console.log(`  Pair: ${pool.token_a.slice(-8)} / ${pool.token_b.slice(-8)}`);
        await repo.deleteAnchorPool(poolAddress);
        console.log(`  ✅ Deleted\n`);
      } else {
        console.log(`Pool ${poolAddress.slice(-12)} not found, skipping\n`);
      }
    } catch (error) {
      console.error(`❌ Error deleting ${poolAddress.slice(-12)}:`, error.message);
    }
  }

  // Verify the kept pool
  console.log('✅ Verifying kept pool...');
  const keptPool = await repo.getAnchorPoolByAddress(POOL_TO_KEEP);
  if (keptPool) {
    console.log(`  Pool: ${POOL_TO_KEEP.slice(-12)}`);
    console.log(`  Pair: ${keptPool.token_a.slice(-8)} / ${keptPool.token_b.slice(-8)}`);
    console.log(`  Status: ${keptPool.status}`);
    console.log(`  Fee: ${keptPool.fee_bps / 100}%\n`);
  }

  // List all remaining pools
  const allPools = await repo.loadAnchorPools();
  console.log(`📊 Total active anchor pools: ${allPools.length}`);
  console.log('✅ Cleanup complete!\n');

  process.exit(0);
}

cleanupPools().catch(error => {
  console.error('❌ Cleanup failed:', error);
  process.exit(1);
});
