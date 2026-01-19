-- LobeChat Database Migration
-- Migration: 0070_extend_agent_triggers
-- Description: Extend agent_cron_jobs to support multiple trigger types (cron, webhook, api, manual)
-- Author: Event-Driven Agent Trigger System
-- Date: 2026-01-19

-- Step 1: Rename table to agent_triggers
ALTER TABLE agent_cron_jobs RENAME TO agent_triggers;

-- Step 2: Add new columns for trigger types
ALTER TABLE agent_triggers
  ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'cron',
  ADD COLUMN IF NOT EXISTS trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Step 3: Migrate existing cron job data to new structure
UPDATE agent_triggers
SET
  trigger_type = 'cron',
  trigger_config = jsonb_build_object(
    'type', 'cron',
    'cronPattern', cron_pattern,
    'timezone', COALESCE(timezone, 'UTC')
  )
WHERE trigger_type = 'cron' AND trigger_config = '{}'::jsonb;

-- Step 4: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_triggers_type ON agent_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled_type ON agent_triggers(enabled, trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_user_type ON agent_triggers(user_id, trigger_type);

-- Step 5: Add comment to document the change
COMMENT ON TABLE agent_triggers IS 'Unified trigger system supporting cron, webhook, api, and manual triggers';
COMMENT ON COLUMN agent_triggers.trigger_type IS 'Type of trigger: cron, webhook, api, or manual';
COMMENT ON COLUMN agent_triggers.trigger_config IS 'JSONB configuration specific to trigger type';

-- Note: We keep cron_pattern and timezone columns for backward compatibility
-- They can be dropped in a future migration after ensuring all apps are updated
