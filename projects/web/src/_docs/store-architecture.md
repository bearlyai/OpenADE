# Store Architecture

MobX store with nested managers. Main file: `store/store.ts`.

## Structure

```
CodeStore (lightweight coordinator)
├── repos: RepoManager         # Repo CRUD, caches RepoEnvironment
├── tasks: TaskManager         # Task CRUD, caches TaskModel
├── events: EventManager       # Event readers and narrow metadata actions
├── execution: ExecutionManager # After-event subscriptions and plan cancellation
├── comments: CommentManager   # Comment CRUD through OpenADE runtime methods
├── queries: QueryManager      # Server-owned turn interrupt
├── creation: TaskCreationManager
├── notifications: NotificationManager
├── ui: UIStateManager
└── runtimes: RuntimeManager   # Runtime protocol lifecycle cache
```

Access via singleton: `codeStore.repos.getRepo(id)`, `codeStore.tasks.getTaskModel(id)`, etc.

## Key Patterns

### TaskModel
Observable wrapper around raw task data. Created on-demand, cached in TaskManager.

- Has `dispose()` - call when removing task
- Lazily creates `InputManager` for per-task input state
- Caches `TaskEnvironment` per device
- Subscribes to `execution.onAfterEvent` to refresh git status

### Event Hooks
Runtime-owned execution broadcasts task completion through `CodeStore` when a task leaves the working set. `ExecutionManager` keeps the subscription API:

```typescript
this.store.execution.onAfterEvent((taskId, eventType) => {
    // TaskModel uses this to refresh git status
})
```

Returns a disposer function - store it and call it on cleanup.

### Cache Invalidation
When task data changes significantly, call `TaskManager.invalidateTaskModel(taskId)`. This disposes the old model and removes it from cache - next access creates fresh one.

### Runtime State
Runtime lifecycle notifications update `RuntimeManager`. Check with `codeStore.isTaskRunning(taskId)` or `codeStore.isWorking` (any task). The renderer does not maintain its own mutable working-task set.

### Durable Mutations

Repo, task, comment, plan-cancel, and preview-usage mutations go through `runtime/localOpenADEClient.ts`. The renderer store is a cache/view over persisted Yjs documents and should refresh from runtime notifications or explicit `refresh*FromStorage()` calls after protocol writes.

## Environment Classes

**RepoEnvironment** - Repo-level git operations. Cached in RepoManager.

**TaskEnvironment** - Task-level git operations. Cached in TaskModel per device. Has static `setup()` method for idempotent environment initialization.

Both are thin wrappers around electron git API calls.

## Where to Look

| Need | File |
|------|------|
| Task observable state | `store/TaskModel.ts` |
| Event observable state | `store/EventModel.ts` |
| Task execution protocol client | `runtime/localOpenADEClient.ts` |
| Available commands (Plan, Do, etc.) | `store/managers/InputManager.ts` |
| Comment tracking | `store/managers/CommentManager.ts` |

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
