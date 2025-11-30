// Test FX endpoints to simulate what the wallet is doing
import 'dotenv/config';

const KTA = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';
const WAVE = 'keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym';

async function testFXEndpoints() {
  try {
    console.log('🧪 Testing FX Anchor endpoints...\n');

    // Test 1: Get quote endpoint
    console.log('1. Testing /fx/api/getQuote...');
    const quoteBody = {
      from: WAVE,
      to: KTA,
      amount: '1000000000', // 1 WAVE with 9 decimals
      affinity: 'from'
    };

    console.log('   Request:', JSON.stringify(quoteBody, null, 2));

    const quoteResponse = await fetch('https://dexkeeta.onrender.com/fx/api/getQuote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quoteBody)
    });

    console.log('   Status:', quoteResponse.status);

    const quoteText = await quoteResponse.text();
    console.log('   Response:', quoteText);
    console.log('');

    if (quoteResponse.ok) {
      const quoteData = JSON.parse(quoteText);
      console.log('✅ Quote successful!');
      console.log('   Provider:', quoteData.provider);
      console.log('   Amount in:', quoteData.amountIn);
      console.log('   Amount out:', quoteData.amountOut);
    } else {
      console.log('❌ Quote failed');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testFXEndpoints();
