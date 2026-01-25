import type { AgentEvent, AgentState, TasksBatchResultPayload } from '@lobechat/agent-runtime';
import debug from 'debug';

import { aiAgentService } from '@/services/aiAgent';
import type { ChatStore } from '@/store/chat/store';
import { sleep } from '@/utils/sleep';

import type { ExecTaskItem } from './executeTaskPolling';

const log = debug('lobe-store:agent-executors:tasks-polling');

export interface ExecuteTasksPollingParams {
  /** Store getter function */
  get: () => ChatStore;
  /** Message map key for fetching messages */
  messageKey: string;
  /** Operation ID for context and cancellation */
  operationId: string;
  /** Parent message ID (tool message) */
  parentMessageId: string;
  /** Current agent state */
  state: AgentState;
  /** Tasks to execute */
  tasks: ExecTaskItem[];
}

export interface ExecuteTasksPollingResult {
  events: AgentEvent[];
  newState: AgentState;
  payload: TasksBatchResultPayload;
}

/**
 * Task tracker for batch execution
 */
interface TaskTracker {
  agentId: string;
  error?: string;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  task: string;
  taskMessageId?: string;
  threadId?: string;
  timeout: number;
  title?: string;
}

/**
 * Shared helper for executing and polling multiple async tasks in parallel
 *
 * Flow:
 * 1. Create task messages for all tasks in parallel
 * 2. Call execSubAgentTask API for each task in parallel
 * 3. Poll for all tasks completion
 * 4. Update task messages with results
 * 5. Return tasks_batch_result payload
 *
 * Used by both exec_tasks executor and call_tool executor
 */
export async function executeTasksPolling(
  params: ExecuteTasksPollingParams,
): Promise<ExecuteTasksPollingResult> {
  const { get, messageKey, operationId, parentMessageId, state, tasks } = params;

  const events: AgentEvent[] = [];
  const sessionLogId = `${operationId}:executeTasksPolling`;

  log('[%s] Starting execution of %d tasks in parallel', sessionLogId, tasks.length);

  // Get context from operation
  const operation = get().operations[operationId];
  if (!operation) {
    throw new Error(`Operation not found: ${operationId}`);
  }

  const { agentId, topicId } = operation.context;

  if (!agentId || !topicId) {
    log('[%s] No valid context, cannot execute tasks', sessionLogId);
    return {
      events,
      newState: state,
      payload: {
        parentMessageId,
        results: tasks.map((t) => ({
          error: 'No valid context available',
          success: false,
          taskMessageId: '',
          threadId: '',
        })),
      },
    };
  }

  // Track all tasks with their messages and thread IDs
  const taskTrackers: TaskTracker[] = tasks.map((t) => ({
    agentId,
    status: 'pending' as const,
    task: t.instruction,
    timeout: t.timeout || 1_800_000, // Default 30 minutes
    title: t.description,
  }));

  try {
    // 1. Create task messages for all tasks in parallel
    await Promise.all(
      taskTrackers.map(async (tracker, index) => {
        const taskLogId = `${sessionLogId}:task-${index}`;
        try {
          const taskMessageResult = await get().optimisticCreateMessage(
            {
              agentId: tracker.agentId,
              content: '',
              metadata: { instruction: tracker.task, taskTitle: tracker.title },
              parentId: parentMessageId,
              role: 'task',
              topicId,
            },
            { operationId },
          );

          if (taskMessageResult) {
            tracker.taskMessageId = taskMessageResult.id;
            log('[%s] Created task message: %s', taskLogId, tracker.taskMessageId);
          } else {
            tracker.status = 'failed';
            tracker.error = 'Failed to create task message';
            console.error('[%s] Failed to create task message', taskLogId);
          }
        } catch (error) {
          tracker.status = 'failed';
          tracker.error = error instanceof Error ? error.message : 'Unknown error';
          console.error('[%s] Error creating task message: %O', taskLogId, error);
        }
      }),
    );

    // 2. Start all tasks in parallel via backend API
    await Promise.all(
      taskTrackers.map(async (tracker, index) => {
        if (tracker.status === 'failed' || !tracker.taskMessageId) return;

        const taskLogId = `${sessionLogId}:task-${index}`;
        try {
          const createResult = await aiAgentService.execSubAgentTask({
            agentId: tracker.agentId,
            instruction: tracker.task,
            parentMessageId: tracker.taskMessageId,
            title: tracker.title,
            topicId,
          });

          if (createResult.success) {
            tracker.threadId = createResult.threadId;
            tracker.status = 'running';
            log('[%s] Task started with threadId: %s', taskLogId, tracker.threadId);
          } else {
            tracker.status = 'failed';
            tracker.error = createResult.error;
            log('[%s] Failed to start task: %s', taskLogId, createResult.error);
            // Update task message with error
            await get().optimisticUpdateMessageContent(
              tracker.taskMessageId,
              `Task creation failed: ${createResult.error}`,
              undefined,
              { operationId },
            );
          }
        } catch (error) {
          tracker.status = 'failed';
          tracker.error = error instanceof Error ? error.message : 'Unknown error';
          console.error('[%s] Error starting task: %O', taskLogId, error);
        }
      }),
    );

    // 3. Poll for all tasks completion
    const pollInterval = 3000; // 3 seconds
    const startTime = Date.now();
    const maxTimeout = Math.max(...taskTrackers.map((t) => t.timeout));

    while (Date.now() - startTime < maxTimeout) {
      // Check if operation has been cancelled
      const currentOperation = get().operations[operationId];
      if (currentOperation?.status === 'cancelled') {
        console.warn('[%s] Operation cancelled, stopping polling', sessionLogId);
        return {
          events,
          newState: { ...state, status: 'done' },
          payload: {
            parentMessageId,
            results: taskTrackers.map((t) => ({
              error: t.status === 'running' ? 'Operation cancelled' : t.error,
              result: t.result,
              success: t.status === 'completed',
              taskMessageId: t.taskMessageId || '',
              threadId: t.threadId || '',
            })),
          },
        };
      }

      // Check status of all running tasks
      const runningTasks = taskTrackers.filter((t) => t.status === 'running');
      if (runningTasks.length === 0) {
        // All tasks have completed or failed
        break;
      }

      await Promise.all(
        runningTasks.map(async (tracker, index) => {
          if (!tracker.threadId || !tracker.taskMessageId) return;

          const taskLogId = `${sessionLogId}:task-${index}`;
          try {
            const status = await aiAgentService.getSubAgentTaskStatus({
              threadId: tracker.threadId,
            });

            // Update taskDetail in message if available
            if (status.taskDetail) {
              get().internal_dispatchMessage(
                {
                  id: tracker.taskMessageId,
                  type: 'updateMessage',
                  value: { taskDetail: status.taskDetail },
                },
                { operationId },
              );
            }

            switch (status.status) {
              case 'completed': {
                tracker.status = 'completed';
                tracker.result = status.result;
                log('[%s] Task completed successfully', taskLogId);
                if (status.result) {
                  await get().optimisticUpdateMessageContent(
                    tracker.taskMessageId,
                    status.result,
                    undefined,
                    { operationId },
                  );
                }
                break;
              }
              case 'failed': {
                tracker.status = 'failed';
                tracker.error = status.error;
                console.error('[%s] Task failed: %s', taskLogId, status.error);
                await get().optimisticUpdateMessageContent(
                  tracker.taskMessageId,
                  `Task failed: ${status.error}`,
                  undefined,
                  { operationId },
                );
                break;
              }
              case 'cancel': {
                tracker.status = 'failed';
                tracker.error = 'Task was cancelled';
                log('[%s] Task was cancelled', taskLogId);
                await get().optimisticUpdateMessageContent(
                  tracker.taskMessageId,
                  'Task was cancelled',
                  undefined,
                  { operationId },
                );
                break;
              }
              // No default
            }

            // Check individual task timeout
            if (tracker.status === 'running' && Date.now() - startTime > tracker.timeout) {
              tracker.status = 'failed';
              tracker.error = `Task timeout after ${tracker.timeout}ms`;
              log('[%s] Task timeout', taskLogId);
              await get().optimisticUpdateMessageContent(
                tracker.taskMessageId,
                `Task timeout after ${tracker.timeout}ms`,
                undefined,
                { operationId },
              );
            }
          } catch (error) {
            console.error('[%s] Error polling task status: %O', taskLogId, error);
          }
        }),
      );

      // Wait before next poll
      await sleep(pollInterval);
    }

    // Mark any remaining running tasks as timed out
    for (const tracker of taskTrackers) {
      if (tracker.status === 'running' && tracker.taskMessageId) {
        tracker.status = 'failed';
        tracker.error = `Task timeout after ${tracker.timeout}ms`;
        await get().optimisticUpdateMessageContent(
          tracker.taskMessageId,
          `Task timeout after ${tracker.timeout}ms`,
          undefined,
          { operationId },
        );
      }
    }

    log('[%s] All tasks completed', sessionLogId);

    return {
      events,
      newState: state,
      payload: {
        parentMessageId,
        results: taskTrackers.map((t) => ({
          error: t.error,
          result: t.result,
          success: t.status === 'completed',
          taskMessageId: t.taskMessageId || '',
          threadId: t.threadId || '',
        })),
      },
    };
  } catch (error) {
    log('[%s] Error executing tasks: %O', sessionLogId, error);
    return {
      events,
      newState: state,
      payload: {
        parentMessageId,
        results: tasks.map((t) => ({
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false,
          taskMessageId: '',
          threadId: '',
        })),
      },
    };
  }
}
