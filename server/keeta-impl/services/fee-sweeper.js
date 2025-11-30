// server/keeta-impl/services/fee-sweeper.js
// Fee Sweeper - Collects accumulated protocol fees from pools and sends to treasury
// Run periodically (e.g., hourly or daily) via cron or manually

import 'dotenv/config';
import { getOpsClient, getTreasuryAccount, accountFromAddress, getTokenBalance } from '../utils/client.js';
import { getAnchorRepository } from '../db/anchor-repository.js';
import * as KeetaNet from '@keetanetwork/keetanet-client';

// Protocol fee: 0.05% (5 basis points)
const PROTOCOL_FEE_BPS = 5n;

/**
 * Ensure fee sweep columns exist in database
 */
async function ensureColumns(repository) {
  const pool = repository.pool;

  try {
    // Add fee_swept column if missing
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'anchor_swaps' AND column_name = 'fee_swept') THEN
          ALTER TABLE anchor_swaps ADD COLUMN fee_swept BOOLEAN DEFAULT false;
        END IF;
      END $$;
    `);

    // Add fee_swept_at column if missing
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'anchor_swaps' AND column_name = 'fee_swept_at') THEN
          ALTER TABLE anchor_swaps ADD COLUMN fee_swept_at TIMESTAMP;
        END IF;
      END $$;
    `);
  } catch (err) {
    console.warn('Note: Could not verify columns:', err.message);
  }
}

/**
 * Sweep accumulated protocol fees from all pools to treasury
 *
 * How it works:
 * 1. Query database for unswept swaps (protocol_fee > 0, not yet collected)
 * 2. Group fees by pool and token
 * 3. Transfer accumulated fees from each pool to treasury
 * 4. Mark swaps as swept in database
 */
export async function sweepProtocolFees() {
  console.log('');
  console.log('='.repeat(70));
  console.log('  PROTOCOL FEE SWEEPER');
  console.log('='.repeat(70));
  console.log('');

  try {
    const opsClient = await getOpsClient();
    const treasuryAccount = getTreasuryAccount();
    const repository = getAnchorRepository();

    // Ensure fee sweep columns exist
    await ensureColumns(repository);

    console.log(`Treasury: ${treasuryAccount.publicKeyString.get()}`);
    console.log('');

    // Get all pools
    const pools = await repository.loadAnchorPools();
    console.log(`Found ${pools.length} anchor pool(s)`);
    console.log('');

    if (pools.length === 0) {
      console.log('No pools to sweep');
      return { success: true, swept: 0 };
    }

    let totalSwept = 0n;
    let poolsProcessed = 0;
    const results = [];

    for (const pool of pools) {
      console.log(`─`.repeat(50));
      console.log(`Pool: ${pool.pool_address.slice(-12)}`);

      try {
        // Get unswept fees for this pool
        const unsweptFees = await getUnsweptFees(repository, pool.pool_address);

        if (unsweptFees.length === 0) {
          console.log('  No unswept fees');
          continue;
        }

        console.log(`  Found ${unsweptFees.length} token(s) with unswept fees`);

        for (const fee of unsweptFees) {
          const { tokenOut, totalFee, swapIds } = fee;

          if (totalFee <= 0n) {
            console.log(`  ${tokenOut.slice(-8)}: 0 (skipping)`);
            continue;
          }

          console.log(`  ${tokenOut.slice(-8)}: ${Number(totalFee) / 1e9} tokens`);

          // Check pool has enough balance
          const poolBalance = await getTokenBalance(pool.pool_address, tokenOut);
          console.log(`    Pool balance: ${Number(poolBalance) / 1e9}`);

          if (poolBalance < totalFee) {
            console.log(`    ⚠️ Insufficient balance, skipping`);
            continue;
          }

          // Transfer fee to treasury
          try {
            const poolAccount = accountFromAddress(pool.pool_address);
            const tokenOutAccount = accountFromAddress(tokenOut);

            // Create pool's UserClient
            const poolUserClient = new KeetaNet.UserClient({
              client: opsClient.client,
              network: opsClient.network,
              networkAlias: 'main',
              account: poolAccount,
              signer: opsClient.account
            });

            const builder = poolUserClient.initBuilder();
            builder.send(
              treasuryAccount,
              totalFee,
              tokenOutAccount,
              undefined,
              { account: poolAccount }
            );

            await poolUserClient.publishBuilder(builder);
            console.log(`    ✅ Transferred ${Number(totalFee) / 1e9} to treasury`);

            // Mark swaps as swept
            await markSwapsAsSwept(repository, swapIds);
            console.log(`    ✅ Marked ${swapIds.length} swap(s) as swept`);

            totalSwept += totalFee;
            results.push({
              pool: pool.pool_address,
              token: tokenOut,
              amount: totalFee.toString(),
              swaps: swapIds.length
            });
          } catch (transferError) {
            console.error(`    ❌ Transfer failed:`, transferError.message);
          }
        }

        poolsProcessed++;
      } catch (poolError) {
        console.error(`  ❌ Error processing pool:`, poolError.message);
      }
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('  SWEEP COMPLETE');
    console.log('='.repeat(70));
    console.log(`  Pools processed: ${poolsProcessed}`);
    console.log(`  Total swept: ${Number(totalSwept) / 1e9} tokens`);
    console.log('');

    return {
      success: true,
      poolsProcessed,
      totalSwept: totalSwept.toString(),
      results
    };
  } catch (error) {
    console.error('❌ Fee sweeper error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get unswept fees grouped by token for a pool
 */
async function getUnsweptFees(repository, poolAddress) {
  const pool = repository.pool;

  // Query for unswept swaps (fee_swept = false or null)
  const result = await pool.query(`
    SELECT
      token_out,
      SUM(CAST(protocol_fee AS BIGINT)) as total_fee,
      ARRAY_AGG(id) as swap_ids
    FROM anchor_swaps
    WHERE pool_address = $1
      AND protocol_fee IS NOT NULL
      AND protocol_fee != '0'
      AND (fee_swept IS NULL OR fee_swept = false)
    GROUP BY token_out
  `, [poolAddress]);

  return result.rows.map(row => ({
    tokenOut: row.token_out,
    totalFee: BigInt(row.total_fee || 0),
    swapIds: row.swap_ids || []
  }));
}

/**
 * Mark swaps as swept in database
 */
async function markSwapsAsSwept(repository, swapIds) {
  if (!swapIds || swapIds.length === 0) return;

  const pool = repository.pool;

  await pool.query(`
    UPDATE anchor_swaps
    SET fee_swept = true, fee_swept_at = CURRENT_TIMESTAMP
    WHERE id = ANY($1)
  `, [swapIds]);
}

/**
 * Get sweep status - how much is pending
 */
export async function getSweepStatus() {
  try {
    const repository = getAnchorRepository();
    const pool = repository.pool;

    const result = await pool.query(`
      SELECT
        pool_address,
        token_out,
        COUNT(*) as swap_count,
        SUM(CAST(protocol_fee AS BIGINT)) as total_fee
      FROM anchor_swaps
      WHERE protocol_fee IS NOT NULL
        AND protocol_fee != '0'
        AND (fee_swept IS NULL OR fee_swept = false)
      GROUP BY pool_address, token_out
      ORDER BY total_fee DESC
    `);

    const pending = result.rows.map(row => ({
      pool: row.pool_address,
      token: row.token_out,
      swaps: parseInt(row.swap_count),
      fee: row.total_fee
    }));

    const totalPending = pending.reduce((sum, p) => sum + BigInt(p.fee || 0), 0n);

    return {
      pending,
      totalPending: totalPending.toString(),
      count: pending.length
    };
  } catch (error) {
    return { error: error.message };
  }
}

// CLI Interface
if (process.argv[1].includes('fee-sweeper')) {
  const command = process.argv[2];

  if (command === 'sweep') {
    sweepProtocolFees()
      .then(result => {
        console.log('\nResult:', JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      })
      .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
      });
  } else if (command === 'status') {
    getSweepStatus()
      .then(result => {
        console.log('Pending fees to sweep:');
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      })
      .catch(err => {
        console.error('Error:', err);
        process.exit(1);
      });
  } else {
    console.log('Protocol Fee Sweeper');
    console.log('');
    console.log('Usage:');
    console.log('  node server/keeta-impl/services/fee-sweeper.js sweep   - Collect fees to treasury');
    console.log('  node server/keeta-impl/services/fee-sweeper.js status  - Show pending fees');
    console.log('');
    process.exit(0);
  }
}
