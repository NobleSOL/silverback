-- Transaction state tracking for two-transaction flows
-- Prevents user fund loss by tracking and enabling recovery of failed transactions

CREATE TABLE IF NOT EXISTS pending_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Transaction metadata
  type VARCHAR(50) NOT NULL, -- 'swap', 'add_liquidity', 'remove_liquidity'
  user_address TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  params JSONB NOT NULL, -- Full transaction parameters

  -- State tracking
  state VARCHAR(50) NOT NULL DEFAULT 'PENDING_TX1',
  -- States: PENDING_TX1, TX1_COMPLETE, TX2_COMPLETE, TX2_FAILED, RECOVERED

  -- Transaction hashes
  tx1_hash TEXT, -- User's blockchain transaction
  tx2_hash TEXT, -- Backend's blockchain transaction
  recovery_tx_hash TEXT, -- Manual recovery transaction (if needed)

  -- Error tracking
  error_message TEXT, -- Error details if TX2 failed
  retry_count INTEGER DEFAULT 0, -- Number of TX2 retry attempts

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  tx1_completed_at TIMESTAMP,
  tx2_completed_at TIMESTAMP,
  tx2_failed_at TIMESTAMP,
  recovered_at TIMESTAMP,

  -- Indexing for queries
  CONSTRAINT check_state CHECK (state IN ('PENDING_TX1', 'TX1_COMPLETE', 'TX2_COMPLETE', 'TX2_FAILED', 'RECOVERED'))
);

-- Indexes for common queries
CREATE INDEX idx_pending_transactions_state ON pending_transactions(state);
CREATE INDEX idx_pending_transactions_user ON pending_transactions(user_address);
CREATE INDEX idx_pending_transactions_pool ON pending_transactions(pool_address);
CREATE INDEX idx_pending_transactions_created ON pending_transactions(created_at);

-- Index for finding stuck transactions (TX1 complete but TX2 not attempted)
CREATE INDEX idx_stuck_transactions ON pending_transactions(state, tx1_completed_at)
  WHERE state = 'TX1_COMPLETE';

-- Index for finding failed transactions requiring recovery
CREATE INDEX idx_failed_transactions ON pending_transactions(state, tx2_failed_at)
  WHERE state = 'TX2_FAILED';

COMMENT ON TABLE pending_transactions IS 'Tracks two-transaction flows to prevent user fund loss';
COMMENT ON COLUMN pending_transactions.state IS 'Transaction state: PENDING_TX1 → TX1_COMPLETE → TX2_COMPLETE (or TX2_FAILED → RECOVERED)';
COMMENT ON COLUMN pending_transactions.params IS 'Full transaction parameters for recovery if TX2 fails';
