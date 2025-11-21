// Transaction state tracking for two-transaction flows
// Prevents user fund loss by tracking and recovering failed transactions

import { getDbPool } from './client.js';

/**
 * Transaction states:
 * - PENDING_TX1: Waiting for user to sign TX1
 * - TX1_COMPLETE: User sent tokens, waiting for backend TX2
 * - TX2_COMPLETE: Backend completed TX2, transaction successful
 * - TX2_FAILED: Backend TX2 failed, requires manual recovery
 * - RECOVERED: Manual recovery completed
 */

/**
 * Record a new transaction (before TX1)
 * @param {string} type - 'swap', 'add_liquidity', or 'remove_liquidity'
 * @param {object} params - Transaction parameters
 * @returns {Promise<string>} Transaction ID
 */
export async function createTransaction(type, params) {
  const query = `
    INSERT INTO pending_transactions (
      type, user_address, pool_address, params, state, created_at
    ) VALUES ($1, $2, $3, $4, 'PENDING_TX1', NOW())
    RETURNING id
  `;

  try {
    const result = await getDbPool().query(query, [
      type,
      params.userAddress,
      params.poolAddress,
      JSON.stringify(params),
    ]);
    return result.rows[0].id;
  } catch (error) {
    console.error('❌ Failed to create transaction record:', error);
    throw error;
  }
}

/**
 * Mark TX1 as complete (user sent tokens)
 * @param {string} txId - Transaction ID
 * @param {string} tx1Hash - Blockchain hash of TX1
 */
export async function markTX1Complete(txId, tx1Hash) {
  const query = `
    UPDATE pending_transactions
    SET state = 'TX1_COMPLETE', tx1_hash = $2, tx1_completed_at = NOW()
    WHERE id = $1
  `;

  try {
    await getDbPool().query(query, [txId, tx1Hash]);
    console.log(`✅ Marked TX1 complete: ${txId}`);
  } catch (error) {
    console.error('❌ Failed to mark TX1 complete:', error);
    throw error;
  }
}

/**
 * Mark TX2 as complete (backend sent tokens)
 * @param {string} txId - Transaction ID
 * @param {string} tx2Hash - Blockchain hash of TX2
 */
export async function markTX2Complete(txId, tx2Hash) {
  const query = `
    UPDATE pending_transactions
    SET state = 'TX2_COMPLETE', tx2_hash = $2, tx2_completed_at = NOW()
    WHERE id = $1
  `;

  try {
    await getDbPool().query(query, [txId, tx2Hash]);
    console.log(`✅ Marked TX2 complete: ${txId}`);
  } catch (error) {
    console.error('❌ Failed to mark TX2 complete:', error);
    throw error;
  }
}

/**
 * Mark TX2 as failed (requires manual recovery)
 * @param {string} txId - Transaction ID
 * @param {string} errorMessage - Error details
 */
export async function markTX2Failed(txId, errorMessage) {
  const query = `
    UPDATE pending_transactions
    SET state = 'TX2_FAILED', error_message = $2, tx2_failed_at = NOW()
    WHERE id = $1
  `;

  try {
    await getDbPool().query(query, [txId, errorMessage]);
    console.error(`🚨 Marked TX2 failed: ${txId} - ${errorMessage}`);

    // TODO: Send alert to monitoring system
    // TODO: Notify admin of stuck transaction requiring recovery
  } catch (error) {
    console.error('❌ Failed to mark TX2 failed:', error);
    throw error;
  }
}

/**
 * Get all failed transactions requiring recovery
 * @returns {Promise<Array>} Failed transactions
 */
export async function getFailedTransactions() {
  const query = `
    SELECT * FROM pending_transactions
    WHERE state = 'TX2_FAILED'
    ORDER BY created_at DESC
  `;

  try {
    const result = await getDbPool().query(query);
    return result.rows;
  } catch (error) {
    console.error('❌ Failed to get failed transactions:', error);
    return [];
  }
}

/**
 * Get stuck transactions (TX1 complete but TX2 not attempted after 5 minutes)
 * @returns {Promise<Array>} Stuck transactions
 */
export async function getStuckTransactions() {
  const query = `
    SELECT * FROM pending_transactions
    WHERE state = 'TX1_COMPLETE'
      AND tx1_completed_at < NOW() - INTERVAL '5 minutes'
    ORDER BY created_at DESC
  `;

  try {
    const result = await getDbPool().query(query);
    return result.rows;
  } catch (error) {
    console.error('❌ Failed to get stuck transactions:', error);
    return [];
  }
}

/**
 * Mark transaction as recovered (manual recovery completed)
 * @param {string} txId - Transaction ID
 * @param {string} recoveryTxHash - Hash of recovery transaction
 */
export async function markRecovered(txId, recoveryTxHash) {
  const query = `
    UPDATE pending_transactions
    SET state = 'RECOVERED', recovery_tx_hash = $2, recovered_at = NOW()
    WHERE id = $1
  `;

  try {
    await getDbPool().query(query, [txId, recoveryTxHash]);
    console.log(`✅ Marked transaction recovered: ${txId}`);
  } catch (error) {
    console.error('❌ Failed to mark transaction recovered:', error);
    throw error;
  }
}
