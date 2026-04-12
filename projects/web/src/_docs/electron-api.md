# Electron API Layer

IPC wrappers in `electronAPI/` communicate with Electron main process handlers in `projects/electron/src/modules/code/`.

## Module Summary

| Module | What It Does |
|--------|--------------|
| `harnessQuery.ts` | Harness execution. Singleton `HarnessQueryManager` manages queries across harnesses (Claude Code, Codex, etc.). |
| `process.ts` | Spawn processes with streaming output. `ProcessHandle` class per process. |
| `pty.ts` | Terminal PTY for interactive shell. `PtyHandle` class per terminal. |
| `git.ts` | Git operations (worktrees, diffs, status). Stateless functions. |
| `files.ts` | Fuzzy file search. Uses git ls-files, ripgrep, or fs walk. |
| `shell.ts` | Shell/OS operations (directory picker, open URL, open path in file manager). Stateless functions. |
| `platform.ts` | Platform info (OS, path separator, home dir) and utilities (file manager name). Cached after first fetch. |
| `procs.ts` | Read/edit `openade.toml` via typed helpers used by the shared Procs editor modal. |

## Harness Execution

Get the singleton manager and start an execution:

```typescript
const manager = getHarnessQueryManager()
const query = await manager.startExecution(prompt, {
    harnessId: "claude-code",
    mode: "plan",
    thinking: "high",
    resumeSessionId: "...",
})

for await (const msg of query.stream()) {
    // Handle harness events
}
```

Reconnect to running execution after page refresh:
```typescript
const query = await manager.attachExecution(executionId)
```

Client tools are registered at the IPC layer via `harness:tool_call` / `harness:tool_response` channels.

Structured helpers (non-streaming JSON output) use the same `harness:command` dispatcher:

```typescript
const output = await runStructuredHarnessQuery({
    prompt: "Convert Every Tuesday 2pm to cron",
    options: { harnessId: "claude-code", cwd: repoPath, mode: "read-only" },
    schema: { type: "object", properties: { schedule: { type: "string" } }, required: ["schedule"] },
})
```

## Event Types

`harnessEventTypes.ts` defines the unified event stream. Events have a `direction`:
- `execution` - From Electron (raw_message, complete, error, tool_call, etc.)
- `command` - From Dashboard (start_query, tool_response, abort, etc.)

`harnessEventCompat.ts` provides a tolerant reader that normalizes v1 persisted events (type: "sdk_message") to v2 (type: "raw_message" with harnessId).

All events stored in `ActionEvent.execution.events`.

## Process/PTY Patterns

Both use handle classes with async generators for streaming:

```typescript
const handle = await ProcessHandle.runScript({ script, cwd })
for await (const chunk of handle.stream()) { ... }
handle.cleanup()
```

Reconnection supported for both - handles persist across renderer refreshes.

## Procs Config Editing

`electronAPI/procs.ts` now exposes typed editor helpers used by `ProcsEditorModal`:
- `loadEditableProcsFile(filePath, searchPath?)`
- `parseEditableRaw(content, relativePath)`
- `serializeEditableProcs({ processes, crons })`
- `saveEditableProcsFile({ filePath, relativePath, processes, crons, searchPath? })`

The parser/serializer source of truth lives in Electron (`modules/code/procs`), including snake_case TOML mapping.

## Git Operations

Stateless functions in `git.ts`. Key operations:
- `getOrCreateWorkTree()` - Creates isolated worktree for task
- `getGitStatus()` - Branch, uncommitted changes
- `workTreeDiffPatch()` - Generate unified diff
- `getLog()` - Paginated commit history for a branch/ref
- `getCommitFiles()` - Files changed in a specific commit
- `getFilePair()` - Before/after file content for diff viewer

## Adding New IPC

1. Add handler in `projects/electron/src/modules/code/{module}.ts`
2. Add wrapper in `electronAPI/{module}.ts`
3. Use `ipcMain.handle("code:{action}", handler)` naming

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
