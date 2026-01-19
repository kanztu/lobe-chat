/**
 * Trigger Queue Worker
 * Polls for pending jobs and executes agents with retry logic
 * Also checks for due cron triggers and enqueues them
 */

import type { CronTriggerConfig, ExecutionConditions, TriggerQueueJob } from '@lobechat/types';
import { CronExpressionParser } from 'cron-parser';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { agentTriggers } from '@/database/schemas';
import { getServerDB } from '@/database/server';

import { AiAgentService } from '../services/aiAgent';
import { enqueueTriggerJob, getNextPendingJob, retryJob, updateJobStatus } from '../services/triggerQueue';

export class TriggerQueueWorker {
  private isRunning = false;

  async start() {
    if (this.isRunning) {
      console.warn('⚠️  Worker already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Trigger Queue Worker started');

    // Run both loops in parallel
    await Promise.all([this.cronSchedulerLoop(), this.queueProcessorLoop()]);
  }

  /**
   * Checks for due cron triggers and enqueues them
   */
  private async cronSchedulerLoop() {
    while (this.isRunning) {
      try {
        const db = await getServerDB();

        // Get all enabled cron triggers
        const cronTriggers = await db
          .select()
          .from(agentTriggers)
          .where(
            and(
              eq(agentTriggers.enabled, true),
              eq(agentTriggers.triggerType, 'cron'),
              or(
                gt(agentTriggers.remainingExecutions, 0),
                isNull(agentTriggers.remainingExecutions),
              ),
            ),
          );

        const now = new Date();

        // Check which triggers are due
        for (const trigger of cronTriggers) {
          try {
            const config = trigger.triggerConfig as CronTriggerConfig;

            // Parse cron pattern
            const interval = CronExpressionParser.parse(config.cronPattern, {
              currentDate: trigger.lastExecutedAt || new Date(0),
              tz: config.timezone || 'UTC',
            });

            const nextRun = interval.next().toDate();

            // Is it time to run?
            if (nextRun <= now) {
              // Check execution conditions
              if (!this.checkExecutionConditions(trigger.executionConditions || undefined)) {
                continue;
              }

              // Enqueue job
              await enqueueTriggerJob({
                agentId: trigger.agentId,
                payload: null,
                prompt: trigger.content,
                triggerId: trigger.id,
                userId: trigger.userId,
              });

              console.log(`✅ Enqueued cron trigger ${trigger.id} (${trigger.name || 'Unnamed'})`);
            }
          } catch (error) {
            console.error(`Error checking cron trigger ${trigger.id}:`, error);
          }
        }

        // Check every 30 seconds
        await this.sleep(30_000);
      } catch (error) {
        console.error('Cron scheduler error:', error);
        await this.sleep(60_000);
      }
    }
  }

  /**
   * Processes queued jobs
   */
  private async queueProcessorLoop() {
    while (this.isRunning) {
      try {
        // Get next pending job
        const job = await getNextPendingJob();

        if (job) {
          await this.processJob(job);
        } else {
          // No jobs, wait 1 second
          await this.sleep(1000);
        }
      } catch (error) {
        console.error('Queue processor error:', error);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: TriggerQueueJob) {
    const db = await getServerDB();

    try {
      // Mark as processing
      await updateJobStatus(job.id, 'processing', {
        attempts: (job.attempts || 0) + 1,
        startedAt: new Date(),
      });

      console.log(`🔄 Processing job ${job.id} for trigger ${job.triggerId}`);

      // Execute agent
      const aiAgentService = new AiAgentService(db, job.userId);

      const result = await aiAgentService.execAgent({
        agentId: job.agentId,
        autoStart: true,
        prompt: job.prompt,
        trigger: 'trigger',
        triggerId: job.triggerId,
      });

      // Mark as completed
      await updateJobStatus(job.id, 'completed', {
        completedAt: new Date(),
        topicId: result.topicId,
      });

      // Update trigger stats
      await db
        .update(agentTriggers)
        .set({
          enabled: sql`
            CASE
              WHEN ${agentTriggers.remainingExecutions} <= 1 THEN FALSE
              ELSE ${agentTriggers.enabled}
            END
          `,
          lastExecutedAt: new Date(),
          remainingExecutions: sql`
            CASE
              WHEN ${agentTriggers.remainingExecutions} IS NULL THEN NULL
              ELSE GREATEST(${agentTriggers.remainingExecutions} - 1, 0)
            END
          `,
          totalExecutions: sql`${agentTriggers.totalExecutions} + 1`,
        })
        .where(eq(agentTriggers.id, job.triggerId));

      console.log(`✅ Completed job ${job.id}`);
    } catch (error) {
      console.error(`❌ Job ${job.id} failed:`, error);

      // Retry logic
      const attempts = job.attempts || 0;
      const maxAttempts = job.maxAttempts || 3;
      if (attempts < maxAttempts) {
        await retryJob(job.id, attempts);
        console.log(
          `🔄 Retrying job ${job.id} (attempt ${attempts + 1}/${maxAttempts})`,
        );
      } else {
        // Max retries exceeded
        await updateJobStatus(job.id, 'failed', {
          completedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Check execution conditions
   */
  private checkExecutionConditions(conditions?: ExecutionConditions): boolean {
    if (!conditions) return true;

    const now = new Date();

    // Check time range
    if (conditions.timeRange) {
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (time < conditions.timeRange.start || time > conditions.timeRange.end) {
        return false;
      }
    }

    // Check weekdays (0=Sunday, 1=Monday, etc.)
    if (conditions.weekdays?.length && !conditions.weekdays.includes(now.getDay())) {
        return false;
      }

    // TODO: Check maxExecutionsPerDay

    return true;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  stop() {
    this.isRunning = false;
    console.log('🛑 Trigger Queue Worker stopped');
  }
}

// Export singleton instance
export const triggerQueueWorker = new TriggerQueueWorker();
