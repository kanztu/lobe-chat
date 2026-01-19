-- LobeChat Database Migration
-- Migration: 0070_add_agent_trigger_system
-- Description: Add complete agent trigger system
-- Renames agent_cron_jobs to agent_triggers and creates trigger queue
-- Date: 2026-01-19

-- Part 1: Rename agent_cron_jobs to agent_triggers (simple, no DO block)
ALTER TABLE agent_cron_jobs RENAME TO agent_triggers;

-- Part 2: Add new columns for trigger types
ALTER TABLE agent_triggers
  ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'cron',
  ADD COLUMN IF NOT EXISTS trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Part 3: Migrate existing cron job data to new structure
UPDATE agent_triggers
SET
  trigger_type = 'cron',
  trigger_config = jsonb_build_object(
    'type', 'cron',
    'cronPattern', cron_pattern,
    'timezone', COALESCE(timezone, 'UTC')
  )
WHERE trigger_config = '{}'::jsonb;

-- Part 4: Create agent_trigger_queue table
CREATE TABLE agent_trigger_queue (
  id TEXT PRIMARY KEY DEFAULT concat('queue_', gen_random_uuid()::text),
  trigger_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  trigger_payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  scheduled_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  topic_id TEXT,
  error TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Part 5: Create indexes for agent_triggers
CREATE INDEX IF NOT EXISTS idx_agent_triggers_type ON agent_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled_type ON agent_triggers(enabled, trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_user_type ON agent_triggers(user_id, trigger_type);

-- Part 6: Create indexes for agent_trigger_queue
CREATE INDEX IF NOT EXISTS idx_queue_status ON agent_trigger_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON agent_trigger_queue(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_trigger ON agent_trigger_queue(trigger_id);
CREATE INDEX IF NOT EXISTS idx_queue_user ON agent_trigger_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_queue_topic ON agent_trigger_queue(topic_id);
CREATE INDEX IF NOT EXISTS idx_queue_completed_at ON agent_trigger_queue(completed_at) WHERE status IN ('completed', 'failed');

-- Part 7: Add foreign key constraint
ALTER TABLE agent_trigger_queue
  ADD CONSTRAINT fk_trigger_queue_trigger
    FOREIGN KEY (trigger_id) REFERENCES agent_triggers(id) ON DELETE CASCADE;

-- Part 8: Add comments
COMMENT ON TABLE agent_triggers IS 'Unified trigger system supporting cron, webhook, api, and manual triggers';
COMMENT ON TABLE agent_trigger_queue IS 'Queue for async agent trigger execution with retry logic';
