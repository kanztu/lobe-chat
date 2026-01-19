/**
 * Agent Trigger Service
 * Frontend service layer for managing agent triggers (cron, webhook, api, manual)
 */

import type {
  CreateAgentTriggerInput,
  TriggerListFilters,
  UpdateAgentTriggerInput,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AgentTriggerService {
  /**
   * Create a new trigger
   */
  async create(data: CreateAgentTriggerInput) {
    return lambdaClient.agentTrigger.create.mutate(data);
  }

  /**
   * Get triggers for a specific agent
   */
  async getByAgentId(agentId: string) {
    return lambdaClient.agentTrigger.findByAgent.query({ agentId });
  }

  /**
   * Get a single trigger by ID
   */
  async getById(id: string) {
    return lambdaClient.agentTrigger.findById.query({ id });
  }

  /**
   * Update a trigger
   */
  async update(id: string, data: UpdateAgentTriggerInput) {
    return lambdaClient.agentTrigger.update.mutate({ data, id });
  }

  /**
   * Delete a trigger
   */
  async delete(id: string) {
    return lambdaClient.agentTrigger.delete.mutate({ id });
  }

  /**
   * List triggers with filtering and pagination
   */
  async list(options: TriggerListFilters) {
    return lambdaClient.agentTrigger.list.query(options);
  }

  /**
   * Reset execution counts
   */
  async resetExecutions(id: string, newMaxExecutions?: number) {
    return lambdaClient.agentTrigger.resetExecutions.mutate({ id, newMaxExecutions });
  }

  /**
   * Get execution statistics
   */
  async getStats() {
    return lambdaClient.agentTrigger.getStats.query();
  }

  /**
   * Get triggers near depletion
   */
  async getNearDepletion(threshold?: number) {
    return lambdaClient.agentTrigger.getNearDepletion.query({ threshold });
  }

  /**
   * Batch update status (enable/disable multiple triggers)
   */
  async batchUpdateStatus(ids: string[], enabled: boolean) {
    return lambdaClient.agentTrigger.batchUpdateStatus.mutate({ enabled, ids });
  }

  /**
   * Test trigger execution with optional test payload
   */
  async testTrigger(triggerId: string, testPayload?: any) {
    return lambdaClient.agentTrigger.testTrigger.mutate({ testPayload, triggerId });
  }
}

export const agentTriggerService = new AgentTriggerService();

// For backward compatibility with existing cron job code
export const agentCronJobService = agentTriggerService;
