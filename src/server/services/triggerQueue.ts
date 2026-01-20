/**
 * Trigger Queue Service
 * Manages async execution of agent triggers with retry logic and idempotency
 */

import type { EnqueueJobParams, TriggerQueueJob, TriggerQueueStatus } from '@lobechat/types';
import { and, eq, lte, sql } from 'drizzle-orm';

import { agentTriggerQueue } from '@/database/schemas';
import { getServerDB } from '@/database/server';

/**
 * Enqueues a trigger job for async execution
 *
 * @param params - Job parameters
 * @returns Created job record
 */
export async function enqueueTriggerJob(
  params: EnqueueJobParams,
): Promise<TriggerQueueJob> {
  const {
    agentId,
    idempotencyKey,
    maxAttempts = 3,
    payload,
    prompt,
    triggerId,
    userId,
  } = params;

  const db = await getServerDB();

  // Check idempotency
  if (idempotencyKey) {
    const existing = await db
      .select()
      .from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.idempotencyKey, idempotencyKey))
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      console.log(`Duplicate job prevented: idempotency key ${idempotencyKey}`);
      return existing;
    }
  }

  // Insert job
  const job = await db
    .insert(agentTriggerQueue)
    .values({
      agentId,
      attempts: 0,
      idempotencyKey: idempotencyKey || null,
      maxAttempts,
      prompt,
      scheduledAt: new Date(),
      status: 'pending',
      triggerId,
      triggerPayload: payload,
      userId,
    })
    .returning()
    .then((rows) => rows[0]);

  console.log(`Enqueued job ${job.id} for trigger ${triggerId}`);
  return job;
}

/**
 * Gets next pending job from queue (with locking for multiple workers)
 *
 * Uses FOR UPDATE SKIP LOCKED to prevent race conditions when multiple workers
 * are polling the same queue. Only one worker will get each job.
 *
 * @returns Next pending job or undefined
 */
export async function getNextPendingJob(): Promise<TriggerQueueJob | undefined> {
  const db = await getServerDB();

  // Use raw SQL for FOR UPDATE SKIP LOCKED support
  // This prevents multiple workers from grabbing the same job
  const result = await db.execute(sql`
    SELECT * FROM agent_trigger_queue
    WHERE status = 'pending'
      AND scheduled_at <= NOW()
    ORDER BY scheduled_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `);

  const row = result.rows[0];
  if (!row) return undefined;

  // Map snake_case database columns to camelCase TypeScript properties
  // Raw SQL returns columns in snake_case but TypeScript expects camelCase
  return {
    agentId: row.agent_id,
    attempts: row.attempts,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    error: row.error,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    maxAttempts: row.max_attempts,
    prompt: row.prompt,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    status: row.status,
    topicId: row.topic_id,
    triggerId: row.trigger_id,
    triggerPayload: row.trigger_payload,
    userId: row.user_id,
  } as TriggerQueueJob;
}

/**
 * Updates job status
 *
 * @param jobId - Job ID
 * @param status - New status
 * @param updates - Additional fields to update
 * @returns Updated job record
 */
export async function updateJobStatus(
  jobId: string,
  status: TriggerQueueStatus,
  updates: Partial<{
    attempts: number;
    completedAt: Date;
    error: string;
    startedAt: Date;
    topicId: string;
  }> = {},
): Promise<TriggerQueueJob> {
  const db = await getServerDB();

  return db
    .update(agentTriggerQueue)
    .set({
      status,
      ...updates,
    })
    .where(eq(agentTriggerQueue.id, jobId))
    .returning()
    .then((rows) => rows[0]);
}

/**
 * Retries a failed job with exponential backoff
 *
 * @param jobId - Job ID to retry
 * @param currentAttempts - Current number of attempts
 * @returns Updated job record
 */
export async function retryJob(jobId: string, currentAttempts: number): Promise<TriggerQueueJob> {
  const db = await getServerDB();

  // Exponential backoff: 2^attempts * 1000ms (max 60s)
  const delay = Math.min(1000 * 2 ** currentAttempts, 60_000);
  const scheduledAt = new Date(Date.now() + delay);

  return db
    .update(agentTriggerQueue)
    .set({
      scheduledAt,
      status: 'pending',
    })
    .where(eq(agentTriggerQueue.id, jobId))
    .returning()
    .then((rows) => rows[0]);
}

/**
 * Gets all jobs for a trigger
 *
 * @param triggerId - Trigger ID
 * @param limit - Max number of jobs to return
 * @returns Array of jobs
 */
export async function getJobsByTrigger(
  triggerId: string,
  limit: number = 50,
): Promise<TriggerQueueJob[]> {
  const db = await getServerDB();

  return db
    .select()
    .from(agentTriggerQueue)
    .where(eq(agentTriggerQueue.triggerId, triggerId))
    .orderBy(agentTriggerQueue.createdAt)
    .limit(limit);
}

/**
 * Gets queue statistics
 *
 * @returns Object with queue statistics
 */
export async function getQueueStats(): Promise<{
  completed: number;
  failed: number;
  pending: number;
  processing: number;
}> {
  const db = await getServerDB();

  const [pending, processing, completed, failed] = await Promise.all([
    db
      .select()
      .from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.status, 'pending'))
      .then((rows) => rows.length),
    db
      .select()
      .from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.status, 'processing'))
      .then((rows) => rows.length),
    db
      .select()
      .from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.status, 'completed'))
      .then((rows) => rows.length),
    db
      .select()
      .from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.status, 'failed'))
      .then((rows) => rows.length),
  ]);

  return {
    completed,
    failed,
    pending,
    processing,
  };
}

/**
 * Cleans up old completed/failed jobs
 *
 * @param olderThanDays - Delete jobs older than this many days
 * @returns Number of deleted jobs
 */
export async function cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
  const db = await getServerDB();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const deleted = await db
    .delete(agentTriggerQueue)
    .where(
      and(
        lte(agentTriggerQueue.completedAt, cutoffDate),
        eq(agentTriggerQueue.status, 'completed'),
      ),
    )
    .returning();

  console.log(`Cleaned up ${deleted.length} old completed jobs`);
  return deleted.length;
}
