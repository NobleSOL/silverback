# FX Resolver Registration for Silverback Anchor Pools

This guide explains how to register Silverback anchor pools with the Keeta FX resolver, enabling discovery through Keeta wallet and other FX-enabled applications.

## Overview

**What this enables:**
- ✅ Silverback pools discoverable in Keeta wallet
- ✅ Proper SWAP transaction display in explorer
- ✅ Automatic liquidity aggregation across all Keeta wallets
- ✅ Protocol fee collection (0.05% on all swaps)
- ✅ Pool creators still earn their custom fees

**Current Status:**
- ✅ FX Anchor SDK server implemented
- ✅ Protocol fees (0.05%) integrated
- ✅ Server running on port 3001
- ⏳ Pending: Resolver registration

## Architecture

### FX Anchor Server
- **Location**: `server/keeta-impl/services/fx-anchor-server.js`
- **Port**: 3001 (configurable via `FX_ANCHOR_PORT` env variable)
- **SDK**: `@keetanetwork/anchor` FX.Server

### Endpoints Created
The FX Server automatically creates these endpoints:

- `GET /` - Service metadata (conversion pairs, endpoints)
- `POST /api/getQuote` - Get quote for conversion
- `POST /api/createExchange` - Execute swap (creates SWAP transaction)
- `POST /api/getExchangeStatus` - Check swap status
- `POST /api/getEstimate` - Get estimate (optional)

## Registration Steps

### 1. Set up Resolver Account

The FX resolver uses a storage account to publish service metadata.

**Option A: Create new storage account**
```javascript
// server/keeta-impl/services/resolver-setup.js
import { getOpsClient } from '../utils/client.js';

async function createResolverAccount() {
  const opsClient = await getOpsClient();
  const builder = opsClient.initBuilder();

  // Generate storage account for resolver
  const pending = builder.generateIdentifier(
    opsClient.account,
    'storage' // Storage account type
  );

  const { identifier: resolverAccount } = await pending.commit();

  console.log('Resolver Account:', resolverAccount.publicKeyString.get());
  return resolverAccount;
}
```

**Option B: Use existing storage account**
- If you already have a resolver account, use its address

### 2. Publish Service Metadata

Service metadata tells the resolver:
- Which token pairs Silverback supports
- Where the FX endpoints are located
- Provider ID ("silverback")

```javascript
import { startSilverbackFXAnchorServer } from './fx-anchor-server.js';

async function publishMetadata() {
  // Start FX server
  const server = await startSilverbackFXAnchorServer(3001);

  // Get service metadata
  const metadata = await server.serviceMetadata();

  console.log('Service Metadata:', JSON.stringify(metadata, null, 2));

  // Metadata format:
  // {
  //   from: [
  //     {
  //       currencyCodes: ["keeta_token1..."],
  //       to: ["keeta_token2..."]
  //     }
  //   ],
  //   operations: {
  //     getQuote: "http://yourserver:3001/api/getQuote",
  //     createExchange: "http://yourserver:3001/api/createExchange",
  //     getExchangeStatus: "http://yourserver:3001/api/getExchangeStatus/{id}"
  //   }
  // }

  return metadata;
}
```

### 3. Register with Resolver

**Production URL:** Your FX server must be accessible at a public URL
- Current: `https://dexkeeta.onrender.com:3001`
- Make sure port 3001 is open and accessible

**Register the provider:**
```javascript
// This requires resolver account access
// Contact Keeta Network team for registration process
async function registerWithResolver() {
  // Provider registration details
  const providerInfo = {
    id: 'silverback',
    url: 'https://dexkeeta.onrender.com:3001',
    metadata: await publishMetadata()
  };

  // Submit to FX resolver
  // (Exact process depends on Keeta's resolver implementation)
  console.log('Provider Info:', providerInfo);
}
```

## Testing

### Test FX Server Locally

```bash
# Start server
pnpm dev

# Server should log:
# 🔗 Starting Silverback FX Anchor Server...
# ✅ FX Anchor Server running on port 3001
```

### Test Endpoints

```bash
# Get service metadata
curl http://localhost:3001/

# Get quote (example)
curl -X POST http://localhost:3001/api/getQuote \
  -H "Content-Type: application/json" \
  -d '{
    "request": {
      "from": "keeta_tokenA...",
      "to": "keeta_tokenB...",
      "amount": "1000000000",
      "affinity": "from"
    }
  }'
```

### Test with Keeta Wallet

Once registered with resolver:

1. Open Keeta wallet
2. Navigate to Swap interface
3. Select token pair that has Silverback pool
4. Keeta wallet should discover Silverback as liquidity provider
5. Execute swap - should display as "SWAP" in explorer

## Benefits

### For Users
- Access Silverback pools from any FX-enabled wallet
- Proper SWAP transaction display
- Competitive rates from user-created pools

### For Pool Creators
- More swap volume from FX discovery
- Earn custom fees on all swaps
- Pools visible in Keeta ecosystem

### For Silverback
- 0.05% protocol fee on all swaps
- Platform sustainability
- Ecosystem growth

## Next Steps

1. **Deploy to production** - Ensure port 3001 accessible
2. **Contact Keeta team** - Get resolver registration process
3. **Submit provider info** - Register as "silverback" provider
4. **Test with Keeta wallet** - Verify pool discovery
5. **Monitor fees** - Track protocol fee collection

## Environment Variables

```env
# FX Anchor Server Port (default: 3001)
FX_ANCHOR_PORT=3001

# Network (test, main, staging, dev)
VITE_KEETA_NETWORK=test

# OPS account seed (for signing)
OPS_SEED=your_ops_seed_hex
```

## Troubleshooting

**Server won't start:**
- Check OPS_SEED is set correctly
- Verify port 3001 is not in use
- Check logs for specific errors

**No pools discovered:**
- Ensure at least one anchor pool exists
- Check pool status is 'active'
- Verify pool has minimum liquidity

**Quotes failing:**
- Check pool reserves are sufficient
- Verify token addresses match exactly
- Review server logs for errors

## Support

For resolver registration assistance:
- Keeta Network Discord
- Keeta Developer Documentation
- support@keetanetwork.com
