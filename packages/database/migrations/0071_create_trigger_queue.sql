-- LobeChat Database Migration
-- Migration: 0071_create_trigger_queue
-- Description: Create agent_trigger_queue table for async execution management
-- Author: Event-Driven Agent Trigger System
-- Date: 2026-01-19

-- Create agent_trigger_queue table
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
  created_at TIMESTAMP DEFAULT NOW(),

  -- Foreign keys
  CONSTRAINT fk_trigger_queue_trigger
    FOREIGN KEY (trigger_id)
    REFERENCES agent_triggers(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_trigger_queue_topic
    FOREIGN KEY (topic_id)
    REFERENCES topics(id)
    ON DELETE SET NULL
);

-- Indexes for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_queue_status ON agent_trigger_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON agent_trigger_queue(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_trigger ON agent_trigger_queue(trigger_id);
CREATE INDEX IF NOT EXISTS idx_queue_user ON agent_trigger_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_queue_topic ON agent_trigger_queue(topic_id);

-- Composite index for worker queries (most efficient for polling)
CREATE INDEX IF NOT EXISTS idx_queue_pending ON agent_trigger_queue(status, scheduled_at)
  WHERE status = 'pending';

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_queue_completed_at ON agent_trigger_queue(completed_at)
  WHERE status IN ('completed', 'failed');

-- Add comments for documentation
COMMENT ON TABLE agent_trigger_queue IS 'Queue for async agent trigger execution with retry logic';
COMMENT ON COLUMN agent_trigger_queue.status IS 'Status: pending, processing, completed, or failed';
COMMENT ON COLUMN agent_trigger_queue.attempts IS 'Number of execution attempts made';
COMMENT ON COLUMN agent_trigger_queue.idempotency_key IS 'Prevents duplicate executions from webhooks';
COMMENT ON COLUMN agent_trigger_queue.trigger_payload IS 'Original event data from webhook/API for debugging';
