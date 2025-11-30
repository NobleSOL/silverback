// Check what metadata is actually stored in the resolver account
import 'dotenv/config';
import { getOpsClient } from './server/keeta-impl/utils/client.js';
import * as KeetaNet from '@keetanetwork/keetanet-client';

const RESOLVER_ACCOUNT = 'keeta_atkceaeuwehunyzmp5vzvjbgxy6orsisfenafd455y5ehiwzhe4hqvlpazyim';

async function checkResolverMetadata() {
  try {
    const opsClient = await getOpsClient();

    console.log('🔍 Checking resolver account metadata...\n');
    console.log('Resolver account:', RESOLVER_ACCOUNT);
    console.log('');

    // Get account info
    const resolverAccount = KeetaNet.lib.Account.fromPublicKeyString(RESOLVER_ACCOUNT);
    const accountInfo = await opsClient.network.getInfo(resolverAccount);

    console.log('Account Info:');
    console.log('  Name:', accountInfo?.name || '(none)');
    console.log('  Description:', accountInfo?.description || '(none)');
    console.log('  Metadata length:', accountInfo?.metadata?.length || 0);
    console.log('  Metadata (first 100 chars):', accountInfo?.metadata?.substring(0, 100) || '(empty)');
    console.log('');

    if (!accountInfo?.metadata || accountInfo.metadata.length === 0) {
      console.log('❌ PROBLEM FOUND: Metadata field is empty!');
      console.log('');
      console.log('This explains the "Encoded metadata cannot be an empty string" error.');
      console.log('The metadata needs to be published again with proper formatting.');
    } else {
      console.log('✅ Metadata exists');
      console.log('   Full metadata:', accountInfo.metadata);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkResolverMetadata();
