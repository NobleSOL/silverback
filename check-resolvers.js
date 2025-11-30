import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const ACCOUNTS = [
  { name: 'NEW RESOLVER', addr: 'keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm' },
  { name: 'Old (2hr)', addr: 'keeta_atkceaeuwehunyzmp5vzvjbgxy6orsisfenafd455y5ehiwzhe4hqvlpazyim' }
];

async function check() {
  // Create a dummy account just to get a client
  const dummySeed = Buffer.alloc(32, 0);
  const dummyAccount = KeetaNet.lib.Account.fromSeed(dummySeed, 0);
  const userClient = KeetaNet.UserClient.fromNetwork('main', dummyAccount);
  const client = userClient.client;

  for (const acc of ACCOUNTS) {
    console.log('\n' + '='.repeat(60));
    console.log(acc.name);
    console.log(acc.addr);
    console.log('='.repeat(60));

    try {
      const accountsInfo = await client.getAccountsInfo([acc.addr]);
      const info = accountsInfo[acc.addr]?.info;

      console.log('Name:', info?.name);
      console.log('Metadata length:', info?.metadata?.length || 0);

      if (info?.metadata) {
        // Try to decode - base64 decode -> zlib inflate -> JSON parse
        try {
          const compressed = Buffer.from(info.metadata, 'base64');
          const decompressed = KeetaNet.lib.Utils.Buffer.ZlibInflate(
            KeetaNet.lib.Utils.Helper.bufferToArrayBuffer(compressed)
          );
          const json = JSON.parse(Buffer.from(decompressed).toString('utf-8'));
          console.log('\nDecoded Metadata:');
          console.log(JSON.stringify(json, null, 2));
        } catch (e) {
          console.log('Failed to decode:', e.message);
          console.log('Raw preview:', info.metadata.substring(0, 100));
        }
      } else {
        console.log('NO METADATA!');
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
  }

  process.exit(0);
}

check().catch(console.error);
