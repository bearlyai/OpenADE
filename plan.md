# Shared Shell And Remote Kernel Migration Plan

## Purpose

Move the Electron desktop app and the mobile companion toward one shared OpenADE application shell attached to a runtime kernel. The intended end state is not two separate products with duplicated UI and transport logic. It is the classic desktop product experience, backed by runtime/OpenADE APIs, that can run through different medium adapters:

- Electron desktop shell
- Capacitor mobile host
- Browser web shell
- Future CLI/headless clients where applicable

The kernel owns durable OpenADE state, host capabilities, runtime lifecycle, subscriptions, permissions, and execution. Clients render UI, keep local interaction state, and call the kernel through a typed runtime client.

This plan is deliberately verification-heavy. Each migration slice must prove behavior through real runtime, storage, transport, notification, and host paths. Tests that only prove mocks were called do not count as migration confidence.

Direction constraint: the existing desktop app UI is the canonical product experience. The shared-shell migration must move that desktop look, behavior, trays, shortcuts, rich composer, task create flow, and settings affordances onto runtime/OpenADE APIs. It must not replace desktop with the compact mobile companion UI. Mobile/web are consumers of the desktop-quality product surface where their permissions and screen size allow; they are not the source design for desktop.

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
- `projects/web/src/remote/client.ts` owns pairing URL parsing, host validation, config persistence, runtime WebSocket construction, reconnect status, `getRemoteProductStore()`, transient read retry, and remote-only device/session actions. Product reads and mutations go through `OpenADEProductStore` rather than per-method remote wrappers.

The current remote UI remains intentionally safer than desktop, but it now covers more product parity than the initial plan state. It reads snapshots/tasks, starts and interrupts turns, listens to runtime notifications, edits task metadata/comments, cancels queued turns, starts reviews, deletes tasks, renders task-owned images, and exposes scoped file/search/process/git-read panels. It still does not expose desktop parity for model/MCP controls, raw terminal access, arbitrary process control, file writes, commit/push, native desktop settings, or broad admin/device-management surfaces.

The current remote/mobile presentation is not the product design target. Because the mobile app is not production-critical yet, its UI can be deleted, replaced, or rebuilt around desktop-derived components whenever that is the cleaner route. Do not preserve the compact companion UI at the cost of the classic desktop experience.

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

### Desktop-Canonical Shared Shell

The shared shell is a reusable OpenADE UI shell in `projects/web` with medium-specific adapters. It must be extracted from the classic desktop app, not from the compact remote companion screens:

- Preserve `CodeLayout`, `TaskPage`, `TaskCreatePage`, `InputBar`, trays, task title editing, shortcuts, rich editor affordances, settings, and desktop navigation semantics as the baseline.
- Move those desktop behaviors from renderer-owned Yjs/local host assumptions to `OpenADEClient`, `kernel/productStore.ts`, and scoped runtime APIs.
- Extract shared project/task/thread/composer/settings/file/diff/search/terminal/process components only after they match the classic desktop behavior and visual quality.
- Keep shared command semantics for Plan, Do, Ask, Revise, Run Plan, Review, Repeat, Stop, Close/Reopen, Commit and Push, but let desktop keep its richer command chrome where needed.
- Adapt desktop-derived components for mobile/web with responsive trays, sheets, tabs, or simplified permissions only after the desktop behavior is preserved.
- Treat compact remote screens as temporary adapters. They should shrink or disappear as desktop-derived shared components replace them.

Medium wrappers should be thin:

- Electron: native window frame, app updates, file picker, open URL/path, local embedded kernel bootstrapping.
- Mobile: QR scan, secure storage, OTA web bundle updates, safe-area handling.
- Web: pairing/session entry, browser-safe storage, remote-only capability set.

## Non-Negotiable Migration Rules

0. Keep classic desktop UI as the source of truth.
   - Runtime migration changes the data and host boundary, not the desktop product surface.
   - Do not ship `RemoteApp`, `OpenADEShell`, `TaskScreen`, `NewTaskScreen`, or other compact companion screens as desktop replacements unless they have first reached classic desktop parity.
   - When sharing UI, extract desktop-quality components from `TaskPage`, `TaskCreatePage`, `InputBar`, trays, settings, and related desktop flows, then adapt them down to mobile/web.

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

Replace the split between the full desktop app and narrow `RemoteApp` by moving the classic desktop app shell onto runtime-backed product APIs, then adapting that desktop-quality surface to remote/mobile. This phase is not a mobile UI promotion.

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

- Keep default desktop routes on classic `CodeLayout`, `TaskPage`, `TaskCreatePage`, `InputBar`, tray, and settings components while each direct Yjs/local-host assumption is replaced by runtime APIs.
- Do not add desktop routes that render compact remote/mobile screens. Shared desktop components must be extracted from the classic desktop route after parity is proven.
- Extract task thread/event presentation from the desktop route first, preserving desktop spacing, markdown/code behavior, comments, images, running-state affordances, and scroll behavior.
- Extract composer behavior from `InputBar` without losing SmartEditor file mentions/slash commands, image attachments, MCP selection, harness/model/thinking/fast-mode controls, repeat/review flows, tray buttons, shortcuts, and disabled/loading states.
- Extract desktop project/task list behavior without changing sidebar ordering, last-viewed restore, workspace redirects, closed task handling, or task-create navigation.
- Extract file/search/diff/terminal/process surfaces from the desktop trays, then put scoped runtime methods underneath them.
- Extract settings surfaces only where the setting belongs to product/kernel state; leave native desktop preferences in the Electron adapter.
- After a desktop-derived feature component is API-backed and parity-tested, adapt it to mobile/web with sheets/tabs/full-screen panels and role-based capability gates.
- Keep keyboard shortcuts desktop-first, with touch controls added as an adapter layer on mobile.
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
  - classic desktop surface markers, with compact shared/mobile surface markers absent by default
- Mobile/web smoke covers:
  - session connect
  - project navigation
  - task thread
  - command submission
  - panel open
- Visual/screenshot checks for changed responsive layouts.
- Desktop visual checks must compare against the classic desktop route, not the current companion/mobile screens.

### Exit Criteria

- Desktop keeps the classic look and functionality while reading and mutating through runtime/OpenADE APIs.
- Shared feature components are desktop-derived and reusable by companion/web through different chrome and permission gates.
- `RemoteApp` is either deleted or reduced to a pairing/session wrapper around the desktop-derived shared shell.
- Compact mobile-only product screens are removed or isolated as temporary non-production adapters.

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
  - desktop-derived shared components
  - remote/mobile adapter shell
  - scoped host capabilities
  - remote terminal/process access
- Default desktop to existing shell until parity gates pass.
- Enable runtime-backed store for internal/dev first.
- Use mobile/web as adapter verification only; do not let a mobile-first shell drive the desktop route.
- Enable desktop-derived shared components only after high-risk trays, settings, task create, and rich composer behavior pass classic desktop parity checks.
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

- One desktop-derived shared shell powers desktop and companion.
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

### 2026-06-01: Desktop UI Direction Corrected

- The canonical UI is the existing desktop app, not the compact companion/mobile shell.
- The migration target is classic desktop look and functionality over runtime/OpenADE APIs: keep `CodeLayout`, `TaskPage`, `TaskCreatePage`, `InputBar`, trays, shortcuts, settings, and rich desktop workflows as the product baseline.
- Remote/mobile UI work is adapter work. Because mobile is not production-critical yet, companion screens may be deleted or rebuilt if they block a cleaner desktop-derived shared shell.
- `OpenADEShell`, `TaskScreen`, and `NewTaskScreen` remain remote/mobile adapter surfaces unless they reach classic desktop parity. Default and packaged desktop smoke must keep asserting the classic desktop route.

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
- Companion permissions still deny raw `runtime/*`, `process/*`, `pty/*`, `fs/*`, `git/*`, `host/*`, `snapshot/*`, `data/*`, `openade/action/*`, `openade/snapshot/create`, `openade/task/environment/setup`, and `openade/task/environment/prepare` methods.
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

### 2026-06-01: Desktop Shared Task Screen Experiment Removed

- The desktop shared-screen route, env flag, test config, and `DesktopShared*` files were removed after the direction correction.
- Desktop task routes now always render the classic `TaskPage`; runtime-backed reads and mutations must move under that existing UI instead of swapping in the compact remote task surface.
- `projects/web/src/Routes.runtimeProductStore.test.ts` keeps real local-runtime coverage on the classic desktop route and asserts the compact shared task surface is absent.
- Keep the renderer Yjs fallback path available until production default-on telemetry has been reviewed.

### 2026-06-01: Runtime Product Bridge Rollout Decision

- The runtime product bridge defaults on in this branch while the desktop UI remains the classic `TaskPage`/`TaskCreatePage` surface. Production rollout must keep the renderer Yjs path as a fallback for at least one production release.
- Do not remove renderer Yjs initialization or fallback reads until telemetry/logs show the runtime-backed path is healthy across normal navigation, task detail, notifications, and reloads.
- If fallback use is observed after default-on rollout, treat it as a production migration bug and add a regression fixture before removing the fallback.
- Rollout observability now comes from `CodeStore`: `app_opened` includes runtime-product gate/status fields, `runtime_product_store_error` records sanitized bridge error categories, and `runtime_product_store_fallback` records deduped legacy direct-read fallback sources/reasons without repo paths or task content.
- Production rollout criteria for the default-on runtime product bridge: packaged workflow smoke passes, no fallback events are seen in the internal/default-on cohort for normal navigation/task-detail/reload flows, and any observed fallback has a reproduction plus a regression fixture before removal of the legacy path.

### Runtime Product Rollout Telemetry Review Runbook

Run this review before shipping the default-on runtime/shared-shell branch broadly and again before removing renderer Yjs fallback reads.

- Cohort setup: ship an internal desktop build with the default-on runtime product bridge enabled and the classic desktop route active. Record any explicit env/config overrides. To compare fallback behavior, use explicit false values for `VITE_OPENADE_ENABLE_RUNTIME_PRODUCT_STORE`.
- Required workflow coverage: desktop launch, repo/project list navigation, task preview navigation, task detail load, runtime notification refresh, Plan, Revise, Run Plan, Ask, comments, metadata edits, close/reopen, app close/relaunch reload, and scoped project file tree/read/write/search.
- Required telemetry checks: `app_opened` must show the gate enabled and a ready runtime product store after normal startup; `runtime_product_store_error` must have no unexplained categories; `runtime_product_store_fallback` must be absent for normal workflows.
- Executable review gate: export the internal/default-on cohort telemetry as JSON, `{ "events": [...] }`, or NDJSON/Amplitude-style lines, then run `cd projects/web && npm run review:runtime-product-rollout -- <telemetry-export.json-or-ndjson>`. The command fails if the cohort lacks a ready default-on `app_opened`, includes fallback/error events, or includes unreviewed rollout event properties.
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
- `OpenADEClient` and `OpenADEProductStore` expose typed helpers for task changes, file patches, and git log reads using OpenADE module DTOs directly.
- Kernel and companion integration tests cover real temp git repos, modified and untracked files, patch stats/content, git log reads, traversal denial, and authenticated paired WebSocket permission behavior.
- `projects/web/src/kernel/productStore.test.ts` verifies the shared UI-facing product store reaches the scoped task git helpers through a real `RuntimeServer`, `RuntimeLocalClient`, `OpenADEClient`, and OpenADE module route.

### 2026-05-31: Scoped Task Git Commit Added

- `openade/task/git/commit` now lives on the OpenADE scoped host boundary for trusted/local product clients.
- Node and Electron hosts resolve the task work dir server-side, stage scoped task changes with `git add -A`, commit with a validated message, and report `committed`, `nothing_to_commit`, or `failed` without granting raw `git/*`.
- `OpenADEClient` and `OpenADEProductStore` expose typed commit helpers that preserve `clientRequestId` for idempotent retry behavior.
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
- `OpenADEClient` and `OpenADEProductStore` expose the typed process list/start/reconnect/stop helpers.
- Kernel tests cover real WebSocket process list/start/reconnect/stop against a temp repo and invalid `work_dir`; companion tests cover authenticated paired WebSocket process lifecycle plus raw process denial.

### 2026-05-31: Scoped Task Terminal Methods Added

- `openade/task/terminal/start`, `openade/task/terminal/write`, `openade/task/terminal/reconnect`, `openade/task/terminal/resize`, and `openade/task/terminal/stop` now live on the OpenADE scoped host boundary.
- Node and Electron hosts derive PTY ids server-side from repo/task ids, resolve the initial cwd through the task workdir rules, normalize reconnect output, and reject client-supplied terminal ids that do not match the task.
- The typed terminal helpers are exposed through `OpenADEClient` and `OpenADEProductStore`.
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
- Desktop must keep using the rich classic `InputBar` and desktop task controls while their internals move to runtime APIs; remaining Phase 7 work is to extract desktop-parity pieces from the classic route and reduce `RemoteApp` to session/pairing plus desktop-derived shared shell composition.

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
- The desktop route no longer opts into this compact task screen; desktop remains on the classic `TaskPage` while shared components are extracted from desktop-parity work.

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

- `projects/web/src/featureFlags.ts` now defaults `VITE_OPENADE_ENABLE_RUNTIME_PRODUCT_STORE` to enabled, and the desktop shared-task-screen flag has been removed. Desktop runtime reads keep the old desktop UI instead of promoting the compact companion shell into desktop.
- The old `DesktopSharedProjectPage`, `DesktopSharedTaskPage`, and `DesktopTaskShell` experiment files were removed. Future shared desktop work must extract from the classic desktop route rather than route around it.
- `CodeWorkspaceRoute` preserves the classic desktop workspace behavior by redirecting from a workspace URL to the latest open task or task-create route, using runtime-backed task previews when the runtime product bridge has a snapshot.
- Classic desktop `InputBar` command execution now avoids direct renderer task-store reads when runtime product reads are active: it sends `openade/turn/start` through `CodeStore.startProductTurn()` and refreshes runtime DTOs through `CodeStore.refreshRuntimeProductSnapshot()` plus `CodeStore.refreshRuntimeProductTaskForTaskId()` instead of forcing `getTaskStore()`.
- Classic desktop task mutation refreshes now share `CodeStore.refreshProductStateAfterTaskMutation()`, `refreshProductStateAfterTaskCreation()`, and `refreshProductStateAfterTaskDeletion()`. Under runtime-backed reads, task metadata, comments, review start, repeat/cron turns, task creation, and task deletion refresh runtime DTOs instead of legacy renderer task-store/repo-store state; with runtime reads disabled, the same callers keep the old Yjs refresh behavior.
- Classic desktop repo mutations now share `CodeStore.createProductRepo()`, `updateProductRepo()`, `deleteProductRepo()`, and `refreshProductStateAfterRepoMutation()`. Under runtime-backed reads, workspace create, settings updates, archive, and delete use the injected runtime product store/OpenADE client and refresh runtime snapshots instead of forcing legacy repo-store refreshes.
- Classic desktop task/comment/turn mutations now also enter through `CodeStore` product helpers (`startProductTurn()`, `startProductReview()`, `interruptProductTurn()`, `cancelProductQueuedTurn()`, `updateProductTaskMetadata()`, `setupProductTaskEnvironment()`, comment helpers, and `deleteProductTask()`). Under runtime-backed reads, `InputBar`, task creation, repeat/cron turns, review, queued-turn cancellation, comments, metadata, environment setup, and deep delete use the injected `OpenADEProductStore`; legacy `runtime/localOpenADEClient.ts` remains the explicit fallback path.
- Classic desktop task read helpers now share `CodeStore.loadProductTaskForRead()`. Delete-resource inventory, sidebar task lists, and sidebar copy-path load runtime task DTOs when runtime product reads are active and only use legacy task stores in the fallback path. Title generation/regeneration uses `CodeStore.generateProductTaskTitle()` in the runtime-backed path so the host/core owns workspace and harness access.
- Runtime notifications now preserve that same boundary: task updates, preview changes, deletions, queued-turn reconciliation, repo snapshot changes, and runtime-settlement after-event callbacks refresh `OpenADEProductStore`/runtime DTO state when runtime reads are active, and only call `refreshRepoStoreFromStorage()` or `refreshTaskStoreFromStorage()` in the legacy fallback path.
- Classic desktop changes tray reads now keep the old desktop UI while routing file lists, split-view file pairs, unified patches, and from-base comparisons through `CodeStore.readProductTaskChanges()`, `readProductTaskDiff()`, and `readProductTaskFilePair()` when runtime product reads are active. The scoped OpenADE API now exposes `openade/task/filePair/read` so desktop, remote web, and mobile adapters can share the same task-scoped core read without raw trusted-local `git/*`.
- Classic desktop Git Log tray commit-list, commit-file list, commit file-content, and commit patch reads now keep the old tray UI while routing task-scoped branch history/details through `CodeStore.readProductTaskGitLog()`, `readProductTaskGitCommitFiles()`, `readProductTaskGitFileAtTreeish()`, and `readProductTaskGitCommitFilePatch()`. Branch/worktree scope discovery still uses trusted-local `gitApi`; non-task worktree scopes remain the explicit local fallback until the product API owns scope discovery.
- Classic desktop Files tray directory reads, file reads, and filename fuzzy search now keep the old tray UI while routing task-scoped paths through `CodeStore.listProductProjectFiles()`, `readProductProjectFile()`, and `fuzzySearchProductProjectFiles()` when runtime product reads are active. Classic desktop Search tray content search and previews now send the active `taskId` through `CodeStore.searchProductProject()` and `readProductProjectFile()`, so worktree task searches no longer fall back to repo-root project search or raw trusted-local `filesApi`.
- `projects/shared/companion` no longer exports `Remote*` aliases for OpenADE product DTOs. Remote/mobile code imports product types directly from `projects/openade-module/src`, leaving the companion package for actual companion-owned pairing, device, keep-awake, and coarse event contracts.
- Classic desktop snapshot event reads now keep `SnapshotEventItem` and `ViewPatch` while routing external patch, index, and slice loads through `CodeStore.readProductTaskSnapshotPatch()`, `readProductTaskSnapshotIndex()`, and `readProductTaskSnapshotPatchSlice()` when runtime product reads are active. Raw `snapshotsApi` reads remain trusted-local fallback only.
- Classic desktop settings Stats now read task previews through `CodeStore.getTaskPreviewReposForStats()`, which uses the runtime product snapshot when runtime reads are active and only falls back to legacy `RepoStore` outside that path. Missing usage backfill also uses runtime task reads plus `openade/task/metadata/update` instead of opening legacy renderer task stores. `storeRuntimeProductStore.test.ts` verifies this through a real `RuntimeServer`, `RuntimeLocalClient`, and `OpenADEProductStore`.
- `projects/web/src/Routes.runtimeProductStore.test.ts` now verifies the default workspace redirect and classic desktop task route through a real `RuntimeServer` behind the production local runtime bridge, while asserting the compact shared task surface is absent and there is no `runtime_product_store_fallback` or `runtime_product_store_error` telemetry during normal default-on route flows.
- Latest packaged default-on verification passed after rebuilding Electron, rebuilding the bundled web app, and packaging a mac directory build: `cd projects/electron && npm run build && npm run build:web && NONOTARY=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir`, then `npm run test:smoke`. The packaged smoke relaunches the built app, navigates from the workspace URL to the classic desktop task route, and asserts the stable `data-openade-surface="desktop-classic-task"` marker while verifying the shared project/task markers are absent by default.
- The desktop new-task route intentionally still uses the rich desktop create page. Do not replace it with the simple shared `NewTaskScreen` until the shared route preserves desktop create parity: SmartEditor file mentions/slash commands, image attachments, MCP selection, harness/model/thinking/fast-mode controls, branch/worktree selection, drafts, pending creation state, shortcuts, create-more behavior, and HyperPlan strategy selection.
- Remaining production work is rollout evidence, not local implementation: run the telemetry review on a default-on cohort, keep legacy Yjs fallback reads for at least one production release, and only remove fallback paths after logs show no normal-flow fallback use.

### 2026-06-01: Runtime Product Rollout Review Gate Added

- `projects/web/src/analytics/runtimeProductRolloutReview.ts` now parses JSON, `{ "events": [...] }`, and NDJSON/Amplitude-style telemetry exports, then verifies the default-on rollout criteria from this plan.
- `npm run review:runtime-product-rollout -- <telemetry-export.json-or-ndjson>` fails the release gate when the export has no ready default-on `app_opened`, any `runtime_product_store_fallback`, any `runtime_product_store_error`, or unreviewed properties on rollout events.
- `projects/web/src/analytics/runtimeProductRolloutReview.test.ts` covers passing Amplitude-style exports, fallback/error failures, non-ready app-open failures, malformed exports, and property hygiene failures for sensitive/unreviewed fields.
- Packaged smoke now captures the renderer's real analytics `track()` calls when `OPENADE_SMOKE_TEST=1`, writes a NDJSON telemetry export, and runs that same rollout review command after exercising the classic desktop route. This proves the packaged default-on smoke emits a ready `app_opened` and no runtime product fallback/error telemetry.
- This does not replace the required internal/default-on cohort run; it makes that review repeatable and gives the team an auditable artifact before broad rollout or fallback removal.

### 2026-06-01: Desktop Shared Task Shell Experiment Removed

- `projects/web/src/shell/DesktopTaskShell.tsx`, `DesktopSharedTaskPage`, `DesktopSharedProjectPage`, and the focused frame test were deleted so desktop has no hidden route into the compact remote task surface.
- The classic desktop route keeps `TaskPage`, `InputBar`, desktop trays, drag image overlay, hotkeys, and `TaskModel` integration while those paths move to runtime APIs.
- `Routes.runtimeProductStore.test.ts` now exercises the classic desktop route for Plan, Revise, Run Plan, Ask, Close/Reopen, and reload through a real local-runtime bridge.

### 2026-05-31: Shared Task Command State Model Added

- `projects/web/src/shell/task/taskCommandModel.ts` now owns command ids, labels, order, grouping, style variants, visibility, enablement, repeat-mode behavior, and telemetry-trackable command ids.
- Desktop `InputManager` now builds its commands from the shared descriptor model and only attaches desktop-specific icons and side effects.
- This moves Plan/Do/Ask/Revise/Run Plan/Review/Repeat/Stop/Close/Reopen/Commit command state toward the shared shell without weakening the existing desktop editor, review modal, repeat, git, or runtime-turn behavior.
- Web tests cover the descriptor model directly plus existing `InputManager` command execution behavior.

### 2026-06-01: Shared Task Composer Agent Controls Added

- `projects/web/src/shell/task/TaskComposer.tsx` owns optional remote/shared-adapter controls for harness, model, thinking level, and fast mode, plus an MCP-control slot supplied by the medium adapter so the Capacitor host does not import desktop store/settings code.
- Desktop remains on the classic `InputBar`; desktop agent/model/thinking/fast-mode/MCP selections are verified through the classic route and `InputManager` runtime path.
- Remaining production evidence is review of rollout fallback telemetry from an internal/default-on cohort.

### 2026-06-01: Classic Desktop Rich Composer Runtime Path Verified

- The classic desktop route supplies the existing rich `InputBar`, preserving SmartEditor, image attach, file mentions, slash commands, desktop tray buttons, tray shortcuts, model/thinking/fast-mode controls, and MCP selection.
- `projects/web/src/Routes.runtimeProductStore.test.ts` verifies the classic route through a real `RuntimeServer` installed behind the production local runtime bridge: the route renders rich attach/tray controls, submits via the rich Do command, and asserts the actual `openade/turn/start` request includes harness id, model id, thinking, and fast mode.
- `projects/web/src/Routes.runtimeProductStore.test.ts` also runs an automated classic desktop workflow smoke against the same real local-runtime route: Plan, Revise, Run Plan, Ask, Close/Reopen, and recreate the store to prove reload reads the runtime-backed state.
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

### 2026-06-01: Generic File/Search Bridge DTOs Consolidated

- Generic `fs/path/describe`, `fs/search/fuzzy`, and `fs/search/content` request/result DTOs now live in `projects/runtime-node/src/files.ts`, which owns the runtime-node filesystem method boundary.
- `projects/electron/src/modules/code/files.ts`, `projects/web/src/electronAPI/files.ts`, and `projects/runtime-node/src/localFiles.ts` import those runtime-node DTOs instead of maintaining mirrored `FuzzySearchResponse`, `ContentSearchMatch`, `PathEntry`, and `DescribePathResponse` shapes.
- This keeps raw filesystem powers as trusted/local host primitives while removing another "keep in sync" bridge type pair between Electron main and the renderer.
- Focused verification passed: runtime-node typecheck, Electron typecheck, web typecheck, Biome lint for the touched filesystem files, and web `FileBrowserManager`/`SmartEditorManager` tests.

### 2026-06-01: Generic Process Bridge DTOs Consolidated

- Generic `process/command/start`, `process/script/start`, `process/list`, `process/reconnect`, `process/kill`, process output chunks, and process lifecycle DTOs now live in `projects/runtime-node/src/process.ts`.
- `projects/electron/src/modules/code/process.ts`, `projects/web/src/electronAPI/process.ts`, and `projects/runtime-node/src/localProcess.ts` import those runtime-node DTOs instead of maintaining separate `StartProcessResponse`, `ProcessOutputChunk`, reconnect, kill, and list shapes.
- Desktop `ProcessHandle` still uses the trusted local runtime process methods, but reconnect now consumes the exact runtime reconnect result rather than a partial local interface plus cast.
- Focused verification passed: runtime-node typecheck, Electron typecheck, web typecheck, Biome lint for the touched process files, `runtimeHost.integration`, and the process-covered `runtimeNodeServer.integration` path.

### 2026-06-01: Generic PTY Bridge DTOs And Encoding Consolidated

- Generic `pty/spawn`, `pty/write`, `pty/resize`, `pty/reconnect`, `pty/kill`, PTY output chunks, and PTY lifecycle DTOs now live in `projects/runtime-node/src/pty.ts`.
- The raw runtime `pty/*` contract now uses base64-encoded terminal data for both `pty/write` input and `pty/output` chunks across Electron and headless runtime-node hosts.
- `projects/electron/src/modules/code/pty.ts`, `projects/web/src/electronAPI/pty.ts`, and `projects/runtime-node/src/localPty.ts` import those runtime-node DTOs instead of maintaining separate `SpawnResponse`, `PtyOutputEvent`, reconnect, and lifecycle shapes.
- OpenADE task-terminal methods remain product-level plain text: `projects/openade-module/src/node.ts` encodes plain text before raw `pty/write` and decodes raw PTY output before returning `OpenADETaskTerminalOutputChunk`.
- Focused verification passed: runtime-node typecheck, Electron typecheck, web typecheck, OpenADE module typecheck, Biome lint for the touched PTY/terminal files, full `runtimeNodeServer.integration`, and `openade-module` kernel integration tests.

### 2026-06-01: MCP Host Bridge DTOs Consolidated

- Browser-safe MCP config, test-connection, OAuth token, OAuth initiation/cancel/refresh, and OAuth completion DTOs now live in `projects/harness/src/types.ts`, next to the harness MCP server config contract that already owned the CLI-facing shape.
- `projects/electron/src/modules/code/mcp.ts`, `projects/web/src/electronAPI/mcp.ts`, and `projects/web/src/persistence/mcpServerStore.ts` alias those harness DTOs instead of maintaining separate renderer/main-process copies.
- `projects/shared/companion` remains limited to actual companion pairing/device contracts; MCP host control is still trusted-local desktop capability, not a companion DTO namespace.
- Focused verification passed: harness typecheck/build, Electron typecheck, web typecheck, Biome lint for the touched MCP/docs files, web `mcp.test.ts`, and Electron `runtimeApi.integration`.

### 2026-06-01: Harness IPC Event DTOs Consolidated

- Low-level harness IPC query, command, event, content-block, renderer-tool, and buffered-execution DTOs now live in `projects/harness/src/types.ts` as `HarnessIpc*`, exported by both `@openade/harness` and `@openade/harness/browser`.
- `projects/electron/src/modules/code/harness.ts` imports the shared IPC types instead of declaring renderer-matching copies, while keeping only Electron-internal execution state for abort controllers, timers, and sinks.
- `projects/web/src/electronAPI/harnessEventTypes.ts` now aliases the shared browser-safe IPC types and keeps only renderer helper functions and persisted-event compatibility helpers.
- The deprecated live `ClaudeStreamEvent` alias was removed; current web model code consumes `HarnessStreamEvent` directly while the compatibility layer still documents old persisted v1 event names.
- Focused verification passed: harness build, Electron typecheck, web typecheck, web harness event/prompt/stat tests, web `harnessStatus.test.ts`, and Electron `runtimeApi.integration`.

### 2026-06-01: openade.toml Config DTOs Consolidated

- Browser-safe `openade.toml` process, cron, editable-file, read-result, save-result, and run-context DTOs now live in `projects/openade-module/src/types.ts`, alongside the OpenADE project process DTOs that consume those config definitions.
- `projects/electron/src/modules/code/procs/types.ts` and `projects/web/src/electronAPI/procs.ts` alias the OpenADE-owned config DTOs instead of carrying a copied renderer/main-process contract.
- This removes another "keep in sync" type pair while preserving the existing trusted local procs editor and classic desktop process tray behavior.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, web typecheck, Electron procs parse/discovery tests, Electron `runtimeData.integration` host utility method, web `CronManager` tests, and Biome lint for the touched procs/docs files.

### 2026-06-01: openade.toml Parser/Serializer Consolidated

- `projects/openade-module/src/procs.ts` now owns the shared dependency-light `openade.toml` parser, editable parser, validation, and serializer for process/cron config.
- `projects/electron/src/modules/code/procs/parse.ts` and `projects/electron/src/modules/code/procs/serialize.ts` re-export that product-owned implementation instead of maintaining a second Electron-only parser/serializer.
- `projects/openade-module/src/node.ts` now uses the same parser for runtime project-process discovery, attaches `configPath` at the OpenADE process boundary, and keeps cwd escape validation server-side.
- Kernel verification covers a real `openade.toml` with comments, single-quoted values, cron blocks, arrays, `work_dir`, and URL fragments through `OpenADEClient.listProjectProcesses()`, proving the production runtime path is not using a duplicate hand parser.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, web typecheck, OpenADE procs parser tests, Electron procs parse/discovery tests, OpenADE kernel integration, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Scoped Project Host Helpers Consolidated

- `projects/openade-module/src/scopedProjectHost.ts` now owns the shared Node implementation for scoped OpenADE project file tree, file read, file write, and project search methods.
- `projects/openade-module/src/node.ts` and `projects/electron/src/modules/companion/runtimeGateway.ts` both wire their `OpenADEScopedHostAdapter` project file/search methods to that single product-owned implementation instead of keeping duplicate path containment, hidden/generated filtering, size-limit, and search code.
- This preserves the classic desktop UI and remote/headless runtime behavior while removing another "two ways to do the same host read/write" path at the OpenADE API boundary.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, shared scoped project host real-filesystem tests, OpenADE kernel integration, Electron companion runtime API integration, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Classic Files And Search Task-Scoped Runtime Path Added

- Existing OpenADE project file/search DTOs now accept optional `taskId`; the runtime resolves the task working directory server-side and keeps request paths scoped-root-relative. This avoids adding a parallel task-file DTO family while making head and worktree task file reads share the same contract.
- `openade/project/files/fuzzySearch` now provides product-level filename search for the classic Files tray and paired/web clients without exposing raw `fs/search/fuzzy`.
- `projects/openade-module/src/scopedProjectHost.ts` now owns task workdir resolution, path containment, generated/hidden filtering, file metadata, tree/read/write, filename fuzzy search, and content search for both Electron and headless Node hosts.
- `FileBrowserManager` keeps the classic desktop Files tray UI but uses `CodeStore.listProductProjectFiles()`, `readProductProjectFile()`, and `fuzzySearchProductProjectFiles()` for runtime-backed task contexts. It does not fall back to raw `filesApi` once a valid product context exists.
- `ContentSearchManager` keeps the classic desktop Search tray behavior but now sends `taskId` through `searchProductProject()` and `readProductProjectFile()` for runtime-backed head and worktree tasks.
- Focused verification passed: OpenADE module typecheck, web typecheck, Electron typecheck, scoped project host real-filesystem tests, OpenADE kernel integration, web `FileBrowserManager` plus `storeRuntimeProductStore` through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` with legacy `filesApi` forced to fail, and Electron companion runtime API integration with a real paired WebSocket.

### 2026-06-01: Classic SmartEditor File Mentions Runtime Path Added

- `openade/project/files/fuzzySearch` now returns an optional product-owned `treeMatch` so the classic SmartEditor file mention popup can keep directory browsing without importing raw runtime-node/Electron file-search types.
- `SmartEditorManager` now owns file mention search and tracked-file validation. Runtime-backed task editors call `CodeStore.fuzzySearchProductProjectFiles()` with the active `taskId`; repo-scoped task creation and scratchpads call the same product method with the repo id. `SmartEditor.tsx` no longer imports `electronAPI/files`.
- Legacy `filesApi` fuzzy/describe calls remain contained as the unscoped trusted-local fallback inside `SmartEditorManager`; once a product context exists, the editor does not fall back to raw `fs/*`.
- Focused verification passed: OpenADE module typecheck, web typecheck, Electron typecheck, scoped project host real-filesystem tests for fuzzy `treeMatch`, OpenADE kernel integration, web `SmartEditorManager` tests, web `storeRuntimeProductStore` through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` with legacy file APIs forced to fail, and React Doctor diff scan with no blocking errors.

### 2026-06-01: Classic Terminal Tray Runtime Product Path Added

- Classic desktop `Terminal` tray rendering stays in the existing desktop UI, but runtime-backed task contexts now create a product `TerminalRuntimeSession` through `CodeStore.startProductTaskTerminal()`, `reconnectProductTaskTerminal()`, `writeProductTaskTerminal()`, `resizeProductTaskTerminal()`, and `stopProductTaskTerminal()`.
- `openade/task/terminal/reconnect` now accepts `repoId` and `taskId` without a client-provided `terminalId`; the OpenADE host derives and validates the terminal id server-side. This removes client-side PTY-id derivation from the desktop tray path and keeps terminal identity in the product boundary.
- `projects/web/src/components/terminalSession.ts` is the only bridge from the classic xterm component to terminal transport. Product sessions use plain-text OpenADE task-terminal DTOs; raw `PtyHandle` stays contained as the trusted-local fallback for legacy/unscoped terminal contexts.
- `projects/openade-module/src/sha256.ts` now provides browser-safe synchronous SHA-256 for product-barrel helpers. Stable client-request ids and scoped task terminal ids keep their existing values without importing `node:crypto` into browser or renderer test imports.
- Focused verification passed: OpenADE kernel terminal start/reconnect/write/resize/stop, stable client-request and task-terminal id helper tests, web `terminalSession` behavior tests, web runtime product store through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient`, browser product/remote/classic-route integration tests, Electron companion runtime API integration, OpenADE module/Electron/web typechecks, Biome lint for touched files, React Doctor diff scan with no blocking errors, and `git diff --check`.

### 2026-06-01: Classic Search Tray Runtime Project Path Added

- `CodeStore` now exposes project file/search/process wrappers alongside the existing task/git/snapshot product helpers, so renderer callers do not need to choose between `OpenADEProductStore` and `runtime/localOpenADEClient.ts` directly.
- `ContentSearchManager` kept the classic desktop Search tray behavior and initially used `searchProductProject()` and `readProductProjectFile()` for runtime-backed repo-root/head-mode tasks. The follow-up task-scoped file/search slice above removed the worktree fallback.
- Focused verification passed: `projects/web` `tsgo --noEmit`, `storeRuntimeProductStore.test.ts` through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` with legacy `filesApi` calls forced to fail for the runtime search path, shared scoped project host real-filesystem tests in `projects/openade-module`, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Scoped Project Process Definition Builder Consolidated

- `projects/openade-module/src/scopedProjectProcesses.ts` now owns conversion from parsed `openade.toml` configs to `OpenADEProjectProcessDefinition` records, including config-path containment and process cwd containment.
- `projects/openade-module/src/node.ts` and `projects/electron/src/modules/companion/runtimeGateway.ts` both use that builder while keeping host-specific process lifecycle plumbing in their respective runtime adapters.
- This removes another duplicated OpenADE API-boundary implementation without changing classic desktop process tray behavior or remote process permissions.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, scoped project process helper tests, OpenADE kernel integration, Electron companion runtime API integration, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Scoped Project Process DTO Helpers Consolidated

- `projects/openade-module/src/scopedProjectProcesses.ts` now also owns scoped project process registration/scope matching, timeout policy, runtime process instance conversion, and reconnect/stop response normalization.
- `projects/openade-module/src/node.ts` and `projects/electron/src/modules/companion/runtimeGateway.ts` both use those helpers while retaining host-specific process start/reconnect/kill plumbing.
- This removes duplicate project-process DTO shaping without changing classic desktop process tray behavior or remote process permissions.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, scoped project process helper tests, OpenADE kernel integration, Electron companion runtime API integration, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Scoped Task Terminal Helpers Consolidated

- `projects/openade-module/src/scopedTaskTerminal.ts` now owns scoped task terminal id derivation and the raw PTY base64/plain-text conversion helpers used at the OpenADE task-terminal boundary.
- `projects/openade-module/src/node.ts` and `projects/electron/src/modules/companion/runtimeGateway.ts` both import those helpers while keeping host-specific PTY lifecycle plumbing in their respective runtime adapters.
- This removes duplicate terminal hash and encoding logic without changing classic desktop terminal behavior; the desktop `Terminal` component still uses trusted-local PTY streaming until product terminal notifications can preserve live output without raw `pty/*` subscription.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, scoped task terminal helper tests, OpenADE kernel integration, Electron companion runtime API integration, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Client Request ID Helpers Consolidated

- `projects/openade-module/src/clientRequestIds.ts` now owns stable task and queued-turn id derivation from `clientRequestId`.
- `projects/openade-module/src/node.ts` and `projects/electron/src/modules/companion/runtimeGateway.ts` both import those helpers instead of carrying duplicate request-id hash logic.
- This preserves idempotent task creation and queued-turn retry behavior while keeping the id contract in the OpenADE product module.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, client request id helper tests, OpenADE kernel integration, Electron companion runtime API integration, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Snapshot Patch Indexing Consolidated

- `projects/openade-module/src/snapshotPatchIndex.ts` now owns OpenADE snapshot patch indexing and byte slicing for both inline and external snapshot patches.
- `projects/electron/src/modules/code/snapshotsIndex.ts` is now a compatibility re-export of the OpenADE-owned types and helpers, while `projects/openade-module/src/node.ts` and Electron companion runtime snapshot reads both use the same implementation.
- This removes duplicate snapshot patch parsers while preserving classic desktop snapshot storage/read APIs and runtime-backed snapshot reads.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, OpenADE snapshot patch index tests, Electron snapshot index compatibility tests, OpenADE kernel integration, Electron companion runtime API integration, web typecheck, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Task Snapshot Patch Read Semantics Consolidated

- `projects/openade-module/src/taskSnapshotPatchReads.ts` now owns task snapshot patch-file id validation plus inline-vs-external patch, index, and slice read behavior.
- `projects/openade-module/src/node.ts` and `projects/electron/src/modules/companion/runtimeGateway.ts` now pass their existing real snapshot storage loaders into that shared product reader instead of duplicating snapshot read rules.
- This keeps classic desktop snapshot storage and runtime-backed snapshot reads intact while removing another host-specific OpenADE API-boundary implementation.
- Focused verification passed: OpenADE module typecheck, Electron typecheck, task snapshot patch read helper tests, OpenADE kernel integration, Electron companion runtime API integration, Biome lint for touched files, and `git diff --check`.

### 2026-06-01: Preload API Contract Consolidated

- `projects/electron/src/preload-api.ts` now owns the browser-safe `OpenADEAPI` shape for the Electron contextBridge surface.
- `projects/electron/src/preload.ts` uses `satisfies OpenADEAPI`, and `projects/web/src/vite-env.d.ts` imports the same type instead of maintaining a second renderer-global interface.
- This removes the duplicate preload/web global contract while preserving the existing Electron IPC runtime bridge and classic desktop wrappers.
- Focused verification passed: Electron typecheck, web typecheck, web Electron API wrapper tests for companion/MCP/harness status, and Biome lint for the touched preload/global/docs files.

### 2026-06-01: Harness Status DTO Alias Consolidated

- `projects/web/src/electronAPI/harnessStatus.ts` now aliases `HarnessInstallStatus` from the browser-safe `@openade/harness/browser` entrypoint instead of declaring a renderer-owned copy of the runtime harness install-status contract.
- The renderer wrapper still validates `agent/provider/status` payloads at the runtime boundary and keeps its local `HarnessStatusResult` UI helper, but the durable DTO now has a single harness-owned source.
- Focused verification passed: web harness status wrapper tests, harness status view utility tests, web typecheck, source scan for duplicate install-status interfaces, and `git diff --check`.

### 2026-06-01: Desktop Host Utility DTOs Consolidated

- `projects/electron/src/modules/code/hostBridgeTypes.ts` now owns browser-safe DTOs for managed binaries, code-module capabilities, SDK capabilities, platform info, shell directory creation/selection/opening, binary checks, and Electron frame colors.
- Electron main-process modules and renderer wrappers now alias that shared contract instead of keeping duplicate `binaries`, `capabilities`, `platform`, `shell`, and `windowFrame` interfaces with "keep in sync" comments.
- This keeps desktop-specific host utility contracts in the Electron code module boundary while preserving the existing trusted local runtime methods and classic desktop settings/process wrappers.
- Focused verification passed: Electron typecheck, web typecheck, Electron `runtimeData.integration` host utility method, web `Routes.runtimeProductStore.test.ts`, and Biome lint for the touched host bridge files.

### 2026-06-01: Managed Binary Registry Mirror Removed

- `projects/electron/src/modules/code/binaries.ts` now exports the internal managed-binary registry and its platform key types so verification code uses the production registry directly.
- `projects/electron/src/modules/code/binaries.test.ts` no longer copies the registry or string-scans `binaries.ts` to keep the copy synchronized.
- Focused verification passed: Electron typecheck, real `binaries.test.ts` downloads and URL checks, Biome lint for touched binary files, and `git diff --check`.

### 2026-06-01: Raw Git Bridge DTOs Consolidated

- `projects/electron/src/modules/code/gitBridgeTypes.ts` now owns browser-safe DTOs for raw trusted-local `git/*` methods: install/directory checks, worktrees, branch lists, status/summary, file listings, commits, path resolution, raw git log reads, file-pair reads, and patch reads.
- `projects/electron/src/modules/code/git.ts` and `projects/web/src/electronAPI/git.ts` alias that shared bridge contract instead of carrying parallel renderer/main-process interfaces.
- Product-scoped task git DTOs remain OpenADE-owned; raw git task-equivalent payload types in `gitBridgeTypes.ts` still derive from `projects/openade-module/src/types.ts` where they overlap.
- Focused verification passed: Electron typecheck, web typecheck, Electron `git.test.ts`, full `runtimeNodeServer.integration`, web `ChangesManager` and classic route runtime-product tests, and Biome lint for the touched git bridge files.

### 2026-06-01: Desktop Storage/Config DTOs Consolidated

- `projects/electron/src/modules/deviceConfigTypes.ts` now owns the browser-safe device config/result DTO used by Electron main and the renderer device-config wrapper.
- `projects/web/src/electronAPI/snapshots.ts` aliases `projects/electron/src/modules/code/snapshotsIndex.ts` for Electron compatibility; snapshot patch index DTOs and helpers were later moved to the OpenADE module, with Electron keeping that compatibility re-export.
- This removes two more small duplicate renderer/main-process type pairs without changing device config persistence or snapshot bundle storage.
- Focused verification passed: Electron typecheck, web typecheck, Electron `deviceConfig.test.ts`, web `store.test.ts` and `Routes.runtimeProductStore.test.ts`, and Biome lint for the touched storage/config files.

### 2026-06-01: Classic Task Open Runtime Refresh Made Responsive

- Classic desktop task opening now reads runtime-backed task detail with `hydrateSessionEvents: false` first and keeps full session-history hydration behind explicit user history expansion instead of a hidden route-open timer.
- Runtime-backed task refresh notifications now avoid duplicate refreshes between `OpenADEProductStore` and `CodeStore`, use non-hydrating task reads for notification-driven updates, and coalesce bursty `openade/task/updated` notifications per task before refreshing.
- `EventLog` and `InlineMessages` now parse/render long histories tail-first: long task histories initially mount recent events, long harness streams group only the visible tail, and older records are exposed behind explicit "Show earlier" controls that can request hydrated runtime history.
- Runtime-backed `TaskModel.stats` now uses snapshot task-preview usage when available, so the classic navbar stats do not rescan the full task event stream during task open.
- This keeps the classic desktop `TaskPage`/`InputBar` route intact while reducing main-thread work during task open and active runtime streams.
- Focused verification passed: web `TaskModel.test.ts`, `EventLog.test.ts`, `storeRuntimeProductStore.test.ts`, and `Routes.runtimeProductStore.test.ts` through real classic components and real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` paths, plus web typecheck, React Doctor diff scan with no blocking errors, and `git diff --check`.

### 2026-06-01: Lightweight Task Reads Bound Stream Payloads

- `projects/openade-module/src/yjsProjection.ts` now honors `hydrateSessionEvents: false` by keeping task/event metadata while bounding action and HyperPlan stream arrays before the runtime response crosses into the renderer. Hidden older task events carry zero stream entries; visible recent task events carry a recent stream tail.
- Bounded stream DTOs set `omittedEventCount`, and the classic desktop `InlineMessages` path shows those omitted entries behind the existing explicit full-history request instead of treating a trimmed `events` array as complete.
- The Node OpenADE adapter now forwards task-read options into the Yjs projection, so real headless/Electron runtime reads get the same lightweight behavior rather than only test adapters recording the flag.
- Focused verification passed: OpenADE Yjs projection fixture test using real file-backed Yjs storage, OpenADE kernel WebSocket integration with persisted turn reload, web `InlineMessages`, `OpenADEProductStore`, `storeRuntimeProductStore`, and classic route runtime-product tests through real runtime/client paths, OpenADE module and web typechecks, React Doctor diff scan with no blocking errors, and `git diff --check`.

### 2026-06-01: Task Resource Inventory Moved To Scoped OpenADE API

- `openade/task/resourceInventory/read` now returns the task-owned delete/resource inventory from the OpenADE scoped host boundary: snapshot patch ids, task image ids, harness session ids, running state, and worktree branch-merge status.
- `projects/openade-module/src/taskResourceInventory.ts` owns the shared extraction helper used by Electron cleanup and the new read API, removing the duplicate snapshot/image/session event scans from `runtimeGateway.ts`.
- Classic desktop `TaskManager.getResourceInventory()` keeps the old delete dialog behavior but uses `CodeStore.readProductTaskResourceInventory()` when runtime-backed reads are active; the renderer-side task-store scan and `gitApi.isBranchMerged()` branch check are now legacy fallback only.
- Paired-device permissions include the new scoped read while continuing to deny raw `git/*`, `snapshot/*`, `data/*`, `fs/*`, `host/*`, `process/*`, and `pty/*` methods.
- Focused verification passed: OpenADE resource-inventory helper test, real OpenADE WebSocket kernel integration, web runtime product store/client/route/product-store tests through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient`, OpenADE module/client/web/Electron typechecks, and Electron companion runtime API integration over an authenticated paired WebSocket.

### 2026-06-01: Classic Git Log Scope Discovery Moved To Scoped OpenADE API

- `openade/task/git/scopes/read` now returns sanitized branch and worktree scope metadata for a task-resolved git context without exposing filesystem paths to the renderer or paired devices.
- `openade/task/git/log` accepts an optional sanitized `scopeId`; worktree scope ids are resolved server-side by the Node/Electron scoped host adapters, so the classic Git Log tray no longer sends worktree cwd values through product APIs.
- Classic desktop `GitLogTray` keeps its existing visual/functionality surface but uses `CodeStore.readProductTaskGitScopes()` and `readProductTaskGitLog()` for task-scoped branch/worktree history when runtime-backed reads are active. Raw `gitApi.listBranches()` and `gitApi.listWorkTrees()` remain legacy/unscoped fallback only.
- Paired-device permissions include the read-only scoped scope-discovery method while raw `git/*` methods and scoped git mutation/detail methods remain denied unless explicitly reviewed.
- Focused verification passed: OpenADE WebSocket kernel integration with a real temp git repo/worktree, web product-store and classic Git Log tray tests through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient`, typed OpenADE client test, and Electron companion runtime API integration over an authenticated paired WebSocket.

### 2026-06-01: Classic Environment Setup Moved To Scoped OpenADE API

- `openade/task/environment/prepare` now resolves repo/task ids server-side and lets trusted local product clients prepare the task environment without renderer-side repo path, worktree, or git plumbing.
- The Node scoped host creates or reuses the `openade/<task-slug>` worktree under `~/.openade/workspaces/worktrees` for worktree-isolated tasks, records the setup event through OpenADE writers, and returns the persisted task environment DTO.
- The Electron scoped host reuses the existing desktop worktree creation path but now exposes it through the same scoped OpenADE host boundary used by the headless kernel.
- Classic desktop `EnvironmentSetupView` keeps the existing visual flow but calls `CodeStore.prepareProductTaskEnvironment()` when runtime-backed reads are active; direct `TaskEnvironment.setup()` and raw git setup remain legacy fallback only.
- Paired-device permissions intentionally deny `openade/task/environment/prepare`; remote/mobile clients may observe persisted environment state but must not create worktrees without a separate role/permission decision and integration coverage.
- Focused verification passed: real OpenADE WebSocket kernel integration with a temp git repo/worktree, web rendered `EnvironmentSetupView` through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` while rejecting legacy renderer setup, typed OpenADE client/product-store tests, and Electron companion runtime API integration over an authenticated paired WebSocket.

### 2026-06-01: Classic Snapshot Event Copy Runtime-Gated

- Classic `SnapshotEventItem` copy/download reads now prefer `CodeStore.readProductTaskSnapshotPatch()` when runtime-backed reads are active, even if the full task model has not been loaded yet and only the runtime snapshot can resolve the repo id.
- Raw `snapshotsApi.loadPatch()` remains only the trusted-local fallback for legacy/unscoped operation.
- Focused verification passed: rendered `SnapshotEventItem` under a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` copies the server-owned patch through the scoped runtime read and rejects legacy snapshot API use.

### 2026-06-01: Pending Task Creation Cleanup Moved To Product APIs

- `TaskCreationManager` no longer tracks a renderer-owned worktree slug or asks `TaskManager` to call raw `gitApi.deleteWorkTree()` when a pending task creation is cancelled.
- If cancellation happens after the server has accepted a task, the renderer now interrupts through `CodeStore.interruptProductTurn()` and deletes the task through `CodeStore.deleteProductTask()` with snapshots, images, sessions, and worktrees selected for cleanup.
- The obsolete `TaskManager.cleanupWorktree()` renderer helper was removed; worktree cleanup for real tasks is owned by OpenADE task deletion host adapters.
- Focused verification passed: `TaskCreationManager.test.ts` covers server-accepted cancellation cleanup through product APIs and confirms title generation does not continue for the cancelled task; `storeRuntimeProductStore.test.ts` runs the same cleanup through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` and verifies the accepted task is deleted.

### 2026-06-01: Task Title Generation Moved To Scoped OpenADE API

- `openade/task/title/generate` now resolves repo/task ids server-side, builds the shared title prompt/schema from `projects/openade-module/src/taskTitle.ts`, asks the trusted host harness in read-only mode, and persists the resulting title through `openade/task/metadata/update` semantics.
- Classic desktop task creation and title regeneration keep the old desktop UI but use `CodeStore.generateProductTaskTitle()` when runtime-backed reads are active; renderer-side `prompts/titleExtractor.generateTitle()` remains legacy fallback only.
- Electron and headless Node hosts implement the same scoped host method. Paired devices intentionally remain denied for `openade/task/title/generate` until there is an explicit role/permission decision and matching integration coverage.
- Focused verification passed: OpenADE kernel integration with a deterministic real executor `structuredQuery`, web `OpenADEProductStore` and `CodeStore` runtime product tests through real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient`, typed OpenADE client request tests, web route/remote integration tests, Electron companion permission integration, and OpenADE module/web/Electron typechecks.

### 2026-06-01: Yjs Projection Compatibility Fixtures Hardened

- `projects/openade-module/src/yjsProjectionFixtures.test.ts` now proves `openade/snapshot/read`, `readProjects`, and `readTaskList` share the same old-Yjs preview ordering and field contract for the committed fixture data.
- The fixture suite now writes a sparse legacy task document through real Yjs updates and the node storage adapter, then verifies `createOpenADEYjsProjection()` returns a valid `OpenADETask` DTO rather than leaking malformed metadata to clients.
- `projects/openade-module/src/yjsProjection.ts` now normalizes legacy `isolationStrategy` records at the storage boundary, preserving worktree scoping with a `HEAD` source-branch fallback when old data omitted the branch.
- Focused verification passed: OpenADE module Yjs projection fixture tests and OpenADE module typecheck.

### 2026-06-01: Classic Task-Create Project Git Reads Moved To Scoped OpenADE API

- `openade/project/git/info/read`, `openade/project/git/branches/read`, and `openade/project/git/summary/read` now resolve repo ids server-side and return scoped project-level git metadata for classic task creation and repo-level status checks.
- Electron and headless Node hosts implement the same scoped host methods while keeping raw `git/*` methods as trusted-local fallback only. Paired devices are granted these read-only scoped project git methods while raw `git/*`, task git mutation/detail, terminal, environment prepare, and title generation methods stay denied.
- Classic desktop `RepoManager.getGitInfo()`, `listBranches()`, `getGitSummary()`, and `refreshGhCliStatus()` keep their existing callers and UI behavior but use `CodeStore.readProductProjectGitInfo()`, `readProductProjectGitBranches()`, and `readProductProjectGitSummary()` whenever runtime-backed reads are active.
- Focused verification passed: OpenADE WebSocket kernel integration with a real temp git repo, web `OpenADEProductStore` and `CodeStore` runtime product tests through real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient`, typed OpenADE client tests, web remote/client/route integration tests, Electron companion authenticated WebSocket permission/integration tests, OpenADE module/web/Electron typechecks, and React Doctor diff scan with no blocking errors.

### 2026-06-01: Classic Task Route Environment Load Preserved Under Runtime Reads

- Classic desktop `TaskPage` now loads the task environment independently from runtime git-summary refresh so task-open performance fixes do not leave file mentions, Files/Search trays, Git Log, Terminal, or Processes without a working directory on runtime-backed tasks.
- The environment load stays on the runtime-backed `RepoManager.getGitInfo()` path, which uses scoped `openade/project/git/info/read` when runtime product reads are active; raw renderer `gitApi` remains only the legacy fallback.
- `Routes.runtimeProductStore.test.ts` now proves the classic task route resolves the task working directory and runs SmartEditor file mention search through scoped project file search using a real `RuntimeServer` behind the production local runtime bridge.
- Focused verification passed: web classic route runtime-product test, web typecheck, React Doctor diff scan with no blocking errors, and `git diff --check`.

### 2026-06-01: Worktree Close Stops Runtime-Owned Product Processes

- `RepoProcessesManager.stopAllForContext()` now accepts scoped product process access and stops runtime-owned process instances through `openade/project/process/stop` before removing them from renderer state.
- Classic desktop `InputManager` passes that scoped product process access when closing runtime-backed worktree tasks, preserving the existing Close command while avoiding the legacy-only `ProcessHandle` cleanup path for product-managed processes.
- Legacy `ProcessHandle` cleanup remains the fallback for non-runtime or unscoped process instances.
- Focused verification passed: web `RepoProcessesManager.test.ts`, `InputManager.test.ts`, `Routes.runtimeProductStore.test.ts`, web typecheck, React Doctor diff scan with no blocking errors, and `git diff --check`.

### 2026-06-01: Dead TaskEnvironment Raw Git Helpers Removed

- `TaskEnvironment` no longer exposes raw patch, changed-file, file-pair, or full-status helpers. Classic Changes tray reads now stay on `TaskModel`/`ChangesManager` scoped product APIs under runtime-backed reads, with raw `gitApi` calls only in the explicit legacy fallback managers.
- The remaining `TaskEnvironment` raw host surface is the documented trusted-local fallback for environment setup and lightweight git summary during the one-release legacy fallback window.
- Focused verification passed: code search confirms the removed helpers are absent from `TaskEnvironment`, web `TaskModel.test.ts`, web `storeRuntimeProductStore.test.ts`, and `git diff --check`.

### 2026-06-01: Task Preview Usage DTOs Consolidated

- Web task preview storage, route, sidebar, stats, and store APIs now use OpenADE-owned task preview DTOs from `projects/openade-module/src` instead of maintaining a separate web preview shape.
- Settings stats recap utilities consume a narrow OpenADE-derived task preview input instead of depending on legacy `RepoItem` persistence metadata, so sidebar/settings calculations do not recreate another product DTO family.
- Focused verification passed: web stats recap tests, web runtime product store tests, web typecheck, duplicate type search, and `git diff --check`.

### 2026-06-01: Remote Product Method Wrappers Removed

- `projects/web/src/remote/client.ts` now exposes the paired-host `OpenADEProductStore` plus a generic transient read retry helper instead of maintaining one `readRemote*`, `listRemote*`, `startRemote*`, or mutation wrapper per product method.
- `RemoteApp` keeps pairing/session/subscription orchestration locally but calls the shared product store directly for snapshots, task reads, scoped file/search/git/process reads, turns, reviews, comments, task metadata, and task deletion.
- Focused verification passed: remote client config tests, remote runtime client cache tests, `RemoteApp.integration.test.ts`, web typecheck, React Doctor diff scan with no blocking errors, `git diff --check`, and a code search confirming the old method-specific remote product wrappers are absent from production remote/mobile code.

### 2026-06-01: Sidebar Preview DTO Imports Consolidated

- Desktop route/sidebar helpers now consume `OpenADETaskPreview` directly instead of importing the legacy `TaskPreview` compatibility alias from `persistence/repoStore.ts`.
- Task usage stat helpers now use `OpenADETaskPreviewUsage` directly, and `persistence/repoStore.ts` stores `OpenADETaskPreview` values without exporting `TaskPreview`, `TaskPreviewLastEvent`, or `TaskPreviewUsage` aliases.
- Focused verification passed: persistence preview-sync tests, sidebar task sorting tests, task stats utility tests, classic runtime route tests, runtime product store bridge tests, web typecheck, `git diff --check`, and a code search confirming the old web `TaskPreview*` aliases are absent.

### 2026-06-01: Files Tray Product Fallback Closed

- `FileBrowserManager` now treats a valid product context as authoritative for directory listing, file reads, and filename fuzzy matching. If scoped product file APIs miss or fail in that context, the Files tray fails closed instead of falling through to raw `filesApi` reads.
- Raw `filesApi` fallback remains available for genuinely unscoped legacy browsing, preserving the one-release legacy fallback window without giving runtime-backed task paths two active file-read routes.
- Focused verification passed: `FileBrowserManager.test.ts` proves product-scoped directory/file/fuzzy paths do not call raw `filesApi`, `storeRuntimeProductStore.test.ts -t "routes classic file browsing"` exercises the classic Files/Search path through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` with legacy `filesApi` mocked to fail, and web typecheck passed.

### 2026-06-01: RemoteApp Product Read Alias Removed

- `RemoteApp.tsx` now calls the paired-host `OpenADEProductStore` directly through `getRemoteProductStore(config)` and `retryRemoteRead()` instead of keeping a local `readRemoteProduct()` helper on top of the product store.
- The remote entrypoint remains a session/action adapter: `client.ts` owns paired-host store construction, runtime client caching, retry policy, companion config persistence, and device/session actions.
- Focused verification passed: remote runtime client tests, `RemoteApp.integration.test.ts`, web typecheck, `git diff --check`, React Doctor diff scan with no blocking errors, and a code search confirming the old method-specific remote product aliases remain absent from the remote surface.

### 2026-06-01: Classic Search Match DTO Consolidated

- `ContentSearchManager` now exposes OpenADE `OpenADEProjectSearchMatch` values to the classic Search tray instead of leaking the legacy runtime-node `ContentSearchMatch` shape into UI state.
- Legacy `fs/search/content` fallback results are adapted once at the manager boundary from `{ file, line, content, matchStart, matchEnd }` to the OpenADE `{ path, line, content, matchStart, matchEnd }` shape. Runtime-backed search results flow through unchanged.
- The unused web `ContentSearchMatch` alias was removed from `electronAPI/files.ts`; the low-level runtime-node fallback response type remains internal to the file API bridge.
- Focused verification passed: `storeRuntimeProductStore.test.ts -t "routes classic file browsing"` exercises classic content search and preview through a real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient`, web typecheck, `git diff --check`, React Doctor diff scan with no blocking errors, and a source scan confirming no renderer `ContentSearchMatch` aliases remain.

### 2026-06-01: Full Web Verification Refreshed

- The full `projects/web` Vitest suite initially exposed a stale `CronManager.test.ts` fake store that lacked the production `shouldUseRuntimeProductReads()` gate. The fixture now explicitly returns `false`, preserving those tests as legacy `readProcs` scheduling coverage while product-process cron coverage remains in `storeRuntimeProductStore.test.ts`.
- Full web verification now passes: `npm test` reports 83 files and 504 tests passing, including the real runtime product route/store coverage, remote integration tests, cron scheduling tests, and the classic desktop route smoke tests.
- Final web hygiene also passed after the fixture fix: web typecheck, `git diff --check`, and the previous React Doctor diff scan with no blocking errors.

### 2026-06-02: Final Packaged Electron Smoke Refreshed

- The current branch diff was rebuilt into a packaged macOS directory app: `cd projects/electron && npm run build && npm run build:web && NONOTARY=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir`.
- The packaged smoke passed against that built app: `cd projects/electron && npm run test:smoke` reported `1 passed`. This smoke drives the packaged artifact, not the dev server.
- This run re-proves the bundled UI boots, runtime IPC initializes, scoped OpenADE runtime methods work, the packaged app navigates to the classic desktop task route with `data-openade-surface="desktop-classic-task"`, compact shared desktop markers are absent, and the smoke telemetry export passes the runtime-product rollout review command.

### 2026-06-02: Cross-Package Verification Refreshed

- Electron package verification passed after the packaged smoke build: `cd projects/electron && npm run typecheck` and `npm test` reported 28 files and 256 tests passing.
- OpenADE product/runtime package verification passed: `cd projects/openade-module && npm run typecheck && npm test` reported 11 files and 32 tests passing, including the real WebSocket OpenADE kernel persistence test.
- OpenADE client package verification passed: `cd projects/openade-client && npm run typecheck`.
- Together with the full web verification checkpoint, this covers the touched desktop host, paired companion runtime, OpenADE runtime module/client, Yjs projection/mutation, and classic desktop renderer paths with real integration coverage.

### 2026-06-02: Remaining Gate Audit

- The remaining ship-gate audit found no committed or generated internal/default-on cohort telemetry export in the local worktree. Searches for telemetry, rollout, analytics export, Amplitude, NDJSON, and JSONL artifacts found only the rollout review script, source/tests, and dependency folders.
- The packaged smoke telemetry export remains valid packaged-app proof for the built artifact, but it is not a substitute for the required internal/default-on cohort export before broad production enablement or fallback removal.
- The rollout review verifier itself was rechecked: `cd projects/web && npm test -- src/analytics/runtimeProductRolloutReview.test.ts` passed 7 tests, covering passing exports, missing ready default-on startup, fallback/error events, stale shared-screen properties, sensitive/unreviewed properties, malformed NDJSON, and report formatting.
- Diff hygiene also passed: `git diff --check`.
- Local code and packaged verification gates are complete for this migration checkpoint. The open production-readiness gate is external data: obtain the real internal/default-on cohort telemetry export and run `cd projects/web && npm run review:runtime-product-rollout -- <telemetry-export.json-or-ndjson>`.

## Remaining Ship Gates Under Corrected Direction

The code migration is now a desktop-runtime boundary migration, not a desktop UI replacement. The completed checkpoints above keep the classic desktop `TaskPage`/`TaskCreatePage`/`InputBar`/tray/settings surface and move normal product reads and mutations through `OpenADEClient`, `OpenADEProductStore`, and scoped OpenADE runtime methods. The remaining gates are rollout gates, fallback policy, and future adapter work:

1. Run the real rollout telemetry review before broad production enablement.
   - Use `cd projects/web && npm run review:runtime-product-rollout -- <telemetry-export.json-or-ndjson>` against the internal/default-on cohort export.
   - This cannot be completed from the local repo without the production/internal telemetry export.
   - The review must show ready default-on `app_opened` events and no normal-flow `runtime_product_store_fallback` or `runtime_product_store_error` events.

2. Keep legacy Yjs/trusted-local fallbacks for one production release.
   - Current direct `filesApi`, `gitApi`, `snapshotsApi`, task-store, and repo-store paths should remain only as documented legacy/unscoped trusted-local fallbacks.
   - Do not remove fallback reads until the telemetry review and at least one production release show the runtime-backed path is healthy across navigation, task detail, notifications, reloads, files/search/git/processes, comments, reviews, cron/repeat turns, task creation, and task deletion.

3. Only extract shared UI from desktop-parity components.
   - Do not reintroduce `DesktopShared*` routes or make compact `RemoteApp`/`OpenADEShell` screens the desktop default.
   - If future work shares more UI, extract from the classic desktop behavior first, then adapt it down to web/mobile with role and capability gates.
   - Any layout-affecting desktop parity extraction needs screenshot/browser checks in addition to runtime integration tests.

4. Treat mobile/web parity as adapter work, not the canonical surface.
   - The current mobile companion UI is not production canonical and should not drive desktop design.
   - Remote/mobile clients should keep raw host powers denied unless scoped product methods, permissions, and authenticated WebSocket integration tests explicitly approve them.

5. Re-run local gates if the branch changes again.
   - Any later web/Electron/runtime change after this checkpoint must rerun the relevant focused tests and the packaged smoke before shipping.

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
9. Extract desktop-derived task thread and composer components behind the existing classic desktop route.
10. Replace companion entry points with the desktop-derived shared shell once parity gates pass; keep desktop on the classic route shape while its internals move to runtime APIs.
