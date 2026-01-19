/**
 * Webhook Trigger API Endpoint
 * Receives webhook events and enqueues agent execution
 */

import type { WebhookTriggerConfig } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { agentTriggers } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { enqueueTriggerJob } from '@/server/services/triggerQueue';
import { interpolatePrompt } from '@/utils/template';

/**
 * Verifies HMAC SHA256 signature
 */
async function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { hash: 'SHA-256', name: 'HMAC' },
      false,
      ['sign'],
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(body),
    );

    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Support both "sha256=..." and raw hex formats
    const receivedSignature = signature.startsWith('sha256=')
      ? signature.slice(7)
      : signature;

    return expectedSignature === receivedSignature;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Checks rate limit (placeholder - implement with Redis)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function checkWebhookRateLimit(_triggerId: string, _userId: string): Promise<boolean> {
  // TODO: Implement proper rate limiting with Redis
  // For now, allow all requests
  return true;
}

/**
 * Webhook POST handler
 * Validates signature, extracts payload, interpolates prompt, and enqueues execution
 */
export async function POST(
  request: Request,
  { params }: { params: { triggerId: string } },
) {
  try {
    const triggerId = params.triggerId;

    // 1. Load trigger config
    const db = await getServerDB();
    const trigger = await db
      .select()
      .from(agentTriggers)
      .where(eq(agentTriggers.id, triggerId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!trigger || !trigger.enabled) {
      return NextResponse.json(
        { error: 'Trigger not found or disabled' },
        { status: 404 },
      );
    }

    if (trigger.triggerType !== 'webhook') {
      return NextResponse.json(
        { error: 'Not a webhook trigger' },
        { status: 400 },
      );
    }

    const config = trigger.triggerConfig as WebhookTriggerConfig;

    // 2. Verify HMAC signature and get payload
    let payload: any;
    if (config.secret) {
      const signature = request.headers.get('X-Webhook-Signature');
      const body = await request.text();

      const isValid = await verifyWebhookSignature(body, signature, config.secret);

      if (!isValid) {
        console.warn(`Invalid signature for trigger ${triggerId}`);
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 },
        );
      }

      // Parse payload from body
      payload = JSON.parse(body);
    } else {
      // 3. Parse payload directly if no signature check
      payload = await request.json();
    }

    // 4. Check rate limit
    const canExecute = await checkWebhookRateLimit(trigger.id, trigger.userId);
    if (!canExecute) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 },
      );
    }

    // 5. Interpolate prompt with payload data
    const prompt = interpolatePrompt(
      trigger.content,
      payload,
      config.payloadMapping,
    );

    // 6. Enqueue job (async execution)
    const job = await enqueueTriggerJob({
      agentId: trigger.agentId,
      idempotencyKey: request.headers.get('X-Idempotency-Key') || undefined,
      payload,
      prompt,
      triggerId: trigger.id,
      userId: trigger.userId,
    });

    // 7. Return immediately (don't wait for agent)
    return NextResponse.json({
      jobId: job.id,
      message: 'Agent execution queued',
      success: true,
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}