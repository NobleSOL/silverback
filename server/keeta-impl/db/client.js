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
    // Initialize main schema (AMM pools)
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('✅ Main database schema initialized');

    // Initialize anchor pools schema
    const anchorSchemaPath = path.join(__dirname, 'anchor-schema.sql');
    const anchorSchema = await fs.readFile(anchorSchemaPath, 'utf8');
    await pool.query(anchorSchema);
    console.log('✅ Anchor pools schema initialized');

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
