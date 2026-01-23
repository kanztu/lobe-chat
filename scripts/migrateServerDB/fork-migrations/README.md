# Fork-Specific Database Migrations

This directory contains database schema changes specific to this fork that are maintained separately from upstream's Drizzle migration system.

## Purpose

Fork-specific migrations solve the problem of migration number conflicts when:
- Upstream adds migration 0070 for Feature A
- Fork adds migration 0070 for Feature B
- Merge conflicts occur in `meta/_journal.json`

## How It Works

1. **Upstream migrations run first** (Drizzle's numbered system: 0000-NNNN)
2. **Then fork migrations run** (this directory: 001-NNN.sql)
3. **All fork SQL is idempotent** - safe to run multiple times

## Benefits

✅ No migration number conflicts with upstream
✅ Fork features always applied
✅ Safe to merge upstream updates
✅ Database stays in sync automatically
✅ No manual intervention needed

## File Naming

- Format: `NNN_description.sql` (e.g., `001_agent_trigger_system.sql`)
- Must be idempotent (use `IF NOT EXISTS`, `IF EXISTS`, DO blocks)
- Run in alphanumeric order

## Adding New Fork Migrations

1. Create new SQL file with next number (e.g., `003_new_feature.sql`)
2. Make it idempotent:
   ```sql
   CREATE TABLE IF NOT EXISTS my_table (...);
   ALTER TABLE my_table ADD COLUMN IF NOT EXISTS my_col TEXT;
   CREATE INDEX IF NOT EXISTS idx_name ON my_table(col);
   ```
3. Test locally
4. Commit and deploy

## Current Fork Migrations

- `001_agent_trigger_system.sql` - Agent triggers and queue tables
- `002_add_next_scheduled_at.sql` - Next scheduled execution timestamp

## Execution

Fork migrations run automatically after Drizzle migrations in:
- `scripts/migrateServerDB/docker.cjs` (Docker containers)
- `scripts/migrateServerDB/index.ts` (local development)

No manual intervention required.
