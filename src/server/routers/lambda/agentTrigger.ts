import {
  type CreateAgentTriggerInput,
  type UpdateAgentTriggerInput,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentTriggerModel } from '@/database/models/agentTrigger';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const agentTriggerProcedure = authedProcedure.use(serverDatabase);

const listQuerySchema = z.object({
  agentId: z.string().optional(),
  enabled: z.boolean().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  triggerType: z.enum(['cron', 'webhook', 'api', 'manual']).optional(),
});

const resetExecutionsSchema = z.object({
  id: z.string(),
  newMaxExecutions: z.number().min(1).max(10_000).optional(),
});

const batchUpdateStatusSchema = z.object({
  enabled: z.boolean(),
  ids: z.array(z.string()),
});

const testTriggerSchema = z.object({
  testPayload: z.any().optional(),
  triggerId: z.string(),
});

// Create input schema for tRPC that omits server-managed fields
const createAgentTriggerInputSchema = z.object({
  agentId: z.string(),
  content: z.string(),
  description: z.string().optional(),
  editData: z.any().optional(),
  enabled: z.boolean().default(true),
  executionConditions: z
    .object({
      maxExecutionsPerDay: z.number().min(1).max(100).optional(),
      timeRange: z
        .object({
          end: z.string(),
          start: z.string(),
        })
        .optional(),
      weekdays: z.array(z.number().min(0).max(6)).optional(),
    })
    .optional(),
  groupId: z.string().optional(),
  maxExecutions: z.number().min(1).optional(),
  name: z.string().optional(),
  remainingExecutions: z.number().min(0).optional(),
  triggerConfig: z.any(), // TriggerConfig union type
  triggerType: z.enum(['cron', 'webhook', 'api', 'manual']),
});

const updateAgentTriggerInputSchema = z.object({
  content: z.string().optional(),
  description: z.string().optional(),
  editData: z.any().optional(),
  enabled: z.boolean().optional(),
  executionConditions: z
    .object({
      maxExecutionsPerDay: z.number().min(1).max(100).optional(),
      timeRange: z
        .object({
          end: z.string(),
          start: z.string(),
        })
        .optional(),
      weekdays: z.array(z.number().min(0).max(6)).optional(),
    })
    .optional(),
  maxExecutions: z.number().min(1).optional(),
  name: z.string().optional(),
  remainingExecutions: z.number().min(0).optional(),
  triggerConfig: z.any().optional(),
  triggerType: z.enum(['cron', 'webhook', 'api', 'manual']).optional(),
});

/**
 * Agent Trigger tRPC Router
 *
 * Provides type-safe API for managing agent triggers (cron, webhook, api, manual)
 */
export const agentTriggerRouter = router({
  /**
   * Batch update status (enable/disable) for multiple triggers
   */
  batchUpdateStatus: agentTriggerProcedure
    .input(batchUpdateStatusSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { ids, enabled } = input;

      try {
        const triggerModel = new AgentTriggerModel(db, userId);
        const updatedCount = await triggerModel.batchUpdateStatus(ids, enabled);

        return {
          data: { updatedCount },
          message: `${updatedCount} triggers ${enabled ? 'enabled' : 'disabled'} successfully`,
          success: true,
        };
      } catch (error) {
        console.error('[agentTrigger:batchUpdateStatus]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update trigger statuses',
        });
      }
    }),

  /**
   * Create a new trigger
   */
  create: agentTriggerProcedure
    .input(createAgentTriggerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;

      try {
        const triggerModel = new AgentTriggerModel(db, userId);
        const trigger = await triggerModel.create(input as CreateAgentTriggerInput);

        return {
          data: trigger,
          message: 'Trigger created successfully',
          success: true,
        };
      } catch (error) {
        console.error('[agentTrigger:create]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create trigger',
        });
      }
    }),

  /**
   * Delete a trigger
   */
  delete: agentTriggerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { id } = input;

      try {
        const triggerModel = new AgentTriggerModel(db, userId);
        const deleted = await triggerModel.delete(id);

        if (!deleted) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Trigger not found or access denied',
          });
        }

        return {
          message: 'Trigger deleted successfully',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error('[agentTrigger:delete]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete trigger',
        });
      }
    }),

  /**
   * List triggers by agent ID
   */
  findByAgent: agentTriggerProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { agentId } = input;

      try {
        const triggerModel = new AgentTriggerModel(db, userId);
        const triggers = await triggerModel.findByAgentId(agentId);

        return {
          data: triggers,
          success: true,
        };
      } catch (error) {
        console.error('[agentTrigger:findByAgent]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch agent triggers',
        });
      }
    }),

  /**
   * Get a single trigger by ID
   */
  findById: agentTriggerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { id } = input;

      try {
        const triggerModel = new AgentTriggerModel(db, userId);
        const trigger = await triggerModel.findById(id);

        if (!trigger) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Trigger not found',
          });
        }

        return {
          data: trigger,
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error('[agentTrigger:findById]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch trigger',
        });
      }
    }),

  /**
   * Get triggers that are near depletion (for warnings)
   */
  getNearDepletion: agentTriggerProcedure
    .input(z.object({ threshold: z.number().min(1).max(20).default(5) }))
    .query(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { threshold } = input;

      try {
        const triggerModel = new AgentTriggerModel(db, userId);
        const triggers = await triggerModel.getTasksNearDepletion(threshold);

        return {
          data: triggers,
          success: true,
        };
      } catch (error) {
        console.error('[agentTrigger:getNearDepletion]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch near depletion triggers',
        });
      }
    }),

  /**
   * Get execution statistics for user's triggers
   */
  getStats: agentTriggerProcedure.query(async ({ ctx }) => {
    const { userId, serverDB: db } = ctx;

    try {
      const triggerModel = new AgentTriggerModel(db, userId);
      const stats = await triggerModel.getExecutionStats();

      return {
        data: stats,
        success: true,
      };
    } catch (error) {
      console.error('[agentTrigger:getStats]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch execution statistics',
      });
    }
  }),

  /**
   * List triggers with filtering and pagination
   */
  list: agentTriggerProcedure.input(listQuerySchema).query(async ({ input, ctx }) => {
    const { userId, serverDB: db } = ctx;
    const { agentId, enabled, limit, offset, triggerType } = input;

    try {
      const triggerModel = new AgentTriggerModel(db, userId);
      const result = await triggerModel.findWithPagination({
        agentId,
        enabled,
        limit,
        offset,
        triggerType,
      });

      return {
        data: result.data,
        pagination: {
          hasMore: offset + limit < result.total,
          limit,
          offset,
          total: result.total,
        },
        success: true,
      };
    } catch (error) {
      console.error('[agentTrigger:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch triggers',
      });
    }
  }),

  /**
   * Reset execution counts for a trigger
   */
  resetExecutions: agentTriggerProcedure
    .input(resetExecutionsSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { id, newMaxExecutions } = input;

      try {
        const triggerModel = new AgentTriggerModel(db, userId);
        const trigger = await triggerModel.resetExecutions(id, newMaxExecutions);

        if (!trigger) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Trigger not found or access denied',
          });
        }

        return {
          data: trigger,
          message: 'Execution counts reset successfully',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error('[agentTrigger:resetExecutions]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reset execution counts',
        });
      }
    }),

  /**
   * Test trigger execution with optional test payload
   */
  testTrigger: agentTriggerProcedure.input(testTriggerSchema).mutation(async ({ input, ctx }) => {
    const { userId, serverDB: db } = ctx;
    const { triggerId, testPayload } = input;

    try {
      const triggerModel = new AgentTriggerModel(db, userId);
      const trigger = await triggerModel.findById(triggerId);

      if (!trigger) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Trigger not found or access denied',
        });
      }

      // For webhook/API triggers with payload mapping, test interpolation
      if (
        testPayload &&
        (trigger.triggerType === 'webhook' || trigger.triggerType === 'api')
      ) {
        const { interpolatePrompt } = await import('@/utils/template');
        const config = trigger.triggerConfig as any;

        const interpolated = interpolatePrompt(
          trigger.content,
          testPayload,
          config.payloadMapping || {},
        );

        return {
          data: {
            interpolatedPrompt: interpolated,
            originalPrompt: trigger.content,
            payload: testPayload,
          },
          message: 'Test completed successfully',
          success: true,
        };
      }

      // For cron/manual triggers, just return the prompt as-is
      return {
        data: {
          interpolatedPrompt: trigger.content,
          originalPrompt: trigger.content,
        },
        message: 'Test completed successfully',
        success: true,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;

      console.error('[agentTrigger:testTrigger]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to test trigger',
      });
    }
  }),

  /**
   * Update a trigger
   */
  update: agentTriggerProcedure
    .input(
      z.object({
        data: updateAgentTriggerInputSchema,
        id: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { id, data } = input;

      try {
        const triggerModel = new AgentTriggerModel(db, userId);
        const trigger = await triggerModel.update(id, data as UpdateAgentTriggerInput);

        if (!trigger) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Trigger not found or access denied',
          });
        }

        return {
          data: trigger,
          message: 'Trigger updated successfully',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error('[agentTrigger:update]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update trigger',
        });
      }
    }),
});

// For backward compatibility, export as agentCronJobRouter alias
export const agentCronJobRouter = agentTriggerRouter;
