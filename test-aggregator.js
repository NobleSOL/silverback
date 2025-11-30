// test-aggregator.js
// Test the FX Aggregator locally

import 'dotenv/config';
import { getFXAggregator } from './server/keeta-impl/services/fx-aggregator.js';

const KTA = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';
const WAVE = 'keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym';

async function main() {
  console.log('');
  console.log('='.repeat(70));
  console.log('  FX AGGREGATOR TEST');
  console.log('='.repeat(70));
  console.log('');

  const aggregator = getFXAggregator();

  // Test 1: List providers
  console.log('1. Listing known providers...');
  const providers = await aggregator.listProviders();
  console.log(`   Found ${providers.length} provider(s):`);
  for (const p of providers) {
    console.log(`   - ${p.id} (${p.source}): ${p.baseUrl || 'N/A'}`);
  }
  console.log('');

  // Test 2: Get quotes for KTA -> WAVE
  console.log('2. Getting quotes for KTA -> WAVE (1 KTA)...');
  const result = await aggregator.getAllQuotes(
    KTA,
    WAVE,
    '1000000000', // 1 KTA (9 decimals)
    'from'
  );

  console.log(`   Queried ${result.providersQueried} provider(s)`);
  console.log(`   Got ${result.quotes.length} valid quote(s)`);
  console.log('');

  if (result.bestQuote) {
    console.log('   Best quote:');
    console.log(`   - Provider: ${result.bestQuote.provider}`);
    console.log(`   - Output: ${result.bestQuote.convertedAmount.toString()} WAVE`);
    console.log(`   - Latency: ${result.bestQuote.latencyMs}ms`);
  } else {
    console.log('   No quotes available');
  }
  console.log('');

  // Test 3: Get quotes for WAVE -> KTA (reverse)
  console.log('3. Getting quotes for WAVE -> KTA (1 WAVE)...');
  const result2 = await aggregator.getAllQuotes(
    WAVE,
    KTA,
    '1000000000', // 1 WAVE
    'from'
  );

  if (result2.bestQuote) {
    console.log('   Best quote:');
    console.log(`   - Provider: ${result2.bestQuote.provider}`);
    console.log(`   - Output: ${result2.bestQuote.convertedAmount.toString()} KTA`);
    console.log(`   - Latency: ${result2.bestQuote.latencyMs}ms`);
  } else {
    console.log('   No quotes available');
  }
  console.log('');

  // Test 4: Test via HTTP (if server is running)
  console.log('4. Testing HTTP endpoint (production)...');
  try {
    const response = await fetch('https://dexkeeta.onrender.com/api/aggregator/providers');
    const data = await response.json();
    console.log(`   HTTP response: ${data.ok ? 'OK' : 'FAILED'}`);
    if (data.providers) {
      console.log(`   Providers from HTTP: ${data.providers.length}`);
    }
  } catch (error) {
    console.log(`   HTTP test failed (server may not have aggregator routes yet): ${error.message}`);
  }
  console.log('');

  console.log('='.repeat(70));
  console.log('  TEST COMPLETE');
  console.log('='.repeat(70));
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
