-- Anchor Pools Schema
-- User-created FX anchor pools for Keeta DEX

-- Anchor pools table (user-created liquidity pools that function as FX anchors)
CREATE TABLE IF NOT EXISTS anchor_pools (
  id SERIAL PRIMARY KEY,

  -- Keeta blockchain addresses
  pool_address VARCHAR(255) UNIQUE NOT NULL,  -- Anchor pool account on Keeta
  creator_address VARCHAR(255) NOT NULL,       -- User who created this anchor

  -- Token pair
  token_a VARCHAR(255) NOT NULL,               -- First token address
  token_b VARCHAR(255) NOT NULL,               -- Second token address
  pair_key VARCHAR(511) NOT NULL,              -- Sorted pair key (e.g., "tokenA:tokenB")

  -- Fee configuration
  fee_bps INTEGER NOT NULL DEFAULT 30,         -- Fee in basis points (30 = 0.3%)

  -- Pool status
  status VARCHAR(50) NOT NULL DEFAULT 'active',  -- active, paused, closed

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  CONSTRAINT unique_anchor_pair UNIQUE (creator_address, pair_key)
);

-- Index for fast lookups by token pair
CREATE INDEX IF NOT EXISTS idx_anchor_pools_pair_key ON anchor_pools(pair_key);

-- Index for creator lookups
CREATE INDEX IF NOT EXISTS idx_anchor_pools_creator ON anchor_pools(creator_address);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_anchor_pools_status ON anchor_pools(status);

-- Anchor pool liquidity snapshots (for APY calculation)
CREATE TABLE IF NOT EXISTS anchor_pool_snapshots (
  id SERIAL PRIMARY KEY,
  pool_address VARCHAR(255) NOT NULL,
  reserve_a VARCHAR(255) NOT NULL,  -- Stored as string to preserve precision
  reserve_b VARCHAR(255) NOT NULL,  -- Stored as string to preserve precision
  snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Foreign key (soft - doesn't enforce since pool might be deleted)
  CONSTRAINT fk_anchor_pool FOREIGN KEY (pool_address)
    REFERENCES anchor_pools(pool_address) ON DELETE CASCADE,

  -- Unique constraint to prevent duplicate snapshots at same time
  CONSTRAINT unique_anchor_snapshot UNIQUE (pool_address, snapshot_time)
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_anchor_snapshots_time ON anchor_pool_snapshots(pool_address, snapshot_time DESC);

-- Anchor swap history (for volume tracking)
CREATE TABLE IF NOT EXISTS anchor_swaps (
  id SERIAL PRIMARY KEY,
  pool_address VARCHAR(255) NOT NULL,

  -- Swap details
  token_in VARCHAR(255) NOT NULL,
  token_out VARCHAR(255) NOT NULL,
  amount_in VARCHAR(255) NOT NULL,   -- Stored as string to preserve precision
  amount_out VARCHAR(255) NOT NULL,  -- Stored as string to preserve precision
  fee_collected VARCHAR(255) NOT NULL,  -- Fee collected by pool creator
  protocol_fee VARCHAR(255) DEFAULT '0',  -- Protocol fee (0.05%) collected by Silverback

  -- Transaction info
  tx_hash VARCHAR(255),  -- Keeta transaction hash
  block_height BIGINT,   -- Block number

  -- User info
  user_address VARCHAR(255),

  -- Timestamp
  swap_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Foreign key
  CONSTRAINT fk_anchor_swap_pool FOREIGN KEY (pool_address)
    REFERENCES anchor_pools(pool_address) ON DELETE CASCADE
);

-- Indexes for swap queries
CREATE INDEX IF NOT EXISTS idx_anchor_swaps_pool ON anchor_swaps(pool_address, swap_time DESC);
CREATE INDEX IF NOT EXISTS idx_anchor_swaps_user ON anchor_swaps(user_address, swap_time DESC);
CREATE INDEX IF NOT EXISTS idx_anchor_swaps_time ON anchor_swaps(swap_time DESC);

-- Comments for documentation
COMMENT ON TABLE anchor_pools IS 'User-created FX anchor pools that provide liquidity and earn fees';
COMMENT ON COLUMN anchor_pools.fee_bps IS 'Fee in basis points (100 bps = 1%). Default 30 bps = 0.3%';
COMMENT ON COLUMN anchor_pools.status IS 'Pool status: active (accepting swaps), paused (no new swaps), closed (removed)';
COMMENT ON TABLE anchor_swaps IS 'History of all swaps executed through anchor pools';
