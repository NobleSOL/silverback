#!/usr/bin/env node
/**
 * Generate Secure Mainnet Accounts for Silverback
 *
 * Creates new accounts using BIP39 24-word mnemonic phrases for:
 * - OPS account (signs pool operations)
 * - Treasury account (collects protocol fees)
 * - FX Resolver account (stores FX metadata)
 *
 * SECURITY:
 * - Run this on a secure, offline machine if possible
 * - Never share or commit the mnemonic phrases
 * - Store mnemonics in a secure location (hardware wallet, vault, etc.)
 *
 * Usage:
 *   node scripts/generate-mainnet-accounts.js [ops|treasury|resolver|all]
 */

import * as bip39 from 'bip39';
import * as crypto from 'crypto';
import * as KeetaNet from '@keetanetwork/keetanet-client';

// Account types to generate
const ACCOUNT_TYPES = {
  ops: {
    name: 'OPS Account',
    description: 'Signs pool operations (swaps, liquidity, etc.)',
    envVar: 'OPS_SEED',
  },
  treasury: {
    name: 'Treasury Account',
    description: 'Collects protocol fees (0.05% of swaps)',
    envVar: 'TREASURY_ADDRESS',
  },
  resolver: {
    name: 'FX Resolver Account',
    description: 'Storage account for FX service metadata',
    envVar: 'FX_RESOLVER_ADDRESS',
  },
};

/**
 * Generate a new account with BIP39 mnemonic
 */
function generateAccount(type) {
  const config = ACCOUNT_TYPES[type];
  if (!config) {
    throw new Error(`Unknown account type: ${type}`);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔐 Generating ${config.name}`);
  console.log(`   ${config.description}`);
  console.log('='.repeat(70));

  // Generate 24-word mnemonic (256 bits of entropy)
  const mnemonic = bip39.generateMnemonic(256);

  // Convert mnemonic to seed (BIP39 standard)
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Use first 32 bytes as Keeta seed
  const keetaSeed = seed.slice(0, 32);

  // Create Keeta account
  const account = KeetaNet.lib.Account.fromSeed(keetaSeed, 0);
  const publicKey = account.publicKeyString.get();

  // Also show as hex for .env file
  const seedHex = keetaSeed.toString('hex');

  console.log('\n📋 MNEMONIC PHRASE (24 words):');
  console.log('   ⚠️  WRITE THIS DOWN AND STORE SECURELY!');
  console.log('   ⚠️  NEVER SHARE OR COMMIT THIS!');
  console.log('\n   ' + mnemonic.split(' ').slice(0, 12).join(' '));
  console.log('   ' + mnemonic.split(' ').slice(12).join(' '));

  console.log('\n📍 PUBLIC ADDRESS:');
  console.log(`   ${publicKey}`);

  console.log('\n🔑 SEED (hex) - ADD THIS TO RENDER ENV VARS:');
  console.log(`   ${config.envVar}=${seedHex}`);
  console.log('\n   → Copy this hex value to Render dashboard → Environment');
  console.log('   → The mnemonic above is your BACKUP (store offline)');

  console.log('\n' + '-'.repeat(70));

  return {
    type,
    name: config.name,
    mnemonic,
    publicKey,
    seedHex,
    envVar: config.envVar,
  };
}

/**
 * Recover hex seed from existing mnemonic
 */
function recoverFromMnemonic(mnemonic) {
  console.log('\n🔄 Recovering account from mnemonic...');

  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Convert mnemonic to seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const keetaSeed = seed.slice(0, 32);

  // Create account
  const account = KeetaNet.lib.Account.fromSeed(keetaSeed, 0);
  const publicKey = account.publicKeyString.get();
  const seedHex = keetaSeed.toString('hex');

  console.log('\n📍 PUBLIC ADDRESS:');
  console.log(`   ${publicKey}`);

  console.log('\n🔑 SEED (hex) for .env:');
  console.log(`   ${seedHex}`);

  return { publicKey, seedHex };
}

/**
 * Main entry point
 */
async function main() {
  const arg = process.argv[2] || 'all';

  // Recovery mode
  if (arg === 'recover') {
    const mnemonic = process.argv.slice(3).join(' ');
    if (!mnemonic || mnemonic.split(' ').length < 12) {
      console.log('\n🔄 Recovery Mode - Regenerate hex seed from mnemonic\n');
      console.log('Usage: node scripts/generate-mainnet-accounts.js recover <24 word mnemonic>');
      console.log('\nExample:');
      console.log('  node scripts/generate-mainnet-accounts.js recover word1 word2 word3 ... word24');
      process.exit(1);
    }
    recoverFromMnemonic(mnemonic);
    return;
  }

  console.log('\n🔒 Silverback Mainnet Account Generator');
  console.log('   Generating secure accounts with BIP39 mnemonics\n');

  console.log('⚠️  SECURITY WARNING:');
  console.log('   - Run on a secure, preferably offline machine');
  console.log('   - Never share or commit mnemonic phrases');
  console.log('   - Store mnemonics in a hardware wallet or secure vault');
  console.log('   - The hex seed in .env is derived from the mnemonic');
  console.log('   - Keep mnemonic as backup - seed can be regenerated from it');

  const accounts = [];

  if (arg === 'all') {
    // Generate all accounts
    for (const type of Object.keys(ACCOUNT_TYPES)) {
      accounts.push(generateAccount(type));
    }
  } else if (ACCOUNT_TYPES[arg]) {
    // Generate single account type
    accounts.push(generateAccount(arg));
  } else {
    console.error(`\n❌ Unknown account type: ${arg}`);
    console.log('\nUsage:');
    console.log('  node scripts/generate-mainnet-accounts.js [ops|treasury|resolver|all]');
    console.log('  node scripts/generate-mainnet-accounts.js recover <24 word mnemonic>');
    process.exit(1);
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('📝 SUMMARY - Environment Variables for .env');
  console.log('='.repeat(70));
  console.log('\n# Silverback Mainnet Accounts');
  console.log(`# Generated: ${new Date().toISOString()}`);
  console.log('# ⚠️ KEEP THESE SECRET!\n');

  for (const acc of accounts) {
    if (acc.type === 'ops') {
      console.log(`# ${acc.name}`);
      console.log(`${acc.envVar}=${acc.seedHex}`);
    } else {
      console.log(`# ${acc.name}`);
      console.log(`${acc.envVar}=${acc.publicKey}`);
    }
    console.log('');
  }

  console.log('\n' + '='.repeat(70));
  console.log('🔐 MNEMONIC BACKUP CHECKLIST');
  console.log('='.repeat(70));
  console.log('\n[ ] Written down all mnemonic phrases');
  console.log('[ ] Stored in secure location (hardware wallet, vault, etc.)');
  console.log('[ ] Verified mnemonics are correct');
  console.log('[ ] Cleared terminal history: history -c');
  console.log('[ ] Did NOT save this output to a file');
  console.log('\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
