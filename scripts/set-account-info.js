#!/usr/bin/env node
/**
 * Set On-Chain Account Info for Silverback Accounts
 *
 * Sets the name and description for OPS and Treasury accounts.
 * Requires accounts to be funded with KTA for transaction fees.
 *
 * Usage:
 *   node scripts/set-account-info.js ops        # Set OPS account info
 *   node scripts/set-account-info.js treasury   # Set Treasury account info
 *   node scripts/set-account-info.js all        # Set both
 *
 * Environment:
 *   OPS_SEED - Hex seed for OPS account (required for ops/all)
 *   TREASURY_SEED - Hex seed for Treasury account (required for treasury/all)
 */

import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const NETWORK = process.env.NETWORK || process.env.VITE_KEETA_NETWORK || 'main';

// Account configurations
const ACCOUNTS = {
  ops: {
    name: 'OPS Account',
    seedEnv: 'OPS_SEED',
    chainName: 'SILVERBACK_ROUTER',
    chainDescription: 'SILVERBACK_TRADING_ROUTER',
  },
  treasury: {
    name: 'Treasury Account',
    seedEnv: 'TREASURY_SEED',
    chainName: 'SILVERBACK_TREASURY',
    chainDescription: 'SILVERBACK_FEE_COLLECTION',
  },
};

/**
 * Get seed from environment variable
 */
function getSeed(envVar) {
  const seedHex = process.env[envVar];
  if (!seedHex) {
    throw new Error(`${envVar} not found in environment. Add it to .env file.`);
  }
  return Buffer.from(seedHex, 'hex');
}

/**
 * Set account info on-chain
 */
async function setAccountInfo(type) {
  const config = ACCOUNTS[type];
  if (!config) {
    throw new Error(`Unknown account type: ${type}`);
  }

  console.log(`\n🔧 Setting info for ${config.name}...`);
  console.log(`   Name: ${config.chainName}`);
  console.log(`   Description: ${config.chainDescription}`);

  // Get seed and create account
  const seed = getSeed(config.seedEnv);
  const account = KeetaNet.lib.Account.fromSeed(seed, 0);
  const publicKey = account.publicKeyString.get();

  console.log(`   Address: ${publicKey}`);

  // Create UserClient
  const userClient = await KeetaNet.UserClient.fromNetwork(NETWORK, account);

  // Try to check balance (may fail for new accounts)
  try {
    const balance = await userClient.client.getBalance(account);
    console.log(`   Balance: ${balance} (need some KTA for tx fee)`);
    if (balance === 0n) {
      console.log('\n❌ Account has no balance! Fund it with KTA first.');
      console.log(`   Send KTA to: ${publicKey}`);
      return { success: false, error: 'No balance' };
    }
  } catch (balanceError) {
    console.log(`   Balance check failed: ${balanceError.message}`);
    console.log('   Continuing anyway (account may be newly created)...');
  }

  // Build setInfo transaction
  console.log('\n📝 Building setInfo transaction...');
  const builder = userClient.initBuilder();

  builder.setInfo({
    name: config.chainName,
    description: config.chainDescription,
    metadata: '',  // Required field, empty for basic accounts
  });

  // Publish
  console.log('📤 Publishing transaction...');
  const result = await userClient.publishBuilder(builder);

  console.log('\n✅ Account info updated successfully!');
  console.log(`   Name: ${config.chainName}`);
  console.log(`   Description: ${config.chainDescription}`);

  return { success: true, publicKey };
}

/**
 * Main entry point
 */
async function main() {
  const arg = process.argv[2];

  if (!arg || !['ops', 'treasury', 'all'].includes(arg)) {
    console.log('\n🏷️  Silverback Account Info Setter\n');
    console.log('Usage:');
    console.log('  node scripts/set-account-info.js ops        # Set OPS account info');
    console.log('  node scripts/set-account-info.js treasury   # Set Treasury account info');
    console.log('  node scripts/set-account-info.js all        # Set both\n');
    console.log('Requirements:');
    console.log('  - Account must be funded with KTA for transaction fees');
    console.log('  - Seed must be in .env (OPS_SEED, TREASURY_SEED)\n');
    process.exit(1);
  }

  console.log('\n🏷️  Silverback Account Info Setter');
  console.log(`   Network: ${NETWORK}\n`);

  const types = arg === 'all' ? ['ops', 'treasury'] : [arg];

  for (const type of types) {
    try {
      await setAccountInfo(type);
    } catch (error) {
      console.error(`\n❌ Error setting ${type} info:`, error.message);
      if (error.message.includes('not found in environment')) {
        console.log(`\n   Add ${ACCOUNTS[type].seedEnv}=<hex> to your .env file`);
      }
    }
  }

  console.log('\n✨ Done!\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
