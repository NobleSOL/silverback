// server/keeta-impl/services/resolver-registration.js
// Helper utilities for FX Resolver registration

import { startSilverbackFXAnchorServer } from './fx-anchor-server.js';

/**
 * Get service metadata for resolver registration
 * This returns the information needed to register Silverback with the FX resolver
 */
export async function getResolverMetadata() {
  try {
    console.log('🔍 Fetching Silverback FX service metadata...\n');

    // Start FX server temporarily to get metadata
    const server = await startSilverbackFXAnchorServer(3001);

    // Get service metadata
    const metadata = await server.serviceMetadata();

    console.log('📊 Service Metadata:');
    console.log(JSON.stringify(metadata, null, 2));
    console.log('\n');

    // Provider information for registration
    const providerInfo = {
      id: 'silverback',
      name: 'Silverback DEX',
      description: 'User-created anchor pools with competitive fees',
      url: process.env.FX_ANCHOR_URL || 'https://dexkeeta.onrender.com:3001',
      metadata: metadata,
      contact: {
        website: 'https://dexkeeta.onrender.com',
        support: 'Discord/Telegram' // Update with actual contact
      },
      fees: {
        protocol: '0.05%',
        poolCreator: 'Custom (set by pool creator)'
      }
    };

    console.log('📋 Provider Registration Information:');
    console.log(JSON.stringify(providerInfo, null, 2));
    console.log('\n');

    console.log('✅ Metadata ready for resolver registration');
    console.log('\n📝 Next steps:');
    console.log('1. Contact Keeta Network team');
    console.log('2. Provide the Provider Registration Information above');
    console.log('3. Ensure FX server is accessible at:', providerInfo.url);
    console.log('\n');

    return providerInfo;
  } catch (error) {
    console.error('❌ Failed to get metadata:', error);
    throw error;
  }
}

/**
 * Test FX server endpoints
 * Verifies that the FX server is working correctly
 */
export async function testFXServer() {
  try {
    console.log('🧪 Testing Silverback FX Server...\n');

    const serverUrl = process.env.FX_ANCHOR_URL || 'http://localhost:3001';

    // Test 1: Get service metadata
    console.log('Test 1: Service Metadata Endpoint');
    console.log(`GET ${serverUrl}/`);

    const metadataResponse = await fetch(serverUrl);
    const metadata = await metadataResponse.json();

    console.log('Status:', metadataResponse.status);
    console.log('Response:', JSON.stringify(metadata, null, 2));
    console.log(metadata.from ? '✅ Pass\n' : '❌ Fail\n');

    // Test 2: Check available conversion pairs
    console.log('Test 2: Available Conversion Pairs');
    console.log(`Pairs: ${metadata.from?.length || 0}`);

    if (metadata.from && metadata.from.length > 0) {
      console.log('Sample pairs:');
      metadata.from.slice(0, 3).forEach((pair, i) => {
        console.log(`  ${i + 1}. ${pair.currencyCodes[0].slice(0, 20)}... → ${pair.to.length} tokens`);
      });
      console.log('✅ Pass\n');
    } else {
      console.log('⚠️  No conversion pairs available (no anchor pools exist)\n');
    }

    // Test 3: Check endpoints
    console.log('Test 3: API Endpoints');
    console.log('Quote endpoint:', metadata.operations?.getQuote || 'N/A');
    console.log('Exchange endpoint:', metadata.operations?.createExchange || 'N/A');
    console.log('Status endpoint:', metadata.operations?.getExchangeStatus || 'N/A');
    console.log(metadata.operations ? '✅ Pass\n' : '❌ Fail\n');

    console.log('✅ All tests completed\n');

    return {
      success: true,
      metadata,
      tests: {
        metadataEndpoint: metadataResponse.ok,
        conversionPairs: metadata.from?.length > 0,
        endpoints: !!metadata.operations
      }
    };
  } catch (error) {
    console.error('❌ FX Server tests failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Display registration instructions
 */
export function displayRegistrationInstructions() {
  console.log('\n📚 FX Resolver Registration Instructions\n');
  console.log('==================================================\n');

  console.log('STEP 1: Prepare Your Environment');
  console.log('  - Ensure FX server is deployed and accessible');
  console.log('  - Verify port 3001 is open and public');
  console.log('  - Confirm at least one anchor pool exists\n');

  console.log('STEP 2: Get Service Metadata');
  console.log('  Run: node server/keeta-impl/services/resolver-registration.js metadata\n');

  console.log('STEP 3: Test FX Server');
  console.log('  Run: node server/keeta-impl/services/resolver-registration.js test\n');

  console.log('STEP 4: Contact Keeta Network');
  console.log('  - Join Keeta Network Discord/Telegram');
  console.log('  - Request FX resolver registration');
  console.log('  - Provide metadata from Step 2\n');

  console.log('STEP 5: Verification');
  console.log('  - Keeta team will verify your FX server');
  console.log('  - They will add your provider to the resolver');
  console.log('  - Test with Keeta wallet after registration\n');

  console.log('==================================================\n');

  console.log('Benefits After Registration:');
  console.log('  ✅ Silverback pools discoverable in Keeta wallet');
  console.log('  ✅ Proper SWAP transaction display');
  console.log('  ✅ 0.05% protocol fee on all swaps');
  console.log('  ✅ Pool creators earn custom fees');
  console.log('  ✅ Ecosystem growth and visibility\n');
}

// CLI Interface
const command = process.argv[2];

if (command === 'metadata') {
  getResolverMetadata().catch(console.error);
} else if (command === 'test') {
  testFXServer().catch(console.error);
} else if (command === 'help') {
  displayRegistrationInstructions();
} else {
  console.log('Silverback FX Resolver Registration Helper\n');
  console.log('Usage:');
  console.log('  node server/keeta-impl/services/resolver-registration.js <command>');
  console.log('\nCommands:');
  console.log('  metadata  - Get provider metadata for registration');
  console.log('  test      - Test FX server endpoints');
  console.log('  help      - Show registration instructions\n');
}
