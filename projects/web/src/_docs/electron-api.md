# Electron API Layer

IPC wrappers in `electronAPI/` communicate with Electron main process handlers in `projects/electron/src/modules/code/`.

## Module Summary

| Module | What It Does |
|--------|--------------|
| `claude.ts` | Claude Agent SDK execution. Singleton `ClaudeQueryManager` manages queries. |
| `process.ts` | Spawn processes with streaming output. `ProcessHandle` class per process. |
| `pty.ts` | Terminal PTY for interactive shell. `PtyHandle` class per terminal. |
| `git.ts` | Git operations (worktrees, diffs, status). Stateless functions. |
| `files.ts` | Fuzzy file search. Uses git ls-files, ripgrep, or fs walk. |

## Claude Execution

Get the singleton manager and start a query:

```typescript
const manager = getClaudeQueryManager()
const query = await manager.startQuery(prompt, options)

for await (const msg of query.stream()) {
    // Handle SDK messages
}
```

Reconnect to running execution after page refresh:
```typescript
const query = await manager.attachExecution(executionId)
```

Tool handlers can be registered for client-side tools:
```typescript
query.registerToolHandler("myTool", async (args) => {
    return { content: [{ type: "text", text: "result" }] }
})
```

## Event Types

`claudeEventTypes.ts` defines the unified event stream. Events have a `direction`:
- `execution` - From Electron (sdk_message, complete, error, tool_call, etc.)
- `command` - From Dashboard (start_query, tool_response, abort, etc.)

All events stored in `ActionEvent.execution.events`.

## Process/PTY Patterns

Both use handle classes with async generators for streaming:

```typescript
const handle = await ProcessHandle.runScript({ script, cwd })
for await (const chunk of handle.stream()) { ... }
handle.cleanup()
```

Reconnection supported for both - handles persist across renderer refreshes.

## Git Operations

Stateless functions in `git.ts`. Key operations:
- `getOrCreateWorkTree()` - Creates isolated worktree for task
- `getGitStatus()` - Branch, uncommitted changes
- `workTreeDiffPatch()` - Generate unified diff
- `getFilePair()` - Before/after file content for diff viewer

## Adding New IPC

1. Add handler in `projects/electron/src/modules/code/{module}.ts`
2. Add wrapper in `electronAPI/{module}.ts`
3. Use `ipcMain.handle("code:{action}", handler)` naming

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
