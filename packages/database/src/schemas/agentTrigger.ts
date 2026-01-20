/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { type ExecutionConditions, type TriggerConfig } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { users } from './user';

// Agent triggers table - unified system supporting cron, webhook, api, and manual triggers
export const agentTriggers = pgTable(
  'agent_triggers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agentTriggers'))
      .notNull(),

    // Foreign keys
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    groupId: text('group_id').references(() => chatGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Trigger type and configuration
    triggerType: text('trigger_type').notNull().default('cron'), // 'cron' | 'webhook' | 'api' | 'manual'
    triggerConfig: jsonb('trigger_config').$type<TriggerConfig>().notNull(),

    // Task identification
    name: text('name'), // Optional task name like "Daily Report", "GitHub Issue Handler"
    description: text('description'), // Optional task description

    // Core configuration
    enabled: boolean('enabled').default(true),

    // Content fields
    content: text('content').notNull(), // Prompt template with {{variables}}
    editData: jsonb('edit_data'), // Rich content data (markdown, files, images, etc.)

    // Execution count management
    maxExecutions: integer('max_executions'), // null = unlimited
    remainingExecutions: integer('remaining_executions'), // null = unlimited

    // Execution conditions (stored as JSONB)
    executionConditions: jsonb('execution_conditions').$type<ExecutionConditions>(),

    // Execution statistics
    lastExecutedAt: timestamp('last_executed_at'),
    nextScheduledAt: timestamp('next_scheduled_at'),
    totalExecutions: integer('total_executions').default(0),

    // Legacy fields (kept for backward compatibility with cron jobs)
    cronPattern: text('cron_pattern'),
    timezone: text('timezone'),

    ...timestamps,
  },
  (t) => [
    // Indexes for performance
    index('agent_triggers_agent_id_idx').on(t.agentId),
    index('agent_triggers_group_id_idx').on(t.groupId),
    index('agent_triggers_user_id_idx').on(t.userId),
    index('agent_triggers_enabled_idx').on(t.enabled),
    index('agent_triggers_type_idx').on(t.triggerType),
    index('agent_triggers_enabled_type_idx').on(t.enabled, t.triggerType),
    index('agent_triggers_user_type_idx').on(t.userId, t.triggerType),
    index('agent_triggers_remaining_executions_idx').on(t.remainingExecutions),
    index('agent_triggers_last_executed_at_idx').on(t.lastExecutedAt),
    index('agent_triggers_next_scheduled_at_idx')
      .on(t.enabled, t.triggerType, t.nextScheduledAt)
      .where(sql`${t.enabled} = true AND ${t.triggerType} = 'cron'`),
  ],
);

// Type exports
export type NewAgentTrigger = typeof agentTriggers.$inferInsert;
export type AgentTrigger = typeof agentTriggers.$inferSelect;

// Re-export types from types package for consumers
export type { ExecutionConditions, TriggerConfig, TriggerType } from '@lobechat/types';
export type {
  CreateAgentTriggerInput as CreateAgentTriggerData,
  UpdateAgentTriggerInput as UpdateAgentTriggerData,
} from '@lobechat/types';
