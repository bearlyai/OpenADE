# Shared Shell And Remote Kernel Migration Plan

## Purpose

Move the Electron desktop app and the mobile companion toward one shared OpenADE application shell attached to a runtime kernel. The intended end state is not two separate products with duplicated UI and transport logic. It is one product surface that can run through different medium adapters:

- Electron desktop shell
- Capacitor mobile host
- Browser web shell
- Future CLI/headless clients where applicable

The kernel owns durable OpenADE state, host capabilities, runtime lifecycle, subscriptions, permissions, and execution. Clients render UI, keep local interaction state, and call the kernel through a typed runtime client.

This plan is deliberately verification-heavy. Each migration slice must prove behavior through real runtime, storage, transport, notification, and host paths. Tests that only prove mocks were called do not count as migration confidence.

Direction constraint: the existing desktop app UI is the canonical product experience. The shared-shell migration must move that desktop look, behavior, trays, shortcuts, and rich composer onto runtime/OpenADE APIs. It must not replace desktop with the compact mobile companion UI. Mobile/web should adapt to the desktop-quality product surface where their permissions and screen size allow.

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

### Mobile Companion Host

Mobile is now a thin host adapter rather than a separate product UI:

- `projects/mobile/src/App.tsx` owns native QR scanning, secure storage mirroring, OTA readiness, and error reset.
- The main product shell is imported from `projects/web/src/remote/RemoteApp.tsx`, which delegates project/task/new-task/session/settings composition to `projects/web/src/shell/OpenADEShell.tsx`.
- `projects/web/src/remote/client.ts` owns pairing URL parsing, host validation, config persistence, runtime WebSocket construction, reconnect status, and remote reads/actions.

The current remote UI remains intentionally safer than desktop, but it now covers more product parity than the initial plan state. It reads snapshots/tasks, starts and interrupts turns, listens to runtime notifications, edits task metadata/comments, cancels queued turns, starts reviews, deletes tasks, renders task-owned images, and exposes scoped file/search/process/git-read panels. It still does not expose desktop parity for model/MCP controls, raw terminal access, arbitrary process control, file writes, commit/push, native desktop settings, or broad admin/device-management surfaces.

### Permission Boundary

Paired remote devices currently get a safe subset of runtime methods. Trusted desktop local IPC has full access. This must remain intentional. A shared shell cannot mean giving remote clients raw `fs/*`, `git/*`, `pty/*`, `process/*`, `host/*`, or `data/yjs/*` access by default.

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
  - `openade/task/git/commit`
  - `openade/task/terminal/start`
  - `openade/task/terminal/write`
  - `openade/task/terminal/reconnect`
  - `openade/task/terminal/resize`
  - `openade/task/terminal/stop`
  - `openade/task/image/read`
  - `openade/project/process/list`
  - `openade/project/process/start`
  - `openade/project/process/reconnect`
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
- `projects/web/src/shell/OpenADEChrome.tsx`
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

- Shell theme override.
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
| Task image blob read | yes | yes if task read allowed | optional read-only | optional read-only |
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
| Task image blobs | real image file storage plus task event references | task-owned image reads, missing image null, unattached image denial/null, raw data method denial |
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

### 2026-05-31: Kernel Composition Started

- Reusable Node kernel composition lives in `projects/openade-module/src/kernel.ts`.
- `openade-module` owns OpenADE product semantics plus the reusable OpenADE runtime composition; `runtime-node` remains generic and must not import OpenADE product semantics.
- The first kernel integration test starts a real `RuntimeServer`, real runtime-node host modules, real OpenADE Yjs storage, and a real HTTP/WebSocket server with a deterministic agent executor.
- Electron-specific runtime composition remains in `projects/electron/src/modules/companion/runtimeGateway.ts` until desktop-only host behavior is extracted or intentionally kept as an Electron adapter.

### 2026-05-31: Shared Session And Product Store Started

- Shared client session code lives in `projects/web/src/kernel/session.ts`; remote companion pairing and desktop local OpenADE client construction now use that shared layer.
- Shared saved-session persistence lives in `projects/web/src/kernel/sessionStore.ts`; the companion client delegates its `openade-companion-config` v2 storage, active-session switching, legacy single-session migration, and invalid-session filtering to that shared browser-safe store.
- Runtime-backed product DTO cache lives in `projects/web/src/kernel/productStore.ts`; it is parallel to the legacy desktop store and is not yet the default desktop read path.
- Existing remote companion helper APIs now read and mutate through the shared product store, so `RemoteApp` uses the new store without a UI rewrite.
- Remote helper APIs and UI now expose the shared product-store path for review start, queued-turn cancel, task metadata, comments, task delete, project files/search/processes, task git reads, and task-owned images through scoped product methods.
- The product store test uses a real `RuntimeServer`, `RuntimeLocalClient`, `OpenADEClient`, runtime notifications, and OpenADE module routing with in-memory adapters for deterministic state.

### 2026-05-31: Companion Product Mutation Parity Started

- Paired-device runtime permissions are centralized in `projects/electron/src/modules/companion/runtimeSocket.ts` and now allow the high-level product methods intentionally surfaced in the companion UI.
- Companion permissions still deny raw `runtime/*`, `process/*`, `pty/*`, `fs/*`, `git/*`, `host/*`, `snapshot/*`, `data/*`, `openade/action/*`, `openade/snapshot/create`, and `openade/task/environment/setup` methods.
- `projects/electron/src/modules/companion/runtimeApi.integration.test.ts` now verifies allowed product mutations over an authenticated paired WebSocket with temp Yjs storage, and verifies denied raw host/storage calls on the same socket.
- `RemoteApp` now exposes runtime-backed product controls for task title, close/reopen, task delete, comments, queued-turn cancellation, review start, and task command modes including Revise and Run Plan.
- `projects/web/src/remote/RemoteApp.integration.test.ts` renders the companion UI against a real `RuntimeServer`, `RuntimeLocalClient`, and `OpenADEClient` rather than mocked client methods.

### 2026-05-31: Scoped Project Read Methods Started

- `openade/project/file/read` and `openade/project/search` are the first scoped host capability methods for the shared shell.
- The methods live behind `OpenADEScopedHostAdapter` in `projects/openade-module`, with Node and Electron host implementations resolving repo ids to server-side repo paths.
- Paired-device permissions allow these read-only OpenADE methods while continuing to deny raw `fs/*`, `git/*`, `host/*`, `snapshot/*`, and `data/yjs/*` methods.
- Kernel and companion integration tests cover real temp repo reads/searches plus path traversal denial over real runtime clients.

### 2026-05-31: Desktop Runtime Read Bridge Started

- Desktop `CodeStore` added a runtime product read bridge behind `VITE_OPENADE_ENABLE_RUNTIME_PRODUCT_STORE` or `CodeStoreConfig.enableRuntimeProductStore`; later slices in this branch promote that bridge to default-on with explicit false overrides.
- The bridge hydrates `runtimeProductSnapshot` through `OpenADEProductStore` and `OpenADEClient`; when ready, `RepoManager.repos` and `CodeStore.getTaskPreviewsForRepo()` may serve repo/task preview reads from runtime DTOs.
- Desktop sidebar/navigation callers now use those accessors; later slices in this branch make the bridge default-on while legacy Yjs renderer stores remain the fallback.
- `projects/web/src/store/storeRuntimeProductStore.test.ts` verifies the bridge through a real `RuntimeServer`, `RuntimeLocalClient`, and `OpenADEClient`.
- `projects/electron/src/modules/companion/openadeProjectionFixtures.test.ts` compares committed legacy Yjs fixture reads against runtime projection DTO reads using the production Electron Yjs storage adapter.
- This is a Phase 4 sidebar/navigation slice. Task route loading, comments, queued turns, runtime working state, metadata, and event detail reads still need to be switched one at a time after each slice has old-vs-new parity coverage.

### 2026-05-31: Desktop Task Detail Runtime Bridge Started

- The runtime product read bridge now caches per-task DTOs and adapts them into the existing desktop `TaskModel`/event/comment shape through `projects/web/src/kernel/taskAdapter.ts`.
- `CodeLayout` loads task detail from `OpenADEProductStore` when the runtime product bridge is ready, while preserving the legacy Yjs `TaskStore` path when the flag is disabled or unavailable.
- Task title, comments, queued turns, event log, metadata, and model/harness history can now render from runtime DTOs in the flagged desktop path; tray and host-heavy task views still use existing desktop managers.
- `projects/web/src/store/storeRuntimeProductStore.test.ts` verifies the bridge with a real `RuntimeServer`, `RuntimeLocalClient`, `OpenADEClient`, action event, comment, task adapter, and `TaskModel`.

### 2026-06-01: Desktop Runtime Notification Bridge Verified

- `CodeStore` can now take a typed `runtimeNotificationSource` for integration tests while production desktop continues to default to `runtime/localRuntimeClient.ts`.
- `projects/web/src/store/storeRuntimeProductStore.test.ts` now sends real `RuntimeServer.notify(...)` events through a real `RuntimeLocalClient` and verifies desktop runtime DTO caches update from `openade/task/updated`, `openade/task/previewChanged`, and `openade/task/deleted`.
- The test proves task detail, comments, events, preview lists, snapshot pruning, cached task removal, and `TaskModel` lookup behavior without mocking `OpenADEClient` or runtime transport.
- Runtime settlement now scans the unified `TaskManager` task view after refresh, so DTO-backed tasks fire the same after-event callbacks as legacy Yjs-backed tasks when a real `runtime/completed` notification removes a running task runtime.
- The same real-notification suite now covers `openade/repo/deleted` cache repair: project lists, task previews, cached task DTOs, and `TaskModel` lookup all prune after the repo disappears from the runtime snapshot.
- `projects/web/src/Routes.runtimeProductStore.test.ts` now installs a real `RuntimeServer` behind the production `runtime/localRuntimeClient.ts` path, then smoke-tests the desktop base route redirecting from runtime-backed project/task previews and the desktop task route rendering runtime-loaded task detail through `CodeLayout`/`TaskPage`.
- The runtime product bridge now defaults on in this branch. Legacy renderer Yjs initialization remains available as fallback-only for at least one production release after the default-on runtime rollout, and removal must wait for telemetry/log review showing no meaningful fallback use.

### 2026-06-01: Desktop Shared Task Screen Gate Started

- Desktop task routes can render `projects/web/src/pages/DesktopSharedTaskPage.tsx` only when `VITE_OPENADE_ENABLE_DESKTOP_SHARED_TASK_SCREEN=true` or `CodeStoreConfig.enableDesktopSharedTaskScreen=true`; the default desktop route stays on the classic `TaskPage` while runtime product reads are enabled.
- The adapter composes the shared `projects/web/src/shell/task/TaskScreen.tsx` from cached OpenADE task/preview DTOs, while preserving the rich desktop `InputBar` through a desktop-supplied composer slot.
- Desktop shared task actions use the same `runtime/localOpenADEClient.ts` product methods for turn start, interrupt, review, metadata, comments, queued-turn cancellation, delete, task image read, and scoped task git reads.
- `projects/web/src/Routes.runtimeProductStore.test.ts` now verifies this route through a real `RuntimeServer` installed behind the production local runtime bridge, including rendering shared task controls, updating metadata/comments, starting a review, and submitting a turn through `openade/turn/start` before waiting for refreshed DTOs to render.
- Keep the legacy task page and renderer Yjs read path available until production default-on telemetry has been reviewed.

### 2026-06-01: Runtime Product Bridge Rollout Decision

- The runtime product bridge defaults on in this branch, but the compact shared desktop task screen is opt-in only. Production rollout must keep the renderer Yjs path as a fallback for at least one production release.
- Do not remove renderer Yjs initialization or fallback reads until telemetry/logs show the runtime-backed path is healthy across normal navigation, task detail, notifications, and reloads.
- If fallback use is observed after default-on rollout, treat it as a production migration bug and add a regression fixture before removing the fallback.
- Rollout observability now comes from `CodeStore`: `app_opened` includes runtime-product gate/status fields, `runtime_product_store_error` records sanitized bridge error categories, and `runtime_product_store_fallback` records deduped legacy direct-read fallback sources/reasons without repo paths or task content.
- Production rollout criteria for the default-on runtime product bridge: packaged workflow smoke passes, no fallback events are seen in the internal/default-on cohort for normal navigation/task-detail/reload flows, and any observed fallback has a reproduction plus a regression fixture before removal of the legacy path.

### Runtime Product Rollout Telemetry Review Runbook

Run this review before shipping the default-on runtime/shared-shell branch broadly and again before removing renderer Yjs fallback reads.

- Cohort setup: ship an internal desktop build with the default-on runtime product bridge enabled and the compact shared task screen disabled unless specifically testing that opt-in experiment. Record any explicit env/config overrides. To compare fallback behavior, use explicit false values for `VITE_OPENADE_ENABLE_RUNTIME_PRODUCT_STORE`; use explicit true values for `VITE_OPENADE_ENABLE_DESKTOP_SHARED_TASK_SCREEN` only when testing the non-default shared-screen route.
- Required workflow coverage: desktop launch, repo/project list navigation, task preview navigation, task detail load, runtime notification refresh, Plan, Revise, Run Plan, Ask, comments, metadata edits, close/reopen, app close/relaunch reload, and scoped project file tree/read/write/search.
- Required telemetry checks: `app_opened` must show the gate enabled and a ready runtime product store after normal startup; `runtime_product_store_error` must have no unexplained categories; `runtime_product_store_fallback` must be absent for normal workflows.
- Data hygiene check: telemetry review must use only the sanitized fields emitted by `CodeStore` (`source`, `reason`, gate/status flags, snapshot presence, repo/task counts, and error kind). Do not add repo paths, task titles/content, prompt text, file contents, or user code to rollout events.
- Failure handling: every fallback or unexplained bridge error blocks broad rollout until the team captures a reproduction, adds a real regression fixture/test on the production bridge path, and reruns packaged workflow smoke.
- Rollout rule: the default-on build can ship broadly only after the internal/default-on cohort has zero normal-flow fallback events and no unexplained bridge errors. Removal of the fallback path requires another telemetry/log review for that release.

### 2026-06-01: Runtime Migration Verification Sweep

- Web verification passed: `npm run typecheck`, full `npm test` with 70 files and 441 tests, focused `npm test -- storeRuntimeProductStore` with 6 tests after the final test-noise cleanup, `npm run build`, and `git diff --check`.
- Electron verification passed: `npm run typecheck`, full `npm test` with 27 files and 252 tests, and packaged-app `npm run test:smoke` after `npm run build`, `npm run build:web`, and `electron-builder --mac --dir`. Coverage includes paired WebSocket permissions, scoped OpenADE host methods, headless runtime-node WebSocket serving, Yjs projection fixtures, bundled web UI boot in the packaged app, real preload IPC initialization of the embedded runtime, `host/platform/info`, `openade/snapshot/read`, `openade/repo/create`, scoped project file tree/read/write/search, and scoped project process list/start/reconnect-output/stop against a temp project with isolated smoke-test `HOME`/`USERPROFILE` plus explicit `OPENADE_YJS_STORAGE_DIR`.
- OpenADE module/client/runtime verification passed: `projects/openade-module` typecheck/test, `projects/openade-client` typecheck, `projects/runtime` typecheck, and `projects/runtime-client` typecheck.
- Mobile companion verification passed: `projects/mobile` typecheck and production `npm run build`.
- Build warnings observed but not introduced by this slice: Vite reports large chunks, `TaskEventThread` dynamically imports `MarkdownMessage` while other paths import it statically, and duplicate `wasm-CG6Dc4jp.js.map` emission.

### 2026-05-31: Scoped Project File Tree And Write Added

- `openade/project/files/tree` and `openade/project/file/write` were added beside `openade/project/file/read` and `openade/project/search`.
- Node and Electron hosts resolve every scoped file request against the server-side repo path and reject traversal through the OpenADE module validator before the host adapter runs.
- Paired devices may list/read/search project files, but `openade/project/file/write` is intentionally excluded from paired-device permissions until explicit roles/admin grants exist.
- Kernel and companion integration tests now cover real scoped file tree/read/write/search paths, traversal denial, and paired-device write denial over real runtime transports.

### 2026-05-31: Scoped Task Git Reads Added

- `openade/task/changes/read`, `openade/task/diff/read`, and `openade/task/git/log` were added to the OpenADE scoped host boundary for read-only task change inspection.
- Node kernel hosts execute real git commands against server-resolved task work dirs; Electron hosts wrap the existing desktop git helpers from `projects/electron/src/modules/code/git.ts`.
- Paired devices may call these scoped OpenADE methods, while raw `git/*`, `fs/*`, `host/*`, `snapshot/*`, and `data/yjs/*` methods remain hidden and denied.
- `OpenADEClient`, `OpenADEProductStore`, and shared companion DTO aliases now expose typed helpers for task changes, file patches, and git log reads.
- Kernel and companion integration tests cover real temp git repos, modified and untracked files, patch stats/content, git log reads, traversal denial, and authenticated paired WebSocket permission behavior.
- `projects/web/src/kernel/productStore.test.ts` verifies the shared UI-facing product store reaches the scoped task git helpers through a real `RuntimeServer`, `RuntimeLocalClient`, `OpenADEClient`, and OpenADE module route.

### 2026-05-31: Scoped Task Git Commit Added

- `openade/task/git/commit` now lives on the OpenADE scoped host boundary for trusted/local product clients.
- Node and Electron hosts resolve the task work dir server-side, stage scoped task changes with `git add -A`, commit with a validated message, and report `committed`, `nothing_to_commit`, or `failed` without granting raw `git/*`.
- `OpenADEClient`, `OpenADEProductStore`, and shared companion DTO aliases expose typed commit helpers that preserve `clientRequestId` for idempotent retry behavior.
- Paired devices do not get `openade/task/git/commit` by default; companion capabilities hide it and permission tests deny it over the authenticated WebSocket path.
- Kernel and companion integration tests cover real temp-repo commits through the Node kernel and Electron host paths, plus paired-device denial.

### 2026-05-31: Scoped Snapshot Patch Reads Added

- `openade/task/snapshot/patch/read`, `openade/task/snapshot/index/read`, and `openade/task/snapshot/patch/readSlice` were added so shared shells can inspect task-owned snapshot patches without raw `snapshot/*` storage access.
- The OpenADE module validates repo id, task id, and snapshot event id before the host adapter may read inline or external patch data.
- Node hosts support inline patches and file-backed snapshot bundles under the sibling `snapshots` data dir; Electron hosts wrap existing snapshot bundle readers.
- Paired-device permissions allow only the scoped OpenADE snapshot reads while raw `snapshot/patch/read`, `snapshot/index/read`, `snapshot/patch/readSlice`, and `snapshot/bundle/save` remain hidden and denied.
- Kernel tests cover inline snapshot patch/index/slice reads through a real WebSocket client; companion tests cover persisted snapshot bundle reads through an authenticated paired WebSocket and raw snapshot denial.

### 2026-05-31: Scoped Process Surface Design Constraint

- Raw `process/command/start` and `process/script/start` accept arbitrary commands and cwd values, so they remain trusted-local only.
- The shared-shell process surface should not expose arbitrary script text to paired clients. It should resolve `openade.toml` process ids server-side, compute cwd from the repo/task context, and then call the existing process adapter.
- Scoped process methods should therefore be shaped around project/task context plus process ids, for example `openade/project/process/list`, `openade/project/process/start`, `openade/project/process/reconnect`, and `openade/project/process/stop`.
- Permission tests must continue proving raw `process/*` methods are hidden and denied after the scoped process surface is added.

### 2026-05-31: Scoped Project Process Methods Added

- `openade/project/process/list`, `openade/project/process/start`, `openade/project/process/reconnect`, and `openade/project/process/stop` now live on the OpenADE scoped host boundary.
- Node and Electron hosts read `openade.toml`, resolve process ids and cwd server-side, reject cwd escape attempts, and then use the existing runtime process adapter for real lifecycle execution.
- Paired devices may call only these scoped process methods; raw `process/command/start`, `process/script/start`, `process/list`, `process/reconnect`, and `process/kill` remain hidden and denied.
- `OpenADEClient`, `OpenADEProductStore`, and shared companion DTO aliases expose the typed process list/start/reconnect/stop helpers.
- Kernel tests cover real WebSocket process list/start/reconnect/stop against a temp repo and invalid `work_dir`; companion tests cover authenticated paired WebSocket process lifecycle plus raw process denial.

### 2026-05-31: Scoped Task Terminal Methods Added

- `openade/task/terminal/start`, `openade/task/terminal/write`, `openade/task/terminal/reconnect`, `openade/task/terminal/resize`, and `openade/task/terminal/stop` now live on the OpenADE scoped host boundary.
- Node and Electron hosts derive PTY ids server-side from repo/task ids, resolve the initial cwd through the task workdir rules, normalize reconnect output, and reject client-supplied terminal ids that do not match the task.
- The typed terminal helpers are exposed through `OpenADEClient`, `OpenADEProductStore`, and shared companion DTO aliases.
- Paired-device permissions intentionally do not include scoped terminal methods yet. The companion tests prove both raw `pty/*` and scoped `openade/task/terminal/*` methods are hidden and denied until explicit role/admin grants exist.
- Kernel tests cover real WebSocket PTY start/write/reconnect/resize/stop against a temp repo task and invalid terminal id denial.

### 2026-05-31: Scoped Task Image Reads Added

- `openade/task/image/read` now lives on the OpenADE scoped host boundary for rendering task-owned image attachments without raw `data/file/*` access.
- The OpenADE module validates repo id, task id, safe image id/extension, and proves the image is referenced by the task events or queued turns before the host adapter may load bytes.
- Node hosts read from the sibling `images` data dir; Electron hosts wrap the existing data-folder reader.
- Paired-device permissions allow this read-only scoped image method while raw `data/file/*` and `data/yjs/*` methods remain hidden and denied.
- The companion thread now renders prompt image attachments through the shared product store and scoped image read method.
- Kernel, companion, product-store, and remote UI integration tests cover real stored image reads, missing/unattached image null results, invalid image id denial, paired raw data denial, and image rendering through a real runtime client.

### 2026-05-31: Shared Task Thread Scroll Primitive Added

- Desktop `TaskPage` and companion `RemoteApp` now use `projects/web/src/shell/task/useTaskThreadScroll.ts` for task-thread bottom-follow behavior.
- The shared primitive preserves remote's "jump to latest only when the user is scrolled away" behavior and desktop's always-follow behavior through explicit modes.
- This is the first Phase 7 task-thread extraction slice; event rendering and composer controls still need to move to shared feature components before `RemoteApp` can shrink to a session wrapper.
- Web tests cover the shared threshold logic, the legacy remote alias, and `RemoteApp` rendering through a real in-memory runtime client.

### 2026-05-31: Shared Task Command Model Started

- Desktop `InputManager` and companion `RemoteApp` now use `projects/web/src/shell/task/taskCommands.ts` for OpenADE turn command labels, composer command order, new-task mode order, and "queue while running" rules.
- This keeps Do/Ask queueability and Plan/Revise/Run Plan/HyperPlan labels consistent across media while preserving each shell's current UI composition.
- Web tests cover the shared command model, desktop queueable InputManager behavior, and `RemoteApp` rendering through a real in-memory runtime client.
- Remaining Phase 7 work: extract the actual composer component and desktop/remote command button rendering around this shared model.

### 2026-05-31: Companion Project Process Panel Added

- `RemoteApp` now exposes repo-declared processes on the project screen using `openade/project/process/list`, `openade/project/process/start`, and `openade/project/process/stop` through the shared product store.
- This gives companion users start/stop parity for reviewed `openade.toml` process definitions without granting raw `process/*` or arbitrary shell commands.
- The remote client now has typed process list/start/stop helpers, and `RemoteApp.integration.test.ts` covers list/start/stop through a real `RuntimeServer`, `RuntimeLocalClient`, `OpenADEClient`, and OpenADE module route.
- Remaining process parity work: config editing and explicit role gates if process control becomes non-default for some paired-device roles.

### 2026-06-01: Shared Project Process Output Viewing Added

- `projects/web/src/shell/project/ProjectHostPanels.tsx` now renders process output from the scoped `openade/project/process/reconnect` result next to the shared project process start/stop controls.
- `RemoteApp` routes the companion Output action through `reconnectRemoteProjectProcess`, so mobile can inspect output for reviewed `openade.toml` processes without raw `process/*`, `pty/*`, or arbitrary host command access.
- `ProjectTasksScreen`, `OpenADEShell`, and the remote client helper now carry the typed reconnect result through the shared shell boundary.
- Focused component/client tests and `RemoteApp.integration.test.ts` cover the output action against a real `RuntimeServer`, `RuntimeLocalClient`, `OpenADEClient`, and OpenADE module route.
- Packaged-app smoke now also writes a real `openade.toml`, calls `openade/project/process/list`, starts the scoped process in the packaged Electron host, reconnects until stdout contains `packaged scoped process ok`, and stops it.

### 2026-05-31: Companion Project File And Search Panel Added

- `RemoteApp` now exposes a project-screen file browser and read-only preview using scoped `openade/project/files/tree` and `openade/project/file/read` methods through the shared product store.
- The project screen also exposes scoped `openade/project/search` so companion users can find files/content without raw filesystem access.
- The companion file panel intentionally stays read-only; paired devices still cannot call `openade/project/file/write` or raw `fs/*` methods by default.
- `RemoteApp.integration.test.ts` covers project file list/read and search through a real `RuntimeServer`, `RuntimeLocalClient`, `OpenADEClient`, and OpenADE module route.
- Remaining file parity work: shared desktop/mobile file component extraction, write/edit role gates, and richer large/binary file handling.

### 2026-05-31: Companion Task Changes Panel Added

- `RemoteApp` now exposes read-only task changes, file diff preview, and recent git log on the task screen using scoped `openade/task/changes/read`, `openade/task/diff/read`, and `openade/task/git/log` methods through the shared product store.
- The panel intentionally avoids commit/push controls for paired devices; `openade/task/git/commit` remains trusted/local unless explicit role gates are added later.
- `RemoteApp.integration.test.ts` covers changed-file listing, diff read, and git log rendering through a real `RuntimeServer`, `RuntimeLocalClient`, `OpenADEClient`, and OpenADE module route.
- Remaining changes parity work: shared desktop/mobile changes component extraction, richer diff rendering reuse, staged/unstaged grouping, and commit/push role gates.

### 2026-05-31: Companion Self-Revoke UI Added

- The companion Settings screen now exposes `remote/device/selfRevoke` so a paired device can revoke its own runtime token and clear its saved session.
- This uses the existing runtime-permissioned device method; mobile still cannot list, revoke, or grant permissions for other devices.
- `RemoteApp.integration.test.ts` covers self-revoke through the same real runtime client path and verifies the local session is removed after the server response.
- Remaining device/admin parity work: shared desktop/mobile device-management surfaces and role-specific permission UI.

### 2026-06-01: Trusted Device Admin Runtime Methods Added

- `remote/device/list`, `remote/device/revoke`, and `remote/device/dropAll` are now trusted-local runtime methods for kernel-owned device administration; paired devices still only receive `remote/device/selfRevoke`.
- Device stream shutdown is routed through a runtime socket stream closer registry so trusted-local revoke closes only the target device sockets and drop-all closes every paired-device socket.
- Shared companion DTOs now include device list/revoke/drop-all/self-revoke result contracts without granting mobile admin rights.
- `runtimeApi.integration.test.ts` covers paired-device capability hiding and permission denial for admin device methods, trusted-local revoke-one keeping other device sockets alive, trusted-local drop-all closing all device sockets, and self-revoke token invalidation over the real WebSocket path.
- Latest verification for this device-admin slice passed: focused `runtimeApi.integration.test.ts`, full `projects/electron` `npm test` with 28 files and 256 tests, `projects/electron` typecheck, `projects/web` typecheck, packaged `npm run build`, `npm run build:web`, `electron-builder --mac --dir`, `npm run test:smoke`, and `git diff --check`.

### 2026-06-01: Desktop Device Settings Use Kernel Methods

- Desktop companion settings now read device lists and perform revoke/drop-all through `projects/web/src/electronAPI/companion.ts` using the production `runtime/localRuntimeClient.ts` path and the `remote/device/*` kernel methods.
- Native companion enablement, pairing, keep-awake, and bound URLs remain on narrow Electron IPC because those settings are shell-adapter state rather than portable kernel device administration.
- `projects/web/src/electronAPI/companion.test.ts` installs a real `RuntimeServer` behind the production local runtime bridge and makes legacy revoke/drop-all IPC throw, proving desktop device admin wrappers and the rendered `CompanionTab` UI use the runtime protocol.
- The old `companion:revokeDevice` and `companion:dropAllDevices` Electron IPC handlers and preload methods were removed so device administration has one trusted-local runtime contract.
- Latest verification for this desktop settings slice passed: focused `companion.test.ts` plus `Routes.runtimeProductStore.test.ts`, full `projects/web` `npm test` with 78 files and 457 tests, `projects/web` typecheck, `projects/electron` typecheck, packaged `npm run build`, `npm run build:web`, `electron-builder --mac --dir`, `npm run test:smoke`, and `git diff --check`.

### 2026-06-01: MCP OAuth Notification Boundary Verified

- `host/mcp/oauthComplete` remains a trusted-local runtime notification; paired companion sockets still cannot see `host/*` notifications in capabilities, live subscriptions, or cursor replay.
- `runtimeApi.integration.test.ts` now proves paired WebSocket clients are denied `host/mcp/*` calls, trusted local clients can see the OAuth completion notification, and paired sockets only receive allowed `openade/*` notifications when replaying from the runtime notification log.
- `projects/web/src/electronAPI/mcp.ts` now validates OAuth completion notification payloads before invoking desktop callbacks, and `electronAPI/mcp.test.ts` verifies the production `runtime/localRuntimeClient.ts` bridge against a real `RuntimeServer`.
- Route integration tests explicitly set `activeWorkUnloadBlockerDisabled` in their fake preload API, matching packaged smoke's `OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER=1` teardown behavior without disabling blockers in normal app launches.
- Latest verification for this notification-boundary slice passed: focused Electron/Web runtime tests, `projects/electron` and `projects/web` typechecks, full `projects/electron` `npm test` with 28 files and 257 tests, full `projects/web` `npm test` with 79 files and 458 tests, `projects/web` production build, `projects/electron` `npm run build:web`, `electron-builder --mac --dir` with `NONOTARY=1`, packaged `npm run test:smoke`, and `git diff --check`.

### 2026-06-01: Mobile Multi-Session Runtime Verification Added

- `RemoteApp.integration.test.ts` now verifies the remote shared shell against two separate real `RuntimeServer` instances selected by the production runtime socket URL builder.
- The test covers saved-session activation, active config persistence, stale host removal, and local shell theme persistence across unmount/remount without replacing `KernelSessionManager`, `RuntimeLocalClient`, or `OpenADEClient` with mocks.
- `OpenADESessionsScreen` remove controls now have stable labels/titles so integration tests and accessibility tooling can target the actual stale-host action instead of relying on icon-only button text.
- Latest focused verification for this session-shell slice passed: `npx vitest --run src/shell/OpenADESessionScreens.test.ts src/remote/RemoteApp.integration.test.ts`.

### 2026-06-01: Production Verification Sweep Refreshed

- The migration remains production-shippable with the default-on runtime/shared-shell branch, but broad production rollout still requires the telemetry review runbook and keeps legacy Yjs direct reads as fallback for at least one production release.
- The active-work unload blocker is disabled only for explicit smoke/test surfaces (`OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER=1`, `OPENADE_SMOKE_TEST=1`, or fake preload test APIs), not for normal production launches.
- Latest verification after the multi-session shell test passed: `projects/web` typecheck, full `npm test` with 79 files and 459 tests, production `npm run build`, and `git diff --check`.
- Runtime package verification passed: `projects/runtime`, `projects/runtime-client`, `projects/runtime-node`, `projects/openade-module`, and `projects/openade-client` typechecks plus `projects/openade-module` tests with the real WebSocket kernel persistence path.
- Shell verification passed: `projects/mobile` typecheck and production build; `projects/electron` typecheck, full `npm test` with 28 files and 257 tests, `npm run build:web`, `electron-builder --mac --dir` with `NONOTARY=1 CSC_IDENTITY_AUTO_DISCOVERY=false`, and packaged `npm run test:smoke`.
- Build warnings observed but not introduced by this slice remain the known Vite chunk-size warning, the `MarkdownMessage` dynamic/static import warning, duplicate `wasm-CG6Dc4jp.js.map` emission, npm/yarn mixed-lockfile warnings, and local macOS ad-hoc signing/notarization skip.

### 2026-05-31: Shared Host Panel Components Started

- Project file/search/process panels now live in `projects/web/src/shell/project/ProjectHostPanels.tsx`.
- Task changes/diff/git-log rendering now lives in `projects/web/src/shell/task/TaskGitPanel.tsx`.
- `RemoteApp` wires these shared components to the runtime-backed remote client today; desktop tray reuse can now happen without copying companion JSX.
- Remaining Phase 7 work: extract the composer, comments/review controls, event-thread presentation, and responsive chrome around the same product DTO/store contracts.

### 2026-05-31: Shared Task Composer And Product Controls Added

- The remote task composer now uses `projects/web/src/shell/task/TaskComposer.tsx`, backed by the shared command model for labels, mode ordering, and queue-while-running rules.
- Task title/close/delete, review launch controls, queued-turn cancellation, comments, and task git/read panels now live in `projects/web/src/shell/task/TaskProductPanel.tsx`.
- `TaskProductPanel` accepts OpenADE task DTOs directly and normalizes legacy/current comment shapes through tolerant readers, keeping old Yjs-projected tasks usable while the shell moves to runtime DTOs.
- `RemoteApp` now wires these shared task controls to the existing runtime-backed remote client path; `RemoteApp.integration.test.ts` still proves metadata/comments/queued/review/delete/git/file/process/self-revoke through a real `RuntimeServer`, `RuntimeLocalClient`, and `OpenADEClient`.
- Desktop can reuse the composer/product panel through the gated `DesktopSharedTaskPage`; remaining Phase 7 work is to close rich desktop editor/model/MCP/tray parity, extract route/chrome layout, and reduce `RemoteApp` to session/pairing plus shared shell composition.

### 2026-05-31: Shared Task Event Thread Added

- Task event DTO presentation now lives in `projects/web/src/shell/task/taskEventPresentation.ts` and renders through `projects/web/src/shell/task/TaskEventThread.tsx`.
- The shared event presentation accepts OpenADE task DTO fields directly, including action/setup/snapshot/queued/unknown event blocks and task-owned image attachments.
- The previous remote-only presentation tests moved with the shared shell files, and `RemoteApp` imports the shared event thread while keeping the scoped task image loader.
- The old remote-only thread-scroll alias and duplicate test were removed; desktop and remote now depend directly on `shell/task/useTaskThreadScroll.ts`.
- Remaining event parity work: reuse these thread components in the desktop task page or bridge desktop event models into the same DTO presentation shape, then remove duplicate desktop-only event rendering where parity permits.

### 2026-05-31: Shared Project Task And New-Task Screens Added

- Mobile companion chrome now lives in `projects/web/src/shell/OpenADEChrome.tsx`, keeping header/status/notices/bottom navigation as a medium adapter instead of embedding it in `RemoteApp`.
- Mobile pairing/connect UI now lives in `projects/web/src/shell/RemotePairingScreen.tsx`; `RemoteApp` still owns pairing parsing, validation, and token/session persistence.
- Mobile session management and local companion settings now live in `projects/web/src/shell/OpenADESessionScreens.tsx`, including saved-session selection/removal, self-revoke, and shell theme selection.
- The project task list, scoped file/search/process panels, and task-row rendering now live in `projects/web/src/shell/project/ProjectTasksScreen.tsx`.
- The project/session list now lives in `projects/web/src/shell/project/ProjectsScreen.tsx`, rendering OpenADE snapshots directly so mobile companion and future desktop/web shells do not need another project-list implementation.
- The new-task form now lives in `projects/web/src/shell/task/NewTaskScreen.tsx` and uses the shared task command model for create-mode labels/order.
- `RemoteApp` imports these shared shell screens and keeps only pairing orchestration, session state, runtime refresh, and action handlers locally.
- Web component tests render these screens with real OpenADE snapshot/project/process/task DTOs and session/settings actions, and `RemoteApp.integration.test.ts` still verifies the project/task runtime path through a real runtime client.

### 2026-05-31: Shared Task Screen Wrapper Added

- `projects/web/src/shell/task/TaskScreen.tsx` now composes the shared task event thread, task product panel, and task composer around OpenADE task and preview DTOs.
- `RemoteApp` delegates the task route to this shared task screen while continuing to own remote refresh, image loading, and product mutation handlers.
- The desktop route can opt into this shared task screen for experiments, but default desktop remains the classic `TaskPage` until the shared route matches desktop UI quality and behavior.

### 2026-06-01: Remote Shared Shell Wrapper Added

- `projects/web/src/shell/OpenADEShell.tsx` now owns remote project, task, new-task, session, and settings route composition.
- `RemoteApp` now delegates those route screens to the shared remote shell wrapper and keeps pairing, saved-session state, runtime refresh, realtime subscriptions, and action handlers at the remote adapter boundary.
- `OpenADEShell.test.ts` renders the wrapper with real OpenADE snapshot/project/task DTOs and verifies route-level actions flow through callbacks, while `RemoteApp.integration.test.ts` still covers the runtime-backed companion path through a real `RuntimeServer`, `RuntimeLocalClient`, and `OpenADEClient`.
- Latest verification for this shell/session slice passed: focused `OpenADEShell`, `RemoteApp.integration`, `sessionStore`, and `client` tests; `projects/web` `tsgo --noEmit`, full `npm test` with 76 files and 454 tests, and `npm run build`; `projects/mobile` typecheck and production build; and `git diff --check`.

### 2026-06-01: Separate Mobile Product UI Removed

- The mobile companion no longer has a separately named product shell. `RemoteApp` uses `OpenADEShell`, `OpenADEChrome`, `OpenADESessionScreens`, and `RemotePairingScreen` from `projects/web/src/shell`.
- `OpenADEChrome` renders the same route navigation as a compact bottom bar on narrow viewports and a side rail on wider viewports, so the remote shell is responsive rather than mobile-only.
- Mobile remains a Capacitor/native host adapter for QR scanning, secure token storage, OTA readiness, and safe-area constraints. Pairing, session persistence, runtime transport, product DTOs, and product screens stay in the shared web shell.

### 2026-06-01: Desktop Runtime Defaults Keep Classic UI

- `projects/web/src/featureFlags.ts` now defaults `VITE_OPENADE_ENABLE_RUNTIME_PRODUCT_STORE` to enabled, while `VITE_OPENADE_ENABLE_DESKTOP_SHARED_TASK_SCREEN` is opt-in only. Desktop runtime reads should keep the old desktop UI by default instead of promoting the compact companion shell into desktop.
- `projects/web/src/pages/DesktopSharedProjectPage.tsx` remains an experimental adapter around `projects/web/src/shell/project/ProjectTasksScreen.tsx`, wiring project files, search, process list/start/reconnect/stop, new-task navigation, and task navigation through `runtime/localOpenADEClient.ts`. Do not use it as the desktop default unless the resulting UI matches the existing desktop product quality and behavior.
- `CodeWorkspaceRoute` preserves the classic desktop workspace behavior by redirecting from a workspace URL to the latest open task or task-create route, using runtime-backed task previews when the runtime product bridge has a snapshot.
- `projects/web/src/Routes.runtimeProductStore.test.ts` now verifies the default workspace redirect and classic desktop task route through a real `RuntimeServer` behind the production local runtime bridge, while keeping separate opt-in coverage for shared project/task experiments and explicit absence of `runtime_product_store_fallback` or `runtime_product_store_error` telemetry during normal default-on route flows.
- Latest packaged default-on verification passed after rebuilding Electron, rebuilding the bundled web app, and packaging a mac directory build: `cd projects/electron && npm run build && npm run build:web && NONOTARY=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir`, then `npm run test:smoke`. The packaged smoke relaunches the built app, navigates from the workspace URL to the classic desktop task route, and asserts the stable `data-openade-surface="desktop-classic-task"` marker while verifying the shared project/task markers are absent by default.
- The desktop new-task route intentionally still uses the rich desktop create page. Do not replace it with the simple shared `NewTaskScreen` until the shared route preserves desktop create parity: SmartEditor file mentions/slash commands, image attachments, MCP selection, harness/model/thinking/fast-mode controls, branch/worktree selection, drafts, pending creation state, shortcuts, create-more behavior, and HyperPlan strategy selection.
- Remaining production work is rollout evidence, not local implementation: run the telemetry review on a default-on cohort, keep legacy Yjs fallback reads for at least one production release, and only remove fallback paths after logs show no normal-flow fallback use.

### 2026-06-01: Desktop Shared Task Shell Frame Added

- `projects/web/src/shell/DesktopTaskShell.tsx` now owns the desktop shared-task frame around `TaskScreen`, including desktop notices, drag image overlay, viewport containment, and the medium-supplied composer slot.
- `DesktopSharedTaskPage` keeps desktop-specific runtime action wiring, rich `InputBar`, hotkeys, image-drop state, and `TaskModel` integration, then delegates the shared route frame to `DesktopTaskShell`.
- `DesktopTaskShell.test.ts` renders the frame with a real OpenADE task DTO and medium-supplied composer, while `Routes.runtimeProductStore.test.ts` still verifies the gated desktop shared route through a real local-runtime bridge and now opens the Files tray through the rich desktop composer frame.
- Latest verification for this desktop frame slice passed: focused `DesktopTaskShell` and `Routes.runtimeProductStore` tests, full `projects/web` `npm test` with 77 files and 455 tests, `projects/web` production `npm run build`, `projects/mobile` typecheck and production build, and `git diff --check`.

### 2026-05-31: Shared Task Command State Model Added

- `projects/web/src/shell/task/taskCommandModel.ts` now owns command ids, labels, order, grouping, style variants, visibility, enablement, repeat-mode behavior, and telemetry-trackable command ids.
- Desktop `InputManager` now builds its commands from the shared descriptor model and only attaches desktop-specific icons and side effects.
- This moves Plan/Do/Ask/Revise/Run Plan/Review/Repeat/Stop/Close/Reopen/Commit command state toward the shared shell without weakening the existing desktop editor, review modal, repeat, git, or runtime-turn behavior.
- Web tests cover the descriptor model directly plus existing `InputManager` command execution behavior.

### 2026-06-01: Shared Task Composer Agent Controls Added

- `projects/web/src/shell/task/TaskComposer.tsx` now owns optional shared controls for harness, model, thinking level, and fast mode, plus an MCP-control slot supplied by the medium adapter so the Capacitor host does not import desktop store/settings code.
- The gated desktop shared task route wires those controls to the same `TaskModel` state used by the legacy desktop `InputBar`, then sends the selected values through `runtime/localOpenADEClient.ts` on `openade/turn/start` and `openade/review/start`.
- `projects/web/src/Routes.runtimeProductStore.test.ts` verifies this through a real `RuntimeServer` installed behind the production local runtime bridge: the shared desktop composer renders the agent/MCP controls, toggles fast mode, submits a turn, and asserts the actual runtime request includes harness id, model id, thinking, fast mode, and enabled MCP server ids.
- Remaining shared task production evidence is review of rollout fallback telemetry from an internal/default-on cohort.

### 2026-06-01: Desktop Shared Rich Composer Slot Added

- `projects/web/src/shell/task/TaskScreen.tsx` now accepts a medium-supplied composer slot plus viewport padding so desktop can reuse the same DTO-backed task thread/product panel while supplying desktop-only input chrome.
- The gated desktop shared route supplies the existing rich `InputBar`, preserving SmartEditor, image attach, file mentions, slash commands, desktop tray buttons, tray shortcuts, model/thinking/fast-mode controls, and MCP selection without importing those desktop-only affordances into mobile.
- `InputBar` now has an optional command override. `DesktopSharedTaskPage` uses it so rich composer command buttons and shortcuts call `runtime/localOpenADEClient.ts` product methods directly instead of falling back to renderer `RepoStore`/Yjs command execution in the runtime-backed route.
- `projects/web/src/Routes.runtimeProductStore.test.ts` verifies this through a real `RuntimeServer` installed behind the production local runtime bridge: the route renders the rich attach/tray/MCP controls, toggles fast mode, submits via the rich Do command, and asserts the actual `openade/turn/start` request includes harness id, model id, thinking, fast mode, and enabled MCP server ids.
- `projects/web/src/Routes.runtimeProductStore.test.ts` also runs an automated desktop workflow smoke against the same real local-runtime route: Plan, Revise, Run Plan, Ask, Close/Reopen, and recreate the store to prove reload reads the runtime-backed state.
- `CodeStore` and `RepoManager` now keep serving an existing runtime snapshot while bridge status is transiently non-ready, preventing route fallback to legacy `RepoStore` during runtime refresh/error windows. `projects/web/src/store/storeRuntimeProductStore.test.ts` covers this with a real `RuntimeServer`, `RuntimeLocalClient`, and `OpenADEClient`.
- `CodeStore` now emits rollout observability for the bridge: app-open runtime status, sanitized runtime bridge errors, and deduped legacy fallback events. `projects/web/src/store/storeRuntimeProductStore.test.ts` verifies the fallback signal after initializing a real runtime-backed bridge, then forcing a direct legacy task-store read.
- Packaged-app smoke passed after `npm run build`, `npm run build:web`, and `electron-builder --mac --dir`, proving the bundled web UI, preload IPC runtime initialization, repo creation, Plan, Revise, Run Plan, Ask, close/reopen, app relaunch reload, scoped project file tree/read/write/search, and scoped project process list/start/reconnect-output/stop still work in the packaged desktop binary. The smoke harness isolates `HOME`/`USERPROFILE` and explicitly sets `OPENADE_YJS_STORAGE_DIR` so it does not read or mutate the developer's normal `~/.openade` data.
- Remaining production blockers are review of rollout fallback telemetry from an internal/default-on cohort and later route/chrome cleanup before removing legacy desktop paths.

### 2026-06-01: Packaged Workflow Smoke And Storage Race Fixes

- `projects/openade-module/src/yjsMutation.ts` now saves Yjs mutation deltas relative to the state vector loaded by that writer. This prevents stale concurrent action-stream saves from resurrecting older task status fields after a later terminal update. `projects/openade-module/src/yjsMutation.test.ts` proves the regression through real node Yjs storage and projection reads.
- `projects/electron/src/modules/code/yjsStorage.ts` now makes loads, deletes, and document listing wait for in-flight per-document saves. This gives the runtime read-after-write consistency when the packaged app starts the next turn immediately after a task event completes. `projects/electron/src/modules/code/yjsStorage.test.ts` covers the behavior with real filesystem-backed Yjs storage.
- `projects/electron/src/modules/companion/runtimeGateway.ts` retries mutation-start task reads on transient `Task not found` errors, so existing-task turns tolerate short projection/storage timing windows without hiding non-task-not-found failures.
- The packaged smoke disables active-work unload prompts with `OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER=1` while also using `OPENADE_SMOKE_TEST=1` and the deterministic smoke harness. The production blocker remains active outside those explicit smoke/test env flags.
- The packaged smoke also sets `OPENADE_YJS_STORAGE_DIR` under its temp user-data directory. This avoids false `Task <id> not found` read-after-write failures caused by the packaged app reading the developer's normal `~/.openade/data/yjs/code_repos` during workflow verification.
- `projects/electron/tests/smoke.spec.ts` now waits for both task-event completion and `runtime/list` idle state before issuing the next turn. Its task-read polling retries only the exact transient `Task <id> not found` window after turn start, which verifies the real runtime lifecycle instead of racing active-execution cleanup.

## Open Questions

- Should the first-class kernel live in a new `projects/openade-kernel` package or be an option in `runtime-node`? Resolved for this migration slice: keep it in `projects/openade-module/src/kernel.ts` so runtime-node stays product-agnostic.
- Should browser web support direct private-network pairing, or should it start desktop/local only until browser Private Network Access constraints are fully handled?
- Which mobile roles should be exposed in product UI first: admin, operator, viewer, or only the current paired-device role?
- Which desktop settings should become kernel-owned versus remain local client preferences?
- Should terminal/process access ever be enabled on mobile by default, or always require explicit per-device grants?
- How long should the old desktop Yjs direct-read path remain behind a fallback flag? Resolved for this branch: at least one production release after default-on runtime rollout, followed by telemetry/log review and regression fixtures for any fallback-triggering cases.

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
