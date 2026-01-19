/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { type ExecutionConditions } from '@lobechat/types';
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { users } from './user';

// Agent triggers table (renamed from agent_cron_jobs in migration 0070)
// Supports multiple triggers per agent: cron, webhook, api, manual
export const agentCronJobs = pgTable(
  'agent_triggers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agentCronJobs'))
      .notNull(),

    // Foreign keys
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    groupId: text('group_id').references(() => chatGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Task identification
    name: text('name'), // Optional task name like "Daily Report", "Data Monitoring"
    description: text('description'), // Optional task description

    // Core configuration
    enabled: boolean('enabled').default(true),
    cronPattern: text('cron_pattern').notNull(), // e.g., "*/30 * * * *" (every 30 minutes)
    timezone: text('timezone').default('UTC'),

    // Content fields
    content: text('content').notNull(), // Simple text content
    editData: jsonb('edit_data'), // Rich content data (markdown, files, images, etc.)

    // Execution count management
    maxExecutions: integer('max_executions'), // null = unlimited
    remainingExecutions: integer('remaining_executions'), // null = unlimited

    // Execution conditions (stored as JSONB)
    executionConditions: jsonb('execution_conditions').$type<ExecutionConditions>(),

    // Execution statistics
    lastExecutedAt: timestamp('last_executed_at'),
    totalExecutions: integer('total_executions').default(0),

    ...timestamps,
  },
  (t) => [
    // Indexes for performance (renamed from agent_cron_jobs_* in migration 0070)
    index('agent_triggers_agent_id_idx').on(t.agentId),
    index('agent_triggers_group_id_idx').on(t.groupId),
    index('agent_triggers_user_id_idx').on(t.userId),
    index('agent_triggers_enabled_idx').on(t.enabled),
    index('agent_triggers_remaining_executions_idx').on(t.remainingExecutions),
    index('agent_triggers_last_executed_at_idx').on(t.lastExecutedAt),
  ],
);

// Type exports
export type NewAgentCronJob = typeof agentCronJobs.$inferInsert;
export type AgentCronJob = typeof agentCronJobs.$inferSelect;

// Re-export types from types package for consumers
export type { ExecutionConditions } from '@lobechat/types';
export type { InsertAgentCronJob as CreateAgentCronJobData } from '@lobechat/types';
export type { UpdateAgentCronJob as UpdateAgentCronJobData } from '@lobechat/types';
