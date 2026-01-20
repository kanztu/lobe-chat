import { CronExpressionParser } from 'cron-parser';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type {
  AgentTrigger,
  CreateAgentTriggerData,
  NewAgentTrigger,
  UpdateAgentTriggerData,
} from '../schemas/agentTrigger';
import { agentTriggers } from '../schemas/agentTrigger';
import type { LobeChatDatabase } from '../type';
import type { CronTriggerConfig } from '@lobechat/types';

export class AgentTriggerModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId?: string) {
    this.db = db;
    this.userId = userId!;
  }

  /**
   * Calculate next scheduled execution time for cron trigger
   * Always calculates from NOW (Linux cron behavior)
   */
  private static calculateNextScheduledAt(
    triggerType: string,
    triggerConfig: any,
    enabled: boolean,
  ): Date | null {
    if (triggerType !== 'cron' || !enabled) return null;

    try {
      const config = triggerConfig as CronTriggerConfig;
      const interval = CronExpressionParser.parse(config.cronPattern, {
        currentDate: new Date(), // Always from NOW
        tz: config.timezone || 'UTC',
      });
      return interval.next().toDate();
    } catch (error) {
      console.error('Failed to calculate nextScheduledAt:', error);
      return null;
    }
  }

  // Create a new trigger
  async create(data: CreateAgentTriggerData): Promise<AgentTrigger> {
    const nextScheduledAt = AgentTriggerModel.calculateNextScheduledAt(
      data.triggerType,
      data.triggerConfig,
      data.enabled ?? true,
    );

    const trigger = await this.db
      .insert(agentTriggers)
      .values({
        ...data,
        // Initialize remaining executions to match max executions
        remainingExecutions: data.maxExecutions,
        nextScheduledAt,
        userId: this.userId,
      } as NewAgentTrigger)
      .returning();

    return trigger[0];
  }

  // Find trigger by ID (with user ownership check)
  async findById(id: string): Promise<AgentTrigger | null> {
    const result = await this.db
      .select()
      .from(agentTriggers)
      .where(and(eq(agentTriggers.id, id), eq(agentTriggers.userId, this.userId)))
      .limit(1);

    return result[0] || null;
  }

  // Find all triggers for a specific agent
  async findByAgentId(agentId: string): Promise<AgentTrigger[]> {
    return this.db
      .select()
      .from(agentTriggers)
      .where(and(eq(agentTriggers.agentId, agentId), eq(agentTriggers.userId, this.userId)))
      .orderBy(desc(agentTriggers.createdAt));
  }

  // Find all triggers for the user (across all agents)
  async findByUserId(): Promise<AgentTrigger[]> {
    return this.db
      .select()
      .from(agentTriggers)
      .where(eq(agentTriggers.userId, this.userId))
      .orderBy(desc(agentTriggers.lastExecutedAt));
  }

  // Find triggers by type
  async findByType(triggerType: string): Promise<AgentTrigger[]> {
    return this.db
      .select()
      .from(agentTriggers)
      .where(
        and(
          eq(agentTriggers.userId, this.userId),
          eq(agentTriggers.triggerType, triggerType),
        ),
      )
      .orderBy(desc(agentTriggers.createdAt));
  }

  // Find triggers by status (enabled/disabled)
  async findByStatus(enabled: boolean): Promise<AgentTrigger[]> {
    return this.db
      .select()
      .from(agentTriggers)
      .where(and(eq(agentTriggers.userId, this.userId), eq(agentTriggers.enabled, enabled)))
      .orderBy(desc(agentTriggers.createdAt));
  }

  // Get all enabled triggers (system-wide for execution)
  static async getEnabledTriggers(db: LobeChatDatabase): Promise<AgentTrigger[]> {
    return db
      .select()
      .from(agentTriggers)
      .where(
        and(
          eq(agentTriggers.enabled, true),
          or(gt(agentTriggers.remainingExecutions, 0), isNull(agentTriggers.remainingExecutions)),
        ),
      )
      .orderBy(agentTriggers.lastExecutedAt);
  }

  // Get enabled triggers by type (for workers)
  static async getEnabledTriggersByType(
    db: LobeChatDatabase,
    triggerType: string,
  ): Promise<AgentTrigger[]> {
    return db
      .select()
      .from(agentTriggers)
      .where(
        and(
          eq(agentTriggers.enabled, true),
          eq(agentTriggers.triggerType, triggerType),
          or(gt(agentTriggers.remainingExecutions, 0), isNull(agentTriggers.remainingExecutions)),
        ),
      )
      .orderBy(agentTriggers.lastExecutedAt);
  }

  // Update trigger
  async update(id: string, data: UpdateAgentTriggerData): Promise<AgentTrigger | null> {
    const current = await this.findById(id);
    if (!current) return null;

    const updateSet: any = { ...data, updatedAt: new Date() };

    // Recalculate nextScheduledAt when:
    // - Enabling: data.enabled = true && !current.enabled
    // - Changing pattern while enabled: data.triggerConfig && current.enabled
    // - Disabling: data.enabled = false

    if (data.enabled === true && !current.enabled) {
      // Enabling
      updateSet.nextScheduledAt = AgentTriggerModel.calculateNextScheduledAt(
        data.triggerType ?? current.triggerType,
        data.triggerConfig ?? current.triggerConfig,
        true,
      );
    } else if (data.enabled === false) {
      // Disabling
      updateSet.nextScheduledAt = null;
    } else if (data.triggerConfig && current.enabled) {
      // Pattern change while enabled
      updateSet.nextScheduledAt = AgentTriggerModel.calculateNextScheduledAt(
        current.triggerType,
        data.triggerConfig,
        true,
      );
    }

    const result = await this.db
      .update(agentTriggers)
      .set(updateSet)
      .where(and(eq(agentTriggers.id, id), eq(agentTriggers.userId, this.userId)))
      .returning();

    return result[0] || null;
  }

  // Delete trigger
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(agentTriggers)
      .where(and(eq(agentTriggers.id, id), eq(agentTriggers.userId, this.userId)))
      .returning();

    return result.length > 0;
  }

  // Update execution statistics after trigger execution
  static async updateExecutionStats(
    db: LobeChatDatabase,
    triggerId: string,
  ): Promise<AgentTrigger | null> {
    // Update execution statistics and decrement remaining executions
    const result = await db
      .update(agentTriggers)
      .set({
        lastExecutedAt: new Date(),
        remainingExecutions: sql`
          CASE
            WHEN ${agentTriggers.remainingExecutions} IS NULL THEN NULL
            ELSE ${agentTriggers.remainingExecutions} - 1
          END
        `,
        totalExecutions: sql`${agentTriggers.totalExecutions} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(agentTriggers.id, triggerId))
      .returning();

    const updatedTrigger = result[0];

    // Auto-disable trigger if remaining executions reached 0
    if (updatedTrigger && updatedTrigger.remainingExecutions === 0) {
      await db
        .update(agentTriggers)
        .set({
          enabled: false,
          updatedAt: new Date(),
        })
        .where(eq(agentTriggers.id, triggerId));

      // Return updated trigger with enabled = false
      return { ...updatedTrigger, enabled: false };
    }

    return updatedTrigger || null;
  }

  // Reset execution counts and re-enable trigger
  async resetExecutions(id: string, newMaxExecutions?: number): Promise<AgentTrigger | null> {
    const trigger = await this.findById(id);
    if (!trigger) return null;

    const nextScheduledAt = AgentTriggerModel.calculateNextScheduledAt(
      trigger.triggerType,
      trigger.triggerConfig,
      true,
    );

    const result = await this.db
      .update(agentTriggers)
      .set({
        enabled: true,
        maxExecutions: newMaxExecutions,
        remainingExecutions: newMaxExecutions,
        nextScheduledAt,
        updatedAt: new Date(),
      })
      .where(and(eq(agentTriggers.id, id), eq(agentTriggers.userId, this.userId)))
      .returning();

    return result[0] || null;
  }

  // Get triggers near depletion (warning system)
  async getTasksNearDepletion(threshold: number = 5): Promise<AgentTrigger[]> {
    return this.db
      .select()
      .from(agentTriggers)
      .where(
        and(
          eq(agentTriggers.userId, this.userId),
          eq(agentTriggers.enabled, true),
          gt(agentTriggers.remainingExecutions, 0),
          sql`${agentTriggers.remainingExecutions} <= ${threshold}`,
        ),
      )
      .orderBy(agentTriggers.remainingExecutions);
  }

  // Batch update status (enable/disable multiple triggers)
  async batchUpdateStatus(ids: string[], enabled: boolean): Promise<number> {
    if (enabled) {
      // Enabling requires per-trigger calculation of nextScheduledAt
      let updatedCount = 0;
      for (const id of ids) {
        await this.update(id, { enabled: true });
        updatedCount++;
      }
      return updatedCount;
    } else {
      // Disabling: bulk update with nextScheduledAt = null
      const result = await this.db
        .update(agentTriggers)
        .set({
          enabled: false,
          nextScheduledAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(agentTriggers.userId, this.userId), sql`${agentTriggers.id} = ANY(${ids})`))
        .returning();

      return result.length;
    }
  }

  // Get trigger statistics (for dashboard)
  async getExecutionStats(): Promise<{
    activeJobs: number;
    completedExecutions: number;
    pendingExecutions: number;
    totalJobs: number;
  }> {
    const result = await this.db
      .select({
        activeJobs: sql<number>`sum(case when ${agentTriggers.enabled} then 1 else 0 end)`,
        completedExecutions: sql<number>`sum(${agentTriggers.totalExecutions})`,
        pendingExecutions: sql<number>`
          sum(
            case when ${agentTriggers.remainingExecutions} is null then 999999
            else coalesce(${agentTriggers.remainingExecutions}, 0) end
          )
        `,
        totalJobs: sql<number>`count(*)`,
      })
      .from(agentTriggers)
      .where(eq(agentTriggers.userId, this.userId));

    const stats = result[0];
    return {
      activeJobs: Number(stats.activeJobs),
      completedExecutions: Number(stats.completedExecutions),
      pendingExecutions: Number(stats.pendingExecutions === 999_999 ? 0 : stats.pendingExecutions),
      totalJobs: Number(stats.totalJobs),
    };
  }

  // Find with pagination
  async findWithPagination(options: {
    agentId?: string;
    enabled?: boolean;
    limit?: number;
    offset?: number;
    triggerType?: string;
  }): Promise<{ data: AgentTrigger[]; total: number }> {
    const { agentId, enabled, limit = 20, offset = 0, triggerType } = options;

    const conditions = [eq(agentTriggers.userId, this.userId)];

    if (agentId) {
      conditions.push(eq(agentTriggers.agentId, agentId));
    }

    if (enabled !== undefined) {
      conditions.push(eq(agentTriggers.enabled, enabled));
    }

    if (triggerType) {
      conditions.push(eq(agentTriggers.triggerType, triggerType));
    }

    const whereClause = and(...conditions);

    // Get total count
    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentTriggers)
      .where(whereClause)
      .then((rows) => rows[0]?.count || 0);

    // Get paginated data
    const data = await this.db
      .select()
      .from(agentTriggers)
      .where(whereClause)
      .orderBy(desc(agentTriggers.createdAt))
      .limit(limit)
      .offset(offset);

    return { data, total };
  }
}

// For backward compatibility, export as AgentCronJobModel alias
export const AgentCronJobModel = AgentTriggerModel;
