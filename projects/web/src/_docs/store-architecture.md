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

Repo, task, comment, plan-cancel, turn, review, queued-turn, environment-setup, and preview-usage mutations should enter through `CodeStore` product helpers such as `startProductTurn()`, `updateProductTaskMetadata()`, and `createProductComment()`. When runtime product reads are active, those helpers use the injected `OpenADEProductStore`; otherwise they fall back to `runtime/localOpenADEClient.ts` and the legacy Yjs refresh path. The renderer store is a cache/view over persisted product state and should refresh through runtime DTO helpers or explicit legacy `refresh*FromStorage()` calls only on the fallback path.

### Task Scoped Git Reads

The classic desktop changes tray stays on `TaskPage`/`ChangesManager`, but runtime-backed reads should use `CodeStore.readProductTaskChanges()`, `readProductTaskDiff()`, and `readProductTaskFilePair()` through `TaskModel`. The classic Git Log tray should use `CodeStore.readProductTaskGitLog()`, `readProductTaskGitCommitFiles()`, `readProductTaskGitFileAtTreeish()`, and `readProductTaskGitCommitFilePatch()` for task-scoped branch history/details. Raw `gitApi` calls remain the trusted-local fallback only for scope discovery and non-task worktree scopes that are not product-scoped yet.

### Task Snapshot Reads

The classic desktop snapshot event UI stays on `SnapshotEventItem` and `ViewPatch`, but external patch, index, and slice reads should use `CodeStore.readProductTaskSnapshotPatch()`, `readProductTaskSnapshotIndex()`, and `readProductTaskSnapshotPatchSlice()` when runtime product reads are active. Raw `snapshotsApi` reads are the trusted-local fallback only.

## Environment Classes

**RepoEnvironment** - Repo-level git operations. Cached in RepoManager.

**TaskEnvironment** - Task-level git operations. Cached in TaskModel per device. Has static `setup()` method for idempotent environment initialization.

Both are thin wrappers around electron git API calls.

## Where to Look

| Need | File |
|------|------|
| Task observable state | `store/TaskModel.ts` |
| Event observable state | `store/EventModel.ts` |
| Task execution and product mutations | `store/store.ts` product helpers |
| Available commands (Plan, Do, etc.) | `store/managers/InputManager.ts` |
| Comment tracking | `store/managers/CommentManager.ts` |

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
