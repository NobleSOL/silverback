# FX Resolver Registration for Silverback Anchor Pools

This guide explains how Silverback anchor pools integrate with the Keeta FX resolver system.

## Current Status

| Component | Status | Details |
|-----------|--------|---------|
| FX Anchor SDK Server | ✅ Live | Running at `https://dexkeeta.onrender.com/fx/` |
| Resolver Registration | ✅ Registered | Account: `keeta_asnqu5qxwxq2r...` |
| Protocol Fees (0.05%) | ✅ Active | Tracked per swap, collectible to treasury |
| Auto-Publish | ✅ Enabled | New pools automatically update resolver |

## Key Accounts

```
Resolver Account: keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm
Treasury Account: keeta_aabtozgfunwwvwdztv54y6l5x57q2g3254shgp27zjltr2xz3pyo7q4tjtmsamy
```

## Architecture

### FX Server Endpoints

```
https://dexkeeta.onrender.com/fx/
├── GET  /                           # Resolver metadata
├── POST /api/getEstimate           # Quick rate estimate (no signature)
├── POST /api/getQuote              # Signed quote for swap
├── POST /api/createExchange        # Execute atomic swap
└── GET  /api/getExchangeStatus/:id # Check swap status
```

### Request/Response Examples

**Get Estimate:**
```bash
curl -X POST https://dexkeeta.onrender.com/fx/api/getEstimate \
  -H "Content-Type: application/json" \
  -d '{
    "from": "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52",
    "to": "keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym",
    "amount": "1000000000",
    "affinity": "from"
  }'
```

**Get Quote:**
```bash
curl -X POST https://dexkeeta.onrender.com/fx/api/getQuote \
  -H "Content-Type: application/json" \
  -d '{
    "from": "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52",
    "to": "keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym",
    "amount": "1000000000",
    "affinity": "from"
  }'
```

## Fee Structure

| Fee Type | Rate | Recipient | Collection |
|----------|------|-----------|------------|
| Pool Creator Fee | 0.3% (default) | Pool Creator | Stays in pool |
| Protocol Fee | 0.05% | Silverback Treasury | Via fee sweeper |

### How Fees Work

1. User swaps 1 KTA for WAVE
2. Pool Creator Fee (0.3%) is deducted first
3. Protocol Fee (0.05%) is deducted from output
4. User receives output minus both fees
5. Protocol fee stays in pool until swept

## Admin Operations

All commands run on Render shell.

### Fee Management

```bash
# Check pending protocol fees
node server/keeta-impl/services/fee-sweeper.js status

# Collect fees to treasury
node server/keeta-impl/services/fee-sweeper.js sweep
```

### Resolver Management

```bash
# Update resolver metadata (after manually adding pools)
node server/keeta-impl/services/publish-fx-resolver.js update keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm

# Create new resolver account (one-time setup)
node server/keeta-impl/services/publish-fx-resolver.js publish
```

### Database Migrations

```bash
# Add protocol_fee column (if missing)
node -e "import('pg').then(async ({default: pg}) => { const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}}); await pool.query(\"ALTER TABLE anchor_swaps ADD COLUMN IF NOT EXISTS protocol_fee VARCHAR(255) DEFAULT '0'\"); console.log('Done'); pool.end(); })"
```

## Auto-Publish Feature

When a new anchor pool is created via the API, the FX resolver metadata is automatically updated to include the new token pair. This happens asynchronously after pool creation.

**How it works:**
1. User creates pool via `/api/anchor-pools/create`
2. Pool is saved to database
3. `updateFXResolverMetadata()` is called in background
4. Resolver metadata is re-published to blockchain
5. New pool becomes discoverable in wallets

**If auto-publish fails:**
- The pool is still created
- Run manual update command (see above)
- Check Render logs for errors

## Troubleshooting

### Swaps Not Working

1. Check FX server is responding:
   ```bash
   curl https://dexkeeta.onrender.com/fx/
   ```

2. Check pool has liquidity:
   ```bash
   curl https://dexkeeta.onrender.com/api/anchor-pools
   ```

3. Check Render logs for errors

### New Pool Not Visible in Wallet

1. Wait 1-2 minutes for blockchain propagation
2. If still not visible, manually update resolver:
   ```bash
   node server/keeta-impl/services/publish-fx-resolver.js update keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm
   ```

### Fees Not Collecting

1. Check pending fees:
   ```bash
   node server/keeta-impl/services/fee-sweeper.js status
   ```

2. Run sweep manually:
   ```bash
   node server/keeta-impl/services/fee-sweeper.js sweep
   ```

3. Check database has `protocol_fee` column:
   ```bash
   node -e "import('pg').then(async ({default: pg}) => { const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}}); const r = await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name = $$anchor_swaps$$'); console.log(r.rows.map(r => r.column_name)); pool.end(); })"
   ```

## Environment Variables

```env
# Required
OPS_SEED=<hex seed for operations account>
DATABASE_URL=<postgresql connection string>

# Optional (defaults shown)
FX_RESOLVER_ACCOUNT=keeta_asnqu5qxwxq2rhuh77s3iciwhtvra2n7zxviva2ukwqbbxkwxtlqhle5cgcjm
FX_ANCHOR_URL=https://dexkeeta.onrender.com/fx
VITE_KEETA_NETWORK=main
```

## Files Reference

| File | Purpose |
|------|---------|
| `server/keeta-impl/services/fx-anchor-server.js` | FX SDK server, handles quotes & swaps |
| `server/keeta-impl/services/anchor-service.js` | Pool quote calculation |
| `server/keeta-impl/services/publish-fx-resolver.js` | Publish/update resolver metadata |
| `server/keeta-impl/services/fee-sweeper.js` | Collect protocol fees to treasury |
| `server/keeta-impl/routes/anchor-pools.js` | Pool CRUD API routes |
| `server/keeta-impl/db/anchor-repository.js` | Database operations |
| `server/keeta-impl/db/anchor-schema.sql` | Database schema |
