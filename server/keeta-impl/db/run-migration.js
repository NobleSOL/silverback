// server/keeta-impl/db/run-migration.js
// Script to run database migrations

import { getDbPool } from './client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration(migrationFile) {
  const pool = getDbPool();

  try {
    console.log(`📝 Running migration: ${migrationFile}`);

    // Read migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', migrationFile);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    await pool.query(sql);

    console.log(`✅ Migration completed: ${migrationFile}`);
  } catch (error) {
    console.error(`❌ Migration failed: ${migrationFile}`);
    console.error(error);
    throw error;
  }
}

// Run protocol fee migration
async function main() {
  console.log('🚀 Starting database migrations...\n');

  try {
    await runMigration('add-protocol-fee.sql');
    console.log('\n✅ All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed');
    process.exit(1);
  }
}

main();
