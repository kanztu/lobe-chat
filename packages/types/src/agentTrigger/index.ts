// Agent Trigger System Types
// Supports multiple trigger types: cron, webhook, api, manual

import type { ExecutionConditions } from '../agentCronJob';

export type { ExecutionConditions };
export type TriggerType = 'cron' | 'webhook' | 'api' | 'manual';

export type TriggerQueueStatus = 'pending' | 'processing' | 'completed' | 'failed';

// Base trigger config interface
export interface BaseTriggerConfig {
  type: TriggerType;
}

// Cron trigger configuration
export interface CronTriggerConfig extends BaseTriggerConfig {
  type: 'cron';
  cronPattern: string; // e.g., "*/30 * * * *"
  timezone: string; // e.g., "UTC", "America/New_York"
}

// Webhook trigger configuration
export interface WebhookTriggerConfig extends BaseTriggerConfig {
  type: 'webhook';
  secret?: string; // HMAC secret for signature verification
  webhookUrl: string; // Auto-generated webhook URL
  payloadMapping: Record<string, string>; // Variable name → JSONPath expression
  expectedHeaders?: Record<string, string>; // Header validation (optional)
}

// API trigger configuration
export interface ApiTriggerConfig extends BaseTriggerConfig {
  type: 'api';
  apiKey: string; // Generated API key for authentication
  allowedOrigins?: string[]; // CORS origins (optional)
  rateLimit?: number; // Requests per hour (optional)
}

// Manual trigger configuration
export interface ManualTriggerConfig extends BaseTriggerConfig {
  type: 'manual';
  // No additional config needed - triggered manually via UI
}

// Union type for all trigger configs
export type TriggerConfig =
  | CronTriggerConfig
  | WebhookTriggerConfig
  | ApiTriggerConfig
  | ManualTriggerConfig;

// Agent trigger record
export interface AgentTrigger {
  id: string;
  agentId: string;
  userId: string;
  groupId?: string;

  // Trigger configuration
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;

  // Content
  name?: string;
  description?: string;
  content: string; // Prompt template with {{variables}}
  editData?: any; // Rich content (markdown, files, etc.)

  // Execution control
  enabled: boolean;
  maxExecutions?: number; // null = unlimited
  remainingExecutions?: number; // null = unlimited
  executionConditions?: ExecutionConditions;

  // Statistics
  lastExecutedAt?: Date;
  totalExecutions: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Legacy fields (kept for backward compatibility)
  cronPattern?: string;
  timezone?: string;
}

// Trigger queue job record
export interface TriggerQueueJob {
  id: string;
  triggerId: string;
  agentId: string;
  userId: string;

  // Execution data
  prompt: string; // Interpolated prompt, ready to execute
  triggerPayload?: any; // Original event data (for debugging)

  // Status
  status: TriggerQueueStatus;
  attempts: number | null;
  maxAttempts: number | null;

  // Timing
  scheduledAt: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;

  // Results
  topicId?: string | null;
  error?: string | null;

  // Deduplication
  idempotencyKey?: string | null;

  // Timestamps
  createdAt: Date | null;
}

// Create trigger input (omits auto-generated fields)
export type CreateAgentTriggerInput = Omit<
  AgentTrigger,
  'id' | 'userId' | 'totalExecutions' | 'lastExecutedAt' | 'createdAt' | 'updatedAt'
>;

// Update trigger input (partial)
export type UpdateAgentTriggerInput = Partial<
  Omit<AgentTrigger, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
>;

// Enqueue job parameters
export interface EnqueueJobParams {
  triggerId: string;
  agentId: string;
  userId: string;
  prompt: string;
  payload?: any;
  idempotencyKey?: string;
  maxAttempts?: number;
}

// Trigger execution result
export interface TriggerExecutionResult {
  success: boolean;
  jobId?: string;
  topicId?: string;
  message?: string;
  error?: string;
}

// Trigger statistics
export interface TriggerStatistics {
  totalTriggers: number;
  activeTriggers: number;
  completedExecutions: number;
  pendingExecutions: number;
  failedExecutions: number;
}

// Helper type for trigger list filters
export interface TriggerListFilters {
  agentId?: string;
  enabled?: boolean;
  triggerType?: TriggerType;
  limit?: number;
  offset?: number;
}
