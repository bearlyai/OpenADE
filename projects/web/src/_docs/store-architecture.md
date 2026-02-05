# Store Architecture

MobX store with nested managers. Main file: `store/store.ts`.

## Structure

```
CodeStore (lightweight coordinator)
├── repos: RepoManager         # Repo CRUD, caches RepoEnvironment
├── tasks: TaskManager         # Task CRUD, caches TaskModel
├── events: EventManager       # Event operations
├── execution: ExecutionManager # Runs Claude, fires after-event hooks
├── comments: CommentManager   # Comment CRUD
├── queries: QueryManager      # Active query tracking, abort
├── creation: TaskCreationManager
├── notifications: NotificationManager
├── ui: UIStateManager
└── workingTaskIds: Set        # Cross-cutting "is executing" state
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
ExecutionManager broadcasts when events complete:

```typescript
this.store.execution.onAfterEvent((taskId, eventType) => {
    // TaskManager uses this to mark tasks as having new events
    // TaskModel uses this to refresh git status
})
```

Returns a disposer function - store it and call it on cleanup.

### Cache Invalidation
When task data changes significantly, call `TaskManager.invalidateTaskModel(taskId)`. This disposes the old model and removes it from cache - next access creates fresh one.

### Working State
`codeStore.setTaskWorking(taskId, true/false)` tracks which tasks are executing. Check with `codeStore.isTaskWorking(taskId)` or `codeStore.isWorking` (any task).

## Environment Classes

**RepoEnvironment** - Repo-level git operations. Cached in RepoManager.

**TaskEnvironment** - Task-level git operations. Cached in TaskModel per device. Has static `setup()` method for idempotent environment initialization.

Both are thin wrappers around electron git API calls.

## Where to Look

| Need | File |
|------|------|
| Task observable state | `store/TaskModel.ts` |
| Event observable state | `store/EventModel.ts` |
| Claude execution flow | `store/managers/ExecutionManager.ts` |
| Available commands (Plan, Do, etc.) | `store/managers/InputManager.ts` |
| Comment tracking | `store/managers/CommentManager.ts` |

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
