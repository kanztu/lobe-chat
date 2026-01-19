const { join } = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const migrator = require('drizzle-orm/node-postgres/migrator');
const { PGVECTOR_HINT } = require('./errorHint');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set, please set it in your environment variables.');
}

console.log('🔍 DEBUG: DATABASE_URL:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@'));

const client = new Pool({ connectionString: process.env.DATABASE_URL });

const db = drizzle(client);

const runMigrations = async () => {
  console.log('[Database] Start to migration...');

  const migrationsFolder = join(__dirname, './migrations');
  console.log('🔍 DEBUG: Migrations folder:', migrationsFolder);

  // Check what files exist
  const fs = require('fs');
  const files = fs.readdirSync(migrationsFolder).filter(f => f.endsWith('.sql'));
  console.log('🔍 DEBUG: Found', files.length, 'SQL files');
  console.log('🔍 DEBUG: Last 3 files:', files.slice(-3));

  // Check current migration state
  const result = await client.query('SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3');
  console.log('🔍 DEBUG: Last 3 migrations in DB:', result.rows);

  console.log('🔍 DEBUG: Running migrator.migrate()...');
  await migrator.migrate(db, {
    migrationsFolder,
  });
  console.log('🔍 DEBUG: migrator.migrate() completed');

  // Check migration state after
  const afterResult = await client.query('SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3');
  console.log('🔍 DEBUG: After migration, last 3:', afterResult.rows);

  // Check if tables exist
  const tablesResult = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename IN ('agent_triggers', 'agent_trigger_queue', 'agent_cron_jobs')
  `);
  console.log('🔍 DEBUG: Tables found:', tablesResult.rows.map(r => r.tablename));

  console.log('✅ database migration pass.');
  console.log('-------------------------------------');
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
};

// eslint-disable-next-line unicorn/prefer-top-level-await
runMigrations().catch((err) => {
  console.error(
    '❌ Database migrate failed. Please check your database is valid and DATABASE_URL is set correctly. The error detail is below:',
  );
  console.error(err);

  if (err.message.includes('extension "vector" is not available')) {
    console.info(PGVECTOR_HINT);
  }

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
