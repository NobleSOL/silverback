// Simple test to isolate FX Server issue
import { KeetaNetFXAnchorHTTPServer } from '@keetanetwork/anchor/services/fx/server.js';

console.log('Step 1: Import successful');
console.log('KeetaNetFXAnchorHTTPServer:', typeof KeetaNetFXAnchorHTTPServer);

try {
  console.log('\nStep 2: Attempting to instantiate server...');

  // Minimal configuration to test constructor
  const server = new KeetaNetFXAnchorHTTPServer({
    port: 3001,
    homepage: 'https://test.com',
    // client: null, // We'll skip this for now
    // account: async () => {}, // Skip
    // signer: null, // Skip
    // quoteSigner: null, // Skip
    fx: {
      from: async () => {
        console.log('fx.from called');
        return [];
      },
      getConversionRateAndFee: async (request) => {
        console.log('fx.getConversionRateAndFee called');
        throw new Error('Not implemented');
      }
    }
  });

  console.log('\n✅ Server instantiated successfully!');
  console.log('Server type:', typeof server);
  console.log('Server methods:', Object.keys(server));

} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
