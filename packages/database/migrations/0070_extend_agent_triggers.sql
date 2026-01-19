-- LobeChat Database Migration
-- Migration: 0070_extend_agent_triggers
-- Description: Extend agent_cron_jobs to support multiple trigger types (cron, webhook, api, manual)
-- Author: Event-Driven Agent Trigger System
-- Date: 2026-01-19

-- Safe migration that handles both scenarios:
-- 1. agent_cron_jobs exists → Rename and extend
-- 2. agent_cron_jobs doesn't exist → Create agent_triggers fresh

DO $$
BEGIN
  -- Check if agent_cron_jobs exists and handle accordingly
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_cron_jobs') THEN

    -- Scenario 1: Rename existing table
    RAISE NOTICE 'Renaming agent_cron_jobs to agent_triggers';
    ALTER TABLE agent_cron_jobs RENAME TO agent_triggers;

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

    RAISE NOTICE 'Successfully migrated agent_cron_jobs to agent_triggers';

  ELSIF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_triggers') THEN

    -- Scenario 2: Create fresh table (if cron jobs feature was never used)
    RAISE NOTICE 'Creating agent_triggers table from scratch';

    CREATE TABLE agent_triggers (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      group_id TEXT,

      -- Trigger configuration
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      trigger_config JSONB NOT NULL,

      -- Task identification
      name TEXT,
      description TEXT,

      -- Core configuration
      enabled BOOLEAN DEFAULT TRUE,

      -- Content
      content TEXT NOT NULL,
      edit_data JSONB,

      -- Execution management
      max_executions INTEGER,
      remaining_executions INTEGER,
      execution_conditions JSONB,

      -- Statistics
      last_executed_at TIMESTAMP,
      total_executions INTEGER DEFAULT 0,

      -- Legacy compatibility
      cron_pattern TEXT,
      timezone TEXT,

      -- Timestamps
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),

      -- Foreign keys
      CONSTRAINT fk_agent_triggers_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      CONSTRAINT fk_agent_triggers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_agent_triggers_group FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE
    );

    RAISE NOTICE 'Successfully created agent_triggers table';

  ELSE
    RAISE NOTICE 'agent_triggers table already exists, skipping';
  END IF;

END $$;

-- Create indexes (idempotent with IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_agent_triggers_agent_id ON agent_triggers(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_user_id ON agent_triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_group_id ON agent_triggers(group_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled ON agent_triggers(enabled);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_type ON agent_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled_type ON agent_triggers(enabled, trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_user_type ON agent_triggers(user_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_remaining_executions ON agent_triggers(remaining_executions);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_last_executed_at ON agent_triggers(last_executed_at);

-- Add comments
COMMENT ON TABLE agent_triggers IS 'Unified trigger system supporting cron, webhook, api, and manual triggers';
COMMENT ON COLUMN agent_triggers.trigger_type IS 'Type of trigger: cron, webhook, api, or manual';
COMMENT ON COLUMN agent_triggers.trigger_config IS 'JSONB configuration specific to trigger type';
