# Shared Shell And Remote Kernel Migration Plan

## Purpose

Move the Electron desktop app and the mobile companion toward one shared OpenADE application shell attached to a runtime kernel. The intended end state is not two separate products with duplicated UI and transport logic. It is one product surface that can run through different medium adapters:

- Electron desktop shell
- Capacitor mobile shell
- Browser web shell
- Future CLI/headless clients where applicable

The kernel owns durable OpenADE state, host capabilities, runtime lifecycle, subscriptions, permissions, and execution. Clients render UI, keep local interaction state, and call the kernel through a typed runtime client.

This plan is deliberately verification-heavy. Each migration slice must prove behavior through real runtime, storage, transport, notification, and host paths. Tests that only prove mocks were called do not count as migration confidence.

## Current Shape

### Runtime And Product Kernel

The core kernel pieces already exist but are not packaged as one first-class OpenADE host:

- `projects/runtime` owns the reusable `RuntimeServer`, request routing, capabilities, subscriptions, notification replay, permissions, and lifecycle state.
- `projects/runtime-client` owns WebSocket and local transport clients.
- `projects/runtime-node` owns generic Node host adapters for files, git, process, PTY, agents, checkpoints, liveness, and a generic HTTP/WebSocket server.
- `projects/openade-module` owns product concepts: projects, tasks, turns, comments, snapshots, HyperPlan, Yjs projection, and Yjs mutation.
- `projects/openade-client` owns typed OpenADE API helpers over a runtime-compatible transport.

Electron currently composes a rich in-process runtime in `projects/electron/src/modules/companion/runtimeGateway.ts`. Mobile connects to that runtime over the companion WebSocket at `/v1/runtime`.

### Desktop Renderer

Desktop is already partially runtime-backed, but it is still a privileged local renderer:

- `projects/web/src/runtime/localRuntimeClient.ts` creates a trusted local runtime client over Electron IPC.
- `projects/web/src/runtime/localOpenADEClient.ts` wraps that client with `OpenADEClient`.
- `projects/web/src/store/store.ts` subscribes to runtime notifications and then refreshes local Yjs-backed stores.
- `projects/web/src/persistence` still exposes renderer-visible Yjs store loading and refresh.
- `projects/web/src/electronAPI` wraps local runtime host methods and narrow Electron IPC features.
- Desktop trays such as Changes, Files, Git Log, Search, Terminal, Scratchpad, and Processes are desktop/full-shell features today.

Desktop is therefore a hybrid: mutations and execution have moved toward the runtime, but read models and much of the view state still assume local trusted storage and host access.

### Mobile Companion

Mobile is already a thin shell:

- `projects/mobile/src/App.tsx` owns native QR scanning, secure storage mirroring, OTA readiness, and error reset.
- The main mobile UI is imported from `projects/web/src/remote/RemoteApp.tsx`.
- `projects/web/src/remote/client.ts` owns pairing URL parsing, host validation, config persistence, runtime WebSocket construction, reconnect status, and remote reads/actions.

The current remote UI is intentionally narrower than desktop. It reads snapshots/tasks, starts turns, interrupts turns, and listens to runtime notifications. It does not yet expose desktop parity for comments, title edits, task delete, review flows, model/MCP controls, files, diffs, terminal, process control, or rich settings.

### Permission Boundary

Paired mobile devices currently get a safe subset of runtime methods. Trusted desktop local IPC has full access. This must remain intentional. A shared shell cannot mean giving mobile raw `fs/*`, `git/*`, `pty/*`, `process/*`, `host/*`, or `data/yjs/*` access by default.

## Target Architecture

### Kernel

The OpenADE kernel is a `RuntimeServer` composition with:

- Runtime protocol routing, capabilities, subscriptions, notification replay, lifecycle supervisor, checkpointing, and permission filtering.
- Generic host adapters from `runtime-node` where the host environment supports them.
- OpenADE product module from `openade-module`.
- OpenADE storage adapters for existing Yjs data and future storage shapes.
- Agent harness execution bridge.
- Snapshot patch and blob storage adapters.
- Auth/session/device permission policy.
- Structured logs for important runtime, auth, permission, and execution events.

Electron may embed the kernel in the main process for local desktop installs. It should still expose it to the renderer through the same conceptual client path as WebSocket clients.

### Shared Client Session

All UI shells use one session layer:

- Local Electron IPC transport.
- WebSocket transport.
- Runtime initialization and capability discovery.
- Connection status and reconnect behavior.
- Notification subscription and replay cursor handling.
- Active session config, multi-session selection, and token storage through medium-specific storage adapters.
- Typed `OpenADEClient` product methods.

Mobile-specific secure storage and QR scanning stay in the mobile adapter. Electron-specific window controls, native update controls, and file picker behavior stay in the Electron adapter.

### Shared Product Store

All product UI reads from a runtime-backed store rather than renderer-owned Yjs stores:

- Snapshot read model from `openade/snapshot/read`.
- Project and task lists from OpenADE runtime methods.
- Task detail from `openade/task/read`.
- Runtime lifecycle from runtime notifications and runtime record cache.
- Comments, queued turns, task metadata, and task deletion through `OpenADEClient`.
- Host/file/diff/process/terminal views through scoped product methods or explicitly granted host capability clients.

The kernel may continue using Yjs internally. Clients should not rely on raw Yjs document access for normal product rendering.

### Shared Shell

The shared shell is a reusable OpenADE UI shell in `projects/web` with medium-specific adapters:

- Shared routes and navigation state.
- Shared project/task/thread/composer components.
- Shared command model for Plan, Do, Ask, Revise, Run Plan, Review, Repeat, Stop, Close/Reopen, Commit and Push.
- Shared settings surfaces where the setting is product/runtime-owned.
- Shared file/diff/search/terminal/process components where capability is granted.
- Responsive layout primitives that render desktop trays on large screens and sheets/tabs/full-screen panels on mobile.

Medium wrappers should be thin:

- Electron: native window frame, app updates, file picker, open URL/path, local embedded kernel bootstrapping.
- Mobile: QR scan, secure storage, OTA web bundle updates, safe-area handling.
- Web: pairing/session entry, browser-safe storage, remote-only capability set.

## Non-Negotiable Migration Rules

1. Preserve existing user data.
   - Old Yjs repo/task documents must keep reading.
   - Add tolerant readers for new fields.
   - Add fixtures for old shapes before changing storage or projection behavior.

2. Prefer typed contracts at every boundary.
   - Use runtime validation and OpenADE module validators.
   - Extend `openade-client` before adding ad hoc remote client calls.
   - Keep browser-safe DTOs free of Node and Electron types.

3. Keep raw host powers restricted.
   - Do not expose raw `fs/*`, `git/*`, `pty/*`, `process/*`, `host/*`, `snapshot/*`, or `data/yjs/*` to paired devices by default.
   - Add scoped product methods for mobile/web parity where possible.
   - Filter notification permissions as carefully as method permissions.

4. Move in slices, not a big rewrite.
   - Every migrated read path gets old-vs-new parity tests.
   - Every migrated mutation proves persistence plus notification plus reload behavior.
   - Keep desktop usable at every phase.

5. Do not fake confidence.
   - Do not mock `OpenADEClient` for integration confidence.
   - Do not mock `RuntimeServer` for runtime confidence.
   - Do not assert only that a wrapper was called.
   - Do not use snapshots or class-name tests as migration proof.

## Accepted Test Doubles

Use real runtime, client, transport, storage, and host paths whenever feasible.

Accepted doubles:

- Deterministic harness executor that implements the same executor interface and streams realistic harness events.
- Fixed clock or fixed id generator only when idempotency or ordering is under test.
- Temporary storage directories and temporary git repos.
- Test WebSocket server using the real runtime server stack.

Not accepted as primary migration proof:

- Mocked `OpenADEClient`.
- Mocked runtime transport for behavior that depends on initialize, permissions, subscriptions, or reconnect.
- Mocked Yjs read/write when validating projection compatibility.
- Mocked git/file/process output when validating host behavior.

## Verification Ladder

Each workstream should climb this ladder as applicable:

1. Typecheck.
2. Boundary validator tests.
3. Real module tests against temp storage.
4. Real runtime server request tests.
5. Real local transport and real WebSocket transport tests.
6. Permission and notification filtering tests.
7. Client store integration tests.
8. UI behavior tests.
9. Build/smoke tests for affected shells.

## Phase 0: Baseline Audit And Fixtures

### Goals

Capture the current production shape before migration. Establish fixtures and parity tests so later changes cannot silently break old data or desktop behavior.

### Tasks

- Inventory current renderer Yjs reads:
  - `projects/web/src/store/store.ts`
  - `projects/web/src/persistence/repoStore.ts`
  - `projects/web/src/persistence/taskStore.ts`
  - `projects/web/src/persistence/taskLoader.ts`
  - `projects/web/src/persistence/*StoreBootstrap.ts`
- Inventory current runtime-backed mutations:
  - `projects/web/src/store/managers/TaskCreationManager.ts`
  - `projects/web/src/store/managers/InputManager.ts`
  - `projects/web/src/store/managers/TaskManager.ts`
  - `projects/web/src/store/managers/RepoManager.ts`
  - `projects/web/src/store/managers/CommentManager.ts`
  - `projects/web/src/store/managers/QueryManager.ts`
- Inventory remote-only client behavior:
  - `projects/web/src/remote/client.ts`
  - `projects/web/src/remote/RemoteApp.tsx`
- Capture fixture data for:
  - repo document with multiple tasks
  - task with action events
  - task with setup event
  - task with snapshot event
  - task with comments
  - task with queued turns
  - task with old/missing optional fields
  - mismatched or missing task document

### Verification

- Add fixture tests in `projects/openade-module` proving `createOpenADEYjsProjection` can read old shapes.
- Add desktop parity tests comparing current Yjs-derived task/project previews against `openade/snapshot/read` and `openade/task/read` projections.
- Run:
  - `cd projects/openade-module && npm run typecheck`
  - `cd projects/electron && npm test -- runtimeData`
  - `cd projects/web && npm test -- remote`

### Exit Criteria

- Existing production-like data has committed fixtures.
- Runtime projections can read those fixtures.
- Known gaps are documented before any migration changes.

## Phase 1: First-Class Kernel Composition

### Goals

Create one reusable OpenADE kernel composition that Electron can embed and non-Electron hosts can serve.

### Tasks

- Add a kernel composition module, likely one of:
  - `projects/openade-kernel`
  - `projects/runtime-node/src/openadeServe.ts`
  - `projects/openade-module/src/serve.ts`
- Compose:
  - `RuntimeServer`
  - runtime-node fs/git/process/PTY/watch adapters
  - runtime-node agent module
  - OpenADE module Node adapters
  - checkpoint store
  - liveness probe
  - optional Codex server-protocol bridges
- Extract shared composition from Electron `runtimeGateway.ts` where it is generic enough to reuse.
- Keep Electron-only host behavior in Electron:
  - snapshot patch generation if it depends on Electron code
  - managed binaries if desktop-specific
  - native shell/window/update integrations
- Add a serve command for local development:
  - authenticated WebSocket
  - loopback unauthenticated only for explicit dev mode
  - config file support
  - data dir override for tests

### Verification

- Integration test starts the kernel in-process with temp data dir, calls `initialize`, and asserts expected capabilities.
- Integration test starts real HTTP/WebSocket server and calls:
  - `openade/repo/create`
  - `openade/snapshot/read`
  - `openade/turn/start` with deterministic harness executor
  - `openade/task/read`
- Verify checkpoint reload marks active work according to runtime lifecycle rules.
- Run:
  - `cd projects/runtime-node && npm run typecheck`
  - `cd projects/openade-module && npm run typecheck`
  - focused kernel integration tests

### Exit Criteria

- Electron is no longer the only place where a complete OpenADE runtime can be composed.
- Tests can spin up a real OpenADE kernel without launching Electron.

## Phase 2: Shared Session And Transport Layer

### Goals

Replace separate desktop local client assumptions and companion client assumptions with one shared session abstraction.

### Proposed Files

- `projects/web/src/kernel/session.ts`
- `projects/web/src/kernel/sessionStore.ts`
- `projects/web/src/kernel/transports.ts`
- `projects/web/src/kernel/storage.ts`
- `projects/web/src/kernel/capabilities.ts`

### Tasks

- Define `KernelSession`:
  - session id
  - display host
  - base URL or local marker
  - token reference
  - connection status
  - initialize result
  - capabilities
  - runtime client
  - OpenADE client
- Define storage adapters:
  - browser localStorage
  - mobile secure-storage mirror
  - Electron local session/default embedded kernel
- Move pairing parsing and private host validation out of `remote/client.ts` into shared session code.
- Keep QR scanning in `projects/mobile/src/App.tsx`.
- Keep companion pairing HTTP exchange, but make it return a normal `KernelSession`.
- Allow desktop to connect to:
  - embedded local runtime over IPC
  - remote runtime over WebSocket, when intentionally selected later

### Verification

- Real `RuntimeLocalClient` initialize test.
- Real `RuntimeClient` WebSocket initialize test.
- Reconnect test with notification cursor replay.
- Multi-session cache test proving one socket per saved runtime/session.
- Protocol mismatch test proving clear error copy.
- Run:
  - `cd projects/runtime-client && npm run typecheck`
  - `cd projects/web && npm test -- remote`

### Exit Criteria

- `RemoteApp` no longer owns generic session behavior.
- Desktop and mobile can both construct an `OpenADEClient` through the same session layer.

## Phase 3: Runtime-Backed Product Store

### Goals

Introduce a product store that reads OpenADE DTOs from the runtime and can replace renderer-owned Yjs reads slice by slice.

### Proposed Shape

Create a store layer with interfaces such as:

```ts
interface OpenADEProductStore {
    snapshot: OpenADESnapshot | null
    getTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<OpenADETask>
    refreshSnapshot(): Promise<void>
    refreshTask(repoId: string, taskId: string): Promise<void>
    startTurn(args: OpenADETurnStartRequest): Promise<OpenADETurnStartResult>
    startReview(args: OpenADEReviewStartRequest): Promise<{ taskId: string }>
    interruptTurn(taskId: string): Promise<void>
    cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest): Promise<OpenADEQueuedTurnCancelResult>
    updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest): Promise<void>
    createComment(args: OpenADECommentCreateRequest): Promise<OpenADECommentCreateResult>
    editComment(args: OpenADECommentEditRequest): Promise<void>
    deleteComment(args: OpenADECommentDeleteRequest): Promise<void>
    deleteTask(args: OpenADETaskDeleteRequest): Promise<OpenADETaskDeleteResult>
}
```

### Tasks

- Keep existing `CodeStore` stable while adding a parallel runtime-backed product store.
- Build adapters from `OpenADETask` DTOs into existing view model needs.
- Make runtime notifications update runtime-backed caches directly.
- Add support for unavailable task documents without crashing.
- Preserve existing `TaskModel` behavior by wrapping DTOs first, then later simplifying internals.
- Avoid exposing raw Yjs stores to new code.

### Verification

- Old-vs-new parity tests for:
  - project list ordering
  - task preview fields
  - active/running task ids
  - task events
  - comments
  - queued turns
  - closed state
  - cancelled plan state
  - enabled MCP server ids
  - session ids
- Notification tests:
  - task updated refreshes matching task
  - task preview changed refreshes snapshot/list
  - repo deleted repairs selected navigation
  - runtime completion triggers after-event equivalent
- Reload tests:
  - mutation writes data
  - store is destroyed
  - new store reads persisted state from runtime

### Exit Criteria

- New runtime-backed store can power remote UI and selected desktop read paths.
- Existing desktop behavior has parity coverage before being switched over.

## Phase 4: Desktop Read Path Migration

### Goals

Move desktop from local Yjs reads to runtime read models without changing user-visible behavior.

### Tasks

Migrate in this order:

1. Sidebar project/task previews.
2. Task route loading.
3. Task event log read model.
4. Comments read model.
5. Queued turn read model.
6. Runtime working state.
7. Task title/closed/metadata read model.
8. Settings that belong to product/runtime rather than local UI.

For each slice:

- Add parity test.
- Switch one consumer.
- Keep compat adapter for old code.
- Remove obsolete Yjs direct read only after all consumers move.

### Verification

- Desktop route tests with runtime-backed store.
- Real runtime notification tests.
- Existing `TaskModel` tests adapted to DTO source rather than Yjs source.
- Manual smoke:
  - create task
  - run plan
  - revise
  - run plan
  - ask
  - close/reopen
  - reload app and verify state

### Exit Criteria

- Normal desktop product navigation no longer requires renderer direct Yjs reads.
- Yjs remains internal to the kernel/storage layer for compatibility.

## Phase 5: Product Mutation Parity Across Desktop And Companion

### Goals

Expose the same product-level operations to desktop and remote/mobile through one client/store path.

### Tasks

- Expand remote UI and shared command model to use existing `openade-client` methods:
  - `startReview`
  - `cancelQueuedTurn`
  - `updateTaskMetadata`
  - `deleteTask`
  - `createComment`
  - `editComment`
  - `deleteComment`
  - repo create/update/archive/delete where product decisions allow
- Move desktop command behavior into shared command definitions:
  - Stop
  - Interrupt and Do
  - Retry
  - Run Plan
  - Review Plan
  - Revise Plan
  - Cancel Plan
  - Do
  - Plan
  - Ask
  - Review
  - Repeat
  - Commit and Push
  - Close/Reopen
- Keep command enablement driven by shared task state.
- Keep mobile-specific layout separate from command semantics.

### Verification

- Command-state tests from production DTOs, not duplicated config assertions.
- Real runtime integration for each product mutation.
- Permission tests for paired clients:
  - allowed product methods are visible in `initialize` capabilities
  - denied product methods are hidden and rejected
  - notifications are filtered consistently
- Idempotency tests using stable `clientRequestId`.

### Exit Criteria

- Product commands are shared.
- Desktop and companion invoke the same OpenADE client methods for product mutations.

## Phase 6: Scoped Host Capability Methods

### Goals

Bring desktop-only host surfaces to the shared shell without granting unsafe raw host powers to remote devices.

### Capability Groups

- Project file read.
- Project file write.
- Project search.
- Task diff/read-only git.
- Task git mutation.
- Task terminal.
- Project processes.
- Procs config.
- MCP config and OAuth.
- Snapshot patch reads.
- Data blobs such as images.

### Tasks

- Add scoped OpenADE/product methods where raw runtime methods are too powerful:
  - `openade/project/files/tree`
  - `openade/project/file/read`
  - `openade/project/file/write`
  - `openade/project/search`
  - `openade/task/changes/read`
  - `openade/task/diff/read`
  - `openade/task/git/log`
  - `openade/task/terminal/start`
  - `openade/task/terminal/write`
  - `openade/task/terminal/resize`
  - `openade/task/terminal/stop`
  - `openade/project/process/list`
  - `openade/project/process/start`
  - `openade/project/process/stop`
- Scope every request by repo/task id and resolve allowed cwd server-side.
- Prevent path traversal and arbitrary absolute path access for remote roles.
- Add user/device permissions for sensitive methods.
- Keep raw methods trusted-local.

### Verification

- Temp git repo integration tests for changes, diffs, git log, file reads, file writes.
- Path traversal denial tests.
- Permission matrix tests for every capability group.
- Real PTY/process lifecycle tests:
  - start
  - stream output
  - resize or input where supported
  - stop
  - reconnect/read current lifecycle
- Backpressure tests where streams can grow.

### Exit Criteria

- Files, diffs, search, terminal, and process features can be shared by UI components while remaining scoped and permissioned.

## Phase 7: Shared Shell UI

### Goals

Replace the split between full desktop app and narrow `RemoteApp` with one shared app shell that adapts layout to the medium.

### Proposed Structure

- `projects/web/src/shell/OpenADEApp.tsx`
- `projects/web/src/shell/SessionGate.tsx`
- `projects/web/src/shell/ResponsiveLayout.tsx`
- `projects/web/src/shell/DesktopChrome.tsx`
- `projects/web/src/shell/MobileChrome.tsx`
- `projects/web/src/shell/routes.ts`
- `projects/web/src/features/tasks/*`
- `projects/web/src/features/projects/*`
- `projects/web/src/features/files/*`
- `projects/web/src/features/terminal/*`
- `projects/web/src/features/settings/*`

### Tasks

- Extract shared project list.
- Extract shared task list.
- Extract shared task thread.
- Extract shared event presentation.
- Extract shared composer and command buttons.
- Extract shared model/harness/MCP controls.
- Extract shared comments.
- Extract shared queued turn controls.
- Extract shared file/search/diff/terminal panels.
- Render desktop trays as side panels.
- Render mobile trays as sheets/tabs/full-screen panels.
- Keep keyboard shortcuts desktop-first, with touch controls on mobile.
- Keep native shell adapters outside shared UI.

### Verification

- Component tests use real DTO fixtures.
- Browser tests run against a real in-process test kernel.
- Desktop smoke covers:
  - project navigation
  - task thread
  - command submission
  - tray open
  - settings open
- Mobile/web smoke covers:
  - session connect
  - project navigation
  - task thread
  - command submission
  - panel open
- Visual/screenshot checks for changed responsive layouts.

### Exit Criteria

- Desktop and companion render the same feature components through different chrome.
- `RemoteApp` is either deleted or reduced to a pairing/session wrapper around the shared shell.

## Phase 8: Settings, Devices, And Admin Surfaces

### Goals

Unify settings that should be kernel/product-owned while preserving medium-specific settings.

### Product/Kernel Settings

- Harness/provider visibility and status.
- Default model/harness choices.
- MCP server configs and OAuth status.
- Companion enabled state, device list, revoke/drop all.
- Keep-awake mode.
- Runtime host status.
- Procs config where applicable.
- Telemetry preference if it should travel with the user/kernel.

### Medium Settings

- Mobile theme override.
- Mobile secure storage state.
- Electron window frame.
- Electron app updates.
- Native file picker defaults.
- OTA update state.

### Verification

- Settings mutation persists through kernel and reload.
- Paired device cannot grant itself stronger permissions.
- Device revoke closes only that device streams.
- Drop all closes all remote streams.
- OAuth completion notification reaches allowed clients only.

### Exit Criteria

- Shared settings UI uses kernel methods where appropriate.
- Native-only settings stay isolated in shell adapters.

## Phase 9: Rollout And Cleanup

### Goals

Ship incrementally without stranding users or losing production data.

### Rollout Strategy

- Add feature flags for:
  - runtime-backed store
  - shared shell desktop
  - shared shell remote
  - scoped host capabilities
  - remote terminal/process access
- Default desktop to existing shell until parity gates pass.
- Enable runtime-backed store for internal/dev first.
- Enable shared shell for mobile first where feature scope is smaller.
- Enable desktop shared shell after high-risk trays and settings pass.
- Remove old paths only after at least one release cycle with migration telemetry/logs.

### Cleanup Tasks

- Delete obsolete remote-only DTO wrappers after shared store lands.
- Delete renderer direct Yjs access for normal product reads.
- Delete duplicate command logic.
- Delete duplicate task sorting/message presentation helpers only after shared replacements pass tests.
- Update all relevant `CLAUDE.md` guidance.

### Verification

- Full focused suite:
  - `cd projects/runtime && npm run typecheck`
  - `cd projects/runtime-client && npm run typecheck`
  - `cd projects/runtime-node && npm run typecheck`
  - `cd projects/openade-module && npm run typecheck`
  - `cd projects/openade-client && npm run typecheck`
  - `cd projects/web && npm test`
  - `cd projects/web && npm run typecheck`
  - `cd projects/electron && npm test`
  - `cd projects/electron && npm run typecheck`
  - `cd projects/mobile && npm run typecheck`
  - `cd projects/mobile && npm run build`
- Electron smoke:
  - `cd projects/electron && npm run test:smoke`
- Mobile native verification when shell/native code changes:
  - `cd projects/mobile && npm run build`
  - `npx cap sync ios`
  - simulator launch and screenshot

### Exit Criteria

- One shared shell powers desktop and companion.
- Product behavior is runtime-backed across media.
- Raw host powers remain restricted.
- Old user data remains readable.
- Old duplicate paths are removed or clearly documented as legacy.

## Permission Matrix Draft

| Capability | Trusted Local Desktop | Paired Admin | Paired Operator | Paired Viewer |
| --- | --- | --- | --- | --- |
| `initialize`, status, subscriptions | yes | yes | yes | yes |
| OpenADE snapshot/task read | yes | yes | yes | yes |
| Start/interrupt turns | yes | yes | yes | no |
| Review start | yes | yes | optional | no |
| Queued turn cancel | yes | yes | yes | no |
| Comments | yes | yes | optional | no/read optional |
| Task metadata close/title | yes | yes | optional | no |
| Task delete | yes | optional | no | no |
| Repo create/update/delete | yes | optional | no | no |
| Scoped file read/search | yes | optional | optional | optional read-only |
| Scoped file write | yes | optional | no by default | no |
| Scoped git diff/log | yes | optional | optional read-only | optional read-only |
| Scoped git mutation | yes | optional | no by default | no |
| Terminal/process | yes | optional explicit grant | no by default | no |
| MCP config/OAuth | yes | optional admin only | no | no |
| Raw `fs/*`, `git/*`, `pty/*`, `process/*`, `host/*`, `data/yjs/*` | yes | no | no | no |

This matrix is a starting point. Every granted cell needs tests proving both allowed and denied behavior.

## Verification Matrix

| Area | Real Inputs | Required Verification |
| --- | --- | --- |
| Runtime protocol | real `RuntimeServer` | initialize, method not found, permission denied, notification filtering |
| Runtime client | real WebSocket | reconnect, cursor replay, pending request rejection on close |
| Local transport | real `RuntimeLocalClient` with IPC/local test transport | initialize-before-call invariant |
| OpenADE projection | committed Yjs fixtures | old data reads, missing data tolerance |
| OpenADE mutation | temp Yjs storage | write, notify, reload |
| Turn start | deterministic harness executor | action event create, stream append, completion, runtime lifecycle |
| Interrupt/stop | deterministic long-running executor | stop persists action as stopped before lifecycle terminal state |
| Comments | temp Yjs storage | create/edit/delete, pending/consumed shape preserved |
| Queued turns | real runtime/store | queue while active, cancel, drain, notify |
| Git/files | temp git repo | status, patch, file pair, search, path denial |
| Terminal/process | real subprocess/PTY adapter where available | stream, stop, reconnect/lifecycle |
| Permissions | paired WebSocket connection | capabilities filtered, method denied, notification denied |
| Desktop UI | real or test kernel | route, task page, command, tray |
| Mobile/web UI | real test kernel | pair/connect, task thread, command, panel |

## Documentation Requirements

Future agents must update documentation in the same change when they alter:

- Runtime method names or permissions.
- OpenADE DTO shapes.
- Storage compatibility behavior.
- Shared shell route/component ownership.
- Medium adapter responsibilities.
- Verification commands or test strategy.

Relevant guidance files:

- Root `CLAUDE.md`
- `projects/web/src/CLAUDE.md`
- `projects/web/src/remote/CLAUDE.md`
- `projects/electron/src/modules/companion/CLAUDE.md`
- `projects/mobile/CLAUDE.md`
- `projects/runtime/CLAUDE.md`
- `projects/runtime-client/CLAUDE.md`
- `projects/runtime-node/CLAUDE.md`
- `projects/openade-module/CLAUDE.md`
- `projects/openade-client/CLAUDE.md`
- `projects/shared/companion/CLAUDE.md`

## Decision Log

Record major decisions here as the migration proceeds.

### 2026-05-31: Plan Created

- Target is one shared OpenADE shell with medium-specific adapters.
- Kernel owns product state and host capabilities.
- Clients use runtime-backed DTOs rather than raw Yjs for normal rendering.
- Verification must use real runtime, storage, transport, permissions, and host paths.
- Deterministic harness executor is acceptable because live LLM output is nondeterministic.

## Open Questions

- Should the first-class kernel live in a new `projects/openade-kernel` package or be an option in `runtime-node`?
- Should browser web support direct private-network pairing, or should it start desktop/local only until browser Private Network Access constraints are fully handled?
- Which mobile roles should be exposed in product UI first: admin, operator, viewer, or only the current paired-device role?
- Which desktop settings should become kernel-owned versus remain local client preferences?
- Should terminal/process access ever be enabled on mobile by default, or always require explicit per-device grants?
- How long should the old desktop Yjs direct-read path remain behind a fallback flag?

## Suggested First Pull Requests

1. Add committed Yjs compatibility fixtures and projection parity tests.
2. Add shared session abstraction while keeping `RemoteApp` behavior unchanged.
3. Add real WebSocket integration tests for `OpenADEClient` operations using temp storage and deterministic harness executor.
4. Add runtime-backed product store behind a feature flag.
5. Switch remote UI to the shared session/store layer.
6. Switch desktop sidebar/project/task reads to runtime-backed store behind a feature flag.
7. Add comments/title/close/review/queued-cancel parity to remote UI using existing OpenADE methods.
8. Add scoped file/diff read methods with temp git repo tests.
9. Extract shared task thread and composer components.
10. Replace desktop and companion entry points with the shared shell once parity gates pass.
