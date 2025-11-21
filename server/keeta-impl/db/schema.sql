-- Pools table - stores liquidity pool information
CREATE TABLE IF NOT EXISTS pools (
  id SERIAL PRIMARY KEY,
  pool_address VARCHAR(255) UNIQUE NOT NULL,
  token_a VARCHAR(255) NOT NULL,
  token_b VARCHAR(255) NOT NULL,
  lp_token_address VARCHAR(255),
  creator VARCHAR(255),
  pair_key VARCHAR(511) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LP positions table - stores liquidity provider positions
CREATE TABLE IF NOT EXISTS lp_positions (
  id SERIAL PRIMARY KEY,
  pool_address VARCHAR(255) NOT NULL REFERENCES pools(pool_address) ON DELETE CASCADE,
  user_address VARCHAR(255) NOT NULL,
  shares NUMERIC(78, 0) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pool_address, user_address)
);

-- Pool snapshots table - stores reserve snapshots for APY calculation
CREATE TABLE IF NOT EXISTS pool_snapshots (
  id SERIAL PRIMARY KEY,
  pool_address VARCHAR(255) NOT NULL REFERENCES pools(pool_address) ON DELETE CASCADE,
  reserve_a NUMERIC(78, 0) NOT NULL,
  reserve_b NUMERIC(78, 0) NOT NULL,
  snapshot_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pool_address, snapshot_time)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_pools_pair_key ON pools(pair_key);
CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(token_a, token_b);
CREATE INDEX IF NOT EXISTS idx_lp_positions_user ON lp_positions(user_address);
CREATE INDEX IF NOT EXISTS idx_lp_positions_pool ON lp_positions(pool_address);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool_time ON pool_snapshots(pool_address, snapshot_time DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_pools_updated_at BEFORE UPDATE ON pools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lp_positions_updated_at BEFORE UPDATE ON lp_positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
