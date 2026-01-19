/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { type TriggerQueueStatus } from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { agentTriggers } from './agentTrigger';
import { topics } from './topic';

// Agent trigger queue table - manages async execution of triggered agents
export const agentTriggerQueue = pgTable(
  'agent_trigger_queue',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `queue_${crypto.randomUUID()}`)
      .notNull(),

    // Foreign keys
    triggerId: text('trigger_id')
      .references(() => agentTriggers.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id').notNull(),
    userId: text('user_id').notNull(),

    // Execution data
    prompt: text('prompt').notNull(), // Interpolated prompt, ready to execute
    triggerPayload: jsonb('trigger_payload'), // Original event data for debugging

    // Status tracking
    status: text('status').$type<TriggerQueueStatus>().notNull().default('pending'),
    attempts: integer('attempts').default(0),
    maxAttempts: integer('max_attempts').default(3),

    // Timing
    scheduledAt: timestamp('scheduled_at').defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),

    // Results
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    error: text('error'),

    // Deduplication
    idempotencyKey: text('idempotency_key'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => [
    // Indexes for efficient queue processing
    index('agent_trigger_queue_status_idx').on(t.status),
    index('agent_trigger_queue_scheduled_idx').on(t.scheduledAt).where(sql`status = 'pending'`),
    index('agent_trigger_queue_trigger_idx').on(t.triggerId),
    index('agent_trigger_queue_user_idx').on(t.userId),
    index('agent_trigger_queue_topic_idx').on(t.topicId),

    // Composite index for worker queries (most efficient for polling)
    index('agent_trigger_queue_pending_idx')
      .on(t.status, t.scheduledAt)
      .where(sql`status = 'pending'`),

    // Index for cleanup queries
    index('agent_trigger_queue_completed_at_idx')
      .on(t.completedAt)
      .where(sql`status IN ('completed', 'failed')`),

    // Unique constraint for idempotency
    uniqueIndex('agent_trigger_queue_idempotency_key_idx').on(t.idempotencyKey),
  ],
);

// Type exports
export type NewTriggerQueueJob = typeof agentTriggerQueue.$inferInsert;
export type TriggerQueueJob = typeof agentTriggerQueue.$inferSelect;

// Re-export types from types package
export type { TriggerQueueStatus } from '@lobechat/types';
export type { EnqueueJobParams, TriggerExecutionResult } from '@lobechat/types';
