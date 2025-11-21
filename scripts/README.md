# Scripts

Production utility scripts for Keeta DEX.

## Available Scripts

### `restore-pools.mjs`
Recovers pool data from blockchain and populates `.pools.json` cache.

**Usage:**
```bash
node scripts/restore-pools.mjs
```

**When to use:**
- After server crashes/restarts if pools are missing
- To rebuild `.pools.json` from scratch
- For disaster recovery

**Note:** This is a utility script. All normal operations (create pool, add/remove liquidity, swap) should be done through the API endpoints, not scripts.

## API Endpoints (Preferred Method)

Instead of using scripts, use these API endpoints:

- **Create Pool:** `POST /api/pools/create`
- **Add Liquidity:** `POST /api/liquidity/add`
- **Remove Liquidity:** `POST /api/liquidity/remove`
- **Swap:** `POST /api/swap/execute`
- **Get Pools:** `GET /api/pools`
- **Get User Positions:** `GET /api/liquidity/positions/:userAddress`

See `COMPREHENSIVE_USER_GUIDE.md` for full API documentation.
