// server/keeta-impl/db/client.js
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;

/**
 * Get PostgreSQL connection pool
 */
export function getDbPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable not set');
    }

    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20, // Maximum number of clients in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    console.log('✅ PostgreSQL pool initialized');
  }

  return pool;
}

/**
 * Initialize database schema
 */
export async function initializeDatabase() {
  const pool = getDbPool();

  try {
    // Try to read from files first (for local development)
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = await fs.readFile(schemaPath, 'utf8');
      await pool.query(schema);
      console.log('✅ Main database schema initialized from file');

      const anchorSchemaPath = path.join(__dirname, 'anchor-schema.sql');
      const anchorSchema = await fs.readFile(anchorSchemaPath, 'utf8');
      await pool.query(anchorSchema);
      console.log('✅ Anchor pools schema initialized from file');
    } catch (fileError) {
      // Files not found (production), use embedded SQL
      console.log('📝 SQL files not found, using embedded schema...');

      // AMM Pools Schema
      const mainSchema = `
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

        CREATE TABLE IF NOT EXISTS lp_positions (
          id SERIAL PRIMARY KEY,
          pool_address VARCHAR(255) NOT NULL REFERENCES pools(pool_address) ON DELETE CASCADE,
          user_address VARCHAR(255) NOT NULL,
          shares NUMERIC(78, 0) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(pool_address, user_address)
        );

        CREATE TABLE IF NOT EXISTS pool_snapshots (
          id SERIAL PRIMARY KEY,
          pool_address VARCHAR(255) NOT NULL REFERENCES pools(pool_address) ON DELETE CASCADE,
          reserve_a NUMERIC(78, 0) NOT NULL,
          reserve_b NUMERIC(78, 0) NOT NULL,
          snapshot_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(pool_address, snapshot_time)
        );

        CREATE INDEX IF NOT EXISTS idx_pools_pair_key ON pools(pair_key);
        CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(token_a, token_b);
        CREATE INDEX IF NOT EXISTS idx_lp_positions_user ON lp_positions(user_address);
        CREATE INDEX IF NOT EXISTS idx_lp_positions_pool ON lp_positions(pool_address);
        CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool_time ON pool_snapshots(pool_address, snapshot_time DESC);

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
      `;

      // Anchor Pools Schema
      const anchorSchema = `
        CREATE TABLE IF NOT EXISTS anchor_pools (
          id SERIAL PRIMARY KEY,
          pool_address VARCHAR(255) UNIQUE NOT NULL,
          creator_address VARCHAR(255) NOT NULL,
          token_a VARCHAR(255) NOT NULL,
          token_b VARCHAR(255) NOT NULL,
          pair_key VARCHAR(511) NOT NULL,
          fee_bps INTEGER NOT NULL DEFAULT 30,
          status VARCHAR(50) NOT NULL DEFAULT 'active',
          lp_token_address VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT unique_anchor_pair UNIQUE (creator_address, pair_key)
        );

        CREATE INDEX IF NOT EXISTS idx_anchor_pools_pair_key ON anchor_pools(pair_key);
        CREATE INDEX IF NOT EXISTS idx_anchor_pools_creator ON anchor_pools(creator_address);
        CREATE INDEX IF NOT EXISTS idx_anchor_pools_status ON anchor_pools(status);

        CREATE TABLE IF NOT EXISTS anchor_pool_snapshots (
          id SERIAL PRIMARY KEY,
          pool_address VARCHAR(255) NOT NULL,
          reserve_a VARCHAR(255) NOT NULL,
          reserve_b VARCHAR(255) NOT NULL,
          snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_anchor_pool FOREIGN KEY (pool_address)
            REFERENCES anchor_pools(pool_address) ON DELETE CASCADE,
          CONSTRAINT unique_anchor_snapshot UNIQUE (pool_address, snapshot_time)
        );

        CREATE INDEX IF NOT EXISTS idx_anchor_snapshots_time ON anchor_pool_snapshots(pool_address, snapshot_time DESC);

        CREATE TABLE IF NOT EXISTS anchor_swaps (
          id SERIAL PRIMARY KEY,
          pool_address VARCHAR(255) NOT NULL,
          token_in VARCHAR(255) NOT NULL,
          token_out VARCHAR(255) NOT NULL,
          amount_in VARCHAR(255) NOT NULL,
          amount_out VARCHAR(255) NOT NULL,
          fee_collected VARCHAR(255) NOT NULL,
          tx_hash VARCHAR(255),
          block_height BIGINT,
          user_address VARCHAR(255),
          swap_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_anchor_swap_pool FOREIGN KEY (pool_address)
            REFERENCES anchor_pools(pool_address) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_anchor_swaps_pool ON anchor_swaps(pool_address, swap_time DESC);
        CREATE INDEX IF NOT EXISTS idx_anchor_swaps_user ON anchor_swaps(user_address, swap_time DESC);
        CREATE INDEX IF NOT EXISTS idx_anchor_swaps_time ON anchor_swaps(swap_time DESC);
      `;

      await pool.query(mainSchema);
      console.log('✅ Main database schema initialized');

      await pool.query(anchorSchema);
      console.log('✅ Anchor pools schema initialized');
    }

    console.log('✅ Database schema fully initialized');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Close database connection pool (for graceful shutdown)
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✅ Database pool closed');
  }
}
