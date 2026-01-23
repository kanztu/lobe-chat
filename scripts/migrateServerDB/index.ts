import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { migrate as neonMigrate } from 'drizzle-orm/neon-serverless/migrator';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// @ts-ignore tsgo handle esm import cjs and compatibility issues
import { DB_FAIL_INIT_HINT, DUPLICATE_EMAIL_HINT, PGVECTOR_HINT } from './errorHint';

// Load environment variables in priority order:
// 1. .env (lowest priority)
// 2. .env.[env] (medium priority, overrides .env)
// 3. .env.[env].local (highest priority, overrides previous)
// Use dotenv-expand to support ${var} variable expansion
const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config()); // Load .env
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` })); // Load .env.[env] and override
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` })); // Load .env.[env].local and override

const migrationsFolder = join(__dirname, '../../packages/database/migrations');

const isDesktop = process.env.NEXT_PUBLIC_IS_DESKTOP_APP === '1';

const runForkMigrations = async () => {
  const forkMigrationsDir = join(__dirname, 'fork-migrations');

  // Check if fork-migrations directory exists
  if (!existsSync(forkMigrationsDir)) {
    console.log('ℹ️  No fork-specific migrations found, skipping');
    return;
  }

  console.log('[Fork Migrations] Running fork-specific migrations...');

  const { serverDB } = await import('../../packages/database/src/server');

  // Get all .sql files and sort them
  const files = readdirSync(forkMigrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    try {
      const sql = readFileSync(join(forkMigrationsDir, file), 'utf8');
      await serverDB.execute(sql);
      console.log(`✅ Fork migration: ${file}`);
    } catch (err) {
      console.error(`❌ Fork migration failed: ${file}`, err);
      throw err;
    }
  }

  console.log('✅ Fork migrations complete.');
};

const runMigrations = async () => {
  const { serverDB } = await import('../../packages/database/src/server');

  const time = Date.now();
  if (process.env.DATABASE_DRIVER === 'node') {
    await nodeMigrate(serverDB, { migrationsFolder });
  } else {
    await neonMigrate(serverDB, { migrationsFolder });
  }

  console.log('✅ database migration pass. use: %s ms', Date.now() - time);

  // Run fork-specific migrations after main migrations
  await runForkMigrations();

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
};

let connectionString = process.env.DATABASE_URL;

// only migrate database if the connection string is available
if (!isDesktop && connectionString) {
  // eslint-disable-next-line unicorn/prefer-top-level-await
  runMigrations().catch((err) => {
    console.error('❌ Database migrate failed:', err);

    const errMsg = err.message as string;

    const constraint = (err as { constraint?: string })?.constraint;

    if (errMsg.includes('extension "vector" is not available')) {
      console.info(PGVECTOR_HINT);
    } else if (constraint === 'users_email_unique' || errMsg.includes('users_email_unique')) {
      console.info(DUPLICATE_EMAIL_HINT);
    } else if (errMsg.includes(`Cannot read properties of undefined (reading 'migrate')`)) {
      console.info(DB_FAIL_INIT_HINT);
    }

    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  });
} else {
  console.log('🟢 not find database env or in desktop mode, migration skipped');
}
