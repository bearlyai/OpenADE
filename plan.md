# OpenADE Core Migration Plan

## Purpose

This plan describes how to migrate OpenADE from the current Electron-main/Yjs/runtime hybrid to the destination in [goal.md](goal.md): a standalone Go OpenADE Core with SQLite/blob storage, one typed runtime API, thin medium shells, and the classic desktop UI as the canonical product surface.

`goal.md` is the destination. This file is the execution plan.

## Direction

- Keep the classic desktop UI as the design source.
- Move product state and host operations into OpenADE Core.
- Keep desktop, browser, mobile, and future CLI/headless clients on one typed OpenADE runtime API.
- Replace hot Yjs projection reads with indexed storage and explicit compatibility import paths.
- Preserve existing production data and keep desktop usable through each migration slice.
- Verify through real runtime, storage, transport, git, process, file, notification, and UI paths. Mock-only tests do not count as migration proof.

## Current State

The repo already has much of the TypeScript runtime foundation:

- `projects/runtime` owns generic routing, permissions, capabilities, subscriptions, notifications, and lifecycle records.
- `projects/runtime-client` owns local/WebSocket runtime clients.
- `projects/runtime-node` owns generic Node host adapters for files, git, process, PTY, agents, checkpointing, and HTTP/WebSocket serving.
- `projects/openade-module` owns OpenADE product semantics over the runtime: repos, tasks, turns, comments, snapshots, HyperPlan, Yjs projection, and Yjs mutation.
- `projects/openade-client` owns typed OpenADE client helpers over runtime transports.
- `projects/web` contains the classic desktop UI, the emerging shared shell, and the runtime-backed product store.
- `projects/electron` still composes the richest local runtime and still owns too much product/backend work in Electron main.

The immediate performance problem is also clear: server-mode currently changes the API boundary more than the execution boundary. Runtime handlers still run in Electron main and still decode/project Yjs documents, so unrelated git/process/search requests can stall behind task or repo projection work.

The first Go core slice now exists in `projects/openade-core`: a standalone runtime server, SQLite migrations/store, SQLite-backed OpenADE read methods for snapshots, projects, task lists, and task detail, queued-turn and device-environment rows in task reads, stored device-token auth, trusted remote-device management methods, Core-owned one-use pairing issuance/exchange for companion device tokens, active paired-connection closure on revoke/drop-all/self-revoke, trusted MCP server settings read/replace/upsert/delete, runtime-backed classic desktop MCP settings projection/import/write routing, scoped project file/search/process-config reads over repo/head/prepared-worktree task roots, initial project process start/reconnect/stop backed by in-memory live state plus durable runtime records and bounded SQLite output history, runtime list/read/reconcile/stop methods for those records, scoped task terminal start/reconnect/write/resize/stop backed by real PTY processes plus durable runtime records and bounded SQLite output history, scoped project git info/branch/summary reads, task git reads/commit over head tasks and prepared worktree tasks, initial task environment setup/prepare, plus initial product mutations for repos, tasks, comments, queued-turn enqueue/reorder/cancel/trusted legacy import, task image write/read/trusted staged preview read/trusted single and bulk legacy import, snapshot patch read/write/trusted bulk legacy import, trusted legacy resource import orchestration, runtime-backed desktop/create image upload cutover through `openade/task/image/write`, runtime-backed SmartEditor stashed preview restore through `openade/task/image/staged/read`, image/snapshot blob cleanup, staged-image garbage collection, and Core-managed worktree/branch cleanup on task deletion, runtime-record-backed task inventory `isRunning`, action-event persistence, HyperPlan sub-execution persistence, initial turn start/interrupt with command-worker process identity, verified-dead reconciliation in runtime records, fail-closed Unix termination for live orphaned agent workers that Core cannot reattach, review start with read-only follow-up handoff, task metadata/title generation, and task deletion. Electron can start managed Core explicitly for development/smoke and now auto-starts the packaged Core for clean production installs with no legacy Yjs documents. Desktop System settings now has a Core-endpoint-gated full legacy Yjs repo/task import trigger plus a separate resource/blob import trigger. Existing Yjs-backed installs still stay legacy until explicit opt-in/import, so production-default backend ownership still requires fallback policy, migration completion review, and full host/execution cutover.

## Non-Negotiables

1. Classic desktop behavior stays canonical.
   - Do not replace desktop with compact companion/mobile screens.
   - Extract shared UI from the desktop-quality flows, then adapt to mobile/web.

2. Existing user data survives.
   - Old Yjs data remains readable.
   - Add tolerant importers, fixtures, and parity tests before changing storage semantics.
   - Never require a destructive migration to launch the app.

3. Contracts are typed and validated.
   - Add or update OpenADE runtime methods before adding ad hoc client calls.
   - Use validators at the core boundary.
   - Generate TypeScript client types from the contract source once Go core work starts.

4. Host powers stay scoped.
   - Paired/browser/mobile clients do not get raw `fs/*`, `git/*`, `pty/*`, `process/*`, `host/*`, `snapshot/*`, or `data/yjs/*` by default.
   - Product-level scoped methods are the path to parity.
   - Notification permissions must be filtered as carefully as request permissions.

5. Verification uses real paths.
   - Real runtime server.
   - Real local and WebSocket transports.
   - Real temp storage.
   - Real temp git repos.
   - Deterministic harness executor only where agent output needs control.

## Accepted Test Doubles

Accepted:

- deterministic harness executor implementing the real executor interface
- fixed clock and fixed id generator for ordering/idempotency
- temporary storage directories
- temporary git repositories
- real test WebSocket server
- copied production-like `~/.openade` data used read-only or in temp dirs

Not accepted as primary migration proof:

- mocked `OpenADEClient`
- mocked runtime transport for initialize/permissions/subscriptions/reconnect behavior
- mocked Yjs read/write for compatibility claims
- mocked git/file/process output for host behavior
- tests that only prove a wrapper was called
- snapshots or class-name assertions as migration confidence

## Verification Ladder

Each workstream should climb as high as the change risk requires:

1. Typecheck.
2. Boundary validator tests.
3. Real module tests against temp storage.
4. Real runtime server request tests.
5. Real local transport tests.
6. Real WebSocket transport tests.
7. Permission and notification filtering tests.
8. Client store integration tests.
9. UI behavior tests.
10. Desktop/mobile/web smoke tests.
11. Production-data import/parity tests.
12. Performance budget tests.

## Performance Budgets

Initial local budgets for production-like data:

| Operation | Target | Hard Gate |
| --- | ---: | ---: |
| Task preview snapshot read | < 100 ms | 250 ms |
| Task detail read with bounded events | < 75 ms | 200 ms |
| Task switch UI spinner visibility | rare | never for cached recent task |
| Git summary for normal repo | < 250 ms | 750 ms |
| Project process list | < 150 ms | 500 ms |
| File fuzzy search warm index query | < 50 ms | 150 ms |
| Cold fuzzy index build | < 1.5 s | 4 s |

Every slow-operation log must include queue wait and handler time separately. If an operation is slow because it waited behind other work, the log should make that clear.

## Phase 0: Stabilize The Current Runtime Path

Goal: stop the current runtime-backed desktop path from making performance worse while the full core migration is designed.

Tasks:

- Keep `openade/task/read` on the lightweight task-document path.
- Keep `hydrateSessionEvents: false` as the task-route default.
- Prevent UI mount/effect paths from loading many historical task documents.
- Keep stats backfill explicit user work.
- Keep SmartEditor from warming fuzzy search with empty queries.
- Coalesce duplicate runtime notifications per task.
- Keep `lastViewedAt` updates on the repo-preview fast path.
- Add slow-op logs for runtime requests, client requests, Yjs load/save, request bursts, and notification bursts.
- Add enough caller/context data to identify background churn without logging prompts, content, tokens, or secrets.

Verification:

- Focused OpenADE module Yjs projection tests.
- Runtime product store integration tests.
- React Doctor serious-error gate when React state/effects change.
- Manual log review on task switch, git summary, process list, and fuzzy search.

Exit criteria:

- Task switching no longer repeatedly reads settings/repos as part of task detail.
- Idle app state does not continuously load task documents.
- Slow logs identify whether latency is queueing, storage, git, process, search, or execution.

## Phase 1: Contracts And Parity Harness

Goal: define the core API and build the tests that let us move implementation safely.

Tasks:

- Inventory all product methods currently used by desktop, remote, mobile, and Electron main.
- Group methods into stable service areas:
  - project
  - task
  - turn
  - comment
  - git
  - file/search
  - process
  - terminal
  - snapshot/blob
  - auth/session/device
  - runtime lifecycle
- Define the contract source for requests, responses, notifications, and error codes.
- Decide the generation flow for Go validators and TypeScript client DTOs.
- Build a parity harness that can:
  - read copied Yjs data
  - call old TypeScript projection
  - call new/imported core projection later
  - compare normalized DTOs
- Define normalized parity for:
  - snapshots
  - projects
  - task previews
  - task detail
  - comments
  - queued turns
  - resource inventories
  - stats/previews

Verification:

- Contract validator tests.
- DTO generation smoke.
- Old projection fixture tests.
- Copied-data read-only parity fixture.

Exit criteria:

- New core work has a stable API target.
- Every later storage/read migration can be compared against existing production-shaped data.

## Phase 2: Go Core Skeleton

Goal: create the standalone OpenADE Core process without moving all product behavior yet.

Tasks:

- Add `openade-core` as a Go module.
- Implement process lifecycle:
  - config loading
  - data directory selection
  - log setup
  - health endpoint
  - graceful shutdown
  - version reporting
- Implement runtime transport:
  - JSON-RPC over WebSocket at `/v1/runtime`
  - initialize handshake
  - capability discovery
  - bearer token auth for non-local clients
  - local trusted mode for Electron-owned loopback/IPC
- Implement generic request routing:
  - method registry
  - schema validation
  - request ids
  - structured errors
  - slow request observer
  - queue wait vs handler time
- Implement notification bus:
  - subscriptions
  - replay cursors
  - permission filtering
  - bounded buffers
  - lagged-client handling
- Add a thin Electron launcher path that can start/connect to the core in development without making it production-default yet.

Verification:

- Go unit tests for request routing, validation, errors, notification replay, and permissions.
- TypeScript client initialize test against real Go core.
- WebSocket auth tests.
- Slow request log test proving queue wait and handler time are separate.

Exit criteria:

- A real Go core can start, accept initialized clients, enforce permissions, and emit notifications.
- Electron can launch/connect to it behind a dev flag.

## Phase 3: Storage Engine And Yjs Import

Goal: build the durable storage model that replaces hot Yjs reads.

Tasks:

- Add SQLite schema for:
  - repos
  - tasks
  - task previews
  - comments
  - events
  - queued turns
  - runtimes
  - sessions/devices
  - settings that belong to product/core
  - stats/materialized usage
  - blob metadata
- Add blob storage for:
  - large agent streams
  - patches
  - images
  - terminal logs
  - raw transcripts
- Add migrations with explicit versions and rollback/recovery rules.
- Add a Yjs importer:
  - read existing repo/task docs
  - tolerate old/missing fields
  - import without destroying source data
  - record import status and errors
  - support re-run/idempotency
- Add projection writers:
  - materialized task previews
  - stats tables
  - bounded task detail query
- Define backup and corruption handling behavior.

Verification:

- Import fixtures from `projects/openade-module`.
- Import copied local data in temp dirs.
- Old-vs-new DTO parity tests.
- Migration idempotency tests.
- Corrupt/missing Yjs document tests.
- Query performance tests for task read, snapshot read, and task list.

Exit criteria:

- Core can import existing data and serve snapshots/task reads from SQLite/blob storage.
- No normal task switch requires decoding Yjs.

## Phase 4: Read APIs In Go Core

Goal: move read-heavy product and host paths to the Go core.

Tasks:

- Implement product reads:
  - `openade/snapshot/read`
  - `openade/project/list`
  - `openade/task/list`
  - `openade/task/read`
  - comment reads
  - queued turn reads
  - stats reads
  - task resource inventory reads
- Implement host reads:
  - scoped project git info/summary/branches
  - scoped task git summary/diff/log/file reads
  - scoped project file tree/read/search/fuzzy search
  - project process list/config reads
  - snapshot/blob/image reads
- Add read-through caches where correctness permits.
- Add invalidation from writes, file changes, git changes, and process changes.
- Keep raw host reads unavailable to paired clients unless explicitly permissioned.

Verification:

- Real Go core plus TypeScript client integration tests.
- Temp git repo tests.
- File/search tests with realistic ignored files and large trees.
- Permission matrix tests.
- Performance budget tests.

Exit criteria:

- Desktop can read normal product state and heavy host surfaces from Go core behind a feature flag.
- Git/process/search requests do not queue behind task storage projection.

## Phase 5: Desktop Store Cutover

Goal: make the classic desktop UI read from the core without changing user-visible behavior.

Tasks:

- Keep `projects/web` UI in TypeScript/React.
- Keep classic desktop route/page behavior:
  - `CodeLayout`
  - `TaskPage`
  - `TaskCreatePage`
  - `InputBar`
  - trays
  - settings
  - shortcuts
  - rich editor behavior
- Point `OpenADEProductStore` and `CodeStore` at the Go core client.
- Remove normal renderer Yjs reads from:
  - sidebar task previews
  - task route loading
  - comments
  - queued turns
  - task metadata
  - stats
  - files/search/git/process/terminal read paths
- Keep legacy fallback only behind explicit compatibility gates during rollout.
- Add cache behavior that avoids task spinners for recently read tasks.

Verification:

- Runtime product store integration tests against real Go core.
- Desktop route tests through actual local client path.
- Browser smoke for task switch, create task, run action, comment, close/reopen, files/search, git summary, process list.
- React Doctor serious-error gate for changed React state/effects.

Exit criteria:

- Normal desktop navigation does not use renderer Yjs stores.
- Classic desktop UI remains behaviorally equivalent.

## Phase 6: Writes And Execution

Goal: move product mutations and task execution fully into OpenADE Core.

Tasks:

- Implement mutations:
  - repo create/update/archive/delete
  - task create/delete/close/reopen
  - task metadata updates
  - comments create/edit/delete
  - queued turn cancel/reorder where supported
  - snapshot/blob writes
- Implement turns:
  - Plan
  - Do
  - Ask
  - Revise Plan
  - Run Plan
  - Review
  - Review Plan
  - Repeat
  - Stop/interrupt
- Implement execution lifecycle:
  - process groups
  - stream append
  - terminal status
  - durable runtime records
  - recovery after core restart
  - reconciliation for orphaned/verified-dead executions
  - idempotent `clientRequestId` handling
- Bridge existing harness CLIs from Go, or keep a narrow TypeScript harness worker only if it has a clear process boundary and typed protocol.
- Persist all execution output into event/blob storage without blocking request handling.

Verification:

- Deterministic harness integration tests.
- Restart-during-execution recovery tests.
- Stop/interrupt tests.
- Idempotency tests.
- Notification replay tests.
- Desktop smoke for every command.

Exit criteria:

- Electron main and renderer do not own task execution.
- Core restart behavior is defined and tested.

## Phase 7: Shared Shell Convergence

Goal: use one desktop-derived product shell across desktop, browser, and mobile.

Tasks:

- Extract shared components from classic desktop flows, not from compact companion screens:
  - task thread
  - rich composer
  - task command controls
  - project/task lists
  - file/search panels
  - diff/changes panels
  - process panels
  - task metadata/comments/review panels
  - settings sections that apply across media
- Keep medium adapters thin:
  - Electron: windows, tray, native dialogs, updates, local bootstrap
  - Mobile: QR scan, secure storage, OTA readiness, safe area
  - Browser: session entry, browser storage, remote permission set
- Delete mobile-only product UI once desktop-derived shared components cover it.
- Keep permission-driven feature visibility.
- Avoid exposing unsafe desktop-only commands to paired clients by layout accident.

Verification:

- Shared component tests using real DTOs.
- Desktop route smoke.
- Mobile attach smoke.
- Browser attach smoke.
- Permission/feature visibility tests.

Exit criteria:

- Desktop, browser, and mobile render the same product model through one shared shell/store.
- Medium differences are adapter/layout/permission differences, not duplicated product implementations.

## Phase 8: Rollout, Migration, And Cleanup

Goal: ship safely and remove obsolete paths.

Tasks:

- Add rollout gates:
  - development flag
  - internal cohort
  - default-on managed Core for clean new installs
  - migration prompt/auto-import for existing installs
  - rollback path
- Add migration observability:
  - import success/failure
  - parity mismatch categories
  - slow operation categories
  - fallback use
  - crash/restart recovery
- Remove obsolete paths after gates pass:
  - renderer Yjs product reads
  - Electron main product projection
  - duplicate companion product wrappers
  - compact mobile product UI
  - duplicated DTO aliases
  - raw host API use from product UI
- Keep read-only Yjs export/import tools for support until deprecation is complete.

Verification:

- Full cross-package checks.
- Packaged Electron smoke.
- Mobile build/smoke.
- Browser attach smoke.
- Production-data import test suite.
- Performance budget suite.
- Rollback drill.

Exit criteria:

- Go OpenADE Core is the production backend.
- Legacy Yjs hot path is gone from normal product use.
- Electron is native shell/chrome only.

## Permission Matrix

Draft defaults:

| Capability | Trusted Desktop | Browser/Mobile Paired | Notes |
| --- | --- | --- | --- |
| Snapshot/task/comment reads | yes | yes | Product DTOs only |
| Product task mutations | yes | limited yes | Role/permission filtered |
| Turn start/stop/review | yes | yes | May require explicit grants |
| Project file reads/search | yes | yes | Scoped to repo/task |
| Project file writes | yes | no by default | Future explicit grant |
| Git reads/diffs/logs | yes | yes | Scoped and sanitized |
| Git commit/push | yes | no by default | Future explicit grant |
| Project processes | yes | read/reconnect limited | Start/stop requires grant |
| Task terminal | yes | no by default | Future explicit grant |
| Raw fs/git/process/pty | no product UI | no | Keep behind trusted adapters only |
| Device/admin settings | yes | self-management only | Remote self-revoke allowed |

## Documentation Requirements

Update docs in the same change when behavior changes:

- Root `CLAUDE.md` for durable direction.
- `goal.md` only when the destination changes.
- `plan.md` when migration phases or gates change.
- Package `CLAUDE.md` files when ownership or boundary rules change.
- Runtime/OpenADE contract docs when methods, permissions, or notifications change.
- Storage migration docs before shipping importer/migration behavior.

## Decision Log

- 2026-06-09: Runtime notification-burst telemetry now exists in both the TypeScript `RuntimeServer` and Go Core runtime. The observer/log shape is sanitized to service, notification method, count, and window duration only; notification params are intentionally excluded. Electron wires the TypeScript observer into `[Runtime] Notification burst`, and Go Core logs `runtime notification burst` by default with env-tunable burst window/count. Focused real runtime tests prove bursts are detected through actual notification fanout and payload data does not enter the event/log.

- 2026-06-09: Classic desktop `CodeStore` runtime notification coalescing now includes `openade/queuedTurn/updated` alongside `openade/task/updated`, so queued-turn bursts in the runtime-backed desktop path do one lightweight task-detail refresh instead of one read per notification. The real `RuntimeServer`/`OpenADEClient` desktop bridge test now publishes three queued-turn notifications and proves the classic store refreshes the task DTO once while preserving queued-turn state.
- 2026-06-09: Remote/shared-shell task refresh policy now treats `openade/queuedTurn/updated` like `openade/task/updated` for the selected task only, and notification-driven task/snapshot refreshes bypass `OpenADEProductStore` completed-result caches. This keeps browser/mobile task detail and queued-turn controls current without refreshing unrelated task detail or serving stale DTOs immediately after Core/desktop-side writes. A real `RemoteApp` integration test renders against `RuntimeServer`/`OpenADEClient`, publishes an actual `openade/queuedTurn/updated` notification, and proves the selected task panel refreshes from the runtime DTO.
- 2026-06-09: Direct `OpenADEProductStore.subscribe()` consumers now coalesce subscribed `openade/task/updated` and `openade/queuedTurn/updated` notifications per task before doing lightweight task-detail refreshes. `openade/task/previewChanged` and `openade/task/deleted` cancel pending detail refreshes and remain immediate, so sidebar/snapshot-visible changes do not wait behind the coalescing window. A real `RuntimeServer`/`OpenADEClient` product-store regression publishes actual OpenADE module task notifications and proves duplicate task updates produce one task read while preview-change notifications avoid detail reads.
- 2026-06-09: `OpenADEProductStore.refreshSnapshot()` and lightweight `getTask()` now keep one-second completed-result caches for duplicate route/render reads after OpenADEClient in-flight coalescing resolves. Product mutations, product/runtime notifications, and `refreshTask()` still bypass those caches, and full-history `{ hydrateSessionEvents: true }` task reads never use the lightweight cache. Runtime-backed product-store tests prove duplicate snapshot/task reads hit the runtime once, explicit snapshot bypass hits again, `refreshTask()` fetches again, and hydrated task reads fetch every time.

- 2026-06-09: `OpenADEProductStore.readProjectGitSummary()` and `readTaskGitSummary()` now keep one-second completed-result caches for duplicate task-open/tray churn while `TaskModel.refreshGitState({ force: true })` passes `bypassCache: true` so explicit refreshes still hit the selected runtime/Core. Scoped file writes, task git commits, repo update/delete, turn starts, and task update notifications clear affected repo/task git-summary entries. Runtime-backed product-store tests prove duplicate project/task summary reads hit the runtime once, forced task refresh bypasses the cache, and scoped file writes invalidate both project and task summary caches.

- 2026-06-09: OpenADEClient request-burst telemetry now counts only actual outbound typed runtime requests after in-flight read coalescing. Coalesced callers for task reads, process lists, searches, git summaries, and other read-only methods no longer produce false `[OpenADEClient] Runtime request burst` warnings when only one runtime request was sent. A `RuntimeServer` + `RuntimeLocalClient` regression issues twelve identical concurrent process-list reads, proves one runtime handler invocation, and proves no burst warning is emitted.

- 2026-06-09: `OpenADEProductStore.fuzzySearchProjectFiles()` and `searchProject()` now keep one-second completed-result caches for identical scoped repo/task queries, complementing the typed client's in-flight coalescing and the host path-walk cache. Scoped file writes invalidate fuzzy/content search caches for the affected repo/task scope, and repo-root writes clear all scopes for that repo. A real `RuntimeServer`/`OpenADEClient` product-store regression proves back-to-back fuzzy/content searches hit the runtime once and hit it again after a scoped file write.

- 2026-06-09: `OpenADEProductStore.listProjectProcesses()` now keeps a one-second completed-read cache keyed by repo/task scope, in addition to the typed client's in-flight coalescing. Process start/stop and scoped `openade.toml` writes invalidate the cache so real instance/config changes are visible on the next read. A real `RuntimeServer`/`OpenADEClient` product-store regression proves back-to-back process-list reads hit the runtime once, then hit it again after a process start and after an `openade.toml` write.

- 2026-06-09: Optional Electron data-folder loads now return `null` silently when a file is absent, instead of logging `File not found` with the full local path. This removes expected legacy cron/image miss noise from startup/idle logs while keeping invalid params and real read failures logged. A focused Electron test uses a real temp data directory and mocked logger to prove missing cron state is silent and existing data-folder files still load.

- 2026-06-09: Cold repo git-info detection now coalesces per repo in `RepoManager.getGitInfo()`, preventing concurrent environment setup, task creation, and sidebar reads from issuing duplicate `openade/project/git/info/read` or legacy `gitApi.isGitDirectory()` calls. A real `RuntimeServer`/`OpenADEClient` bridge regression calls `getGitInfo("repo-1")` twice concurrently and proves one product git-info read while branch, summary, and gh-status reads still use product APIs.

- 2026-06-09: Lightweight runtime task reads now use a short renderer fresh-cache window in `CodeStore.getRuntimeProductTask()`. Duplicate in-flight reads still coalesce, immediate route/render churn can reuse the cached OpenADE task DTO without another `openade/task/read`, and explicit `{ hydrateSessionEvents: true }` full-history requests still fetch. The cache freshness marker is pruned on snapshot/task deletion and cleared with runtime-product store teardown. A focused real `RuntimeServer`/`OpenADEClient` bridge regression proves duplicate lightweight reads coalesce, a fresh lightweight reread does not hit runtime, and full-history hydration still does.

- 2026-06-09: SmartEditor file mentions no longer run host/product fuzzy search for empty queries. `warmFileMentionSearch()` and the empty `@` popup path now return local frecency favorites without calling `openade/project/files/fuzzySearch` or the legacy `filesApi.fuzzySearch()` fallback; non-empty queries still use the real scoped search path. Focused SmartEditorManager tests cover runtime product context, empty-query favorites, empty legacy fallback, and non-empty legacy search.

- 2026-06-09: Renderer cron process-config refreshes now coalesce per repo in `CronManager.refreshRepoConfig()`, covering startup, sidebar on-demand loads, focus refreshes, and after-event refreshes through one in-flight `openade/project/process/list` / `readProcs` call per repo. This does not replace Core-owned scheduling; clean managed-Core sessions still keep renderer cron scheduling fully off. The focused CronManager regression overlaps `addRepo()` with `ensureRepoConfigLoaded()` and proves the same repo is read once.

- 2026-06-09: Runtime lifecycle reads now have typed `status` and `statuses` filters from `projects/runtime-protocol` through the TypeScript runtime server, `OpenADEClient`, and Go Core `runtime/list`. Core storage adds SQLite expression indexes over runtime scope owner fields plus status, and `Service` active task helpers use filtered storage reads for working-task notifications, queue drain checks, task interrupt lookup, and resource-inventory running state instead of scanning every historical runtime record. Clean managed-Core desktop hydration now asks only for `starting` and `running` `openade-task` runtimes in a single status-list request, keeping startup/task-switch running-state reads bounded as runtime history grows. Real storage, WebSocket Core, TypeScript runtime server, and MobX RuntimeManager tests cover the filter path.

- 2026-06-09: The Core host-operation hard gates now measure first-hit work instead of only warmed calls. `TestProductHostOperationPerformanceBudgetsOverRuntime` enforces first-hit git summary at 750 ms, first-hit project process list at 500 ms, first-hit `openade/project/files/fuzzySearch` at 4 seconds, and repeated fuzzy search at 150 ms over the real WebSocket/temp-git/filesystem path. The focused host-operation budget test plus full Core `make check` pass with those stricter gates.

- 2026-06-09: The Core task read performance gate now measures first-hit reads instead of warmed SQLite/runtime calls. `TestProductReadPerformanceBudgetsOverRuntime` enforces `openade/snapshot/read` at 250 ms and bounded `openade/task/read` at 200 ms over the real WebSocket path against production-shaped SQLite data without pre-reading either route. The focused read-budget test plus full Core `make check` pass with that stricter setup.

- 2026-06-09: Clean managed-Core desktop startup now hydrates working-task runtime state from the selected product runtime/Core client instead of `runtime/localRuntimeClient.ts`. `OpenADEClient` exposes typed `runtime/list` access for runtime records, `OpenADEProductStore` refreshes its `RuntimeRecordCache` through that selected transport, and `CodeStore` passes that source into `RuntimeManager` whenever runtime product reads are active. The legacy Electron IPC runtime-list fallback remains only for legacy product sessions. A real `RuntimeServer`/`OpenADEClient` regression test seeds an active Core runtime record, exposes a poison legacy `openadeAPI.runtime`, initializes clean managed Core stores, and proves the desktop running-task cache is hydrated without any legacy IPC request.

- 2026-06-09: Legacy Yjs migration acceptance markers now include sanitized import evidence and the trusted local accept method rejects non-clean evidence. The desktop System settings flow passes count-only summaries from the real Yjs import/parity report and the real resource import report into `host/core/legacyYjsMigration/accept`; Electron validates zero import skips, zero import errors, zero parity mismatches, zero resource skips, and zero resource missing/conflict/failure counts before writing `legacy-yjs-import-accepted.json`. Existing v1 markers remain readable, but new writes preserve enough evidence to audit why Core can auto-start over retained legacy Yjs documents.

- 2026-06-09: Core Unix process termination now falls back to the stored/direct PID when persisted process-group metadata is stale. `terminateAgentWorkerProcess`, `terminateProjectProcess`, and `terminateProjectProcessID` no longer treat `ESRCH` on the process group as a complete stop when a PID/process handle is still available. Unix-only real process tests launch signal-aware helpers, pass intentionally missing process-group ids, and prove the helpers still terminate through the PID fallback.

- 2026-06-09: Core `runtime/stop` now fails closed for stored agent workers when the in-memory execution handle is gone. Active/orphaned `agent` runtime records with persisted worker PID/Unix process group now terminate that process group before settling the runtime/action as `stopped`, while normal in-memory cancellation still handles platforms or executors without process metadata. A real Unix runtime-stop test seeds both running and orphaned SQLite agent runtime rows after Core startup, points each at a live helper process group, calls `runtime/stop`, and proves the runtime/action stop notification plus process-group exit.

- 2026-06-09: Core startup now fails closed for live project process runtimes that cannot be adopted. Adoption still takes precedence when an orphaned process has a live PID plus Core-owned stdout/stderr capture files and offsets. After that adoption pass, any remaining live orphaned process is treated as unadoptable: startup terminates the stored process group, marks the runtime `stopped` with `process was orphaned during core startup`, and keeps any bounded durable `runtime_output_chunks` reconnectable for transcript review. `runtime/stop` now uses the same stored PID/PGID fallback for active/orphaned process records when no in-memory process state exists. A real Unix startup-path test seeds a live helper process group plus old-shape SQLite runtime/output rows before Core registration and proves runtime stop, durable reconnect output, and process-group exit.

- 2026-06-09: Core task terminal restart behavior now fails closed for live orphaned PTYs. Because a PTY master file descriptor cannot be safely recovered after Core exits, startup marks previously active `pty:*` runtimes orphaned, uses the stored PID/Unix process group to terminate still-live orphan shells, settles the runtime as `stopped` with `terminal process was orphaned during core startup`, and keeps bounded historical `runtime_output_chunks` reconnectable for the desktop terminal transcript. `runtime/stop` now has the same stored-PID fallback when in-memory PTY state is gone. A real Unix startup-path test launches a live helper process group, seeds SQLite runtime/output rows before Core registration, boots Core, and proves the runtime stop, durable reconnect output, and process-group exit.

- 2026-06-09: Core-owned project processes now use Unix process groups plus file-backed output capture for restart adoption. `openade/project/process/start` configures repo-declared commands into their own group before launch, writes stdout/stderr into private Core-owned capture files, persists `pgid`, capture paths, and byte offsets on runtime records without exposing those paths in runtime DTO JSON, and tails the files into existing SQLite `runtime_output_chunks` plus process output notifications. `openade/project/process/stop` and runtime stop paths signal the stored process group before falling back to the direct process, including after startup adoption. On startup, Core adopts still-running orphaned process runtimes that have live PIDs and private capture files, rehydrates durable output, tails new output, and marks the runtime completed when the PID exits without claiming a recovered exit code. Real Unix runtime tests prove child process-group cleanup and live process adoption/output/completion after simulated Core restart.

- 2026-06-09: Command-agent workers now write Core restart recovery transcripts and Core can adopt still-running workers after restart. `CommandAgentExecutor` gives each worker a private `OPENADE_AGENT_WORKER_RECOVERY_FILE` under the Core data directory, persists that private path in the agent runtime payload without exposing it in runtime DTO JSON, and the TypeScript worker appends every outbound `stream`/`execution`/`result` NDJSON message to that file before stdout. On startup, Core marks active runtimes orphaned, replays terminal worker transcripts into the task action stream/execution/result, reactivates live worker processes with non-terminal transcripts, tails those files until a terminal result arrives, and wires adopted workers into `runtime/stop`/`openade/turn/interrupt` through stored PID/process-group termination. Real Core tests prove completed transcript recovery, live transcript adoption, and adopted-worker stop. The managed-Core packaged smoke now starts a delayed Core-owned turn through the packaged worker, closes/relaunches the app while the turn is live, proves Core recovers the turn to `completed` after relaunch, and proves the recovered turn renders in the classic desktop task route.

- 2026-06-09: Managed Electron Core now packages and configures the TypeScript harness worker so clean-install packaged Core smoke can prove Core-owned turn execution, not just storage/host APIs. `npm run build` copies `projects/harness/dist` into `projects/electron/dist/harness-worker`, electron-builder includes that resource, and `runtimeCore.ts` sets `OPENADE_CORE_AGENT_WORKER_COMMAND` to the packaged worker command plus `ELECTRON_RUN_AS_NODE=1` unless an explicit worker command is already configured. The managed-Core packaged smoke sets the guarded deterministic smoke harness, calls `openade/turn/start` over the real Core WebSocket endpoint, waits for the task event to complete, reads `runtime/read` for `openade-turn:<eventId>`, and asserts persisted worker session/output plus process-start metadata. This is packaged rollout proof for the command-worker boundary.

- 2026-06-09: Clean-install packaged managed-Core smoke now proves the classic desktop task route can render Core-created data before and after app/Core restart. After creating a repo/task, running a Core-owned turn through the packaged worker, and updating task metadata over the real Core WebSocket endpoint, the smoke navigates the packaged renderer to `/dashboard/code/workspace/:repoId/task/:taskId`, waits for `data-openade-surface="desktop-classic-task"`, asserts the Core-created turn prompt is visible, and asserts the compact shared/mobile task surfaces are absent. It then closes and relaunches the packaged app against the same isolated Core data, requires the managed rollout state again, and proves the persisted Core task still renders through the classic desktop route. This keeps default-on Core rollout aligned with the user-facing goal: old desktop UI look/functionality over Core APIs, not the mobile companion UI.

- 2026-06-09: Browser/mobile-style Core attach now has live generated-client contract coverage. `projects/openade-client/src/generated/openade-contracts.test.ts` spawns the real Go Core, creates a trusted repo, starts a trusted pairing session, pairs an iOS-style device through the real `/v1/pair` HTTP endpoint, reconnects over the shared `runtimeSocketUrl()` WebSocket contract with the returned device token, and proves paired capabilities allow snapshot reads plus normal `openade/turn/start`/interrupt while denying trusted-local file writes, repo creation, and pairing administration. This keeps mobile/web attach verification tied to the same remote-kernel protocol the shared shell uses.

- 2026-06-09: Classic desktop Repeat now has runtime-product-store regression coverage. The real `RuntimeServer` + `OpenADEClient` bridge test records typed `openade/turn/start` requests, starts Repeat from the existing `RepeatManager`, advances after-event callbacks through the existing execution manager, and proves each repeated Do turn carries the classic `Repeat` label through the product API while `getTaskStore()`, `refreshTaskStoreFromStorage()`, and `refreshRepoStoreFromStorage()` stay unused. Repeat remains a desktop behavior layered over normal Do turns rather than a new `repeat` protocol type.

- 2026-06-09: Clean-install packaged managed-Core smoke now covers trusted Core-owned task git commit mutation over the real Core WebSocket endpoint. After proving task git summary/changes/diff/file-pair/log for a Core-written untracked file, the smoke calls `openade/task/git/commit`, verifies a committed SHA is returned, verifies the scoped git summary is clean afterward, and verifies the latest task git log entry is the Core-created commit. This keeps commit mutation in the packaged rollout proof while paired-device permissions still deny commit by default.

- 2026-06-09: Clean-install packaged managed-Core smoke now covers Core-owned git read surfaces over the real Core WebSocket endpoint. After Core writes an untracked file through `openade/project/file/write`, the smoke checks project git branches and summary plus task-scoped git summary, changes, diff, file pair, and log. This gives packaged rollout proof for scoped git ownership beyond repository detection while keeping commit mutation covered by lower-level Core WebSocket tests.

- 2026-06-09: Clean-install packaged managed-Core smoke now covers Core-owned task terminal lifecycle on non-Windows packaged runs over the real Core WebSocket endpoint. After creating a Core task, the smoke starts the deterministic task terminal, writes a command, polls `openade/task/terminal/reconnect` until PTY output is returned from Core's bounded runtime output, resizes the terminal, and stops it. Windows still returns an explicit skipped marker because Core PTY coverage is currently Unix-only in product tests.

- 2026-06-09: Clean-install packaged managed-Core smoke now covers Core-owned project process lifecycle over the real Core WebSocket endpoint. After auto-managed rollout state is proven, the smoke starts an `openade.toml` process with `openade/project/process/start`, polls `openade/project/process/reconnect` until real stdout is returned from Core's bounded runtime output, and stops it with `openade/project/process/stop`. This keeps rollout proof aligned with the goal that Core owns process operations rather than merely process config discovery.

- 2026-06-09: Packaged Electron managed-Core smoke now proves the clean-install default-on rollout path rather than only the explicit opt-in path. The managed-Core smoke launches with isolated temp Core/Yjs/user data, a custom Core port/token, and no `OPENADE_USE_OPENADE_CORE` or `OPENADE_CORE_MANAGED` flags, then asserts `openadeAPI.core.rolloutState` and `app_opened` telemetry report `connected`/`managed`/`managed-core` with `automatic: true` before exercising real Core WebSocket product methods. Explicit opt-in flags remain available for targeted variants, but broad rollout proof must keep covering the automatic clean-install decision.

- 2026-06-09: Electron companion paired-device permissions now include the same safe read-only task git history/detail surface that Go Core already grants: `openade/task/git/summary/read`, `openade/task/git/commit/files/read`, `openade/task/git/fileAtTreeish/read`, and `openade/task/git/commit/filePatch/read`. These remain scoped OpenADE product methods that resolve repo/task ownership server-side and do not expose raw `git/*` powers or commit mutation. The real companion WebSocket integration test now exercises those reads from a paired device against a temp git repo while continuing to deny `openade/task/git/commit`.

- 2026-06-09: Electron companion paired-device permissions now match the Go Core safe attach stance for repo-declared processes: paired devices may list/reconnect scoped product process state, but they no longer receive `openade/project/process/start` or `openade/project/process/stop` by default. Those methods can execute or terminate host processes even though they are scoped through `openade.toml`, so they remain trusted/local until an explicit remote role decision lands. The companion integration test now proves paired capabilities hide process start/stop and direct requests are denied before handler validation, while scoped process list remains available.

- 2026-06-09: Go Core paired-client permissions no longer grant `notify:runtime/*`. Paired browser/mobile clients still receive product-level `openade/*`, connection, and device-change notifications, but raw runtime lifecycle records can include process, terminal, agent, scope, and host-path-shaped metadata that belongs to trusted/local clients. The paired WebSocket capability/filter test now asserts `runtime/created`, `runtime/updated`, `runtime/completed`, `runtime/failed`, `runtime/stopped`, `process/output`, and `pty/output` are hidden and proves a raw `runtime/completed` notification with private path-shaped payload fields is not delivered while normal product notifications still are.

- 2026-06-09: Go Core now owns the headless cron due-run loop for clean managed-Core sessions. `openade-core` starts `Service.StartCronScheduler()` in the daemon, scans Core SQLite repos plus per-repo cron install state, resolves cron definitions from server-side `openade.toml` parsing, computes due five-field schedules with `robfig/cron`, updates `lastRunAt` before turn start, uses deterministic per-occurrence `clientRequestId`s, and starts scheduled work through the existing `openade/turn/start` path so task/action/runtime persistence stays unified. A real temp-repo/Core runtime test proves an installed due cron creates a real executor-backed turn, updates `lastRunAt`/`lastTaskId`, and does not duplicate on a second due scan at the same timestamp. The renderer remains responsible for cron UI/config editing only in clean-Core mode.

- 2026-06-09: Clean managed-Core startup now has a manager-level guard against renderer cron scheduling and process-list churn. `CodeStore` already skipped `CronManager.startAll()` when `shouldUseCoreOwnedCronScheduler()` was true; `CronManager.startAll()` itself now returns before loading product cron install state, calling `openade/project/process/list`, registering focus/event refresh handlers, or marking itself started. Focused web tests make product cron-state and process-list calls hostile and prove clean-Core cron startup remains inert, while explicit sidebar `ensureRepoConfigLoaded()` continues to be the path for visible cron config display.

- 2026-06-09: Go Core task git scopes now include registered Git worktrees and `openade/task/git/log` resolves `worktree:*` scope ids server-side. Core exposes typed branch and worktree scope DTOs, enumerates worktrees through `git worktree list --porcelain`, rejects unknown or malformed worktree ids instead of accepting paths, and runs scoped logs in the matched registered worktree. Branch scope selection continues to use the existing `ref` parameter. Real WebSocket/temp-git tests prove scope projection includes worktree metadata and worktree-scoped logs read commits that only exist on the selected worktree branch.

- 2026-06-09: Clean managed-Core personal settings now have typed trusted-local product APIs. Go Core registers `openade/settings/personal/read` and `openade/settings/personal/replace` backed by SQLite settings with concrete DTOs, preserves explicit `false` booleans, dedupes pinned task ids, allows multiline env var values, validates themes/tabs/agent defaults, and keeps both methods out of paired-device grants. `OpenADEClient`, generated contracts, `OpenADEProductStore`, and `connectProductPersonalSettingsStore()` let the classic desktop `PersonalSettingsStore` projection use Core APIs so clean managed-Core startup no longer needs to open legacy `code:personal_settings`; Electron/Yjs compatibility hosts expose the same methods through shared `yjsMutation` helpers.

- 2026-06-09: Clean managed-Core env vars now stay Core-owned instead of being pushed back into Electron main. Core merges personal-settings `envVars` into Core-owned project processes, task terminals, task title generation, turn/review command-agent workers, queued-turn workers, and review follow-up workers without mutating process-global env. The classic renderer skips `host/subprocess/setGlobalEnv` when `usesCleanManagedCoreRuntime()` is true, while legacy/Electron fallback sessions keep the existing env push/reaction behavior. Real Core WebSocket tests prove env values reach project process output, PTY output, and command-agent subprocesses; the runtime product store test proves clean Core startup does not call the Electron env API.

- 2026-06-09: Electron preload now exposes a sanitized Core rollout state next to the Core runtime endpoint. `runtimeCore.ts` records the launch decision reason (`managed-core`, `legacy-yjs-documents`, `development-default-off`, `missing-core-binary`, etc.) plus automatic/legacy-data booleans in process env before preload runs; `preload.ts` validates and exposes that as `openadeAPI.core.rolloutState` without paths, tokens beyond the existing endpoint token, command strings, or env values. `projects/web/src/runtime/localProductRuntimeClient.ts` validates the shape for renderer callers, System settings shows the current Core migration state before enabling resource import, and runtime-product telemetry includes the rollout status/source/reason so cohort review can distinguish true Core failures from intentional legacy-data holds.

- 2026-06-09: Desktop System settings now includes trusted-local legacy data and resource import actions. `persistence/storage/openadeYjsStorageAdapter.ts` adapts Electron's trusted `data/yjs/list` and `data/yjs/read` runtime methods to `OpenADEYjsStorageAdapter`; `CodeStore.importProductLegacyYjsData()` builds an `OpenADEYjsProjection`, calls `OpenADEProductStore.importLegacyYjsData()`, returns both import counts and `compareOpenADELegacyYjsToCore()` parity results from the same selected runtime/Core client, and refreshes runtime snapshot cache state. The import buttons stay disabled unless `openadeAPI.core.runtimeEndpoint` is present, while tests may install an explicit runtime-product store factory. The narrow accepted-import marker now requires both a clean data/parity report and a clean resource import report with no skipped, missing, conflicted, or failed images, snapshot patches, or transcripts before System settings calls trusted-local `host/core/legacyYjsMigration/accept`, which writes `~/.openade/data/core/legacy-yjs-import-accepted.json`; subsequent packaged launches may then auto-start Core over retained legacy Yjs docs and report `legacy-yjs-migration-accepted`. Adapter coverage uses real Yjs update bytes; primary migration correctness remains the real Go Core import/parity test in `projects/openade-module/src/yjsImport.test.ts`.
- 2026-06-09: Electron managed Core is now default-on for clean production installs without legacy Yjs documents. `projects/electron/src/modules/runtimeCore.ts` starts the packaged Core binary automatically when `isDev` is false, no external `OPENADE_CORE_RUNTIME_URL` is configured, no `OPENADE_DISABLE_OPENADE_CORE=1` opt-out is present, and the normal or legacy-nested Yjs storage directories are empty. Existing Yjs-backed installs remain on the trusted IPC path until explicit opt-in/import, while `OPENADE_CORE_MANAGED=1` or `OPENADE_USE_OPENADE_CORE=1` still starts managed Core for development/smoke, and `OPENADE_USE_OPENADE_CORE=1` without an external URL is now treated as managed opt-in so the rollout path has fewer two-flag combinations. Real Electron unit tests cover clean-install auto-start, legacy-data suppression, explicit disable, explicit dev opt-in, and filesystem-backed Yjs detection.
- 2026-06-08: Classic desktop process/cron editor reads now stay on scoped product APIs when opened from runtime-backed contexts. `ProcsEditorModal` uses `CodeStore.listProductProjectProcesses()` for config discovery, `CodeStore.readProductProjectFile()` for `openade.toml` content, and browser-safe OpenADE module parse/serialize helpers for raw editing whenever `productScope` is present; `host/procs/read`, `host/procs/editable/load`, `host/procs/raw/parse`, and `host/procs/editable/serialize` remain fallback-only for unscoped trusted-local contexts. A real `RuntimeServer` + `OpenADEClient` store bridge test drives scoped discovery, file load, raw parse, and raw serialize through the runtime product store.
- 2026-06-08: Classic desktop Cron sidebar edits now use the same repo-scoped product process config access as the Processes tray when runtime-backed reads are active. `CronsSidebarContent` passes `{ repoId }` plus scoped start/reconnect/stop access into `ProcsEditorModal`, so sidebar-opened `openade.toml` saves route through `CodeStore.writeProductProjectFile()` / `openade/project/file/write` and stale runtime-owned processes can be stopped through `openade/project/process/stop`. A real `RuntimeServer` + `OpenADEClient` store bridge test renders the sidebar, loads cron definitions through `openade/project/process/list`, opens the editor, and proves the modal receives repo-scoped product access that routes stop calls through the runtime product API.
- 2026-06-08: Desktop now has a guarded System settings trigger for Core legacy resource import. `SystemConfigTab` exposes a Core Migration section only as a trusted-local desktop action, checks `openadeAPI.core.runtimeEndpoint` before enabling import, uses the native directory picker for the legacy data directory, and calls `CodeStore.importProductLegacyResources()` / `openade/import/legacyResources` with optional Claude Code/Codex transcript import. `components/settings/coreResourceMigration.ts` keeps the import selection and result formatting browser-safe. The real `RuntimeServer` + `OpenADEClient` store bridge test now drives that helper, proves `clientRequestId` is attached, snapshot cache refreshes, and legacy Yjs store refreshes are not used. This is user-facing resource/blob/transcript migration wiring after Core rows exist, not the full Yjs repo/task importer.
- 2026-06-08: Classic desktop process config saves now use the product file-write path when opened from a runtime-backed Processes tray. `ProcessesTray` passes the scoped repo/task into `ProcsEditorModal`; `saveProcsEditorFile()` serializes the edited `openade.toml` in the browser-safe OpenADE module, writes it through `CodeStore.writeProductProjectFile()` / `openade/project/file/write`, then refreshes parsed process config through `CodeStore.listProductProjectProcesses()`. A real `RuntimeServer` + `OpenADEClient` test proves the serialized TOML reaches the runtime product file-write adapter and the process-list refresh runs. Raw `host/procs/editable/save` remains only the trusted-local fallback.
- 2026-06-08: Classic desktop process-editor cleanup now preserves Core process ownership. `ProcessesTray` passes scoped product process access into `ProcsEditorModal`, and `RepoProcessesManager.stopProcessesMissingFromConfig()` uses `openade/project/process/stop` for stale runtime-owned processes before deleting local renderer state, while keeping direct `ProcessHandle` cleanup only as the trusted-local fallback. A focused manager test covers mixed Core-managed and legacy process cleanup after config edits.
- 2026-06-08: Classic desktop action image thumbnails now use the runtime product image read path when runtime product reads are active. `ImageAttachments` receives the task id, resolves the runtime repo from `CodeStore`, calls `CodeStore.readProductTaskImage()` / `openade/task/image/read`, and only uses the legacy `dataFolderApi` image folder when the runtime product store is not active. A real `RuntimeServer` + `OpenADEClient` bridge test renders the thumbnail from runtime-returned base64 data and fails if the legacy image file API is touched. This removes another normal desktop UI direct-file fallback from the Core-backed task thread.
- 2026-06-08: Runtime-backed SmartEditor stashed draft image previews now restore through the product runtime instead of the legacy image folder. Core, the TypeScript OpenADE module, OpenADEClient contracts, `OpenADEProductStore`, and `CodeStore` expose `openade/task/image/staged/read`, a trusted/local read for unreferenced staged `task_image` blobs used only for pending composer previews. The normal `openade/task/image/read` route remains task-reference-gated. The staged route is intentionally excluded from paired-device permissions because it can return raw unreferenced upload bytes. Real Core WebSocket/storage tests cover staged reads, missing/mismatched blobs, invalid ids, and reference-gated task reads; a real `RuntimeServer` + `OpenADEClient` web-store test proves a recreated SmartEditor manager restores a stashed staged preview from runtime base64 data without touching `dataFolderApi.load`.
- 2026-06-08: Go Core startup now fails closed for live orphaned agent workers when active execution reattach is unavailable. Startup first marks previously active agent runtimes `orphaned`, then uses the persisted worker PID/Unix process group to terminate still-live orphaned workers before settling the matching action/runtime as `stopped` with `agent worker process was orphaned during core startup`; Unix sends SIGTERM to the process group first with PID fallback, while Windows remains conservative until a real process-tree terminator lands. A real startup-path test launches a live helper process in its own process group, seeds SQLite runtime/action state before `product.Register()`, boots Core, and proves the runtime/action stop plus the helper process exits. The later 2026-06-09 worker recovery transcript slice supersedes fail-closed behavior when a resumable transcript exists.
- 2026-06-08: Go Core verified-dead recovery now includes task terminal PTY runtimes. Startup and `runtime/reconcile` check PID-backed `pty:*` runtime records with the same conservative liveness probe, persist verified-dead terminals as `stopped` with `terminal process is no longer running`, emit `runtime/stopped` on explicit reconcile, and keep durable `runtime_output_chunks` reconnectable for this automatic recovery case. Explicitly user-stopped terminals still return not found. Real startup and runtime-reconcile tests seed dead child PIDs plus persisted PTY output, then prove terminal runtimes settle and `openade/task/terminal/reconnect` still returns the saved output. Live PTY pipe adoption after restart remains intentionally unsupported; the later 2026-06-09 slice fails closed for still-live orphan PTYs.
- 2026-06-08: Go Core startup now runs verified-dead reconciliation for process-backed persisted runtimes immediately after orphaning previous active records. Agent worker runtimes and project process runtimes with stored PIDs are checked with the same conservative liveness probe used by `runtime/reconcile`; verified-dead workers/processes are persisted as `stopped`, agent action events and running queued turns are settled through the normal stop path, and task threads no longer have to wait for a later manual reconcile call to clear dead work after restart. A real startup-path test seeds SQLite before `product.Register()` with a reaped child PID for both an agent worker and project process runtime, then proves Core boots with the runtimes stopped and the action event settled. The later 2026-06-09 recovery slices supersede the original live-adoption gap for command-agent workers and file-backed Core project processes.
- 2026-06-08: Electron managed-Core startup now publishes the Core product endpoint before creating the renderer BrowserWindow. `main.ts` calls `loadRuntimeCore()` ahead of `loadExecutorWindow()` so the preload can synchronously expose `openadeAPI.core.runtimeEndpoint` and the classic desktop product store does not depend on a timing race to attach to Go Core. A focused startup-order regression test locks this down while the packaged managed-Core smoke remains the real end-to-end proof.
- 2026-06-08: The copied-data import/parity CLI now has restart-idempotency coverage. The real CLI/Core integration test imports file-backed Yjs data plus images, snapshot patches, and Claude/Codex transcripts into a spawned Go Core, stops that Core, restarts a fresh Core process on the same SQLite/blob data directory, reruns the actual bundled CLI, and proves the second run remains `ok: true` with zero parity mismatches while reporting the existing image, patch, and transcript blobs as already imported instead of duplicated or conflicted.
- 2026-06-08: The copied-data import CLI can now import Core-owned resource blobs as part of the same real migration command. `npm run import:yjs:core -- --import-resources` runs the Yjs document importer, then calls Core `openade/import/legacyResources` through `OpenADEClient` for referenced legacy images and snapshot patches, defaulting resource roots to the parent of a `yjs` data directory or an explicit `--resources-dir`. `--import-sessions` with `--claude-config-dir` and/or `--codex-home` also imports referenced Claude Code/Codex transcripts. The CLI JSON report includes `importedResources` and fails on skipped resource kinds plus missing/conflicted/failed image, patch, or session imports. The real CLI/Core integration tests now write file-backed Yjs data under the canonical copied `data/yjs` layout plus sibling `data/images` and `data/snapshots`, add Claude and Codex JSONL files, run the actual bundled CLI with only `--data-dir data/yjs`, read the imported task image and snapshot patch back from the spawned Go Core over WebSocket, verify the transcript blobs were written under Core's blob directory, and prove missing copied resource directories return `ok: false` with a nonzero exit.
- 2026-06-08: Copied-data parity now has a real preview usage/stats fixture. The file-backed Yjs import test seeds a full `OpenADETaskPreviewUsage` payload, imports through `OpenADEClient` into a spawned Go Core, and asserts `openade/snapshot/read` returns the same usage totals, model cost breakdown, event count, duration, and stats version. The copied-data CLI test also seeds preview usage so `npm run import:yjs:core` proves stats parity through the actual command/report path.
- 2026-06-08: Copied-data parity now covers task resource inventories. `projects/openade-module/src/yjsImportParity.ts` calls Core `openade/task/resourceInventory/read` through the real `OpenADEClient` and compares durable snapshot ids, action image refs, harness sessions from action execution/HyperPlan sub-executions/task metadata, and worktree identity against the old Yjs projection. Dynamic `isRunning` and git-derived `branchMerged` are intentionally excluded from old-data parity because they are runtime state, not copied Yjs product data. The real Yjs-to-Core import test now seeds action image refs, snapshot patches, top-level and HyperPlan sessions, and metadata sessions, then proves zero parity mismatches against a spawned Go Core over WebSocket.
- 2026-06-08: Go Core task reads now expose legacy-compatible comment fields while preserving the current Core fields. SQLite comments still return `body` and `anchor`, but `commentsDTO()` also projects `content`, `source`, `selectedText`, and `author` from stored `anchor_json` when present. Focused Core product tests and the real Yjs-import-to-Core test now assert the compatibility shape, closing the comment DTO mismatch found by the importer slice.
- 2026-06-08: `projects/openade-module/src/yjsImport.ts` now preserves legacy queued turns through a trusted non-executing product route. Go Core registers `openade/queued-turn/importLegacy`, validates the legacy queued-turn DTO, stores it with `CreateQueuedTurn`, emits task/queued-turn notifications, and deliberately does not call queue drain or start an executor. `OpenADEClient.importLegacyQueuedTurn()` exposes the typed method, and the generated client contract map includes it. Real verification covers a WebSocket Core test proving import does not create runtime records, task events, or executor requests; the live generated-contract test proving Core capabilities and typed client drift; and the real file-backed Yjs-to-Core import test proving queued-turn DTO preservation.
- 2026-06-08: `projects/openade-module/src/yjsImportParity.ts` now provides the first reusable old-Yjs-vs-Core DTO parity report for the migration path. It compares legacy `OpenADEYjsProjection` output against a real `OpenADEClient` Core snapshot/task reads for stable repo, preview, task, queued-turn, comment, and event semantics, while normalizing benign wire differences such as ISO timestamp precision, absent optional fields, and externalized snapshot patch blobs. The live Yjs import integration test now asserts zero parity mismatches after importing into a real Core over WebSocket and then deliberately mutates Core task metadata to prove the parity report detects semantic drift. This is the harness foundation for copied-production-data parity; broader copied-production corpus runs and transcript-session fixtures still need to be added before rollout.
- 2026-06-08: `projects/openade-module/src/yjsImport.ts` now contains the first trusted legacy Yjs-to-product-API importer. It reads existing Yjs data through `OpenADEYjsProjection`, writes repos, tasks, setup/action/snapshot events, comments, queued turns, and supported task metadata through typed OpenADE product writer methods with stable `clientRequestId`s, and returns explicit skipped/error records for unsupported or malformed data. A real integration test writes source data into file-backed Yjs, launches a real Go Core over WebSocket, imports through `OpenADEClient`, then reads Core SQLite-backed task DTOs to verify the imported repo/task/comment/setup/action stream/snapshot/queued-turn path. This is meaningful Phase 3 progress, but not full production migration yet: copied-production-data parity/performance fixtures still need to be added before rollout.
- 2026-06-08: `@openade/openade-client` now has a checked generated contract map for its typed OpenADE methods. `projects/openade-client/openade-contracts.json` records the current method name, request DTO, response DTO, and read-coalescing set; `scripts/generate-openade-contracts.mjs` emits `src/generated/openade-contracts.ts`, checks that every public `OpenADEClient` runtime method string is in the contract source, and checks that each contracted method is registered by Go Core. `OpenADEClient.request()` is now typed by generated method/request/response mappings, and `npm run typecheck` in `projects/openade-client` runs the contract check before the no-`any` and `tsgo` gates. This is not the final cross-language schema generator, but it closes the immediate hand-wired TypeScript client drift gap while Core contracts continue moving toward a single schema source.
- 2026-06-08: `@openade/openade-client` now verifies its generated contract map against a live Go Core in package tests. `src/generated/openade-contracts.test.ts` launches `go run ./cmd/openade-core` with an isolated SQLite/data directory, initializes the real runtime WebSocket with bearer auth, asserts every generated OpenADE method is advertised by Core capabilities, and then drives `OpenADEClient.getSnapshot()` through `RuntimeClient`. This keeps the generated TypeScript client backed by a real Core server rather than a mocked runtime surface.
- 2026-06-08: Desktop now has a product-store bridge for Core resource import orchestration. The TypeScript OpenADE module can register `openade/import/legacyResources` when a host adapter provides a real importer, `OpenADEProductStore.importLegacyResources()` calls it through the selected runtime client and refreshes the cached snapshot, and `CodeStore.importProductLegacyResources()` gives desktop migration UI/commands one typed entry point. A real RuntimeServer/OpenADEClient web-store test proves the helper sends the import request over the runtime product API, attaches `clientRequestId`, refreshes snapshot cache state, and avoids legacy Yjs store refreshes. This is resource/blob/transcript import trigger wiring only; the full Yjs repo/task importer remains a separate Phase 3 gap.
- 2026-06-08: The managed-Core packaged smoke now proves more than Core launch and snapshot bootstrap. It creates a real temp git repo, launches packaged Electron with the bundled Core and isolated Core/Yjs/user data, connects from the renderer to `openadeAPI.core.runtimeEndpoint` over a real browser WebSocket, then exercises Core-owned repo create, task create/read, comment create, task metadata update, scoped file tree/read/write, fuzzy/content search, project git info, and project process config list before running the rollout telemetry reviewer. This raises the opt-in Core package gate toward real product-backend coverage while keeping the classic IPC desktop workflow smoke separate until desktop is Core-default.
- 2026-06-08: Go Core WebSocket auth now negotiates the bearer subprotocol correctly. Core still receives trusted and paired tokens through `Sec-WebSocket-Protocol: bearer.<token>`, but `core.HTTPServer` now echoes the selected bearer subprotocol during `websocket.Accept`; otherwise browser and Node WebSocket clients reject the handshake with "Sent non-empty Sec-WebSocket-Protocol header but no response was received" even though HTTP health and server auth are healthy. A focused Core test asserts the negotiated subprotocol, and the managed-Core packaged smoke proves the renderer can connect to the bundled Core over a real browser WebSocket.
- 2026-06-08: The managed-Core packaged smoke now runs the same `projects/web` runtime-product rollout reviewer as the legacy packaged desktop smoke. After launching Electron with the bundled Core behind `OPENADE_USE_OPENADE_CORE=1` and `OPENADE_CORE_MANAGED=1`, the smoke exports real renderer `app_opened` telemetry from local storage, runs `npm run review:runtime-product-rollout -- <telemetry.ndjson>`, attaches the telemetry and review output, and requires a PASS. This keeps the opt-in Core attach path aligned with the broad-rollout telemetry gate rather than relying only on inline `app_opened` assertions.
- 2026-06-08: Electron managed Core launch now has a packageable binary path. `projects/electron/build.mjs` builds `projects/openade-core/cmd/openade-core` into `dist/openade-core/openade-core` (or `.exe` on Windows), electron-builder includes `dist/openade-core/**`, and `runtimeCore.ts` prefers the built dev binary or packaged binary under `process.resourcesPath` before falling back to `go run ../openade-core/cmd/openade-core`. This removes the runtime Go toolchain dependency from managed-Core testing after the Electron build has run. Core is still opt-in behind `OPENADE_USE_OPENADE_CORE=1` and `OPENADE_CORE_MANAGED=1`; production-default backend ownership still requires migration UX, packaged smoke coverage, fallback policy, and full host/execution cutover.
- 2026-06-08: Packaged smoke now has a separate managed-Core attach test. The existing packaged desktop workflow smoke remains on the trusted IPC runtime so it can keep proving classic desktop behavior; the new smoke launches Electron with isolated user/Core/Yjs data plus `OPENADE_USE_OPENADE_CORE=1` and `OPENADE_CORE_MANAGED=1`, waits for renderer smoke telemetry proving the runtime product store is enabled, ready, and has a snapshot, then connects from the renderer to `openadeAPI.core.runtimeEndpoint` with a real browser WebSocket and calls Core `initialize` plus `openade/snapshot/read`. This proves the packaged Electron shell can start the bundled Go Core and route the renderer product-store bootstrap to Core without claiming the full desktop UI is Core-default yet.
- 2026-06-08: Electron can now launch a development OpenADE Core process behind `OPENADE_USE_OPENADE_CORE=1` plus `OPENADE_CORE_MANAGED=1`. `projects/electron/src/modules/runtimeCore.ts` keeps the existing trusted local IPC runtime loaded for raw desktop host methods, but when managed Core is requested and no external `OPENADE_CORE_RUNTIME_URL` is set, it builds a Core launch plan, generates or preserves a bearer token, starts `go run ../openade-core/cmd/openade-core` by default on `127.0.0.1:37376`, and publishes `OPENADE_CORE_RUNTIME_URL`/`OPENADE_CORE_TOKEN` before preload exposes `openadeAPI.core.runtimeEndpoint`. This is a Phase 2 launcher bridge for development and rollout testing, not production-default backend ownership yet.
- 2026-06-09: Go Core now owns trusted/local usage-preview recalculation and bulk backfill through `openade/task/usage/recalculate` and `openade/task/usage/backfill`. The bulk method accepts optional repo/task filters, skips previews that already have usage v2 plus duration unless forced, scans real SQLite task-event rows, computes the existing `OpenADETaskPreviewUsage` v2 shape from action and HyperPlan execution streams, persists `task_previews.usage_json`, and emits task/preview notifications. Clean managed-Core desktop stats backfill now groups explicit user-triggered work by repo and calls the bulk typed product method instead of loading full task event history in the renderer or issuing one runtime request per task; the TypeScript renderer `computeTaskUsage()` path remains only for legacy/runtime compatibility. Real WebSocket/storage product tests prove usage aggregation, skip/force behavior, metadata persistence, preview refresh, notifications, and missing-task errors.
- 2026-06-09: The generated TypeScript OpenADE client contract test now drives `openade/task/usage/backfill` against a spawned Go Core over WebSocket, not only an in-memory TypeScript runtime or Go-only harness. It builds the WebSocket URL through the shared browser/mobile `runtimeSocketUrl()` session helper, creates a real Core repo/task/action event through typed client mutations, appends a Codex completion usage event, calls `OpenADEClient.backfillTaskUsage()`, and verifies the Core-computed usage appears in `openade/snapshot/read`. This keeps the new bulk stats path and remote attach URL contract on the contract-first verification ladder.
- 2026-06-08: Desktop renderer product calls now have a narrow Go Core attachment path. Electron preload exposes optional `openadeAPI.core.runtimeEndpoint` only when `OPENADE_USE_OPENADE_CORE=1` and `OPENADE_CORE_RUNTIME_URL` is a valid `ws:`/`wss:` URL; `projects/web/src/runtime/localProductRuntimeClient.ts` uses that endpoint for the `OpenADEClient` and product notifications, otherwise it falls back to the existing trusted local IPC runtime. Raw desktop host wrappers still use `runtime/localRuntimeClient.ts`, so this is not the final Electron-main removal, but it gives the classic desktop product store a real Core WebSocket path without routing raw `git/*`, `fs/*`, `pty/*`, or host methods into Core prematurely.
- 2026-06-08: The Electron Yjs compatibility bridge now keeps loaded document bytes cached for 15 seconds, invalidated/updated by in-app saves, and the renderer storage driver skips `Y.applyUpdate()` when a refresh returns identical bytes. This is a Phase 0 mitigation for idle/task-switch refresh loops that repeatedly touched `code:personal_settings`, `code:repos`, and active task documents just outside the previous 1-second cache window. It reduces disk reads and redundant Yjs decode work while Go Core continues replacing normal product reads with SQLite/blob-backed runtime DTOs.
- 2026-06-08: Go Core now owns trusted/local MCP server settings rows through `openade/settings/mcpServers/read`, `openade/settings/mcpServers/replace`, `openade/settings/mcpServers/upsert`, and `openade/settings/mcpServers/delete`. The methods store the existing desktop MCP row shape in SQLite settings, preserve preset ids, health state, timestamps, HTTP headers, OAuth access/refresh tokens, stdio args/env/cwd, and enabled state, validate transport-specific fields and timestamps, and stay out of paired-device grants because they expose secrets and local process commands. `OpenADEClient.readMcpServers()`, `replaceMcpServers()`, `upsertMcpServer()`, `deleteMcpServer()`, and shared DTOs provide the typed caller surface. A real WebSocket/storage/executor test proves empty read, replace/import, readback, execution-time MCP config resolution from rows written through the API, upsert, delete, invalid URL rejection, and paired capability denial.
- 2026-06-08: Classic desktop MCP settings now route through the typed product settings API when runtime-backed reads are active. `kernel/productStore.ts` and `CodeStore` expose read/replace/upsert/delete helpers, `McpServerManager` imports legacy `code:mcp_servers` rows only when product settings are empty, mirrors product rows into the existing classic observable list, and persists add/update/delete/OAuth/health changes back through `openade/settings/mcpServers/*`. The TypeScript OpenADE module and Electron/runtime-node compatibility hosts also expose these methods over their legacy Yjs storage using shared `yjsMutation` helpers, preserving stdio `cwd`. Real local-runtime web tests prove Core/runtime projection, legacy import, and mutation persistence through `OpenADEClient`; real node Yjs storage tests prove MCP row replace/upsert/delete round trips.
- 2026-06-08: Go Core now has trusted/local staged task-image garbage collection through `openade/task/images/gcStaged`. The method lists Core-owned `task_image` blob metadata, scans all task events and queued turns for referenced image ids, retains referenced and young unreferenced blobs, supports dry-run reporting, deletes metadata only when the scanned row is unchanged, and removes orphan files best-effort without returning local paths. `OpenADEClient.gcStagedTaskImages()` and shared DTOs expose the typed caller surface. Real storage tests prove kind-filtered blob listing and delete-if-unchanged behavior; a real WebSocket/storage/filesystem product test proves old orphan removal, dry run, young orphan retention, event/queued reference retention, non-image blob retention, and post-GC image reads.
- 2026-06-08: Go Core now persists bounded process stdout/stderr and PTY output history in SQLite `runtime_output_chunks`. Project process and task terminal output append paths write real subprocess/PTY output to storage, prune per-runtime history to the same bounded reconnect limits, and use a narrow active-runtime timestamp touch so late output cannot overwrite completed runtime state. `openade/project/process/reconnect` and `openade/task/terminal/reconnect` still prefer live in-memory state, but can now fall back to durable output for matching completed/orphaned runtimes after Core memory loss; explicitly stopped processes/terminals still return not found. Storage tests prove prune/cascade behavior and active-only runtime touch; real WebSocket product tests prove durable reconnect fallback plus real process/PTY output persistence. This is not live pipe adoption after restart, but it removes the previous output-history loss.
- 2026-06-08: Go Core slow runtime request telemetry now logs by default and carries the operational fields required by `goal.md`: service name, method, bounded/sanitized request id, connection id, duration, queue wait, handler time, failure state, and sanitized error code. The custom slow-request observer still works for tests/tools, and passing `nil` restores the default logger. Focused core tests prove queue/handler separation, event identity fields, default log fields, and request-id control-character/truncation sanitization. This closes the Core runtime observability gap for the request router; product-specific slow spans and performance-budget gates still need broader coverage.
- 2026-06-08: Go Core now has durable stored device-token authentication, Core-owned pairing issuance/exchange, active paired-connection closure on revoke, and the trusted `remote/device/*` management surface. SQLite migration v4 adds `devices.token_hash` and `devices.last_seen_at`; storage helpers cover device listing, token-hash lookup, last-seen touch, single revoke, and drop-all revoke. `core.HTTPServer` now accepts a product-installed bearer authenticator after the trusted Core token check; `product.ConfigureDeviceAuthentication()` authenticates non-revoked stored device tokens, applies paired permissions or device-specific permission JSON, records the connection device id, and touches last-seen once per connection. Core registers trusted `remote/pairing/start`, admin `remote/device/list`, `remote/device/revoke`, `remote/device/dropAll`, paired `remote/device/selfRevoke`, and `remote/device/changed`; paired devices only receive self-revoke plus the safe paired product profile, and cannot start pairing. `remote/pairing/start` returns the companion-compatible `{url, token, hostId, expiresAt}` payload and stores a short-lived one-use token hash; unauthenticated `POST /v1/pair` rate-limits by remote address and can only exchange that live session token for a hashed stored device bearer token. Runtime connections now have a close hook keyed by device id: admin revoke closes all live sockets for that device, drop-all closes all paired-device sockets, and self-revoke closes sibling sockets immediately while closing the caller after the success response is written. Real SQLite, HTTP, and WebSocket tests prove pairing start, HTTP pairing exchange, one-use token rejection, stored device creation, paired token auth, paired capability filtering, durable self-revoke, live-socket closure, revoked-token reconnect denial, trusted admin list/revoke/drop-all, and device change notifications.
- 2026-06-08: Go Core now has an opt-in paired-client permission profile through `OPENADE_CORE_PERMISSION_PROFILE=paired`. The profile is product-owned policy applied before the runtime server starts, keeps default local Core trusted, and lets explicit `OPENADE_CORE_PERMISSIONS` override the preset. It grants high-level product reads plus normal task-thread actions while denying raw Yjs, repo admin, file writes, git commit, terminals, import/migration, snapshot-create, action-event plumbing, HyperPlan plumbing, process start/stop, process output notifications, and PTY output notifications. Real WebSocket/runtime tests prove paired capabilities include safe product methods, exclude trusted methods, deny a trusted file-write request before the handler runs, deliver `openade/task/updated`, and filter `pty/output`. This is a safe attach profile for browser/mobile work, not the final per-device/session permission system.
- 2026-06-08: Go Core now owns HyperPlan sub-execution action payload mutations through `openade/hyperplan/subExecution/add`, `openade/hyperplan/subExecution/stream/append`, `openade/hyperplan/subExecution/update`, and `openade/hyperplan/reconcileLabels/set`. The handlers preserve the existing TypeScript/UI `hyperplanSubExecutions` shape, validate primitive/status and required step/harness/model fields, no-op duplicate sub-execution adds, dedupe stream events by id, update only provided typed string fields, and skip missing reconcile-label targets without rewriting the event. A real WebSocket/storage runtime test proves add, duplicate suppression, stream append dedupe, update, reconcile labels, custom-field preservation, notifications, and invalid status validation.
- 2026-06-08: Go Core now owns `openade/task/title/generate`. The method resolves repo/task/workdir through Core storage, builds the existing concise-title prompt with bounded recent task-event context, runs the configured executor in read-only title mode when a description and executor are available, parses `Title:`/assistant-message outputs, falls back to the existing title or truncated description when generation is unavailable, persists the title through Core task metadata storage, emits task/preview notifications, and honors `clientRequestId` idempotency. Real WebSocket/storage/executor tests prove read-only executor inputs, event-context prompt inclusion, metadata persistence, notifications, idempotent retry without rerunning the executor, and no-executor fallback.
- 2026-06-08: Go Core `runtime/reconcile` now verifies persisted agent worker process identity before reporting stale agent runtime state. For agent runtimes with stored `pid` metadata and `running`, `starting`, or `orphaned` status, Unix Core checks process liveness with signal `0`; if the worker is gone, Core uses the same agent stop path as `runtime/stop` to persist the matching action/queued turn as stopped, terminalize the runtime with a sanitized error, emit `runtime/stopped`, and refresh working-task notifications. Windows remains conservative until a real Windows process probe lands. A real WebSocket/storage test starts and reaps an actual child process, stores that dead PID on an agent runtime, calls `runtime/reconcile`, and proves the runtime and action settle. This still does not claim active execution reattach; it closes the verified-dead side of recovery.
- 2026-06-08: Go Core `runtime/reconcile` now also verifies persisted project process PIDs. Process runtimes with `running`, `starting`, or `orphaned` status and a stored PID are checked with the same conservative OS liveness probe; if the PID is verified dead, Core persists the runtime as `stopped`, records `process is no longer running`, emits `runtime/stopped`, and leaves terminal runtimes unchanged. A real WebSocket/storage test starts and reaps an actual child process, stores that dead PID on a process runtime, and proves reconcile updates and notifies through the runtime API. The later 2026-06-09 file-backed process capture slice adds live project-process adoption/output tailing after restart.
- 2026-06-08: Go Core command-worker execution now persists process identity onto agent runtime records. `CommandAgentExecutor` records the worker PID, Unix process-group id when available, and `processStartedAt` through the executor update path before sending the worker start envelope; Core stores that metadata in the runtime payload and emits `runtime/updated`. The real subprocess-backed turn test now proves `runtime/read` exposes the worker process metadata after the turn completes. This does not claim active execution reattach is complete, but it gives restart/recovery work a durable process handle instead of an opaque in-memory goroutine.
- 2026-06-08: Go Core now owns product-level `openade/turn/interrupt`. The method finds an active task-owned `agent` runtime, delegates to the same stop path as `runtime/stop`, persists the action event as `stopped`, stores the stopped runtime record, cancels the executor, emits working-task/runtime notifications, honors `clientRequestId` idempotency, and returns the legacy-compatible `{ ok: false, error }` shape when no server-owned task runtime is active. Real WebSocket/storage/executor tests prove active interrupt, idempotent retry after the stop, inactive-task result shape, and late executor output being ignored.
- 2026-06-08: Go Core now owns `openade/review/start` for executor-backed task reviews. The method validates the existing review contract, builds the classic plan/work review prompts from Core task events plus recent snapshot file summaries, extracts prior plan text from persisted Claude/Codex raw messages, creates a review action/runtime, runs it through `AgentExecutor` with `ReadOnly: true`, and auto-starts a read-only ask follow-up from the review output using the existing action/runtime settlement path. The Go `CommandAgentExecutor` and TypeScript `openade-harness-worker` protocol now carry a typed `readOnly` flag and map it to `HarnessQuery.mode = "read-only"`. Real WebSocket/storage/executor tests prove review idempotency, prompt content, task MCP config propagation, read-only review/follow-up requests, persisted action events, runtime completion, and validation errors; subprocess and worker tests prove the read-only flag crosses the process boundary. Remaining execution gaps are active execution reattach and production-default wiring.
- 2026-06-08: Go Core now has trusted/local legacy harness transcript import through `openade/task/sessions/importLegacy`. The method scans task-owned session ids from action execution payloads, HyperPlan sub-execution payloads, and task metadata `sessionIds`, locates real Claude Code project JSONL files from `CLAUDE_CONFIG_DIR`/`~/.claude` or explicit `claudeConfigDir` and Codex JSONL files from `CODEX_HOME`/`~/.codex` or explicit `codexHome`, copies referenced files into Core-owned `harness_session` blobs under `sessions/<harness>/<session>.jsonl`, preserves source files, and reports imported/already-imported/missing/conflicted/failed counts. `openade/import/legacyResources` can now orchestrate session import when `importSessions` or explicit session roots are provided, and `OpenADEClient.importLegacyTaskHarnessSessions()` plus shared DTOs expose the typed caller surface. A real WebSocket/temp-filesystem test proves Claude, Codex, already-imported, missing, retry, and orchestrated import behavior.
- 2026-06-08: Go Core task deletion now supports `deleteSessions` for best-effort CLI transcript cleanup. Core collects task-owned session ids from action execution payloads, HyperPlan sub-execution payloads, and task metadata `sessionIds`, then deletes Claude Code session JSONL/subagent/debug files from `CLAUDE_CONFIG_DIR` or `~/.claude` and Codex session/archived JSONL files from `CODEX_HOME` or `~/.codex`; unknown harness ids are ignored and Core device/client sessions and imported `harness_session` blobs are untouched. A real WebSocket/temp-filesystem test proves task delete removes referenced Claude/Codex session files and leaves unrelated session files intact.
- 2026-06-08: Go Core task resource inventory now derives `isRunning` from Core runtime records instead of returning a placeholder false value. `openade/task/resourceInventory/read` marks a task running when any `starting` or `running` runtime has `scope.ownerType = "openade-task"` and the matching task id, and ignores terminal or other-task runtimes. The existing real WebSocket/temp-git inventory test now seeds SQLite runtime records and proves false before active ownership, false for terminal/wrong-task records, and true for an active task-owned runtime. This aligns Core inventory with the TypeScript OpenADE module contract now that Core owns execution/runtime records.
- 2026-06-08: Go Core task reads now project persisted task metadata JSON for valid `createdBy`, `enabledMcpServerIds`, and `sessionIds` fields through concrete DTOs with tolerant trimming/filtering. Runtime tests assert these fields on `openade/task/read` rather than only checking SQLite storage, and the real Yjs-to-Core import/parity test now preserves task-level `createdBy` plus `enabledMcpServerIds`.
- 2026-06-08: Go Core `openade/task/metadata/update` now safely merges legacy `sessionIds` and `cancelledPlanEventId` into persisted task metadata JSON while keeping `queuedTurns` on first-class queue rows and leaving `enabledMcpServerIds` as create-time metadata for now. `openade/task/read` projects `cancelledPlanEventId`, storage tests prove metadata JSON updates persist with preview refreshes, and the real Yjs-to-Core import/parity test now includes legacy session ids and cancelled-plan metadata with no expected skips.
- 2026-06-08: `projects/openade-module` now has `npm run import:yjs:core` for copied legacy Yjs data verification against a running Go Core. The command bundles a typed CLI with the repo's existing esbuild/yjs install, reads a copied Yjs directory, writes through real `OpenADEClient`, runs old-Yjs-vs-Core parity, prints a JSON report, and exits nonzero on import errors/skips or parity mismatches. The integration test runs the actual CLI against a spawned real Go Core and temp file-backed Yjs data.
- 2026-06-07: Go Core now has trusted/local resource import orchestration through `openade/import/legacyResources`. The method accepts a legacy data directory or explicit image/snapshot directories, defaults data roots to `images` and `snapshots`, reuses the bulk legacy image and snapshot import paths, skips missing derived subdirectories with typed `skipped` entries, rejects missing explicit directories, preserves source files, and keeps the route out of paired-device grants because it accepts raw host directories. A real WebSocket/storage/filesystem test proves image and snapshot import from one data root, reference-gated image read, snapshot patch read, idempotent retry, missing-subdirectory skip reporting, and explicit missing-dir rejection. `OpenADEClient.importLegacyResources()` and shared DTOs provide the typed caller surface. A later 2026-06-08 slice added optional harness transcript session import orchestration. Remaining blob/resource work is migration UI/trigger wiring and active execution reattach.
- 2026-06-07: Go Core now has trusted/local bulk legacy snapshot patch import through `openade/task/snapshots/importLegacy`. The method scans Core task events for valid `patchFileId` references, dedupes refs across tasks, copies matching `patchFileId.patch` files from a local legacy snapshot directory into Core-owned `snapshot_patch` blob storage, preserves source files, reports imported/already-imported/missing/conflicted/failed counts, and keeps patch reads/indexing behind the existing task snapshot event resolver. A real WebSocket/storage/filesystem test proves import, Core blob metadata/path/hash, duplicate ref handling, already-imported detection, conflict and missing-file reporting, invalid ref skipping, idempotent retry, and `openade/task/snapshot/patch/read` plus index reads from the imported blob. `OpenADEClient.importLegacyTaskSnapshots()` and shared DTOs provide the typed caller surface. Remaining blob/resource work is migration UI/trigger wiring and active execution reattach.
- 2026-06-07: Go Core now has trusted/local single and bulk legacy image import primitives: `openade/task/image/importLegacy` and `openade/task/images/importLegacy`. Single import validates sanitized image ids/ext/media types, requires a local regular source file under the 20 MB image limit, copies bytes into the Core blob directory as `task_image` metadata, preserves the source file, reuses same-id/same-content idempotency and conflict semantics, and keeps reads reference-gated through `openade/task/image/read`. Bulk import scans Core task events and queued turns for referenced image ids, dedupes refs across tasks, copies matching `imageId.ext` files from a local legacy image directory, reports imported/already-imported/missing/conflicted/failed counts, and preserves source files. Real WebSocket/storage/filesystem tests prove both routes, Core blob metadata/path/hash, reference-gated event/queued-turn reads, retries, conflict handling, missing source reporting, and media mismatch rejection. `OpenADEClient.importLegacyTaskImage()` / `importLegacyTaskImages()` and shared DTOs provide the typed caller surface. Remaining image/resource work is migration UI/trigger wiring and active execution reattach.
- 2026-06-07: Runtime-backed desktop image attachment now persists resized image bytes through the OpenADE product boundary before turn/task creation. Classic `InputBar`, `TaskCreatePage`, `SmartEditor` paste/drop, and page drop zones pass a typed `persistImage` callback into `processImageBlob()`; `CodeStore.persistProductTaskImage()` calls `OpenADEProductStore.writeTaskImage()` / `openade/task/image/write` when runtime product reads are active and keeps `dataFolderApi` only as the legacy fallback. The TypeScript OpenADE module, Electron product adapter, and Node kernel adapter now expose the trusted-local `openade/task/image/write` compatibility route while Go Core remains the target owner. RuntimeServer-backed web tests prove product-store image writes and CodeStore runtime persistence carry real base64 bytes through the route. Remaining image/resource work is migration UI/trigger wiring and active execution reattach.
- 2026-06-08: Go Core task deletion now supports `deleteWorktrees` for Git-registered imported/external task worktrees without weakening path safety. Core still accepts deterministic Core-managed worktrees under the configured worktree base, but imported paths must be listed by `git worktree list --porcelain` for the repo, must be on the exact `openade/<slug>` branch, and must not point at the repository root. Imported cleanup targets require live Git registration during removal, so Core will not fall back to raw `os.RemoveAll` for arbitrary external paths. Real WebSocket plus temp-git tests prove imported registered worktree deletion removes the directory, git worktree entry, exact branch, and task row, while unregistered external paths still reject before task deletion.
- 2026-06-07: Go core task deletion now supports `deleteWorktrees` for Core-managed worktrees. Cleanup targets must match the deterministic configured Core worktree base plus task slug before deletion can proceed; after SQLite deletion, Core best-effort removes the git worktree, prunes stale worktree metadata when needed, and deletes the exact `openade/<slug>` branch if present. Real WebSocket plus temp-git tests prove prepare/delete removes the directory, git worktree entry, branch, and task row, and reject unsafe external stored worktree paths without deleting the task. A later 2026-06-08 slice added Git-registered imported/external worktree cleanup.
- 2026-06-07: Go core task deletion now supports `deleteImages` and `deleteSnapshots` for Core-owned blobs. It scans task events and queued turns for `task_image` and `snapshot_patch` references, skips blob ids still referenced by other tasks, deletes task/blob metadata transactionally, and removes owned files best-effort. Real storage plus WebSocket/filesystem product tests prove selected metadata deletion, owned file removal, shared blob preservation, and post-delete shared resource reads. Later cleanup slices added CLI transcript session cleanup and Git-registered imported/external worktree cleanup.
- 2026-06-07: Go core now owns initial `openade/task/image/write`. The trusted/local mutation validates sanitized image ids/exts, requires media type to match extension, decodes base64 bytes, writes `task_image` blobs under the configured Core blob directory, stores SQLite blob metadata with size/hash/content type, treats same-id/same-content retries as idempotent, and rejects same-id/different-content conflicts. A real WebSocket/storage/filesystem test proves upload, metadata/path/hash, task-reference-gated reads, idempotent retry, conflict handling, and media mismatch rejection. A later 2026-06-07 slice cut runtime-backed desktop/create image upload over to this product method with a TypeScript module compatibility bridge. Remaining image/resource work is migration UI/trigger wiring and active execution reattach.
- 2026-06-07: Go core now owns initial `openade/snapshot/create`. The trusted/local mutation validates the existing TypeScript snapshot-create DTO, proves the referenced action event belongs to the task, writes non-empty `fullPatch` content into a Core-owned `snapshot_patch` blob under the configured blob directory with SQLite blob metadata, persists the snapshot event with `fullPatch: ""` plus lightweight `patchFileId`, emits task/snapshot notifications, and honors `clientRequestId` idempotency. A real WebSocket/storage/filesystem test proves create, blob metadata/hash/path, task-read projection, patch read, index read, slice read, retry behavior, and missing-action rejection. Remaining blob/resource work is production Yjs blob import and active execution reattach.
- 2026-06-07: Core execution now expands task image refs into worker prompt images. `openade/turn/start` and queued-turn drain keep persisted action/queued-turn `images` as lightweight refs, then build executor-only image payloads by resolving referenced `task_image` blob metadata after the action exists, proving task ownership with the same reference checks used by `openade/task/image/read`, reading the blob bytes, and sending base64 image sources to the worker. Missing blobs are skipped like the legacy Electron prompt assembly path; invalid refs never grant raw path access. Real product tests seed temp image files plus SQLite blob metadata and prove both initial turns and queued follow-ups deliver base64 prompt images to the executor. Migration UI/trigger wiring and active execution reattach remain pending.
- 2026-06-07: Core execution now propagates MCP server configs through the Go `CommandAgentExecutor` and TypeScript `openade-harness-worker` protocol. The worker validates optional `mcpServerConfigs` from the start envelope and passes them to `HarnessQuery.mcpServers`; focused worker tests prove real stdin/stdout protocol behavior. Go Core now has SQLite settings helpers and resolves selected `enabledMcpServerIds` from the `mcp_servers` setting into harness config objects for initial and queued turns, including HTTP header copying, OAuth access-token Authorization injection, and disabled/unselected row filtering. Real SQLite/product/subprocess tests prove settings round-trip, core-owned MCP config resolution into executor requests, and command-worker envelope propagation. Later 2026-06-08 slices added trusted typed MCP settings read/replace/upsert/delete methods and classic desktop settings routing through those methods. Remaining execution gaps are active execution reattach after restart and production-default Core launch wiring.
- 2026-06-07: `@openade/harness` now ships a typed OpenADE Core worker CLI (`openade-harness-worker`, backed by `projects/harness/src/agent-worker.ts`). The worker reads the Go Core `CommandAgentExecutor` protocol version 1 `start` envelope from stdin, runs Claude Code or Codex through the existing `HarnessQuery` interface, writes NDJSON `stream` messages using the same persisted `raw_message` / `session_started` / `stderr` / `complete` / `error` event shapes the classic renderer already consumes, writes `execution` updates with session id and best-effort final git refs, and writes a terminal `result`. Focused tests use a deterministic harness executor and real stdin/stdout stream behavior. This makes the process boundary usable with the existing harness package after `yarn build`; the later 2026-06-09 worker recovery transcript slice adds active execution restart adoption for resumable command workers.
- 2026-06-06: Go core now has a process-bound `CommandAgentExecutor` bridge for external harness workers. When `OPENADE_CORE_AGENT_WORKER_COMMAND` is set, the `openade-core` binary wires an executor that launches the configured command in the repo cwd, writes a typed JSON `start` envelope to stdin, reads NDJSON `stream`, `execution`, and `result` messages from stdout, persists stream/session/git-ref/result state through the same action/runtime path, treats cancellation as stopped, and fails closed on invalid worker protocol. `OPENADE_CORE_AGENT_WORKER_COMMAND` accepts a JSON string array so command and args do not require shell parsing. Real WebSocket/storage tests use an actual subprocess worker to prove the boundary. The later 2026-06-09 worker recovery transcript slice adds active execution restart adoption for resumable command workers.
- 2026-06-06: Go core now owns executor-backed queued-turn drain. Completed executor turns attempt to claim the oldest queued row for the task, serialize drain behind a service queue mutex plus active-agent-runtime check, assign the queued action event id into the queued-turn payload, create a real action event/runtime, emit queued-turn/task/runtime/working-task notifications, and run the queued work through the same `AgentExecutor` path. Running queued turns settle to `completed`, `error`, or `stopped` from executor/runtime state; `runtime/stop` and startup orphan reconciliation also stop linked running queued turns. Real storage tests cover queued-turn claim, running-event assignment, completion, unchanged terminal rows, and ordering; a real WebSocket/storage executor test covers queued follow-up execution after an active turn completes. MCP/blob expansion for real turns and active execution reattach remain pending.
- 2026-06-06: Go core now owns initial `openade/turn/start`, stop settlement for those core-started agent runtimes, restart orphan reconciliation for their action events, and an injectable `AgentExecutor` execution boundary. Turn start validates the existing turn contract, creates or reuses SQLite tasks, creates an in-progress action event, persists a running `agent` runtime record, emits task/runtime/working-task notifications, preserves deterministic task IDs from `repoId + clientRequestId`, and runs a configured executor asynchronously. Executor stream events, session ids, parent session ids, git refs, and terminal completed/failed/stopped results are persisted through the same action-event storage helpers; runtime records emit completed/failed/stopped notifications and working-task updates. `runtime/stop` marks those runtimes stopped, writes the matching action event to `stopped`, cancels the active executor, and prevents late executor completion/output from overwriting the stopped state. Startup marks previously active agent runtimes `orphaned` and reconciles matching in-progress actions to `stopped`. Real WebSocket/storage/runtime tests cover new-task turns, existing-task turns, idempotent retry, executor completion/stream persistence, stop race handling, startup orphan reconciliation, and `run_plan` validation. MCP/blob expansion for real turns and active execution reattach remain pending.
- 2026-06-06: Go core now owns initial action-event persistence primitives: `openade/action/create`, `openade/action/stream/append`, `openade/action/complete`, `openade/action/error`, `openade/action/stopped`, `openade/action/reconcileRuntime`, and `openade/action/execution/update`. The methods write SQLite task-event rows, preserve the existing action payload JSON shape, dedupe repeated stream events by stream event id, update task previews for terminal events, honor `clientRequestId` idempotency, and are covered by a real WebSocket/storage lifecycle test. This is execution-state persistence only; full turn/harness orchestration remains a later slice.
- 2026-06-06: Go core now owns initial `openade/task/terminal/start`, `openade/task/terminal/reconnect`, `openade/task/terminal/write`, `openade/task/terminal/resize`, and `openade/task/terminal/stop`. The methods resolve repo/task workdirs server-side, use the deterministic `openade-task-terminal-*` id format, run a real PTY shell, buffer reconnect output, persist `pty:*` runtime records, emit `pty/started`, `pty/output`, `pty/killed`, and runtime notifications, support `runtime/stop`, and honor `clientRequestId` idempotency for mutations. Real WebSocket integration tests cover start/retry, reconnect, write/output, resize, invalid terminal ids, stop, notifications, and runtime records. Paired-device grants remain blocked until interactive shell permissions are explicit.
- 2026-06-06: Go core now owns queued-turn enqueue and reorder alongside queued-turn cancel, with SQLite `queued_turns.position`, deterministic queued-turn ids from `taskId + clientRequestId`, explicit task/queued-turn notifications, idempotent retry behavior that preserves existing queued-turn payloads, and typed `OpenADEClient.enqueueQueuedTurn()` / `reorderQueuedTurns()` helpers. Real storage and real WebSocket tests cover enqueue, retry/no-overwrite, ordering, reorder, invalid payloads, duplicate reorder ids, and task-read queue projection.
- 2026-06-06: Go core now owns initial `openade/task/create`, and `OpenADEClient` has a typed `createTask()` helper. The core method creates SQLite task/preview rows plus initial device environment/setup event rows in one transaction, preserves existing task data on retry/collision instead of overwriting, emits task/snapshot notifications for new rows, validates head/worktree isolation, and mirrors the existing TypeScript deterministic task id format for `repoId + clientRequestId`. Real storage and real WebSocket tests cover create/read/list/preview metadata, setup-event hydration, notification fanout, deterministic ids, missing repos, invalid isolation, and no-overwrite behavior.
- 2026-06-06: Go core process lifecycle now persists process runtime records in SQLite, exposes `runtime/list`, `runtime/read`, `runtime/reconcile`, and `runtime/stop`, emits `runtime/created`, `runtime/completed`, `runtime/failed`, and `runtime/stopped` notifications alongside process notifications, and marks previously active persisted records as `orphaned` on startup. Real storage tests cover record round-trip/orphaning, and real WebSocket/subprocess tests cover runtime notifications, stop-through-runtime, and startup orphaning. The later 2026-06-09 file-backed process capture slice supersedes orphaning as the only defined recovery behavior for Core-owned project processes that have live PIDs and capture files.
- 2026-06-06: Go core process lifecycle now emits `process/started`, `process/output`, and `process/exit` notifications over the real runtime WebSocket, with `process/error` reserved for start/wait failures. Tests prove started/output/exit notification payloads for successful processes and stop-triggered terminal events. A later 2026-06-06 slice added durable runtime records and runtime notifications.
- 2026-06-06: Go core now owns an initial in-memory `openade/project/process/start`, `openade/project/process/reconnect`, and `openade/project/process/stop` lifecycle. Starts resolve `openade.toml` process definitions server-side for repo/head/prepared-worktree task scopes, run the configured command in the resolved cwd, buffer bounded stdout/stderr chunks, expose scoped instances through `openade/project/process/list`, enforce repo/task scope for reconnect/stop, and honor `clientRequestId` idempotency for start/stop. Real WebSocket plus temp-project/temp-git tests cover process output reconnect, instance listing, idempotent start/stop, wrong-scope denial, invalid definitions, and worktree cwd execution without repo-root leakage. Later slices added process notifications, durable runtime records, runtime stop integration, and 2026-06-09 file-backed restart adoption for Core-owned project processes.
- 2026-06-06: Go core process config reads now support task scopes. `openade/project/process/list` resolves omitted task ids to the repo path, head tasks to the repo path, and prepared worktree tasks to the latest completed stored device environment worktree; unprepared worktree tasks fail explicitly. Real WebSocket plus temp-project/temp-git tests cover repo-root parsing, head task reads, prepared worktree-only process configs, and worktree cwd resolution. This slice still returned empty `instances`; a later 2026-06-06 slice added initial in-memory process lifecycle instances.
- 2026-06-05: Go core project file/search methods now support task scopes. `openade/project/files/tree`, `openade/project/file/read`, `openade/project/file/write`, `openade/project/files/fuzzySearch`, and `openade/project/search` resolve omitted task ids to the repo path, head tasks to the repo path, and prepared worktree tasks to the latest completed stored device environment worktree; unprepared worktree tasks fail explicitly. Real WebSocket plus temp-filesystem/temp-git tests cover head task reads, prepared worktree reads/writes/fuzzy/content search, and repo-root leakage prevention.
- 2026-06-05: Go core task git methods now resolve prepared worktree tasks through stored device environments instead of rejecting all worktree isolation. The default task git summary/scopes/changes/diff/file-pair/log/commit-files/file-at-treeish/commit-file-patch/commit paths use the repo path for head tasks and the latest completed worktree environment for worktree tasks; unprepared worktree tasks fail explicitly. Changes/diff/file-pair use the stored merge base as the default comparison point for worktree tasks. Real WebSocket plus temp-git tests cover prepared worktree history, changes, diffs, file pairs, and commits on the task branch.
- 2026-06-05: Go core now owns initial `openade/task/environment/setup` and `openade/task/environment/prepare`. Core stores task device environments in SQLite, includes them in `openade/task/read`, creates/reuses real `openade/<task-slug>` git worktrees under the configured core worktree directory, appends setup events for worktree tasks, honors `clientRequestId` idempotency, and is verified by real WebSocket plus temp-git integration tests. Later slices added task-scoped file/search/process/terminal/git paths and explicit `worktree:*` git log scope selection.
- 2026-06-05: Go core now owns initial head-mode `openade/task/git/commit`. The mutation resolves repo/task ownership through SQLite, validates and trims commit messages, stages all scoped head-task changes with real `git add -A`, maps commit results to `committed`, `nothing_to_commit`, or `failed`, honors `clientRequestId` idempotency, and is verified by a real temp-git WebSocket integration test. Worktree commits remain explicitly rejected until commit resolves task workdirs from prepared core environments, and paired clients should not receive commit permission until scoped commit grants are designed.
- 2026-06-05: Go core now owns initial task snapshot patch reads: `openade/task/snapshot/patch/read`, `openade/task/snapshot/index/read`, and `openade/task/snapshot/patch/readSlice`. The methods resolve repo/task/event ownership through SQLite, support inline `fullPatch` and `snapshot_patch` blob-backed patch files, build byte-offset patch indexes in core, validate patch file ids and slice ranges, and are verified by real WebSocket plus temp-filesystem integration tests. A later 2026-06-07 slice added Core-owned snapshot patch writes; production Yjs blob import still needs to land before this replaces all legacy snapshot storage.
- 2026-06-05: Go core now owns initial `openade/task/image/read`. The method validates image id/ext, resolves task ownership through SQLite, verifies the image is referenced by task events or queued turns before reading anything, reads only `task_image` blob metadata paths, returns base64 data or `null` for missing/unreferenced images, and is verified by real WebSocket plus temp-filesystem integration tests. A later 2026-06-07 slice added Core-owned task image writes; production image import still needs to land before this can replace all legacy image storage.
- 2026-06-05: Go core now owns initial `openade/task/resourceInventory/read`. The method resolves repo/task ownership through SQLite, reads the full task event stream from indexed task-event rows, extracts task-owned snapshot patch ids, image refs, harness sessions, and worktree cleanup metadata, checks worktree branch merge status with real `git`, and is verified by a real WebSocket plus temp-git integration test. A later 2026-06-08 slice connected `isRunning` to Core runtime records.
- 2026-06-05: Go core now owns initial branch-only head-mode `openade/task/git/scopes/read`. The method resolves repo/task ownership through SQLite, calls real `git`, returns the canonical `branch:HEAD` scope plus local and optional remote branch scopes, preserves default-branch metadata, and is verified by a real temp-git WebSocket integration test. Worktree scopes are intentionally omitted until core owns task workdir/environment and worktree lifecycle.
- 2026-06-05: Go core now owns initial head-mode `openade/task/git/summary/read`. The method resolves repo/task ownership through SQLite, calls real `git`, returns the existing lightweight summary DTO used by classic desktop task refresh, covers staged/unstaged/untracked stats, and is verified by a real dirty temp-git WebSocket integration test. Worktree tasks are explicitly rejected until core owns task workdir/environment and worktree lifecycle.
- 2026-06-05: Go core now owns initial head-mode task working-tree reads for the Changes tray: `openade/task/changes/read`, `openade/task/diff/read`, and `openade/task/filePair/read`. These resolve repo/task ownership through SQLite, call real `git`, include untracked files, return patch stats/truncation flags and before/after file pairs, validate treeish/path/context inputs, and are covered by a real dirty temp-git WebSocket integration test. Worktree tasks are explicitly rejected until core owns task workdir/environment and worktree lifecycle.
- 2026-06-05: Go core now owns initial head-mode task git history reads: `openade/task/git/log`, `openade/task/git/commit/files/read`, `openade/task/git/fileAtTreeish/read`, and `openade/task/git/commit/filePatch/read`. These resolve repo/task ownership through SQLite, call real `git`, preserve existing OpenADE DTO shapes, validate treeish/path/context inputs, return commit patch stats/truncation flags, and are covered by a real temp-git WebSocket integration test. This slice originally rejected worktree tasks; a later 2026-06-05 slice added prepared-worktree task git resolution while keeping explicit `scopeId` selection pending.
- 2026-06-05: Go core now owns initial repo-root scoped `openade/project/file/write`. The method resolves repo paths server-side, enforces scoped relative paths, supports utf8/base64 writes and optional parent-directory creation, honors `clientRequestId` idempotency, and is covered by real temp-filesystem WebSocket integration tests. A later 2026-06-05 slice added head/prepared-worktree task resolution for writes.
- 2026-06-05: Go core now owns initial `openade/project/process/list` config reads. The method resolves repo paths server-side from SQLite project records, parses real `openade.toml` files, returns configs/process definitions/cwd errors with an empty instances array until process lifecycle moves into core, and is covered by a real temp-project WebSocket integration test. A later 2026-06-06 slice added head/prepared-worktree task resolution for process config reads.
- 2026-06-05: Go core now owns initial scoped project file/search reads: `openade/project/files/tree`, `openade/project/file/read`, `openade/project/files/fuzzySearch`, and `openade/project/search`. These resolve repo paths server-side, enforce scoped relative paths, skip `.git` and generated/hidden paths by default, preserve existing DTO shapes, and are covered by real temp-filesystem WebSocket integration tests. A later 2026-06-05 slice added head/prepared-worktree task resolution for file/search reads.
- 2026-06-05: Go core now owns initial scoped project git reads: `openade/project/git/info/read`, `openade/project/git/branches/read`, and `openade/project/git/summary/read`. These resolve repo paths server-side from SQLite project records, call real `git`, preserve the existing OpenADE DTO shapes including non-git empty/default responses, and are covered by real temp-repo WebSocket integration tests.
- 2026-06-05: Go core queued turns are now first-class SQLite rows included in `openade/task/read`, and `openade/queued-turn/cancel` matches the legacy runtime behavior by cancelling only turns still in `queued` status. The method emits `openade/task/updated` plus `openade/queuedTurn/updated`, honors `clientRequestId` idempotency, and is covered by real WebSocket integration tests.
- 2026-06-05: Go core product mutations now honor `clientRequestId` idempotency with in-flight request coalescing and short successful-result retention. Real WebSocket tests cover retrying generated repo creation, generated comment creation, and task deletion without duplicated rows or false `not_found` errors.
- 2026-06-05: Go core now owns initial repo/comment/task deletion mutations: `openade/repo/create`, `openade/repo/update`, `openade/repo/delete`, `openade/comment/create`, `openade/comment/edit`, `openade/comment/delete`, and `openade/task/delete`. These run against SQLite, emit OpenADE notifications over the real runtime WebSocket, and initially rejected task-delete cleanup options until later slices added first-class resource ownership. The cleanup/import slices now handle Core-owned image/snapshot blobs, CLI transcript session files, Core-managed worktree/branch cleanup, Git-registered imported/external worktree cleanup, and Core-owned harness transcript import.
- 2026-06-05: TypeScript package `typecheck` scripts now run `scripts/check-no-explicit-any.mjs` before `tsgo`, and current non-test source scans clean across `projects`. Real boundary exceptions must use a nearby real source comment with `openade-allow-explicit-any: concrete reason`; fake string markers and bare allow markers are rejected, and the guard reports documented exception counts. Routine code should use concrete types, `unknown`, or named JSON boundary aliases.
- 2026-06-05: Go core non-test code now avoids direct `any` usage. Runtime dynamic values are named `core.JSONPayload`, product DTOs use concrete structs or validated `json.RawMessage`, and a core hygiene test scans non-test Go files to prevent direct `any` from returning.
- 2026-06-08: Added the first real runtime performance budget gate for OpenADE Core reads. `TestProductReadPerformanceBudgetsOverRuntime` seeds production-shaped SQLite data, exercises `openade/snapshot/read` and bounded `openade/task/read` over WebSocket, and fails if snapshot read exceeds 250ms or bounded task read exceeds 200ms. The runtime test harness now raises its client read limit so large snapshots prove the real transport path instead of hiding behind a 32KB client cap.
- 2026-06-08: Extended Core performance budget coverage to the remaining hot operations called out in `goal.md`. `TestProductHostOperationPerformanceBudgetsOverRuntime` builds a real temp git repo with hundreds of committed source files, multiple `openade.toml` configs, skipped generated files, and a dirty worktree, then exercises `openade/project/git/summary/read`, `openade/project/process/list`, and `openade/project/files/fuzzySearch` over WebSocket. The hard gates are 750ms for project git summary, 500ms for process list, and 500ms for fuzzy search, with correctness assertions on staged/unstaged/untracked summary data, process config counts, and the top fuzzy result.
- 2026-06-05: Go core now handles the narrow `openade/task/metadata/update` subset needed for fast title, closed, last-viewed, last-event, and preview-usage updates. The mutation updates `tasks` plus `task_previews` in SQLite, rejects unsupported metadata fields explicitly, emits `openade/task/updated` and `openade/task/previewChanged`, and is covered by real WebSocket integration tests.
- 2026-06-05: Go core WebSocket runtime now routes responses and notifications through one outbound writer queue per connection. This keeps transport behavior production-safe as notification volume grows and avoids concurrent WebSocket writes from separate goroutines.
- 2026-06-05: SQLite-backed OpenADE read methods started in `projects/openade-core/internal/product` and registered on the Go runtime: `openade/snapshot/read`, `openade/project/list`, `openade/task/list`, and `openade/task/read`. Integration tests seed a real temp SQLite store, connect over a real WebSocket runtime server, verify initialize capabilities, bounded task event hydration, full hydration, comments, preview JSON, and runtime error codes.
- 2026-06-05: OpenADE Core SQLite storage started in `projects/openade-core/internal/storage` with versioned migrations for repos, tasks, previews, events, comments, queued turns, runtimes, sessions/devices, settings, usage, and blob metadata. The CLI now opens the configured SQLite store before serving runtime traffic.
- 2026-06-05: `projects/openade-core` Go module started with config loading, health/version endpoints, existing runtime wire shape over WebSocket, bearer subprotocol auth, initialize/status/subscription methods, permission-filtered capabilities, and slow-request timing split.
- 2026-06-05: Destination clarified as standalone Go OpenADE Core with SQLite/blob storage and TypeScript/React shells. See [goal.md](goal.md).
- 2026-06-05: `plan.md` cleaned up to focus on the execution plan; historical implementation notes remain available through git history and package guidance files.
- 2026-06-01: Classic desktop UI reaffirmed as canonical. Compact companion/mobile screens are not a desktop replacement.
- 2026-06-01: Runtime-backed desktop reads must keep task opening responsive with lightweight task reads and explicit full-history hydration.
- 2026-06-01: Scoped product methods are the path to web/mobile parity; paired clients do not get raw host powers by default.

## Open Questions

- Should the Go core embed a TypeScript harness worker for near-term reuse, or should harness execution move fully to Go subprocess orchestration immediately?
- What is the exact contract/schema source for generating Go validators and TypeScript client DTOs?
- What is the migration UX for existing local data: silent import, explicit prompt, or dual-read until confidence threshold?
- What remote permission roles should exist beyond trusted desktop and paired companion?
- Which features should remain desktop-only for product reasons even after the core supports them?
