// Test script to check pair_key generation
import 'dotenv/config';
import { getDbPool } from './server/keeta-impl/db/client.js';
import { getPairKey } from './server/keeta-impl/utils/constants.js';

const KTA = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';
const WAVE = 'keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym';
const POOL_ADDRESS = 'keeta_atarbm5jjcgnujxkkc3mbxo6tvzpjg33xil27we3y4g4r7lssb5yckvqneqsk';

async function testPairKey() {
  try {
    const pool = getDbPool();

    console.log('Testing pair_key generation...\n');

    // Query database for actual pair_key
    console.log('1. Querying database for actual pair_key...');
    const result = await pool.query(
      'SELECT pair_key, token_a, token_b FROM anchor_pools WHERE pool_address = $1',
      [POOL_ADDRESS]
    );

    if (result.rows.length === 0) {
      console.log('❌ Pool not found in database!');
      return;
    }

    const row = result.rows[0];
    console.log('   Database pair_key:', row.pair_key);
    console.log('   Database token_a:', row.token_a);
    console.log('   Database token_b:', row.token_b);
    console.log('');

    // Test getPairKey with both orderings
    console.log('2. Testing getPairKey() function...');
    const generatedKey1 = getPairKey(KTA, WAVE);
    console.log('   getPairKey(KTA, WAVE):', generatedKey1);

    const generatedKey2 = getPairKey(WAVE, KTA);
    console.log('   getPairKey(WAVE, KTA):', generatedKey2);
    console.log('');

    // Compare
    console.log('3. Comparison:');
    console.log('   Database key matches generated key?', row.pair_key === generatedKey1);
    console.log('');

    if (row.pair_key !== generatedKey1) {
      console.log('❌ MISMATCH FOUND!');
      console.log('   Expected:', generatedKey1);
      console.log('   Got:', row.pair_key);
      console.log('');
      console.log('This explains why getAnchorPoolByPairKey() returns no results!');
    } else {
      console.log('✅ Keys match correctly');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testPairKey();
