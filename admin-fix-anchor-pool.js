// Admin script to verify and fix anchor pool data
// Run on production server to ensure KTA/WAVE pool is in database

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// Pool data
const KTA = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';
const WAVE = 'keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym';
const POOL_ADDRESS = 'keeta_atarbm5jjcgnujxkkc3mbxo6tvzpjg33xil27we3y4g4r7lssb5yckvqneqsk';
const CREATOR = 'keeta_aabtozgfunwwvwdztv54y6l5x57q2g3254shgp27zjltr2xz3pyo7q4tjtmsamy'; // OPS account

// Generate pair key (sorted alphabetically with underscore)
function getPairKey(tokenA, tokenB) {
  const [token0, token1] = [tokenA, tokenB].sort();
  return `${token0}_${token1}`;
}

async function main() {
  console.log('');
  console.log('='.repeat(70));
  console.log('  ANCHOR POOL DATABASE VERIFICATION & FIX');
  console.log('='.repeat(70));
  console.log('');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    // Step 1: Check if anchor_pools table exists
    console.log('1. Checking if anchor_pools table exists...');
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'anchor_pools'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('   ❌ Table does not exist! Creating...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS anchor_pools (
          id SERIAL PRIMARY KEY,
          pool_address VARCHAR(255) UNIQUE NOT NULL,
          creator_address VARCHAR(255) NOT NULL,
          token_a VARCHAR(255) NOT NULL,
          token_b VARCHAR(255) NOT NULL,
          pair_key VARCHAR(511) NOT NULL,
          fee_bps INTEGER NOT NULL DEFAULT 30,
          status VARCHAR(50) NOT NULL DEFAULT 'active',
          lp_token_address VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_anchor_pools_pair_key ON anchor_pools(pair_key);
        CREATE INDEX IF NOT EXISTS idx_anchor_pools_status ON anchor_pools(status);
      `);
      console.log('   ✅ Table created');
    } else {
      console.log('   ✅ Table exists');
    }

    // Step 2: Check if pool exists
    console.log('');
    console.log('2. Checking if KTA/WAVE pool exists...');
    const poolCheck = await pool.query(
      'SELECT * FROM anchor_pools WHERE pool_address = $1',
      [POOL_ADDRESS]
    );

    if (poolCheck.rows.length === 0) {
      console.log('   ❌ Pool not found! Inserting...');

      const pairKey = getPairKey(KTA, WAVE);
      console.log(`   Pair key: ${pairKey}`);

      await pool.query(`
        INSERT INTO anchor_pools (pool_address, creator_address, token_a, token_b, pair_key, fee_bps, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (pool_address) DO UPDATE SET
          token_a = EXCLUDED.token_a,
          token_b = EXCLUDED.token_b,
          pair_key = EXCLUDED.pair_key,
          status = EXCLUDED.status,
          updated_at = CURRENT_TIMESTAMP
      `, [POOL_ADDRESS, CREATOR, KTA, WAVE, pairKey, 30, 'active']);

      console.log('   ✅ Pool inserted');
    } else {
      console.log('   ✅ Pool exists');
      const row = poolCheck.rows[0];
      console.log(`   Status: ${row.status}`);
      console.log(`   Token A: ${row.token_a.slice(0, 30)}...`);
      console.log(`   Token B: ${row.token_b.slice(0, 30)}...`);
      console.log(`   Pair Key: ${row.pair_key.slice(0, 50)}...`);

      // Check if status is active
      if (row.status !== 'active') {
        console.log('');
        console.log('   ⚠️  Pool is not active! Activating...');
        await pool.query(
          'UPDATE anchor_pools SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE pool_address = $2',
          ['active', POOL_ADDRESS]
        );
        console.log('   ✅ Pool activated');
      }
    }

    // Step 3: Verify pair_key format
    console.log('');
    console.log('3. Verifying pair_key format...');
    const expectedPairKey = getPairKey(KTA, WAVE);
    const currentPool = await pool.query(
      'SELECT pair_key FROM anchor_pools WHERE pool_address = $1',
      [POOL_ADDRESS]
    );

    if (currentPool.rows.length > 0) {
      const actualPairKey = currentPool.rows[0].pair_key;
      if (actualPairKey !== expectedPairKey) {
        console.log(`   ❌ Pair key mismatch!`);
        console.log(`   Expected: ${expectedPairKey}`);
        console.log(`   Actual:   ${actualPairKey}`);
        console.log('   Fixing...');

        await pool.query(
          'UPDATE anchor_pools SET pair_key = $1, updated_at = CURRENT_TIMESTAMP WHERE pool_address = $2',
          [expectedPairKey, POOL_ADDRESS]
        );
        console.log('   ✅ Pair key fixed');
      } else {
        console.log('   ✅ Pair key is correct');
      }
    }

    // Step 4: Test the query that getQuote uses
    console.log('');
    console.log('4. Testing getAnchorPoolByPairKey query...');
    const testPairKey = getPairKey(WAVE, KTA);  // Test with reversed order
    console.log(`   Query pair_key: ${testPairKey.slice(0, 50)}...`);

    const queryResult = await pool.query(
      'SELECT * FROM anchor_pools WHERE pair_key = $1 AND status = $2',
      [testPairKey, 'active']
    );

    if (queryResult.rows.length > 0) {
      console.log(`   ✅ Query found ${queryResult.rows.length} pool(s)`);
    } else {
      console.log('   ❌ Query returned no pools!');
    }

    // Step 5: List all anchor pools
    console.log('');
    console.log('5. All anchor pools in database:');
    const allPools = await pool.query('SELECT pool_address, status, pair_key FROM anchor_pools');

    if (allPools.rows.length === 0) {
      console.log('   (no pools)');
    } else {
      for (const row of allPools.rows) {
        console.log(`   - ${row.pool_address.slice(-12)} | ${row.status} | ${row.pair_key.slice(0, 30)}...`);
      }
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('  DONE');
    console.log('='.repeat(70));
    console.log('');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
