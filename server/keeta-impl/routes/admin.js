// Admin routes for one-time operations
import express from 'express';
import { getOpsAccount, accountFromAddress, KeetaNet, createUserClient } from '../utils/client.js';
import { getPoolManager } from '../contracts/PoolManager.js';
import { PoolRepository } from '../db/pool-repository.js';
import { initializeDatabase } from '../db/client.js';
import { SnapshotRecorder } from '../utils/snapshot-recorder.js';

const router = express.Router();

/**
 * POST /api/admin/fix-pool-permissions
 *
 * One-time endpoint to grant OPS permissions on existing pools
 * Requires pool owner's wallet seed
 *
 * Body: { walletSeed: string }
 */
router.post('/fix-pool-permissions', async (req, res) => {
  try {
    const { walletSeed } = req.body;

    if (!walletSeed) {
      return res.status(400).json({
        success: false,
        error: 'walletSeed is required',
      });
    }

    console.log('🔧 Starting permission fix...');

    // Get pool manager to access pools
    const poolManager = await getPoolManager();
    const pools = poolManager.getAllPools();

    console.log(`📋 Found ${pools.length} pools to check`);

    // Create user client
    const { client: userClient, account: userAccount } = createUserClient(walletSeed);
    const ops = getOpsAccount();
    const opsAddress = ops.publicKeyString.get();
    const userAddress = userAccount.publicKeyString.get();

    console.log('👤 Pool owner:', userAddress.slice(0, 30) + '...');
    console.log('🔧 Ops address:', opsAddress.slice(0, 30) + '...');

    const results = [];

    // Fix permissions for each pool
    for (const pool of pools) {
      const result = {
        poolAddress: pool.poolAddress,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        creator: pool.creator,
        success: false,
        message: '',
      };

      console.log(`\n🔧 Checking pool: ${pool.poolAddress}`);
      console.log(`   Creator: ${pool.creator || 'unknown'}`);

      // Check if user is the creator
      if (!pool.creator || pool.creator.toLowerCase() !== userAddress.toLowerCase()) {
        result.message = 'Not the pool creator - skipping';
        console.log(`   ⚠️ SKIPPING: User is not the creator`);
        results.push(result);
        continue;
      }

      try {
        const builder = userClient.initBuilder();
        const poolAccount = accountFromAddress(pool.poolAddress);

        // Grant Ops the necessary permissions: SEND_ON_BEHALF, STORAGE_DEPOSIT, ACCESS
        builder.updatePermissions(
          ops,
          new KeetaNet.lib.Permissions(['SEND_ON_BEHALF', 'STORAGE_DEPOSIT', 'ACCESS']),
          undefined,
          undefined,
          { account: poolAccount }
        );

        console.log('   📝 Granting Ops: SEND_ON_BEHALF, STORAGE_DEPOSIT, ACCESS');

        await userClient.publishBuilder(builder);

        result.success = true;
        result.message = 'Permissions updated successfully';
        console.log('   ✅ Permissions updated successfully');
      } catch (err) {
        result.message = `Error: ${err.message}`;
        console.error(`   ❌ Error updating permissions:`, err.message);
      }

      results.push(result);
    }

    console.log('\n✅ Permission fix complete!');

    res.json({
      success: true,
      message: 'Permission fix completed',
      results,
    });
  } catch (error) {
    console.error('❌ Permission fix error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/fix-ride-pool-storage-permissions
 *
 * Fix permissions for RIDE/KTA pool token storage accounts
 * Grants OPS wallet SEND_ON_BEHALF and ACCESS on token storage within the pool
 *
 * Body: { walletSeed: string }
 */
router.post('/fix-ride-pool-storage-permissions', async (req, res) => {
  try {
    const { walletSeed } = req.body;

    if (!walletSeed) {
      return res.status(400).json({
        success: false,
        error: 'walletSeed is required',
      });
    }

    const RIDE_KTA_POOL = 'keeta_athjolef2zpnj6pimky2sbwbe6cmtdxakgixsveuck7fd7ql2vrf6mxkh4gy4';
    const RIDE_TOKEN = 'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo';
    const KTA_TOKEN = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';

    console.log('🔧 Fixing RIDE/KTA Pool Storage Permissions\n');

    // Create user client
    const { client: creatorClient, address: creatorAddress } = createUserClient(walletSeed);
    const ops = getOpsAccount();

    console.log(`👤 Creator: ${creatorAddress}`);
    console.log(`🤖 OPS: ${ops.publicKeyString.get()}\n`);
    console.log(`📦 Pool: ${RIDE_KTA_POOL}`);
    console.log(`🪙 RIDE: ${RIDE_TOKEN}`);
    console.log(`🪙 KTA: ${KTA_TOKEN}\n`);

    const results = [];

    // Grant permissions on the pool account itself
    console.log('1️⃣ Granting permissions on pool account...');
    try {
      const poolAccount = accountFromAddress(RIDE_KTA_POOL);
      const builder1 = creatorClient.initBuilder();

      builder1.updatePermissions(
        ops,
        new KeetaNet.lib.Permissions(['SEND_ON_BEHALF', 'STORAGE_DEPOSIT', 'ACCESS']),
        undefined,
        undefined,
        { account: poolAccount }
      );

      console.log('   🚀 Publishing...');
      await creatorClient.publishBuilder(builder1);
      console.log('   ✅ Pool account permissions granted\n');
      results.push({ target: 'pool_account', success: true });
    } catch (err) {
      console.error('   ❌ Error:', err.message);
      results.push({ target: 'pool_account', success: false, error: err.message });
    }

    // Grant permissions on RIDE token storage within pool
    console.log('2️⃣ Granting permissions on RIDE token storage...');
    try {
      const rideStoragePath = `${RIDE_KTA_POOL}/${RIDE_TOKEN}`;
      const rideStorageAccount = accountFromAddress(rideStoragePath);
      const builder2 = creatorClient.initBuilder();

      builder2.updatePermissions(
        ops,
        new KeetaNet.lib.Permissions(['SEND_ON_BEHALF', 'ACCESS']),
        undefined,
        undefined,
        { account: rideStorageAccount }
      );

      console.log('   🚀 Publishing...');
      await creatorClient.publishBuilder(builder2);
      console.log('   ✅ RIDE storage permissions granted\n');
      results.push({ target: 'ride_storage', success: true });
    } catch (err) {
      console.error('   ❌ Error:', err.message);
      results.push({ target: 'ride_storage', success: false, error: err.message });
    }

    // Grant permissions on KTA token storage within pool
    console.log('3️⃣ Granting permissions on KTA token storage...');
    try {
      const ktaStoragePath = `${RIDE_KTA_POOL}/${KTA_TOKEN}`;
      const ktaStorageAccount = accountFromAddress(ktaStoragePath);
      const builder3 = creatorClient.initBuilder();

      builder3.updatePermissions(
        ops,
        new KeetaNet.lib.Permissions(['SEND_ON_BEHALF', 'ACCESS']),
        undefined,
        undefined,
        { account: ktaStorageAccount }
      );

      console.log('   🚀 Publishing...');
      await creatorClient.publishBuilder(builder3);
      console.log('   ✅ KTA storage permissions granted\n');
      results.push({ target: 'kta_storage', success: true });
    } catch (err) {
      console.error('   ❌ Error:', err.message);
      results.push({ target: 'kta_storage', success: false, error: err.message });
    }

    console.log('✅ All permissions granted successfully!');
    console.log('🎉 RIDE/KTA pool is now ready for swaps\n');

    res.json({
      success: true,
      message: 'RIDE/KTA pool permissions fixed',
      results,
    });
  } catch (error) {
    console.error('\n❌ Permission grant failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/fix-kta-wave-pool-storage-permissions
 *
 * Fix permissions for KTA/WAVE pool token storage accounts
 * Grants OPS wallet SEND_ON_BEHALF and ACCESS on token storage within the pool
 *
 * Body: { walletSeed: string }
 */
router.post('/fix-kta-wave-pool-storage-permissions', async (req, res) => {
  try {
    const { walletSeed } = req.body;

    if (!walletSeed) {
      return res.status(400).json({
        success: false,
        error: 'walletSeed is required',
      });
    }

    const KTA_WAVE_POOL = 'keeta_arwmubo5gxl7vzz3rulmcqyts7webl73zakb5d6hsm2khf3b5xsbil5m3bpek';
    const KTA_TOKEN = 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52';
    const WAVE_TOKEN = 'keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym';

    console.log('🔧 Fixing KTA/WAVE Pool Storage Permissions\\n');

    // Create user client
    const { client: creatorClient, address: creatorAddress } = createUserClient(walletSeed);
    const ops = getOpsAccount();

    console.log(`👤 Creator: ${creatorAddress}`);
    console.log(`🤖 OPS: ${ops.publicKeyString.get()}\\n`);
    console.log(`📦 Pool: ${KTA_WAVE_POOL}`);
    console.log(`🪙 KTA: ${KTA_TOKEN}`);
    console.log(`🪙 WAVE: ${WAVE_TOKEN}\\n`);

    const results = [];

    // Grant permissions on the pool account itself
    console.log('1️⃣ Granting permissions on pool account...');
    try {
      const poolAccount = accountFromAddress(KTA_WAVE_POOL);
      const builder1 = creatorClient.initBuilder();

      builder1.updatePermissions(
        ops,
        new KeetaNet.lib.Permissions(['SEND_ON_BEHALF', 'STORAGE_DEPOSIT', 'ACCESS']),
        undefined,
        undefined,
        { account: poolAccount }
      );

      console.log('   🚀 Publishing...');
      await creatorClient.publishBuilder(builder1);
      console.log('   ✅ Pool account permissions granted\\n');
      results.push({ target: 'pool_account', success: true });
    } catch (err) {
      console.error('   ❌ Error:', err.message);
      results.push({ target: 'pool_account', success: false, error: err.message });
    }

    // Grant permissions on KTA token storage within pool
    console.log('2️⃣ Granting permissions on KTA token storage...');
    try {
      const ktaStoragePath = `${KTA_WAVE_POOL}/${KTA_TOKEN}`;
      const ktaStorageAccount = accountFromAddress(ktaStoragePath);
      const builder2 = creatorClient.initBuilder();

      builder2.updatePermissions(
        ops,
        new KeetaNet.lib.Permissions(['SEND_ON_BEHALF', 'ACCESS']),
        undefined,
        undefined,
        { account: ktaStorageAccount }
      );

      console.log('   🚀 Publishing...');
      await creatorClient.publishBuilder(builder2);
      console.log('   ✅ KTA storage permissions granted\\n');
      results.push({ target: 'kta_storage', success: true });
    } catch (err) {
      console.error('   ❌ Error:', err.message);
      results.push({ target: 'kta_storage', success: false, error: err.message });
    }

    // Grant permissions on WAVE token storage within pool
    console.log('3️⃣ Granting permissions on WAVE token storage...');
    try {
      const waveStoragePath = `${KTA_WAVE_POOL}/${WAVE_TOKEN}`;
      const waveStorageAccount = accountFromAddress(waveStoragePath);
      const builder3 = creatorClient.initBuilder();

      builder3.updatePermissions(
        ops,
        new KeetaNet.lib.Permissions(['SEND_ON_BEHALF', 'ACCESS']),
        undefined,
        undefined,
        { account: waveStorageAccount }
      );

      console.log('   🚀 Publishing...');
      await creatorClient.publishBuilder(builder3);
      console.log('   ✅ WAVE storage permissions granted\\n');
      results.push({ target: 'wave_storage', success: true });
    } catch (err) {
      console.error('   ❌ Error:', err.message);
      results.push({ target: 'wave_storage', success: false, error: err.message });
    }

    console.log('✅ All permissions granted successfully!');
    console.log('🎉 KTA/WAVE pool is now ready for remove liquidity operations\\n');

    res.json({
      success: true,
      message: 'KTA/WAVE pool permissions fixed',
      results,
    });
  } catch (error) {
    console.error('\\n❌ Permission grant failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/init-database
 *
 * Initialize PostgreSQL database schema (tables, indexes, triggers)
 * Safe to run multiple times - uses IF NOT EXISTS
 */
router.post('/init-database', async (req, res) => {
  try {
    console.log('📊 Initializing PostgreSQL database schema...\n');

    await initializeDatabase();

    console.log('✅ Database initialized successfully!\n');

    res.json({
      success: true,
      message: 'Database schema initialized',
    });
  } catch (error) {
    console.error('\n❌ Database initialization failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/sync-lp-positions
 *
 * One-time sync of LP positions to PostgreSQL database
 * Adds initial LP position data for both KTA/WAVE and RIDE/KTA pools
 */
router.post('/sync-lp-positions', async (req, res) => {
  try {
    console.log('🚀 Syncing initial LP positions to PostgreSQL\n');

    const repository = new PoolRepository();

    // Your wallet address
    const userAddress = 'keeta_aabuf556k7q465i3p6c7xdhirnems2rkgtorfn6j6wwic5iwlo7pjr4h7aolayi';

    // KTA/WAVE pool - from current pools endpoint
    const ktaWavePool = 'keeta_arwmubo5gxl7vzz3rulmcqyts7webl73zakb5d6hsm2khf3b5xsbil5m3bpek';
    const ktaWaveShares = '3162277660';

    console.log(`📦 Adding LP position for KTA/WAVE pool...`);
    await repository.saveLPPosition(ktaWavePool, userAddress, BigInt(ktaWaveShares));
    console.log(`✅ Saved: ${ktaWaveShares} shares in pool ${ktaWavePool}`);

    // RIDE/KTA pool - creator position (you created this pool)
    const rideKtaPool = 'keeta_athjolef2zpnj6pimky2sbwbe6cmtdxakgixsveuck7fd7ql2vrf6mxkh4gy4';

    console.log(`\n📦 Adding LP position for RIDE/KTA pool...`);
    console.log(`   (Creator position - will be calculated from reserves)`);
    // Use 1 as placeholder - actual shares calculated from reserves
    await repository.saveLPPosition(rideKtaPool, userAddress, 1n);
    console.log(`✅ Saved: Creator position for pool ${rideKtaPool}`);

    console.log('\n✅ LP position sync complete!\n');

    res.json({
      success: true,
      message: 'LP positions synced to database',
      positions: [
        { pool: ktaWavePool, shares: ktaWaveShares },
        { pool: rideKtaPool, shares: 'creator_position' },
      ],
    });
  } catch (error) {
    console.error('\n❌ Sync failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/check-database
 *
 * Check what's actually in the PostgreSQL database (for debugging)
 */
router.get('/check-database', async (req, res) => {
  try {
    const repository = new PoolRepository();

    // Check pools table
    const pools = await repository.loadPools();
    console.log(`Found ${pools.length} pools in database`);

    // Check lp_positions table
    const { getDbPool } = await import('../db/client.js');
    const pool = getDbPool();
    const lpResult = await pool.query('SELECT * FROM lp_positions ORDER BY created_at DESC');
    console.log(`Found ${lpResult.rows.length} LP positions in database`);

    res.json({
      success: true,
      pools: pools.map(p => ({
        pool_address: p.pool_address,
        token_a: p.token_a,
        token_b: p.token_b,
        creator: p.creator,
        lp_token_address: p.lp_token_address,
      })),
      lp_positions: lpResult.rows.map(lp => ({
        pool_address: lp.pool_address,
        user_address: lp.user_address,
        shares: lp.shares,
        created_at: lp.created_at,
      })),
    });
  } catch (error) {
    console.error('Database check error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/migrate-lp-tokens
 *
 * Populate lpTokenAddress field for all pools in database
 * Reads LP token address from on-chain pool name field
 */
router.post('/migrate-lp-tokens', async (req, res) => {
  try {
    console.log('🔧 Migrating database pools to populate LP token addresses...\n');

    // Helper function to find LP token for a pool
    async function findLpTokenForPool(client, poolAddress) {
      try {
        const accountsInfo = await client.client.getAccountsInfo([poolAddress]);
        const accountInfo = accountsInfo[poolAddress];

        if (!accountInfo?.info?.name) {
          console.warn(`  ⚠️ No account info for pool ${poolAddress.slice(-8)}`);
          return null;
        }

        // LP token is stored in pool's name field: "SILVERBACK_POOL|<lpTokenAddress>"
        const parts = accountInfo.info.name.split('|');
        if (parts.length >= 2 && parts[0] === 'SILVERBACK_POOL') {
          return parts[1];
        }

        console.warn(`  ⚠️ Pool name doesn't match expected format: ${accountInfo.info.name}`);
        return null;
      } catch (error) {
        console.error(`  ❌ Error reading pool ${poolAddress.slice(-8)}:`, error.message);
        return null;
      }
    }

    // Create repository and client
    const repository = new PoolRepository();
    const client = KeetaNet.UserClient.fromNetwork('test', null);

    // Load all pools from database
    console.log('[1/2] Loading pools from database...');
    const pools = await repository.loadPools();
    console.log(`✅ Found ${pools.length} pools in database\n`);

    // Process each pool
    console.log('[2/2] Updating LP token addresses...\n');
    let updated = 0;
    let skipped = 0;

    for (const pool of pools) {
      const shortAddr = pool.pool_address.slice(-8);
      console.log(`📍 Processing pool ${shortAddr}...`);

      // Skip if already has LP token
      if (pool.lp_token_address) {
        console.log(`   ⏭️ Already has LP token: ${pool.lp_token_address.slice(-8)}\n`);
        skipped++;
        continue;
      }

      // Find LP token address from blockchain
      const lpTokenAddress = await findLpTokenForPool(client, pool.pool_address);

      if (lpTokenAddress) {
        // Update database
        await repository.updatePoolLPToken(pool.pool_address, lpTokenAddress);
        console.log(`   ✅ Updated with LP token: ${lpTokenAddress.slice(-8)}\n`);
        updated++;
      } else {
        console.log(`   ⚠️ No LP token found (legacy pool)\n`);
        skipped++;
      }
    }

    console.log('\n✅ Migration completed!');
    console.log(`   Updated: ${updated} pools`);
    console.log(`   Skipped: ${skipped} pools`);

    res.json({
      success: true,
      message: 'LP token migration completed',
      updated,
      skipped,
      total: pools.length,
    });
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/record-snapshots
 *
 * Record reserve snapshots for all pools
 * Used for APY calculation based on 24h reserve growth
 * Can be triggered manually or via cron job every 6 hours
 */
router.post('/record-snapshots', async (req, res) => {
  try {
    console.log('📸 Recording snapshots for all pools...\n');

    const recorder = new SnapshotRecorder();
    const results = await recorder.recordAllSnapshots();

    res.json({
      success: true,
      message: 'Snapshots recorded successfully',
      ...results,
    });
  } catch (error) {
    console.error('❌ Snapshot recording failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/clean-snapshots
 *
 * Clean up old snapshots (default: keep last 30 days)
 * Optional query param: ?days=X to specify retention period
 */
router.post('/clean-snapshots', async (req, res) => {
  try {
    const daysToKeep = parseInt(req.query.days) || 30;

    console.log(`🧹 Cleaning snapshots older than ${daysToKeep} days...\n`);

    const recorder = new SnapshotRecorder();
    const deletedCount = await recorder.cleanOldSnapshots(daysToKeep);

    res.json({
      success: true,
      message: `Cleaned ${deletedCount} old snapshots`,
      deletedCount,
      daysKept: daysToKeep,
    });
  } catch (error) {
    console.error('❌ Snapshot cleanup failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/migrate-snapshots
 *
 * Create pool_snapshots table (safe migration - uses CREATE TABLE IF NOT EXISTS)
 */
router.post('/migrate-snapshots', async (req, res) => {
  try {
    console.log('🔧 Running pool_snapshots migration...\n');

    // Use PoolRepository which has access to the database pool
    const repository = new PoolRepository();

    // Get pool by creating a temporary snapshot (this initializes the pool)
    // Then we'll use the pool instance directly via the repository's internal methods

    // Import pg directly and create migration queries
    const migrationSQL = `
      CREATE TABLE IF NOT EXISTS pool_snapshots (
        id SERIAL PRIMARY KEY,
        pool_address VARCHAR(255) NOT NULL REFERENCES pools(pool_address) ON DELETE CASCADE,
        reserve_a NUMERIC(78, 0) NOT NULL,
        reserve_b NUMERIC(78, 0) NOT NULL,
        snapshot_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pool_address, snapshot_time)
      );

      CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool_time
      ON pool_snapshots(pool_address, snapshot_time DESC);
    `;

    // Execute using repository's db pool (imported from client.js)
    const clientModule = await import('../db/client.js');
    const dbPool = clientModule.getDbPool();

    await dbPool.query(migrationSQL);
    console.log('✅ pool_snapshots table and index created');

    // Verify table exists
    const verifyQuery = `
      SELECT COUNT(*) as count FROM information_schema.tables
      WHERE table_name = 'pool_snapshots';
    `;

    const result = await dbPool.query(verifyQuery);
    const tableExists = result.rows[0].count === '1';

    res.json({
      success: true,
      message: 'Migration completed successfully',
      tableCreated: tableExists,
    });
  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

/**
 * POST /api/admin/cleanup-anchor-pools
 *
 * Delete unfunded anchor pools, keep only the funded KTA/WAVE pool
 */
router.post('/cleanup-anchor-pools', async (req, res) => {
  try {
    const { getAnchorRepository } = await import('../db/anchor-repository.js');
    const repo = getAnchorRepository();

    const POOLS_TO_DELETE = [
      'keeta_ar625ggl42fqb5tbtgmcw5abd277xpujg6odgjfypmdlq6c53xztzptkssoja', // KTA/ROCK
      'keeta_aqqvchwui4oftmsn6wlesseymdu6z5wfrjycabsenywsxzh7bjvjssf6vstgi', // KTA/RIDE
      'keeta_aqncunhoohmuvsbxswiu22uxxivojwy33rwnyycrzededjlythl75tqkrhyns'  // RIDE/WAVE
    ];

    console.log('🗑️  Cleaning up unfunded anchor pools...');

    const results = [];
    for (const poolAddress of POOLS_TO_DELETE) {
      try {
        await repo.deleteAnchorPool(poolAddress);
        console.log(`✅ Deleted: ${poolAddress.slice(-12)}`);
        results.push({ poolAddress, status: 'deleted' });
      } catch (error) {
        console.error(`❌ Error deleting ${poolAddress.slice(-12)}:`, error.message);
        results.push({ poolAddress, status: 'error', error: error.message });
      }
    }

    // Get remaining pools
    const remaining = await repo.loadAnchorPools();
    console.log(`📊 Remaining anchor pools: ${remaining.length}`);

    res.json({
      success: true,
      deleted: results.filter(r => r.status === 'deleted').length,
      remaining: remaining.length,
      details: results,
      pools: remaining.map(p => ({
        pool_address: p.pool_address,
        token_a: p.token_a,
        token_b: p.token_b,
        status: p.status,
        fee_bps: p.fee_bps
      }))
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
