import 'dotenv/config';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const RESOLVER_ADDRESS = 'keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm';

async function debug() {
  const dummySeed = Buffer.alloc(32, 0);
  const dummyAccount = KeetaNet.lib.Account.fromSeed(dummySeed, 0);
  const userClient = KeetaNet.UserClient.fromNetwork('main', dummyAccount);
  const client = userClient.client;

  console.log('Fetching account info for:', RESOLVER_ADDRESS);
  console.log('');

  const accountsInfo = await client.getAccountsInfo([RESOLVER_ADDRESS]);
  const info = accountsInfo[RESOLVER_ADDRESS];

  console.log('Full response:');
  console.log(JSON.stringify(info, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  , 2));

  if (info?.info) {
    console.log('\nParsed fields:');
    console.log('  name:', info.info.name);
    console.log('  description:', info.info.description);
    console.log('  metadata:', info.info.metadata ? `${info.info.metadata.length} chars` : 'null');

    if (info.info.metadata) {
      console.log('\nMetadata preview:', info.info.metadata.substring(0, 100));

      // Try to decode
      try {
        const compressed = Buffer.from(info.info.metadata, 'base64');
        console.log('Base64 decoded length:', compressed.length);

        const decompressed = KeetaNet.lib.Utils.Buffer.ZlibInflate(
          KeetaNet.lib.Utils.Helper.bufferToArrayBuffer(compressed)
        );
        const json = JSON.parse(Buffer.from(decompressed).toString('utf-8'));
        console.log('\nDecoded metadata:');
        console.log(JSON.stringify(json, null, 2));
      } catch (e) {
        console.log('Decode error:', e.message);
      }
    }
  }

  process.exit(0);
}

debug().catch(console.error);
