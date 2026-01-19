/**
 * Trigger Queue Service
 * Manages async execution of agent triggers with retry logic and idempotency
 */

import type { EnqueueJobParams, TriggerQueueJob, TriggerQueueStatus } from '@lobechat/types';
import { and, eq, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';

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
 * Gets next pending job from queue
 *
 * @returns Next pending job or undefined
 */
export async function getNextPendingJob(): Promise<TriggerQueueJob | undefined> {
  const db = await getServerDB();

  return db
    .select()
    .from(agentTriggerQueue)
    .where(
      and(
        eq(agentTriggerQueue.status, 'pending'),
        lte(agentTriggerQueue.scheduledAt, new Date()),
      ),
    )
    .orderBy(agentTriggerQueue.scheduledAt)
    .limit(1)
    .then((rows) => rows[0]);
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
  const delay = Math.min(1000 * 2 ** currentAttempts, 60000);
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
