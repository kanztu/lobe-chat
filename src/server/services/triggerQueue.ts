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

  const values = {
    agentId,
    attempts: 0,
    idempotencyKey: idempotencyKey || null,
    maxAttempts,
    prompt,
    scheduledAt: new Date(),
    status: 'pending' as const,
    triggerId,
    triggerPayload: payload,
    userId,
  };

  if (idempotencyKey) {
    // Use ON CONFLICT for atomic idempotency
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

  try {
    const job = await db
      .insert(agentTriggerQueue)
      .values(values)
      .returning()
      .then((rows) => rows[0]);

    console.log(`Enqueued job ${job.id} for trigger ${triggerId}`);
    return job;
  } catch (error: any) {
    // Handle unique constraint violation (race condition with idempotency key)
    if (error?.code === '23505' && idempotencyKey) {
      const existing = await db
        .select()
        .from(agentTriggerQueue)
        .where(eq(agentTriggerQueue.idempotencyKey, idempotencyKey))
        .limit(1)
        .then((rows) => rows[0]);
      if (existing) return existing;
    }
    throw error;
  }
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

  // Must wrap SELECT FOR UPDATE + status UPDATE in a single transaction
  // to hold the row lock while marking it as processing
  const result = await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT * FROM agent_trigger_queue
      WHERE status = 'pending'
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const row = rows.rows?.[0];
    if (!row) return undefined;

    // Mark as processing within the same transaction to hold the lock
    await tx.execute(sql`
      UPDATE agent_trigger_queue
      SET status = 'processing', started_at = NOW(), attempts = COALESCE(attempts, 0) + 1
      WHERE id = ${row.id}
    `);

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
  });

  return result;
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
    db.select({ count: sql<number>`count(*)` }).from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.status, 'pending'))
      .then((rows) => Number(rows[0]?.count ?? 0)),
    db.select({ count: sql<number>`count(*)` }).from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.status, 'processing'))
      .then((rows) => Number(rows[0]?.count ?? 0)),
    db.select({ count: sql<number>`count(*)` }).from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.status, 'completed'))
      .then((rows) => Number(rows[0]?.count ?? 0)),
    db.select({ count: sql<number>`count(*)` }).from(agentTriggerQueue)
      .where(eq(agentTriggerQueue.status, 'failed'))
      .then((rows) => Number(rows[0]?.count ?? 0)),
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
        sql`${agentTriggerQueue.status} IN ('completed', 'failed')`,
      ),
    )
    .returning();

  console.log(`Cleaned up ${deleted.length} old completed/failed jobs`);
  return deleted.length;
}

/**
 * Recover stale processing jobs that have been stuck for too long
 */
export async function recoverStaleJobs(timeoutMinutes: number = 15): Promise<number> {
  const db = await getServerDB();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const recovered = await db
    .update(agentTriggerQueue)
    .set({
      completedAt: new Date(),
      error: `Job timed out after ${timeoutMinutes} minutes`,
      status: 'failed' as const,
    })
    .where(
      and(
        eq(agentTriggerQueue.status, 'processing'),
        lte(agentTriggerQueue.startedAt, cutoff),
      ),
    )
    .returning();

  if (recovered.length > 0) {
    console.log(`[TriggerQueue] Recovered ${recovered.length} stale jobs`);
  }

  return recovered.length;
}
