-- Fork-Specific Migration: Agent Trigger System
-- This migration is idempotent and runs independently from Drizzle's numbered migrations
-- Date: 2026-01-24

DO $$
BEGIN
  -- Part 1: Handle agent_cron_jobs → agent_triggers migration
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_cron_jobs')
     AND NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_triggers') THEN

    -- Rename agent_cron_jobs to agent_triggers
    RAISE NOTICE 'Renaming agent_cron_jobs to agent_triggers';
    ALTER TABLE agent_cron_jobs RENAME TO agent_triggers;

  ELSIF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_triggers') THEN

    -- Create agent_triggers from scratch if neither table exists
    RAISE NOTICE 'Creating agent_triggers table from scratch';
    CREATE TABLE agent_triggers (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      group_id TEXT,
      name TEXT,
      description TEXT,
      enabled BOOLEAN DEFAULT TRUE,
      cron_pattern TEXT NOT NULL,
      timezone TEXT DEFAULT 'UTC',
      content TEXT NOT NULL,
      edit_data JSONB,
      max_executions INTEGER,
      remaining_executions INTEGER,
      execution_conditions JSONB,
      last_executed_at TIMESTAMP,
      total_executions INTEGER DEFAULT 0,
      accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

      CONSTRAINT fk_agent_triggers_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      CONSTRAINT fk_agent_triggers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_agent_triggers_group FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE
    );

  ELSE
    RAISE NOTICE 'agent_triggers table already exists, skipping';
  END IF;

  -- Part 2: Add new columns for trigger types (idempotent)
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_triggers') THEN
    ALTER TABLE agent_triggers
      ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'cron',
      ADD COLUMN IF NOT EXISTS trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb;

    RAISE NOTICE 'Added trigger_type and trigger_config columns';
  END IF;

  -- Part 3: Migrate existing cron job data to new structure
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_triggers') THEN
    UPDATE agent_triggers
    SET
      trigger_type = 'cron',
      trigger_config = jsonb_build_object(
        'type', 'cron',
        'cronPattern', cron_pattern,
        'timezone', COALESCE(timezone, 'UTC')
      )
    WHERE trigger_config = '{}'::jsonb OR trigger_config IS NULL;

    RAISE NOTICE 'Migrated cron job data to new structure';
  END IF;

END $$;

-- Part 4: Create agent_trigger_queue table (idempotent)
CREATE TABLE IF NOT EXISTS agent_trigger_queue (
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

-- Part 5: Create indexes for agent_triggers (all idempotent)
CREATE INDEX IF NOT EXISTS idx_agent_triggers_agent_id ON agent_triggers(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_user_id ON agent_triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_group_id ON agent_triggers(group_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled ON agent_triggers(enabled);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_type ON agent_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled_type ON agent_triggers(enabled, trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_user_type ON agent_triggers(user_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_remaining_executions ON agent_triggers(remaining_executions);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_last_executed_at ON agent_triggers(last_executed_at);

-- Part 6: Create indexes for agent_trigger_queue (all idempotent)
CREATE INDEX IF NOT EXISTS idx_queue_status ON agent_trigger_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON agent_trigger_queue(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_trigger ON agent_trigger_queue(trigger_id);
CREATE INDEX IF NOT EXISTS idx_queue_user ON agent_trigger_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_queue_topic ON agent_trigger_queue(topic_id);
CREATE INDEX IF NOT EXISTS idx_queue_completed_at ON agent_trigger_queue(completed_at) WHERE status IN ('completed', 'failed');

-- Part 7: Add foreign key constraint (idempotent with DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_trigger_queue_trigger'
  ) THEN
    ALTER TABLE agent_trigger_queue
      ADD CONSTRAINT fk_trigger_queue_trigger
        FOREIGN KEY (trigger_id) REFERENCES agent_triggers(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added foreign key constraint fk_trigger_queue_trigger';
  ELSE
    RAISE NOTICE 'Foreign key constraint fk_trigger_queue_trigger already exists';
  END IF;
END $$;

-- Part 8: Add table comments
COMMENT ON TABLE agent_triggers IS 'Unified trigger system supporting cron, webhook, api, and manual triggers';
COMMENT ON TABLE agent_trigger_queue IS 'Queue for async agent trigger execution with retry logic';
