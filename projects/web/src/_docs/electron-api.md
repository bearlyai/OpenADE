# Electron API Layer

Wrappers in `electronAPI/` communicate with Electron main through the shared runtime transport where possible. Product-specific OS integrations still use narrow Electron IPC wrappers.

## Module Summary

| Module | What It Does |
|--------|--------------|
| `harnessQuery.ts` | Harness execution over runtime methods. Singleton `HarnessQueryManager` manages queries across harnesses (Claude Code, Codex, etc.). |
| `process.ts` | Spawn processes with streaming output over runtime methods. `ProcessHandle` class per process. |
| `pty.ts` | Terminal PTY for interactive shell over runtime methods. `PtyHandle` class per terminal. |
| `git.ts` | Git operations over runtime methods. Stateless functions. |
| `files.ts` | Fuzzy file search over runtime methods. Uses git ls-files, ripgrep, or fs walk. |
| `shell.ts` | Shell/OS operations (directory picker, open URL, open path in file manager) plus runtime-backed directory creation. Stateless functions. |
| `platform.ts` | Platform info (OS, path separator, home dir) and utilities (file manager name). Cached after first fetch. |
| `binaries.ts` | Managed binary status/download helpers over trusted runtime methods. |
| `subprocess.ts` | Pushes global subprocess environment variables through trusted runtime methods. |
| `procs.ts` | Read/edit `openade.toml` via typed helpers used by the shared Procs editor modal. |
| `mcp.ts` | MCP connection tests and OAuth flows over trusted runtime methods plus runtime OAuth completion notifications. |

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

Client tools are registered on the runtime harness request and answered through `agent/tool/respond`.

Structured helpers (non-streaming JSON output) use the same runtime harness bridge:

```typescript
const output = await runStructuredHarnessQuery({
    prompt: "Convert Every Tuesday 2pm to cron",
    options: { harnessId: "claude-code", cwd: repoPath, mode: "read-only" },
    schema: { type: "object", properties: { schedule: { type: "string" } }, required: ["schedule"] },
})
```

## OpenADE Runtime Methods

Dashboard task execution should go through the local OpenADE runtime client, not renderer-owned harness loops:

- `openade/turn/start` for new task creation and existing-task Do, Plan, Ask, Revise Plan, Run Plan, and HyperPlan.
- `openade/review/start` for Review Plan/Review Work plus the automatic review follow-up Ask.
- `openade/turn/interrupt` for stopping server-owned task execution.
- `openade/repo/*`, `openade/task/delete`, `openade/task/metadata/update`, and `openade/comment/*` for durable product mutations.

The renderer store is a view/cache over persisted Yjs documents. Runtime notifications refresh task/repo documents from storage and emit after-event callbacks when a working task leaves the runtime working set.

Host capability checks use trusted local runtime methods:

- `host/capabilities/read`
- `agent/sdkCapabilities/read`
- `agent/sdkCapabilities/invalidate`
- `host/platform/info`
- `host/system/checkBinary`
- `host/system/checkVendoredRipgrep`
- `host/binaries/statuses`
- `host/binaries/ensure`
- `host/binaries/remove`
- `host/binaries/resolve`
- `host/subprocess/setGlobalEnv`
- `host/shell/createDirectory`
- `host/mcp/testConnection`
- `host/mcp/initiateOAuth`
- `host/mcp/cancelOAuth`
- `host/mcp/refreshOAuth`

MCP OAuth completion uses runtime notification `host/mcp/oauthComplete`; do not reintroduce a preload event channel for it.

Raw Yjs backup access uses trusted local runtime methods only:

- `data/yjs/list`
- `data/yjs/read`
- `data/yjs/save`
- `data/yjs/delete`

## Event Types

`harnessEventTypes.ts` defines the unified event stream. Events have a `direction`:
- `execution` - From Electron (raw_message, complete, error, tool_call, etc.)
- `command` - From Dashboard (start_query, tool_response, abort, etc.)

`harnessEventCompat.ts` provides a tolerant reader that normalizes v1 persisted events (type: "sdk_message") to v2 (type: "raw_message" with harnessId).

All events stored in `ActionEvent.execution.events`.

## Process/PTY Patterns

Both use handle classes with async generators for streaming:

```typescript
const handle = await ProcessHandle.startScript({ script, cwd })
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

The parser/serializer source of truth lives in Electron (`modules/code/procs`), including snake_case TOML mapping. Web callers use trusted local runtime methods:

- `host/procs/read`
- `host/procs/file/read`
- `host/procs/file/write`
- `host/procs/editable/load`
- `host/procs/raw/parse`
- `host/procs/editable/serialize`
- `host/procs/editable/save`

## Git Operations

Stateless functions in `git.ts`. Key operations:
- `getOrCreateWorkTree()` - Creates isolated worktree for task
- `getGitSummary()` - Lightweight branch and change summary for tray refreshes
- `getGitStatus()` - Heavy branch + full staged/unstaged patch payloads for explicit snapshot/export flows
- `workTreeDiffPatch()` - Generate full worktree-vs-commit patch (legacy snapshot helper)
- `getLog()` - Paginated commit history for a branch/ref
- `getCommitFiles()` - Files changed in a specific commit
- `getFilePair()` - Full before/after file content for current/whole-file views
- `getWorktreeFilePatch()` - Per-file patch for working tree diffs; accepts `allowTruncation: false` for full-fidelity snapshot bundling
- `getCommitFilePatch()` - Per-file patch for Git Log diffs

## Blob And Snapshot Operations

Blob storage and snapshot bundles use trusted local runtime methods:

- `data/file/save`
- `data/file/load`
- `data/file/delete`
- `snapshot/bundle/save`
- `snapshot/index/read`
- `snapshot/patch/readSlice`
- `snapshot/patch/read`
- `snapshot/bundle/delete`

The web wrappers are `electronAPI/dataFolder.ts` and `electronAPI/snapshots.ts`:

- `saveBundle()` - Persist `{id}.patch` and `{id}.json`
- `loadIndex()` - Load or backfill the patch index for a snapshot
- `loadPatchSlice()` - Read a byte range from the saved patch file
- `loadPatch()` - Load the raw patch on demand for copy/download/dedupe
- `deleteBundle()` - Remove both patch and index files

## Adding New IPC

Prefer runtime methods for host operations that can be represented as plain request/response or notifications. Use direct IPC only for narrow Electron/window/OS integrations that do not belong in the reusable runtime protocol.

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
