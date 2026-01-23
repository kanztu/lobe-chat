const { join } = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const migrator = require('drizzle-orm/node-postgres/migrator');
const { PGVECTOR_HINT } = require('./errorHint');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set, please set it in your environment variables.');
}

const client = new Pool({ connectionString: process.env.DATABASE_URL });

const db = drizzle(client);

const runForkMigrations = async () => {
  const fs = require('node:fs');
  const forkMigrationsDir = join(__dirname, 'fork-migrations');

  // Check if fork-migrations directory exists
  if (!fs.existsSync(forkMigrationsDir)) {
    console.log('ℹ️  No fork-specific migrations found, skipping');
    return;
  }

  console.log('[Fork Migrations] Running fork-specific migrations...');

  // Get all .sql files and sort them
  const files = fs
    .readdirSync(forkMigrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    try {
      const sql = fs.readFileSync(join(forkMigrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`✅ Fork migration: ${file}`);
    } catch (err) {
      console.error(`❌ Fork migration failed: ${file}`, err);
      throw err;
    }
  }

  console.log('✅ Fork migrations complete.');
};

const runMigrations = async () => {
  console.log('[Database] Start to migration...');
  await migrator.migrate(db, {
    migrationsFolder: join(__dirname, './migrations'),
  });

  console.log('✅ database migration pass.');

  // Run fork-specific migrations after main migrations
  await runForkMigrations();

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
