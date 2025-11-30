// Script to discover FX providers on Keeta network
// This helps find the root resolver accounts and test the aggregator concept

import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import Resolver from '@keetanetwork/anchor/lib/resolver.js';

// Known resolver accounts to test
const KNOWN_RESOLVERS = [
  // Your Silverback resolver
  'keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm',

  // TODO: Add Keeta's official root resolver(s) here
  // Ask Keeta team or check their docs for the master resolver account
];

// Token addresses for testing
const KTA = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';
const WAVE = 'keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym';

async function main() {
  console.log('');
  console.log('='.repeat(70));
  console.log('  KEETA FX PROVIDER DISCOVERY');
  console.log('='.repeat(70));
  console.log('');

  // Create client
  const dummySeed = Buffer.alloc(32, 0);
  const dummyAccount = KeetaNet.lib.Account.fromSeed(dummySeed, 0);
  const userClient = KeetaNet.UserClient.fromNetwork('main', dummyAccount);

  for (const resolverAddr of KNOWN_RESOLVERS) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Resolver: ${resolverAddr}`);
    console.log('─'.repeat(70));

    try {
      const rootAccount = KeetaNet.lib.Account.fromPublicKeyString(resolverAddr);

      const resolver = new Resolver({
        root: rootAccount,
        client: userClient.client,
        trustedCAs: [],
        id: 'discovery'
      });

      // Get root metadata
      console.log('\n1. Fetching root metadata...');
      const rootMeta = await resolver.getRootMetadata();

      // Check version
      const version = await rootMeta.version?.('number');
      console.log(`   Version: ${version}`);

      // List available services
      console.log('\n2. Available services:');
      const services = await rootMeta.services?.('object');
      if (services) {
        for (const serviceName of Object.keys(services)) {
          console.log(`   - ${serviceName}`);
        }
      }

      // Get FX providers
      console.log('\n3. FX Providers:');
      const fxServices = services?.fx;
      if (fxServices) {
        const fxObj = typeof fxServices === 'function' ? await fxServices('object') : fxServices;
        for (const [providerId, providerData] of Object.entries(fxObj)) {
          console.log(`\n   Provider: ${providerId}`);

          try {
            const ops = typeof providerData.operations === 'function'
              ? await providerData.operations('object')
              : providerData.operations;

            if (ops) {
              console.log(`   - getQuote: ${ops.getQuote || '(not set)'}`);
              console.log(`   - createExchange: ${ops.createExchange || '(not set)'}`);
            }

            const fromPairs = typeof providerData.from === 'function'
              ? await providerData.from('array')
              : providerData.from;

            if (fromPairs && Array.isArray(fromPairs)) {
              console.log(`   - Conversion pairs: ${fromPairs.length}`);
            }
          } catch (e) {
            console.log(`   - Error reading provider data: ${e.message}`);
          }
        }
      } else {
        console.log('   (no FX services found)');
      }

      // Try to lookup FX providers for KTA/WAVE
      console.log('\n4. Looking up providers for KTA → WAVE...');
      try {
        const providers = await resolver.lookup('fx', {
          inputCurrencyCode: KTA,
          outputCurrencyCode: WAVE
        });

        if (providers) {
          console.log(`   Found ${Object.keys(providers).length} provider(s)`);
          for (const providerId of Object.keys(providers)) {
            console.log(`   - ${providerId}`);
          }
        } else {
          console.log('   No providers found for this pair');
        }
      } catch (e) {
        console.log(`   Lookup error: ${e.message}`);
      }

      // List tokens
      console.log('\n5. Listed tokens:');
      try {
        const tokens = await resolver.listTokens();
        if (tokens && tokens.length > 0) {
          for (const t of tokens.slice(0, 10)) { // Show first 10
            console.log(`   - ${t.currency}: ${t.token.slice(0, 30)}...`);
          }
          if (tokens.length > 10) {
            console.log(`   ... and ${tokens.length - 10} more`);
          }
        } else {
          console.log('   (no tokens listed)');
        }
      } catch (e) {
        console.log(`   Error listing tokens: ${e.message}`);
      }

    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('  NEXT STEPS');
  console.log('='.repeat(70));
  console.log(`
  To build a full aggregator, you need Keeta's ROOT resolver account.
  This is the master account that indexes ALL registered FX providers.

  Ask the Keeta team:
  1. What is the official root resolver account address?
  2. How do FX providers register with the root resolver?
  3. Is there an API to list all registered providers?

  Once you have the root account, add it to KNOWN_RESOLVERS and
  the aggregator will automatically discover all providers.
  `);

  process.exit(0);
}

main().catch(console.error);
