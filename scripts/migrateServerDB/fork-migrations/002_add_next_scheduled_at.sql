-- Fork-Specific Migration: Add next_scheduled_at field
-- This migration is idempotent and runs independently from Drizzle's numbered migrations
-- Date: 2026-01-24

-- Add next_scheduled_at column (idempotent)
ALTER TABLE agent_triggers
  ADD COLUMN IF NOT EXISTS next_scheduled_at TIMESTAMP;

-- Create index for efficient cron job queries (idempotent)
CREATE INDEX IF NOT EXISTS agent_triggers_next_scheduled_at_idx
  ON agent_triggers(enabled, trigger_type, next_scheduled_at)
  WHERE enabled = true AND trigger_type = 'cron';
