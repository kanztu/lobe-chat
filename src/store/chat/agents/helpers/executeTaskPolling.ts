import type { AgentEvent, AgentState, TaskResultPayload } from '@lobechat/agent-runtime';
import debug from 'debug';

import { aiAgentService } from '@/services/aiAgent';
import type { ChatStore } from '@/store/chat/store';
import { sleep } from '@/utils/sleep';

const log = debug('lobe-store:agent-executors:task-polling');

export interface ExecTaskItem {
  /** Brief description of what this task does (shown in UI) */
  description: string;
  /** Whether to inherit context messages from parent conversation */
  inheritMessages?: boolean;
  /** Detailed instruction/prompt for the task execution */
  instruction: string;
  /**
   * Whether to execute the task on the client side (desktop only).
   * When true and running on desktop, the task will be executed locally
   * with access to local tools (file system, shell commands, etc.)
   */
  runInClient?: boolean;
  /** Timeout in milliseconds (optional, default 30 minutes) */
  timeout?: number;
}

export interface ExecuteTaskPollingParams {
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
  /** Task to execute */
  task: ExecTaskItem;
}

export interface ExecuteTaskPollingResult {
  events: AgentEvent[];
  newState: AgentState;
  payload: TaskResultPayload;
}

/**
 * Shared helper for executing and polling a single async task
 *
 * Flow:
 * 1. Create task message placeholder (role: 'task')
 * 2. Call execSubAgentTask API (backend creates thread)
 * 3. Poll for task completion
 * 4. Update task message with result
 * 5. Return task_result payload
 *
 * Used by both exec_task executor and call_tool executor
 */
export async function executeTaskPolling(
  params: ExecuteTaskPollingParams,
): Promise<ExecuteTaskPollingResult> {
  const { get, messageKey, operationId, parentMessageId, state, task } = params;

  const events: AgentEvent[] = [];
  const sessionLogId = `${operationId}:executeTaskPolling`;

  log('[%s] Starting task execution: %s', sessionLogId, task.description);

  // Get context from operation
  const operation = get().operations[operationId];
  if (!operation) {
    throw new Error(`Operation not found: ${operationId}`);
  }

  const { agentId, topicId } = operation.context;

  if (!agentId || !topicId) {
    log('[%s] No valid context, cannot execute task', sessionLogId);
    return {
      events,
      newState: state,
      payload: {
        parentMessageId,
        result: {
          error: 'No valid context available',
          success: false,
          taskMessageId: '',
          threadId: '',
        },
      },
    };
  }

  try {
    // 1. Create task message as placeholder
    const taskMessageResult = await get().optimisticCreateMessage(
      {
        agentId,
        content: '',
        metadata: { instruction: task.instruction, taskTitle: task.description },
        parentId: parentMessageId,
        role: 'task',
        topicId,
      },
      { operationId },
    );

    if (!taskMessageResult) {
      log('[%s] Failed to create task message', sessionLogId);
      return {
        events,
        newState: state,
        payload: {
          parentMessageId,
          result: {
            error: 'Failed to create task message',
            success: false,
            taskMessageId: '',
            threadId: '',
          },
        },
      };
    }

    const taskMessageId = taskMessageResult.id;
    log('[%s] Created task message: %s', sessionLogId, taskMessageId);

    // 2. Create and execute task on server
    log('[%s] Using server-side execution', sessionLogId);
    const createResult = await aiAgentService.execSubAgentTask({
      agentId,
      instruction: task.instruction,
      parentMessageId: taskMessageId,
      title: task.description,
      topicId,
    });

    if (!createResult.success) {
      log('[%s] Failed to create task: %s', sessionLogId, createResult.error);
      await get().optimisticUpdateMessageContent(
        taskMessageId,
        `Task creation failed: ${createResult.error}`,
        undefined,
        { operationId },
      );
      return {
        events,
        newState: state,
        payload: {
          parentMessageId,
          result: {
            error: createResult.error,
            success: false,
            taskMessageId,
            threadId: '',
          },
        },
      };
    }

    log('[%s] Task created with threadId: %s', sessionLogId, createResult.threadId);

    // 3. Poll for task completion
    const pollInterval = 3000; // 3 seconds
    const maxWait = task.timeout || 1_800_000; // Default 30 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // Check if parent operation has been cancelled
      const currentOperation = get().operations[operationId];
      if (currentOperation?.status === 'cancelled') {
        log('[%s] Operation cancelled, stopping polling', sessionLogId);

        // Send interrupt request to stop the server-side task
        try {
          await aiAgentService.interruptTask({ threadId: createResult.threadId });
          log('[%s] Sent interrupt request for cancelled task', sessionLogId);
        } catch (err) {
          log('[%s] Failed to interrupt cancelled task: %O', sessionLogId, err);
        }

        // Update task message to cancelled state
        await get().optimisticUpdateMessageContent(
          taskMessageId,
          'Task was cancelled by user.',
          undefined,
          { operationId },
        );

        const updatedMessages = get().dbMessagesMap[messageKey] || [];
        return {
          events,
          newState: { ...state, messages: updatedMessages },
          payload: {
            parentMessageId,
            result: {
              error: 'Operation cancelled',
              success: false,
              taskMessageId,
              threadId: createResult.threadId,
            },
          },
        };
      }

      const status = await aiAgentService.getSubAgentTaskStatus({
        threadId: createResult.threadId,
      });

      // Update taskDetail in message if available
      if (status.taskDetail) {
        get().internal_dispatchMessage(
          {
            id: taskMessageId,
            type: 'updateMessage',
            value: { taskDetail: status.taskDetail },
          },
          { operationId },
        );
        log('[%s] Updated task message with taskDetail', sessionLogId);
      }

      if (status.status === 'completed') {
        log('[%s] Task completed successfully', sessionLogId);
        if (status.result) {
          await get().optimisticUpdateMessageContent(taskMessageId, status.result, undefined, {
            operationId,
          });
        }
        const updatedMessages = get().dbMessagesMap[messageKey] || [];
        return {
          events,
          newState: { ...state, messages: updatedMessages },
          payload: {
            parentMessageId,
            result: {
              result: status.result,
              success: true,
              taskMessageId,
              threadId: createResult.threadId,
            },
          },
        };
      }

      if (status.status === 'failed') {
        const errorMessage = status.error || 'Unknown error';
        log('[%s] Task failed: %s', sessionLogId, errorMessage);
        await get().optimisticUpdateMessageContent(
          taskMessageId,
          `Task failed: ${errorMessage}`,
          undefined,
          { operationId },
        );
        const updatedMessages = get().dbMessagesMap[messageKey] || [];
        return {
          events,
          newState: { ...state, messages: updatedMessages },
          payload: {
            parentMessageId,
            result: {
              error: status.error,
              success: false,
              taskMessageId,
              threadId: createResult.threadId,
            },
          },
        };
      }

      if (status.status === 'cancel') {
        log('[%s] Task was cancelled', sessionLogId);
        await get().optimisticUpdateMessageContent(taskMessageId, 'Task was cancelled', undefined, {
          operationId,
        });
        const updatedMessages = get().dbMessagesMap[messageKey] || [];
        return {
          events,
          newState: { ...state, messages: updatedMessages },
          payload: {
            parentMessageId,
            result: {
              error: 'Task was cancelled',
              success: false,
              taskMessageId,
              threadId: createResult.threadId,
            },
          },
        };
      }

      // Still processing, wait and poll again
      await sleep(pollInterval);
    }

    // Timeout reached
    log('[%s] Task timeout after %dms', sessionLogId, maxWait);

    // Try to interrupt the task that timed out
    try {
      await aiAgentService.interruptTask({ threadId: createResult.threadId });
      log('[%s] Sent interrupt request for timed out task', sessionLogId);
    } catch (err) {
      log('[%s] Failed to interrupt timed out task: %O', sessionLogId, err);
    }

    await get().optimisticUpdateMessageContent(
      taskMessageId,
      `Task timeout after ${maxWait}ms`,
      undefined,
      { operationId },
    );

    const updatedMessages = get().dbMessagesMap[messageKey] || [];
    return {
      events,
      newState: { ...state, messages: updatedMessages },
      payload: {
        parentMessageId,
        result: {
          error: `Task timeout after ${maxWait}ms`,
          success: false,
          taskMessageId,
          threadId: createResult.threadId,
        },
      },
    };
  } catch (error) {
    log('[%s] Error executing task: %O', sessionLogId, error);
    return {
      events,
      newState: state,
      payload: {
        parentMessageId,
        result: {
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false,
          taskMessageId: '',
          threadId: '',
        },
      },
    };
  }
}
