-- LobeChat Database Migration
-- Migration: 0070_add_agent_trigger_system
-- Description: Add complete agent trigger system (combines old 0070 + 0071)
-- Extends agent_cron_jobs to agent_triggers and creates trigger queue
-- Author: Event-Driven Agent Trigger System
-- Date: 2026-01-19

-- Part 1: Extend agent_cron_jobs to support multiple trigger types
-- Safe: handles both rename (if exists) or create fresh (if doesn't exist)

DO $$
BEGIN
  -- Check if agent_cron_jobs exists
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_cron_jobs') THEN

    -- Rename existing table
    ALTER TABLE agent_cron_jobs RENAME TO agent_triggers;
    RAISE NOTICE 'Renamed agent_cron_jobs to agent_triggers';

    -- Add new columns
    ALTER TABLE agent_triggers
      ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'cron',
      ADD COLUMN IF NOT EXISTS trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb;

    -- Migrate existing data
    UPDATE agent_triggers
    SET
      trigger_type = 'cron',
      trigger_config = jsonb_build_object(
        'type', 'cron',
        'cronPattern', cron_pattern,
        'timezone', COALESCE(timezone, 'UTC')
      )
    WHERE trigger_config = '{}'::jsonb;

    RAISE NOTICE 'Migrated existing cron jobs to trigger format';

  ELSIF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_triggers') THEN

    -- Create fresh table if neither exists
    CREATE TABLE agent_triggers (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      group_id TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      trigger_config JSONB NOT NULL,
      name TEXT,
      description TEXT,
      enabled BOOLEAN DEFAULT TRUE,
      content TEXT NOT NULL,
      edit_data JSONB,
      max_executions INTEGER,
      remaining_executions INTEGER,
      execution_conditions JSONB,
      last_executed_at TIMESTAMP,
      total_executions INTEGER DEFAULT 0,
      cron_pattern TEXT,
      timezone TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT fk_agent_triggers_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      CONSTRAINT fk_agent_triggers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_agent_triggers_group FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE
    );

    RAISE NOTICE 'Created agent_triggers table from scratch';

  ELSE
    RAISE NOTICE 'agent_triggers already exists, skipping';
  END IF;
END $$;

-- Part 2: Create trigger execution queue table

CREATE TABLE IF NOT EXISTS agent_trigger_queue (
  id TEXT PRIMARY KEY DEFAULT concat('queue_', gen_random_uuid()::text),
  trigger_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  -- Execution data
  prompt TEXT NOT NULL,
  trigger_payload JSONB,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Timing
  scheduled_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,

  -- Results
  topic_id TEXT,
  error TEXT,

  -- Deduplication
  idempotency_key TEXT UNIQUE,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW()
);

-- Part 3: Create all indexes

-- agent_triggers indexes
CREATE INDEX IF NOT EXISTS idx_agent_triggers_agent_id ON agent_triggers(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_user_id ON agent_triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_group_id ON agent_triggers(group_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled ON agent_triggers(enabled);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_type ON agent_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled_type ON agent_triggers(enabled, trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_user_type ON agent_triggers(user_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_remaining_executions ON agent_triggers(remaining_executions);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_last_executed_at ON agent_triggers(last_executed_at);

-- agent_trigger_queue indexes
CREATE INDEX IF NOT EXISTS idx_queue_status ON agent_trigger_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON agent_trigger_queue(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_trigger ON agent_trigger_queue(trigger_id);
CREATE INDEX IF NOT EXISTS idx_queue_user ON agent_trigger_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_queue_topic ON agent_trigger_queue(topic_id);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON agent_trigger_queue(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_completed_at ON agent_trigger_queue(completed_at) WHERE status IN ('completed', 'failed');

-- Part 4: Add comments
COMMENT ON TABLE agent_triggers IS 'Unified trigger system supporting cron, webhook, api, and manual triggers';
COMMENT ON COLUMN agent_triggers.trigger_type IS 'Type of trigger: cron, webhook, api, or manual';
COMMENT ON COLUMN agent_triggers.trigger_config IS 'JSONB configuration specific to trigger type';
COMMENT ON TABLE agent_trigger_queue IS 'Queue for async agent trigger execution with retry logic';
