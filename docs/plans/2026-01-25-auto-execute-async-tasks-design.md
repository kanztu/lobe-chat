# Design: Auto-Execute Async Tasks in Single Chat

## Problem Statement

When an agent in single chat calls the `execTask` tool from the lobe-gtd plugin:
1. Tool creates async task on backend and returns `{stop: true, state: {type: 'execTask', ...}}`
2. `call_tool` executor detects this and returns `tool_result` phase
3. **Agent execution stops** - user sees "Task created: ..." and agent waits for user response
4. The `exec_task` executor that should poll for task status **never runs**
5. Task runs in background but no one checks results or reports back to user

**Root cause**: The agent runtime doesn't automatically convert `execTask` state into `exec_task` instruction. It expects the LLM to decide the next action, but this is a system-level handoff that shouldn't require LLM decision-making.

## Solution Design

### Approach

**Auto-invoke the task executor** when `call_tool` detects async task state types. Instead of returning `tool_result` phase and waiting, directly execute the polling logic.

### Architecture

#### Current Flow (Broken)
```
User → Agent → execTask tool
              ↓
         stop=true, state={type: 'execTask', task, parentMessageId}
              ↓
         call_tool returns phase: 'tool_result'
              ↓
         ❌ Runtime waits for next instruction (never comes)
```

#### New Flow (Fixed)
```
User → Agent → execTask tool
              ↓
         stop=true, state={type: 'execTask', task, parentMessageId}
              ↓
         call_tool detects execTask state
              ↓
         ✅ Directly invokes exec_task executor logic
              ↓
         Polls backend → Task completes → Returns task_result
              ↓
         Runtime continues → Agent receives result → Responds to user
```

###Implementation Strategy

Since executors cannot directly call each other during object construction, we'll extract the polling logic into a shared helper function that both the `exec_task` executor and the `call_tool` executor can use.

#### File Structure
```
src/store/chat/agents/
├── createAgentExecutors.ts         # Main executors
├── helpers/
│   └── executeTaskPolling.ts       # Shared task polling logic (NEW)
```

#### executeTaskPolling.ts

```typescript
/**
 * Shared helper for executing and polling async tasks
 * Used by both exec_task executor and call_tool executor
 *
 * Handles:
 * - Creating task message placeholder
 * - Calling backend API
 * - Polling for completion
 * - Updating message with results
 * - Cancellation handling
 */
export async function executeTaskPolling(params: {
  task: ExecTaskItem;
  parentMessageId: string;
  state: AgentState;
  context: ExecutorContext;
  operationId: string;
}): Promise<ExecutorOutput>;
```

#### Changes to createAgentExecutors.ts

1. **call_tool executor** (lines 595-620):
   - When detects `execTask/execTasks/execClientTask/execClientTasks` state
   - Instead of returning `tool_result` phase
   - Call `executeTaskPolling()` for single tasks or `executeTasksPolling()` for batch
   - Return the polling result directly

2. **exec_task executor** (lines 915-1290):
   - Refactor to use `executeTaskPolling()` helper
   - Keep same external interface
   - Reduce code duplication

3. **exec_tasks executor** (lines 1295+):
   - Refactor to use `executeTasksPolling()` helper
   - Keep same external interface

### State Mapping

**From tool result state** → **To executor instruction**:

```typescript
// Tool returns (ExecTaskState):
{
  type: 'execTask',
  parentMessageId: 'tool_msg_123',
  task: {
    description: 'Analyze codebase',
    instruction: 'Find all React components',
    timeout: 300000
  }
}

// Transform to exec_task instruction:
{
  type: 'exec_task',
  payload: {
    parentMessageId: 'tool_msg_123',
    task: {
      description: 'Analyze codebase',
      instruction: 'Find all React components',
      timeout: 300000
    }
  }
}
```

### Handling All Task Types

| State Type | Executor | Helper Function |
|------------|----------|-----------------|
| `execTask` | `exec_task` | `executeTaskPolling` (server) |
| `execTasks` | `exec_tasks` | `executeTasksPolling` (server) |
| `execClientTask` | `exec_task` | `executeTaskPolling` (client) |
| `execClientTasks` | `exec_tasks` | `executeTasksPolling` (client) |

All four types follow the same pattern - the helper functions handle both server and client execution based on the task configuration.

### Error Handling

- Task creation fails → Return error immediately, update message
- Task timeout → Cancel backend task, return timeout error
- Operation cancelled → Send interrupt to backend, update message
- Polling errors → Retry with exponential backoff (up to 3 times)

### Testing Strategy

1. **Unit tests**: Test `executeTaskPolling` helper in isolation
2. **Integration tests**: Test call_tool → task execution flow
3. **Edge cases**: Cancellation, timeout, errors during polling
4. **Regression tests**: Ensure existing exec_task/exec_tasks still work

## Benefits

1. **No runtime changes needed** - Works with existing @lobechat/agent-runtime
2. **Transparent to LLM** - Agent doesn't need to understand task execution mechanics
3. **Code reuse** - Shared helper eliminates duplication
4. **Consistent behavior** - Same polling logic everywhere
5. **Maintains existing API** - exec_task/exec_tasks executors still work independently

## Implementation Checklist

- [ ] Create `src/store/chat/agents/helpers/executeTaskPolling.ts`
- [ ] Extract polling logic from `exec_task` executor
- [ ] Update `call_tool` to use polling helper for execTask states
- [ ] Update `exec_task` to use polling helper
- [ ] Create `executeTasksPolling` helper for batch tasks
- [ ] Update `exec_tasks` to use batch polling helper
- [ ] Add comprehensive tests
- [ ] Update type definitions if needed
- [ ] Test in both single chat and group chat scenarios

## Related Files

- `src/store/chat/agents/createAgentExecutors.ts` - Main executor definitions
- `packages/builtin-tool-gtd/src/executor/index.ts` - Tool implementation
- `packages/builtin-tool-gtd/src/types.ts` - State type definitions
- `src/services/aiAgent/index.ts` - Backend API calls
