// server/keeta-impl/services/publish-fx-resolver.js
// Publish FX service metadata to a storage account for resolver discovery

import 'dotenv/config';
import Resolver from '@keetanetwork/anchor/lib/resolver.js';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { getOpsClient } from '../utils/client.js';
import { getSilverbackAnchorService } from './anchor-service.js';

/**
 * Publish FX service metadata to a storage account for resolver discovery
 * This makes Silverback discoverable by Keythings wallet and other FX resolvers
 *
 * @param {string|null} storageAccountAddress - Optional existing storage account address
 * @returns {Promise<{success: boolean, resolverAccount?: string, voteStaple?: string}>}
 */
export async function publishFXMetadataToResolver(storageAccountAddress = null) {
  try {
    const opsClient = await getOpsClient();
    const anchorService = getSilverbackAnchorService();

    console.log('📊 Building FX service metadata...\n');

    // Step 1: Get available pools for conversion pairs
    const pools = await anchorService.getAvailablePools();

    if (!pools || pools.length === 0) {
      throw new Error('No anchor pools available. Create at least one pool first.');
    }

    console.log(`✅ Found ${pools.length} anchor pools`);

    // Step 2: Build conversion pairs from pools
    const conversionMap = new Map();
    for (const pool of pools) {
      const keyAB = pool.token_a;
      const keyBA = pool.token_b;

      if (!conversionMap.has(keyAB)) {
        conversionMap.set(keyAB, new Set());
      }
      if (!conversionMap.has(keyBA)) {
        conversionMap.set(keyBA, new Set());
      }

      conversionMap.get(keyAB).add(pool.token_b);
      conversionMap.get(keyBA).add(pool.token_a);
    }

    const conversions = [];
    for (const [fromToken, toTokens] of conversionMap.entries()) {
      conversions.push({
        currencyCodes: [fromToken],
        to: Array.from(toTokens)
      });
    }

    console.log(`✅ Built ${conversions.length} conversion pairs\n`);

    // Step 3: Build FX metadata structure
    const baseUrl = process.env.FX_ANCHOR_URL || 'https://dexkeeta.onrender.com/fx';

    const fxMetadata = {
      operations: {
        getEstimate: `${baseUrl}/api/getEstimate`,
        getQuote: `${baseUrl}/api/getQuote`,
        createExchange: `${baseUrl}/api/createExchange`,
        getExchangeStatus: `${baseUrl}/api/getExchangeStatus/:id`
      },
      from: conversions
    };

    // Step 4: Build complete ServiceMetadata structure
    const serviceMetadata = {
      version: 1,
      currencyMap: {}, // Optional: can map currency codes to token addresses
      services: {
        fx: {
          'silverback': fxMetadata  // Provider ID is 'silverback'
        }
      }
    };

    console.log('📋 Service Metadata Structure:');
    console.log(JSON.stringify(serviceMetadata, null, 2));
    console.log('');

    // Step 5: Format metadata using Resolver.Metadata.formatMetadata
    console.log('📦 Formatting metadata for on-chain storage...');
    const formattedMetadata = Resolver.Metadata.formatMetadata(serviceMetadata);

    console.log('✅ Formatted metadata (compressed + base64):');
    console.log(`   Length: ${formattedMetadata.length} bytes`);
    console.log(`   Preview: ${formattedMetadata.substring(0, 80)}...`);
    console.log('');

    // Step 6: Publish to storage account
    const builder = opsClient.initBuilder();

    let targetAccount;
    if (storageAccountAddress) {
      // Use existing storage account
      targetAccount = KeetaNet.lib.Account.fromPublicKeyString(storageAccountAddress);
      console.log(`📝 Publishing to existing account: ${storageAccountAddress}`);
    } else {
      // Create new storage account
      console.log('🆕 Creating new storage account for FX resolver...');
      const pending = builder.generateIdentifier(
        KeetaNet.lib.Account.AccountKeyAlgorithm.STORAGE
      );
      await builder.computeBlocks();
      targetAccount = pending.account;
      console.log(`✅ New storage account: ${targetAccount.publicKeyString.get()}`);
    }
    console.log('');

    // Step 7: Set account info with the formatted metadata
    // Note: defaultPermission is REQUIRED for new identifiers (storage accounts)
    const basePermissions = [
      'ACCESS',
      'STORAGE_CAN_HOLD',
      'STORAGE_DEPOSIT',
    ];

    builder.setInfo(
      {
        name: 'SILVERBACK_FX_RESOLVER',
        description: 'FX service metadata for Silverback DEX anchor pools',
        metadata: formattedMetadata,  // This is the key field for resolver discovery
        defaultPermission: new KeetaNet.lib.Permissions(basePermissions),
      },
      { account: targetAccount }
    );

    // Step 8: Publish the transaction
    console.log('📤 Publishing metadata to blockchain...');
    const result = await builder.publish();

    if (result.publish) {
      const resolverAccountAddress = targetAccount.publicKeyString.get();

      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('✅ FX METADATA PUBLISHED SUCCESSFULLY!');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
      console.log('🔗 Resolver Account Address:');
      console.log(`   ${resolverAccountAddress}`);
      console.log('');
      console.log('📋 Transaction Hash:');
      console.log(`   ${result.voteStaple.hash.toString()}`);
      console.log('');
      console.log('📍 How to Use:');
      console.log('   1. Copy the Resolver Account Address above');
      console.log('   2. Open Keythings wallet');
      console.log('   3. Add FX resolver with this address');
      console.log('   4. Silverback pools will be discoverable for swaps!');
      console.log('');
      console.log('🌐 FX Server URL:');
      console.log(`   ${baseUrl}`);
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');

      return {
        success: true,
        resolverAccount: resolverAccountAddress,
        voteStaple: result.voteStaple.hash.toString(),
        fxServerUrl: baseUrl,
        conversionPairs: conversions.length
      };
    } else {
      console.error('❌ Failed to publish metadata');
      console.error('   Publish result:', result);
      return { success: false, error: 'Publish transaction failed' };
    }
  } catch (error) {
    console.error('❌ Failed to publish FX metadata:', error);
    console.error('   Error:', error.message);
    console.error('   Stack:', error.stack);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

/**
 * Update existing resolver account with new metadata
 * Use this when pools change or server URL changes
 */
export async function updateFXResolverMetadata(resolverAccountAddress) {
  console.log('🔄 Updating existing FX resolver metadata...\n');
  return publishFXMetadataToResolver(resolverAccountAddress);
}

// CLI Interface
const command = process.argv[2];
const accountAddress = process.argv[3];

if (command === 'publish') {
  publishFXMetadataToResolver(accountAddress).catch(console.error);
} else if (command === 'update') {
  if (!accountAddress) {
    console.error('❌ Error: Resolver account address required for update');
    console.error('Usage: node publish-fx-resolver.js update <resolver-account-address>');
    process.exit(1);
  }
  updateFXResolverMetadata(accountAddress).catch(console.error);
} else {
  console.log('Silverback FX Resolver Publisher\n');
  console.log('Usage:');
  console.log('  node server/keeta-impl/services/publish-fx-resolver.js <command> [options]\n');
  console.log('Commands:');
  console.log('  publish                  - Create new resolver account and publish metadata');
  console.log('  update <account>         - Update existing resolver account metadata');
  console.log('');
  console.log('Examples:');
  console.log('  node server/keeta-impl/services/publish-fx-resolver.js publish');
  console.log('  node server/keeta-impl/services/publish-fx-resolver.js update keeta_axxxx...');
  console.log('');
}
