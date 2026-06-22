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

## 90% Process-Reduction Dogfood Mode

The current migration mode is local dogfood speed, not release-hardening after every edit. Keep the final destination in [goal.md](goal.md), but target 90-95% less process overhead by optimizing daily work around broad, coherent vertical slices and checkpoint verification.

Process budget:

- one short orientation pass per slice
- one bulk implementation pass per slice
- one focused checkpoint proof per slice
- one compact handoff per slice
- broad checks only at push, default flips, fallback removal, storage/import changes, host-authority changes, or release readiness
- roughly 90% implementation time and 10% process time while a local dogfood slice is active
- in practical terms, delete nine out of ten process loops: avoid repeated scans, repeated guidance rereads, routine test reruns, routine doc edits, small cleanup passes, and small commits while the workflow is still incomplete

This mode is the default for the active local dogfood migration. Do not drift back into release-hardening cadence unless the user explicitly asks for release readiness, a default flip, a fallback removal, a storage/import semantic change, or a host-authority expansion.

Expected reduction versus the previous cadence:

| Work category | Previous migration cadence | Current dogfood cadence | Expected reduction |
| --- | --- | --- | ---: |
| Verification commands during coding | Many focused and broad checks per small edit | One focused proof per coherent vertical slice | 90-95% |
| Full package/repo gates during coding | Repeated package checks before the slice is locally usable | Only at push, default flips, fallback removal, storage/import changes, host-authority changes, or release readiness | 90-95% |
| Plan/doc/status churn | Patch-level implementation journals and frequent process updates | Durable docs only for explicit requests, architecture, gates, active slice, or handoff state | 90-95% |
| Broad file scans and rereads | Repo-wide scans and repeated guidance rereads | One targeted read of active files and only newly entered local guidance | 90-95% |
| Adjacent cleanup and warning-chasing | React Doctor/capability/type cleanup around the active work | Only cleanup blocking the current workflow or a gate checkpoint | 90-95% |
| Total process overhead | Many small cleanup commits and verification loops | Two or three coherent vertical-slice commits with checkpoint proof | 90-95% |

Operational estimate: this should remove roughly 90-95% of migration process overhead while local Core dogfood is still being made usable.

Hard cap: if a command, scan, proof, doc update, or intermediate cleanup pass does not answer a blocking question for the current slice, do not do it during implementation. Save it for the next checkpoint or release-hardening pass. Extra process is opt-in and must have a clear reason: it prevents likely wasted implementation, proves a just-touched host/storage/permission boundary, or is explicitly requested by the user.

Default slice budget:

| Process item | Normal dogfood budget |
| --- | ---: |
| Targeted source/guidance read pass | 1 |
| Bulk implementation pass | 1 |
| Verification commands while coding | 0 |
| Focused checkpoint proof | 1 |
| Broad gates | 0 until push/default/fallback/storage/host/release checkpoint |
| Durable-doc edits | 0 unless direction, gates, active slice, or handoff state changed |
| Intermediate cleanup commits | 0 |

Use this cadence:

1. Pick one user-visible workflow.
2. Cut it vertically through Core/runtime/client/shared shell.
3. Keep the old Electron/Yjs path only as import, compatibility, or explicit fallback.
4. Keep coding until the slice reaches a real checkpoint.
5. Run the smallest real-path proof for the slice.
6. Batch full checks, docs, mobile/web smoke, performance budgets, and release gates at push/default/release checkpoints.

Commit strategy:

- prefer two or three larger vertical-slice commits for a dogfood milestone
- include several related file edits in one commit when they serve the same user-visible workflow
- avoid standalone cleanup commits unless the cleanup removes a real blocker or would otherwise obscure the next bulk implementation pass
- do not pause for a commit solely because one helper, component, or test changed

Default priority order:

- task open through indexed Core reads
- turn start, event streaming, interrupt, retry, and restart recovery
- git summary, diff, log, scopes, and commit
- file tree/search/read/write and content search
- project processes and task terminals
- settings, MCP connectors, pairing/session management, and notification refresh

What to stop doing during fast dogfood:

- no stopping after every file or helper extraction
- no tests after routine edits
- no full typecheck/check until push, default flips, fallback removal, storage/import changes, host-authority expansion, or release-risk checkpoints
- no docs updates unless explicitly requested or a durable architecture/gate/slice/handoff fact changes
- no plan updates unless the work spans many files and coordination would clearly save time
- no repeated status messages unless blocked, changing phase, or handing off
- no broad repo scans when targeted reads are enough
- no re-reading already-known guidance unless entering a new nested scope or changing durable docs there
- no full package checks after tiny UI wiring edits
- no broad React Doctor warning cleanup
- no broad capability or type-shape cleanup unless it blocks the active workflow
- no mobile/web/packaged Electron smoke on every desktop shared-shell change
- no production-data import parity, rollback drill, or performance budget suite unless storage/default/fallback semantics changed
- no effort to polish legacy Yjs/Electron paths except to keep import/fallback usable

Definition of a checkpoint:

- a user-visible workflow works end to end through the intended Core/runtime/shared-shell path
- the old path is kept only as explicit compatibility/fallback where needed
- expensive panels and background refreshes are not reintroduced into route open or idle paths
- missing capabilities fail closed and do not issue denied or fallback requests
- the slice has one narrow real-path proof or a clear note explaining why manual local feedback is the proof

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

The first Go core slice now exists in `projects/openade-core`: a standalone runtime server, SQLite migrations/store, SQLite-backed OpenADE read methods for snapshots, projects, task lists, and task detail, queued-turn and device-environment rows in task reads, stored device-token auth, trusted remote-device management methods, Core-owned one-use pairing issuance/exchange for companion device tokens, active paired-connection closure on revoke/drop-all/self-revoke, MCP server settings read with read-only summary redaction plus trusted replace/upsert/delete, runtime-backed classic desktop MCP settings projection/import/write routing, scoped project file/search/process-config reads over repo/head/prepared-worktree task roots, initial project process start/reconnect/stop backed by in-memory live state plus durable runtime records and bounded SQLite output history, runtime list/read/reconcile/stop methods for those records, scoped task terminal start/reconnect/write/resize/stop backed by real PTY processes plus durable runtime records and bounded SQLite output history, scoped project git info/branch/summary reads, task git reads/commit over head tasks and prepared worktree tasks, initial task environment setup/prepare, plus initial product mutations for repos, tasks, comments, queued-turn enqueue/reorder/cancel/trusted legacy import, task image write/read/trusted staged preview read/trusted single and bulk legacy import, snapshot patch read/write/trusted bulk legacy import, trusted legacy resource import orchestration, runtime-backed desktop/create image upload cutover through `openade/task/image/write`, runtime-backed SmartEditor stashed preview restore through `openade/task/image/staged/read`, image/snapshot blob cleanup, staged-image garbage collection, and Core-managed worktree/branch cleanup on task deletion, runtime-record-backed task inventory `isRunning`, action-event persistence, HyperPlan sub-execution persistence, initial turn start/interrupt with command-worker process identity and restart recovery/adoption transcripts, verified-dead reconciliation in runtime records, fail-closed Unix termination for live orphaned agent workers that Core cannot reattach, review start with read-only follow-up handoff, task metadata/title generation, and task deletion. Electron can start managed Core explicitly for development/smoke and now auto-starts the packaged Core for clean production installs with no legacy Yjs documents. Desktop System settings now has a Core-endpoint-gated Import All path that imports legacy Yjs repo/task data plus selected resource/blob roots, marks Core launch accepted only when both reports are clean, keeps separate rerun triggers for data/resources, and has an accepted-import rollback control that removes only the accepted marker for the next launch. Existing Yjs-backed installs still stay legacy until explicit opt-in/import, so production-default backend ownership still requires migration completion review and full host/execution cutover.

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

Each workstream should climb only as high as the change risk requires. Local dogfood slices do not need to clear the full ladder unless they make Core default-on, remove a fallback, change durable storage semantics, or widen host permissions.

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

## Local Feedback Track

During 90% process-reduction dogfood, do not block usable local feedback on the full production rollout gate. Verification should be batched by coherent slice, not run after every small edit.

While iterating inside a slice:

- inspect targeted files only
- make bulk edits that complete the workflow path
- run no tests by default
- run no typecheck by default
- run no docs updates by default
- run no plan updates by default
- run no broad repo scans by default
- run one focused test, scoped no-`any`, typecheck, or manual smoke only when the result changes the next edit or prevents likely wasted work
- prefer one larger checkpoint verification over many small green checks

The phase-level verification lists below describe release/default/fallback/storage/host-authority checkpoints. They are not required after routine implementation edits during local dogfood.

The phase sections below are the release roadmap, not a standing checklist for every coding pass. During the active local-feedback slice, use the current dogfood slice section as the source of truth and treat deeper phase gates as deferred unless the slice crosses their named risk boundary.

At a slice checkpoint, run the smallest proof that matches the risk:

- UI-only shell wiring: focused shell/component tests plus scoped no-`any`
- runtime/client wiring: one real `RuntimeServer`/`RuntimeClient` or `OpenADEClient` test
- Core storage/host behavior: one real Core test with temp storage, temp repo, process, PTY, or WebSocket as relevant
- contract changes: generated contract drift check
- medium-boundary changes: desktop shell smoke first; mobile/web smoke only when imports, routing, or host adapters changed

Run broad gates only before push, default-on changes, fallback removal, storage/import changes, host-authority expansion, or release readiness:

- package `typecheck` / `check`
- repo no-explicit-`any`
- React Doctor serious-error gates
- mobile/web attach smoke
- packaged Electron smoke
- production-data import/parity
- restart/recovery proof
- performance budgets
- rollback drills

Do not add new gates just because a feature moved behind the shared shell. Add a gate only when the change expands host authority, changes durable data, changes fallback policy, flips a default, or exposes a previously local-only feature to paired/browser/mobile clients.

Document only architecture decisions, changed gates, completed vertical slices, and handoff state. Do not use `plan.md` as an implementation journal for every cleanup patch.

## Capabilities And Shell First

Before more backend ownership migration, keep only the shell/capability work required to make the shared shell dogfoodable. Do not keep broadening this into general cleanup once controls are capability-derived, fail closed, and use lightweight opens.

This is intentionally a local-feedback gate, not a production migration gate. Do not block the first local dogfood pass on legacy-data import parity, packaged Electron restart smoke, mobile simulator proof, rollback drills, or full performance budget coverage unless this slice changes storage, fallback policy, default backend selection, or paired-device authority. The proof for this slice is capability completeness, fail-closed UI/handler behavior, lightweight opens, and focused real runtime tests.

Scope:

- Pairing/session shell: connect, switch sessions, match desktop theme, self-revoke.
- Project shell: snapshot/project task list, files, content search, git info/branches/summary, read-only cron definitions, process list/output, and capability-gated process start/stop.
- Task shell: lightweight task detail, turns, reviews, comments, queued-turn enqueue/reorder/cancel, metadata, plain delete, image reads/uploads, snapshot patch reads, resource inventory, capability-gated terminal, and git changes/diff/file-pair/log/scopes/summary/commit-file inspection.
- Capability source: derive visible controls from runtime `initialize.capabilities`, not from medium assumptions.
- Permission shape: paired clients get scoped product methods only; raw host, terminal, commit, file-write, cleanup, settings-admin, and migration powers stay hidden and denied until explicitly granted.

Local exit criteria:

- The shared shell exposes all paired-safe product capabilities needed for dogfooding.
- Missing capabilities hide or disable the relevant controls and handlers return without issuing denied requests.
- Server permissions match the advertised shell capabilities.
- Task/project opening stays on lightweight DTO reads; expensive git/process/search/resource panels stay lazy/manual.
- Focused shell/component tests plus one real `RuntimeServer`/`OpenADEClient` remote integration path cover the changed controls.

## Current Dogfood Slice

The current local-feedback target is Core-backed classic desktop task opening through indexed reads. Shared shell parity is treated as the baseline, not the active cleanup target.

Next vertical slice:

- open the classic desktop task route through shared shell/runtime/Core
- read task metadata, latest bounded events, comments, preview state, queued turns, resources needed for first paint, and runtime state from indexed Core storage
- avoid normal renderer Yjs reads and avoid full snapshot projection on task switch
- keep git/process/file/search/resource panels lazy/manual after first paint
- prove the slice with one Core/runtime task-read test, one desktop/shared-shell route or store test, and a manual/local smoke only if automation cannot exercise the path cheaply

Shared-shell parity baseline:

- project tasks, files, search, process list/output with capability-gated controls, git info/branches/summary, cron definitions, trusted/local cron run-now, and capability-gated cron install-state controls
- task detail, turns, reviews, comments, queued-turn enqueue/reorder/cancel, metadata, delete, images, snapshot patches, resource inventory, capability-gated task terminal, capability-gated MCP connector selection, and task git changes/diff/file-pair/log/scopes/summary/commit-file inspection
- remote session pairing, session switching, theme matching, device self-revoke, runtime notification refresh behavior, and mobile thin-host reuse of the shared remote shell instead of a separate companion product UI

Current Core/runtime baseline:

- Go Core owns the first SQLite-backed runtime server path, including snapshot/project/task reads, task metadata/comments/queued turns, task images/snapshot patches/resources, selected settings, task create/delete, turn start/interrupt/review, runtime records, scoped git/file/search/process/terminal paths, MCP settings, pairing/session methods, and legacy import/resource import primitives.
- Desktop can start managed Core for development/smoke and auto-start the packaged Core for clean production installs with no legacy Yjs documents. Existing Yjs-backed installs remain legacy until explicit opt-in/import.
- Runtime product paths now prefer scoped project/task DTO reads over broad snapshot projection where available, use capability-derived controls, and fail closed instead of falling back to raw Electron/Yjs paths in Core-owned sessions.
- Tactical TypeScript/Yjs compatibility caches and notification coalescing reduce request amplification during dogfood, but they are bridges only. The destination remains indexed Core SQLite/blob reads with no hot Yjs projection.

Local dogfood focus:

- finish task-open responsiveness through direct Core reads and route-first loading
- remove duplicated shell/capability/type shapes only when they block the active workflow
- fix request amplification that shows up in real local logs, especially repeated settings/repos/task loads, eager git/process/search calls, and duplicate metadata/settings writes
- keep task/project opening on lightweight DTO reads; expensive git/process/file/search/resource panels stay lazy/manual unless the classic route needs them for first paint

Do not append dated implementation entries here. Use git history, PR descriptions, and final handoff notes for routine patch evidence. Update this section only when the active vertical slice, baseline capability state, or handoff state changes.

Defer broader mutating/admin parity until after local feedback unless it blocks dogfooding: OAuth token editing, connector health/test flows, and any decision to grant repo create/update/delete, title generation, environment prepare, git commit, cron run-now, cron install-state mutation, or file writes to paired devices by default.

## Production Exit Checklist

Local dogfood readiness is not the same as completing [goal.md](goal.md). Before production default rollout, the migration must prove these remaining items with current-state evidence:

- Backend ownership: clean installs and accepted-import installs use OpenADE Core for normal product reads, mutations, execution, scoped git/files/search/process/PTY operations, settings, scheduling, permissions, and notifications. Electron main must remain only chrome, lifecycle, bootstrap, local trust, dialogs, and narrow native integrations.
- Fallback policy: legacy Yjs/Electron product paths remain available only for unaccepted legacy installs or explicit rollback states. Normal Core-owned routes, managers, trays, settings, cron, companion, and shared/mobile/web shells must not silently fall back to legacy product storage or raw host APIs when a scoped Core product method is missing.
- Data migration: copied production-like `~/.openade` data imports into SQLite/blob storage, resource import reruns are idempotent, and old Yjs projections match Core DTOs for snapshots, projects, task previews, task detail, comments, usage/stats, queued turns, resource inventories, image refs, snapshot patch refs, and active runtime state.
- Runtime contract: `openade-contracts.json` remains the single product contract source for Core, TypeScript compatibility runtime, generated client helpers, permissions, notification filtering, and shared shell capabilities. New `openade/*` or `remote/*` methods must fail checks until generated and validated.
- Medium parity: classic desktop stays the canonical UI; mobile and browser attach through the same shared shell/store over `/v1/runtime`; no compact companion product UI becomes the desktop or mobile product surface. Paired clients receive scoped product capabilities only, with raw host/admin/migration powers denied by default.
- Observability and performance: slow logs split queue wait and handler time with method, request id, service, failure state, and sanitized error code. Performance gates cover task read, snapshot/project reads, git summary, process list, fuzzy search warm/cold paths, and packaged desktop task switching without Yjs decode/projection churn.
- Verification: release gating includes focused package checks, no-explicit-`any` over `projects` and `scripts`, generated contract checks, real Core WebSocket/client tests, real temp git/file/process/storage tests, desktop packaged smoke, mobile/shared-shell smoke, browser attach smoke, production-data import/parity, restart/recovery tests for active executions, and rollback-marker behavior.

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

Update docs in the same change when behavior changes, but do not turn durable docs into a patch-by-patch activity log:

- Root `CLAUDE.md` for durable direction.
- `goal.md` only when the destination or active operating mode changes.
- `plan.md` only when migration phases, gates, active vertical slices, or handoff state change.
- Package `CLAUDE.md` files when ownership or boundary rules change.
- Runtime/OpenADE contract docs when methods, permissions, or notifications change.
- Storage migration docs before shipping importer/migration behavior.
- Use git history, PR descriptions, and final handoff notes for routine implementation details and command transcripts.

## Decision Log

Keep this section for durable decisions only. Do not add patch-by-patch verification notes, command transcripts, or routine cleanup summaries.

- 2026-06-15: Active migration work uses 90% process-reduction dogfood mode. Agents should batch coherent vertical slices, run no default tests while coding, run one focused checkpoint proof per slice, and reserve broad gates for push, default flips, fallback removal, storage/import changes, host-authority changes, and release readiness.
- 2026-06-15: Classic desktop UI remains canonical. Web and mobile should reuse the desktop-derived shared shell and medium adapters, not revive the compact companion product UI as a second product implementation.
- 2026-06-15: Go is the default OpenADE Core language. The durable backend target is a standalone Go daemon with SQLite/blob storage, typed runtime/OpenADE contracts, generated TypeScript client helpers, and thin TypeScript/React shells.
- 2026-06-15: Normal Core-owned product routes must fail closed when scoped product capabilities are missing. They must not silently fall back to renderer Yjs stores, raw Electron git/file/process APIs, or broad snapshot projection after Core owns the session.
- 2026-06-15: `openade-contracts.json` is the current product contract source for generated OpenADE client helpers, method/notification drift checks, and paired permission profiles. Generated TypeScript and Go output must stay in sync with that contract.
- 2026-06-15: Paired/browser/mobile clients receive scoped product capabilities only. Raw host, terminal, commit, file-write, cleanup, settings-admin, and migration powers stay hidden and denied until an explicit role decision grants them.
- 2026-06-15: Existing-task `openade/turn/start` is append-only for task identity. New task creation is explicit through `openade/task/create`; legacy new-task `openade/turn/start` remains compatibility-only.
- 2026-06-15: TypeScript/Yjs projection caches, notification coalescing, and lightweight DTO routing are tactical dogfood bridges. They should not become the long-term storage architecture or justify keeping hot Yjs projection in normal product flow.

## Open Questions

- Should the Go core embed a TypeScript harness worker for near-term reuse, or should harness execution move fully to Go subprocess orchestration immediately?
- What is the final shared schema format for generated request/response validators beyond the current structurally validated `openade-contracts.json` method/notification/error-code source?
- What is the final production rollout UX after the explicit Settings Import All path: proactive launch prompt, first-run banner, or settings-only migration entry point until confidence threshold?
- What remote permission roles should exist beyond trusted desktop and paired companion?
- Which features should remain desktop-only for product reasons even after the core supports them?
