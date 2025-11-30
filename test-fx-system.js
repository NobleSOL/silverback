// Comprehensive FX Anchor System Test
// Tests the entire flow from metadata to quote to swap execution

import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import Resolver from '@keetanetwork/anchor/lib/resolver.js';

// Token addresses
const KTA = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';
const WAVE = 'keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym';

// Pool address (KTA/WAVE anchor pool)
const POOL = 'keeta_atarbm5jjcgnujxkkc3mbxo6tvzpjg33xil27we3y4g4r7lssb5yckvqneqsk';

// Resolver accounts to check
const RESOLVER_OLD = 'keeta_atkceaeuwehunyzmp5vzvjbgxy6orsisfenafd455y5ehiwzhe4hqvlpazyim';
const RESOLVER_NEW = 'keeta_aqqhqfbgt2v4ie445odoppu2m7fqzjkn7irnp6jejz766yamkx4553445e4lo';

// Server URL
const FX_SERVER = 'https://dexkeeta.onrender.com/fx';

const TESTS = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  TESTS.push({ name, fn });
}

async function runTests() {
  console.log('');
  console.log('='.repeat(70));
  console.log('  SILVERBACK FX ANCHOR SYSTEM TEST');
  console.log('='.repeat(70));
  console.log('');

  for (const { name, fn } of TESTS) {
    process.stdout.write(`  ${name}... `);
    try {
      await fn();
      console.log('\x1b[32mPASS\x1b[0m');
      passed++;
    } catch (error) {
      console.log(`\x1b[31mFAIL\x1b[0m`);
      console.log(`    Error: ${error.message}`);
      failed++;
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(70));
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

// Initialize client
let client;
async function getClient() {
  if (!client) {
    const dummySeed = Buffer.alloc(32, 0);
    const dummyAccount = KeetaNet.lib.Account.fromSeed(dummySeed, 0);
    const userClient = KeetaNet.UserClient.fromNetwork('main', dummyAccount);
    client = userClient.client;
  }
  return client;
}

// ==================== TESTS ====================

test('1. Pool exists on blockchain', async () => {
  const c = await getClient();
  const info = await c.getAccountsInfo([POOL]);
  if (!info[POOL]) throw new Error('Pool account not found');
  if (!info[POOL].info) throw new Error('Pool has no info');
});

test('2. Pool has token balances (KTA)', async () => {
  const c = await getClient();
  const balances = await c.balances({ account: KeetaNet.lib.Account.fromPublicKeyString(POOL) });
  const ktaBalance = balances.find(b => b.token.publicKeyString?.toString() === KTA);
  if (!ktaBalance || ktaBalance.balance === 0n) {
    throw new Error('Pool has no KTA balance');
  }
  console.log(`\n    KTA balance: ${Number(ktaBalance.balance) / 1e9}`);
});

test('3. Pool has token balances (WAVE)', async () => {
  const c = await getClient();
  const balances = await c.balances({ account: KeetaNet.lib.Account.fromPublicKeyString(POOL) });
  const waveBalance = balances.find(b => b.token.publicKeyString?.toString() === WAVE);
  if (!waveBalance || waveBalance.balance === 0n) {
    throw new Error('Pool has no WAVE balance');
  }
  console.log(`\n    WAVE balance: ${Number(waveBalance.balance) / 1e9}`);
});

test('4. FX server root endpoint responds', async () => {
  const response = await fetch(`${FX_SERVER}/`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  console.log(`\n    Response: ${text.substring(0, 100)}...`);
});

test('5. FX server getQuote endpoint responds', async () => {
  const response = await fetch(`${FX_SERVER}/api/getQuote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request: {
        from: WAVE,
        to: KTA,
        amount: '1000000000', // 1 WAVE
        affinity: 'from'
      }
    })
  });

  const text = await response.text();
  console.log(`\n    Status: ${response.status}`);
  console.log(`    Response: ${text.substring(0, 200)}...`);

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);

  const data = JSON.parse(text);
  if (!data.convertedAmount) throw new Error('Missing convertedAmount in response');
});

test('6. Resolver OLD has metadata', async () => {
  const c = await getClient();
  const info = await c.getAccountsInfo([RESOLVER_OLD]);
  const metadata = info[RESOLVER_OLD]?.info?.metadata;

  if (!metadata) {
    throw new Error('No metadata on resolver account');
  }

  // Decode metadata
  try {
    const compressed = Buffer.from(metadata, 'base64');
    const decompressed = KeetaNet.lib.Utils.Buffer.ZlibInflate(
      KeetaNet.lib.Utils.Helper.bufferToArrayBuffer(compressed)
    );
    const json = JSON.parse(Buffer.from(decompressed).toString('utf-8'));
    console.log(`\n    Metadata version: ${json.version}`);
    console.log(`    Has currencyMap: ${!!json.currencyMap}`);
    console.log(`    Has services.fx: ${!!json.services?.fx}`);
  } catch (e) {
    throw new Error(`Failed to decode metadata: ${e.message}`);
  }
});

test('7. Resolver NEW has metadata', async () => {
  const c = await getClient();
  const info = await c.getAccountsInfo([RESOLVER_NEW]);
  const metadata = info[RESOLVER_NEW]?.info?.metadata;

  if (!metadata) {
    throw new Error('No metadata on resolver account - NEEDS REPUBLISHING');
  }

  // Decode metadata
  try {
    const compressed = Buffer.from(metadata, 'base64');
    const decompressed = KeetaNet.lib.Utils.Buffer.ZlibInflate(
      KeetaNet.lib.Utils.Helper.bufferToArrayBuffer(compressed)
    );
    const json = JSON.parse(Buffer.from(decompressed).toString('utf-8'));
    console.log(`\n    Metadata version: ${json.version}`);
    console.log(`    currencyMap keys: ${Object.keys(json.currencyMap || {}).join(', ')}`);
    console.log(`    FX provider: ${Object.keys(json.services?.fx || {}).join(', ')}`);
  } catch (e) {
    throw new Error(`Failed to decode metadata: ${e.message}`);
  }
});

test('8. CurrencyMap format is correct (symbol -> address)', async () => {
  const c = await getClient();
  const info = await c.getAccountsInfo([RESOLVER_OLD]);
  const metadata = info[RESOLVER_OLD]?.info?.metadata;

  if (!metadata) throw new Error('No metadata');

  const compressed = Buffer.from(metadata, 'base64');
  const decompressed = KeetaNet.lib.Utils.Buffer.ZlibInflate(
    KeetaNet.lib.Utils.Helper.bufferToArrayBuffer(compressed)
  );
  const json = JSON.parse(Buffer.from(decompressed).toString('utf-8'));

  const currencyMap = json.currencyMap;
  if (!currencyMap) throw new Error('No currencyMap');

  // Check format: keys should be like "$KTA", values should be keeta addresses
  for (const [key, value] of Object.entries(currencyMap)) {
    if (!key.startsWith('$')) {
      throw new Error(`CurrencyMap key "${key}" should start with $ (e.g., "$KTA")`);
    }
    if (typeof value !== 'string' || !value.startsWith('keeta_')) {
      throw new Error(`CurrencyMap value for "${key}" should be a keeta address, got: ${typeof value}`);
    }
  }

  console.log(`\n    Format is correct: ${Object.keys(currencyMap).length} currencies mapped`);
});

test('9. FX operations URLs are correct format', async () => {
  const c = await getClient();
  const info = await c.getAccountsInfo([RESOLVER_OLD]);
  const metadata = info[RESOLVER_OLD]?.info?.metadata;

  if (!metadata) throw new Error('No metadata');

  const compressed = Buffer.from(metadata, 'base64');
  const decompressed = KeetaNet.lib.Utils.Buffer.ZlibInflate(
    KeetaNet.lib.Utils.Helper.bufferToArrayBuffer(compressed)
  );
  const json = JSON.parse(Buffer.from(decompressed).toString('utf-8'));

  const fx = json.services?.fx?.silverback;
  if (!fx) throw new Error('No FX service config');

  const ops = fx.operations;
  if (!ops) throw new Error('No operations defined');

  // Check getExchangeStatus uses {id} not :id
  if (ops.getExchangeStatus && ops.getExchangeStatus.includes(':id')) {
    throw new Error('getExchangeStatus uses :id instead of {id}');
  }

  console.log(`\n    getQuote: ${ops.getQuote}`);
  console.log(`    createExchange: ${ops.createExchange}`);
  console.log(`    getExchangeStatus: ${ops.getExchangeStatus}`);
});

// Run all tests
runTests();
