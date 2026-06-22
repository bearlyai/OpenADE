# Code Module

Task planning and execution system with pluggable AI harnesses (`@openade/harness`). Supports multiple execution engines (Claude Code, Codex, etc.) through a unified interface. Users describe tasks, the AI generates plans, users can review/revise before execution.

This is a TypeScript-first codebase. When fixing type errors, focus on proper TypeScript solutions rather than workarounds.


## Tray System

Slide-out panels (Files, Search, Changes, Terminal, Processes) managed by `TrayManager`. Each tray type is defined declaratively in `components/tray/trayConfigs.tsx`.

Diff rendering uses `@pierre/diffs` under `components/FilesAndDiffs.tsx`, with `DiffsWorkerProvider` mounted at the code-app root so syntax highlighting runs off the main thread. The Changes tray must stay on the lightweight git-summary path (`getGitSummary()` locally, `readProductTaskGitSummary()` through the runtime product API) until a specific file is selected.

### Adding a New Tray

Add to `TRAY_CONFIGS` array in `trayConfigs.tsx`:

```typescript
{
    id: "mytray",
    label: "My Tray",
    icon: SomeIcon,
    shortcut: { key: "mod+m", display: "⌘M" }, // optional
    renderBadge: (tray) => {
        // Return count/badge content or null
        return count > 0 ? count : null
    },
    renderContent: (tray) => {
        // Return tray panel JSX
        return <MyTrayContent taskId={tray.taskId} onClose={() => tray.close()} />
    },
}
```

Also add to `TrayType` union in `store/managers/TrayManager.ts`.

### Key Files

| File | Purpose |
|------|---------|
| `store/managers/TrayManager.ts` | MobX state for open/close |
| `components/tray/trayConfigs.tsx` | Declarative tray definitions |
| `components/tray/TrayButtons.tsx` | Renders toggle buttons from config |
| `components/tray/TraySlideOut.tsx` | Slide-out animation wrapper |

Runtime/Core-backed tray visibility is an authority boundary, not just button styling. Use `TrayManager.visibleOpenTray`/`isOpen` for rendering tray content so a capability loss hides stale panels before they mount. `TrayButtons` may close an already-open hidden tray from an effect, but it must not mutate MobX state during render.

Runtime-backed tray product adapters must read capabilities at action time. Long-lived process and terminal access objects can outlive the render that created them, so their start/reconnect/write/resize/stop methods must call the shared capability builders against current `CodeStore.canUseProductMethod()` state before forwarding to product APIs.

Mounted terminal UI must also re-check product access before destructive handlers. Restart must read the current terminal capabilities before stopping, must not clear the terminal unless the old product session actually exits, and must create replacements with the current product access object instead of a render-time snapshot.

## Backwards Compatibility

**This is a production app with real user data.** Existing tasks, workspaces, persisted events, and storage state must continue to work after code changes. When changing data models or storage schemas:

- Write tolerant readers that handle both old and new shapes (see `harnessEventCompat.ts` for the pattern)
- Use `??` fallbacks for fields that may be absent in old persisted data (e.g. `event.execution.harnessId ?? "claude-code"`)
- Never rename or remove persisted fields without a compat layer
- Test with fixtures that represent old data shapes

## Code Style

- **No JSDoc comments** - Code should be self-documenting
- **No trivial getters** - Inline `task.status === "stopped"` instead of `task.isStopped`
- **Destructured params for 3+ args** - Use inline destructured params
- **Remove unused methods** - After refactors, grep and clean up
- **No string-containment tests on prompts** — `expect(prompt).toContain("some phrase")` tests are brittle, break on every wording change, and verify nothing meaningful. Test prompt builder *logic* (conditional inclusion, merging, undefined returns) not prompt *text*.
- **No mirror tests** — Do not export constants, split out helpers, or write tests whose only purpose is to repeat labels, classes, config arrays, or branches from the implementation. If a harmless copy/style/refactor forces the test to change in lockstep, delete it or rewrite it around the actual user-visible behavior or data contract.
- **No implementation-only styling tests** — Do not test Tailwind/class-name substrings, snapshots, or incidental DOM wrappers just to lock layout. Test behavior, accessibility, state transitions, parsing, integration paths, or use browser/visual checks when layout matters. CSS class assertions are only acceptable when the class string itself is an explicit public API.

### React Doctor

Run React Doctor from `projects/web` when changing React state, effects, accessibility, security-sensitive rendering, or shared shell UI. `npm run typecheck` includes the serious-error React Doctor gate through `npm run doctor` plus the non-mutating Biome error lint gate through `npm run biome`; use [`../doctor.config.json`](../doctor.config.json) as the project baseline: cleanup, fresh effect dependencies, mutable deps, and unsafe rendering are blocking errors; ambiguous prop-to-state reset findings remain warnings until they are reviewed with behavior coverage. The scoped `MarkdownMessage.tsx` `no-danger` override depends on DOMPurify sanitization and the adjacent Biome suppressions in that file. Do not mass-fix the full backlog without targeted tests or a browser/runtime verification for the affected workflow.

## Architecture

```
Routes.tsx          → Thin URL resolution, redirects to pages
CodeLayout.tsx      → Shared layout, sidebar, reconnection logic
pages/*.tsx         → Page components (TaskPage, TaskCreatePage, etc.)
store/              → MobX state management (runtime)
persistence/        → YJS-backed sync (RepoStore, TaskStore)
electronAPI/        → Runtime/Electron host wrappers for renderer callers
kernel/            → Shared kernel session, pairing, transport, OpenADE client construction, and runtime-backed product DTO store for desktop, web, and companion shells
components/         → UI components
routing.ts          → Local typesafe routing (isolated from @/state/routing)
api.ts              → Data types, localStorage CRUD
prompts/            → Prompt builders and serialization helpers
```

`CodeStore` owns desktop runtime product notification refreshes. Keep task-detail notifications coalesced per task and task-preview notifications coalesced per repo so Core bursts do not fan out into repeated task reads or project-list refreshes. Do not bypass those queues with direct `refreshRuntimeProductProjection()` calls from notification handlers unless the notification is a deletion, repo-level repair, or explicit full snapshot repair.

In-progress or non-preview task update notifications should refresh cached task DTOs without invalidating scoped file/search/git caches. Reserve scoped host cache invalidation for writes, generic task updates, repo mutations, and mutations that can change host-scope/resource state; otherwise streaming/status notifications can turn into repeated `openade/project/files/fuzzySearch` and `openade/task/git/summary/read` calls during normal task-open churn.

Runtime-backed product surfaces in `components`, `kernel`, `pages`, `remote`, `shell`, and `store` must import generated `OPENADE_METHOD` and `OPENADE_NOTIFICATION` constants from `@openade/openade-client` instead of copying `openade/*` method strings or product notification names. `projects/openade-client` `npm run check:contracts` enforces this for non-test web product code.

Shared shell panels must filter preloaded/stale DTO props through the same granular capability booleans that control their requests. Top-level project/session summaries are included in this rule: when neither `openade/snapshot/read` nor `openade/project/list` is advertised, the shell must not render stale projects from saved snapshots. For example, a summary-only project Git profile must not render stale branch-list or repo-info data, a list-only project Files profile must not render stale file contents or fuzzy-search results, a process-list-only project profile must not render stale reconnect output, and a task environment-only profile must not render stale task resource inventory just because the adapter still has old DTOs in memory. Shell-level loading flags and action markers such as file-tree loading, file-read paths, task diff paths, commit-detail keys, and treeish-file keys must be filtered with the matching read capability too, otherwise a denied read profile can still show stale busy spinners from an old in-flight action.

Shared shell task-history artifact props must be filtered by their read capabilities before they reach event renderers. Snapshot patch maps require `OPENADE_METHOD.taskSnapshotPatchRead` or the index/slice pair, and stale slice content must be stripped unless `OPENADE_METHOD.taskSnapshotPatchReadSlice` is advertised.

Shared shell editing state should collapse when its mutation capability disappears. For example, `OpenADEShell` must clear task title/comment/review drafts when task metadata/comment/review capabilities disappear, clear existing-task composer input/mode/HyperPlan drafts when neither `OPENADE_METHOD.turnStart` nor `OPENADE_METHOD.queuedTurnEnqueue` is advertised, clear new-task title/prompt/mode/isolation/HyperPlan drafts when `OPENADE_METHOD.taskCreate` disappears, `TaskProductPanel` must cancel an open comment editor when `OPENADE_METHOD.commentEdit` is no longer advertised, `TaskGitPanel` must clear commit-message drafts when `OPENADE_METHOD.taskGitCommit` disappears, `ProjectsScreen` must drop project-create drafts and invalidate in-flight path inspection when `OPENADE_METHOD.repoCreate` disappears, `ProjectTasksScreen` must close an open project manager when repo update/delete capabilities disappear and drop repo edit drafts when `OPENADE_METHOD.repoUpdate` disappears, `ProjectFilesPanel` must drop unsaved file drafts when `OPENADE_METHOD.projectFileWrite` disappears, and `OpenADESessionScreens` must drop connector and personal-env drafts when settings write capabilities disappear, rather than keeping hidden drafts that can revive after capabilities change. Remote/shared shell and classic desktop input owners must also treat MCP connector ids as capability-owned state: if `OPENADE_METHOD.settingsMcpServersRead` is not advertised, hide connector pickers and omit stale task/new-task `enabledMcpServerIds` from task-create, turn-start, repeat, queued-turn, retry, and metadata-update requests. Enforce this in managers such as `TaskCreationManager`, `InputManager`, `RepeatManager`, and `TaskManager`, not only in visible React controls.

Shared shell new-task isolation state must be derived from current branch capability at both render and submit time. If `openade/project/git/branches/read` is not advertised, stale Worktree/source-branch drafts must be treated as `{ type: "head" }`, branch controls must stay hidden, and `openade/task/create` must not receive a hidden worktree isolation strategy.

Classic desktop snapshot event renderers follow the same rule when Core/runtime owns snapshots. Inline `SnapshotEvent.fullPatch` data is still snapshot patch content and must be hidden from `SnapshotEventModel.fullPatch`, Copy/Download, and `ViewPatch` props unless `OPENADE_METHOD.taskSnapshotPatchRead` is currently advertised. Legacy/Yjs sessions may continue to render inline patches through the existing local path.

Shared shell callable adapters must be intersected with generated capabilities before they reach child components. Terminal product access is one example: `OpenADEShell` must clamp `TaskTerminalProductAccess.capabilities` with `OPENADE_METHOD.taskTerminal*` and hide terminal access when neither start nor reconnect is advertised, even if the medium adapter still holds a stale full-power terminal object. `TaskProductPanel` must also close an open shared terminal when terminal product access disappears so a re-grant cannot remount a stale terminal without a fresh user action.

Remote/shared-shell lazy refresh helpers, adapter callbacks, read loaders, and action/mutation handlers must derive capabilities from the active `RemoteConfig` at call time, not only from the render that created the callback. Timers, SmartEditor managers, terminal sessions, reconnect handlers, session switches, stale controls, and delayed async callbacks can otherwise run project/task/git/file/process reads or product/admin writes after a runtime has lost that method. Delayed scoped read results must also confirm the same active runtime config plus repo/task scope before applying panel state, because two saved sessions may expose the same repo/task ids while pointing at different authorities.

### Route/Page Separation

Routes resolve URLs and load data. Pages render UI. Routes are in `Routes.tsx`, pages in `pages/`.

### Local Routing

The code module has its own routing in `routing.ts`, isolated from `@/state/routing`. Use `useCodeNavigate()` for navigation:

```typescript
import { useCodeNavigate } from "../routing"

const navigate = useCodeNavigate()
navigate.go("CodeWorkspaceTask", { workspaceId, taskId })
navigate.path("CodeWorkspace", { workspaceId }) // returns URL string
```

For non-React contexts (e.g., NotificationManager), use `CodeStoreConfig.navigateToTask` callback instead.

### Store Structure

Nested managers pattern. Access via `codeStore.{manager}.{method}()`:

```
codeStore
├── repos      # Repo CRUD, RepoEnvironment cache
├── tasks      # Task CRUD, TaskModel cache
├── events     # Event operations
├── execution  # Claude execution, fires after-event hooks
├── comments   # Comment CRUD, consumption tracking
├── queries    # Active query tracking, abort
└── ...
```

Key observable wrappers:
- `TaskModel` - Per-task state, environment, input manager
- `EventModel` - Per-event derived state

### Runtime And Electron Host Access

Dashboard (`electronAPI/`) ↔ local runtime bridge/Electron host modules

**All host APIs used in the code module must go through `electronAPI/`.** Prefer local runtime methods for plain request/response host operations. Use direct Electron IPC only for narrow OS/window integrations such as file dialogs, URL opening, window frame controls, and notifications.

Main modules: runtime (agent/process/PTY/git/files transport), shell (directory picker, open URL), procs (typed read/edit/save for `openade.toml`)

Task execution goes through the OpenADE runtime module (`openade/turn/start`, `openade/review/start`, `openade/turn/interrupt`). Durable repo/task/comment/task-metadata/queued-turn/environment mutations should enter through `CodeStore` product helpers; those helpers use the injected `OpenADEProductStore` when the runtime product API is active and `runtime/localOpenADEClient.ts` only as the legacy fallback. Core-owned workspace creation/settings, including onboarding, candidate path validation, and existing-directory Git initialization, must use `openade/repo/path/inspect` plus repo product mutations for trusted host preparation with `createDirectory`/`initializeGit` instead of calling Electron path/git helpers first; keep raw Electron validation/creation/init only for legacy local sessions. Workspace create/settings/onboarding path validation must clear stale path/git state when Core path inspection is unavailable and must ignore in-flight inspect/resolve results after the requested path or active capability scope changes. Use `getHarnessQueryManager()` only for low-level harness helpers that are not task turns, such as small JSON-constrained helpers (cron generation, config suggestions).

Low-level harness IPC event/query types and harness install status DTOs come from `@openade/harness/browser` as `HarnessIpc*` and `HarnessInstallStatus`; `electronAPI/harnessEventTypes.ts` and `electronAPI/harnessStatus.ts` may keep renderer helper functions, runtime response normalizers, and compatibility aliases, but they must not redeclare the Electron/runtime harness bridge contracts. When Core exposes a product runtime endpoint, harness status reads must use the selected product runtime and fail closed unless that runtime advertises `agent/provider/status`; do not fall back to the Electron local runtime from Core-owned product sessions.

Companion device administration in desktop settings should use `electronAPI/companion.ts` wrappers backed by the selected product runtime for `remote/device/list`, `remote/device/revoke`, and `remote/device/dropAll`. In Core-owned sessions, pairing also goes through the selected product runtime with Electron only exposing the public listener/base URL; keep native companion enablement, keep-awake, and bound-URL state on narrow Electron IPC because those are shell adapter responsibilities.

`CodeStore` has a default-on runtime product API bridge controlled by `VITE_OPENADE_ENABLE_RUNTIME_PRODUCT_STORE` or `CodeStoreConfig.enableRuntimeProductStore` for legacy/Electron product sessions. Core-owned product runtime startup is different: when rollout says Core is connected, non-legacy, and either no legacy Yjs documents are present or a clean legacy import has been accepted, Core ownership overrides that flag and startup must keep the runtime product bridge on. It hydrates `runtimeProductSnapshot` and task DTOs from `kernel/productStore.ts`; when a runtime snapshot is cached, `RepoManager.repos`, `CodeStore.getTaskPreviewsForRepo()`, `CodeLayout` task loading, and `TaskModel` reads should keep serving runtime DTOs even during transient bridge errors, otherwise they fall back to legacy Yjs stores. Core-owned product runtime startup must use product personal settings, an ephemeral MCP projection, Core-owned cron scheduling, and Core product APIs even when `runtimeProductSnapshot` is null because the snapshot read failed or `openade/snapshot/read` is not advertised; do not route product helpers, manager-level repo CRUD, notification refreshes, image writes, task-route loading, task-model git reads, snapshot artifact reads, or generic task reads to legacy `localOpenADEClient`/Yjs just because the snapshot cache is absent. Manager/page/model code that needs to choose a product API must use `CodeStore.shouldUseRuntimeProductAPI()`; snapshot-projection checks are internal to `CodeStore` and should not become manager/page/model branch conditions. Repo-list projection callers should use `CodeStore.getRuntimeProductProjectProjection()` and `CodeStore.shouldUseRuntimeProductProjectListProjection()` instead of checking snapshot state directly. Task lifecycle code should use `CodeStore.getCachedProductTask()`, `hasProductTaskModelSource()`, and `findProductRepoIdForTask()` instead of stitching together runtime DTO caches, cached task stores, and `repoStore` previews itself. Directly loaded runtime task DTOs remain valid even when the snapshot projection is null, so accepted task mutations must sync back into `runtimeProductTasks` by using the cached task's repo id before consulting the snapshot. If the Core runtime does not advertise `openade/snapshot/read`, initialize directly from `openade/project/list` instead of probing snapshot and logging an initialization error. If the Core snapshot fails but `openade/project/list` is advertised, initialize from the scoped project-list DTOs, keep `runtimeProductSnapshot` null, and keep repo/sidebar/stat projections on those Core DTOs. If both snapshot and project-list initialization fail, keep the runtime product store in an error/no-snapshot state instead of opening legacy repo/MCP/personal settings stores or starting renderer cron scheduling; repo/sidebar/stat projection helpers must return empty Core state rather than exposing any stale legacy `repoStore` that might still be in memory. Lightweight runtime task reads have a short fresh-cache window for route/render churn; explicit full-history hydration must still fetch. `CodeLayout` route remounts must render immediately when `CodeStore.storeInitialized` is already true, and its task-load effect must run before broad app-shell initialization and use `CodeStore.loadRuntimeProductTaskForRoute()` so Core-owned task URLs can attach the product runtime and load direct task DTOs before full app-shell/project projection initialization starts competing; do not reintroduce a per-route initialization, workspace task-loaded, or background `reposLoading` gate that shows loading on task switches or initialized task routes before cached runtime DTOs can render. The desktop product runtime is selected in `runtime/localProductRuntimeClient.ts`: by default it uses trusted Electron IPC, but when Electron exposes a valid `ws:` or `wss:` `openadeAPI.core.runtimeEndpoint` it uses the Go Core WebSocket for OpenADE product methods and notifications only; malformed, empty, or non-WebSocket endpoint values must fall back to Electron IPC. Electron may also expose a valid `openadeAPI.core.migrationRuntimeEndpoint` for unaccepted existing Yjs-backed installs; that endpoint is only for System settings import/accept/revoke actions, must not make `selectedLocalProductRuntime()` choose Core, and `CodeStore` migration imports must not set `runtimeProductStore` or flip `shouldUseRuntimeProductAPI()` in the current launch. The exported `localProductRuntimeClient` is a stable forwarding client that resolves the selected runtime on each call, follows endpoint changes, and closes stale Core clients, so product-store and local OpenADE client code must not capture `localProductRuntime.client` directly or reintroduce import-time transport selection. `resolveCoreRolloutState()` is the renderer boundary for sanitized Core rollout reason/source/status (`legacy-yjs-documents`, `legacy-yjs-migration-accepted`, `managed-core`, etc.) used by settings and telemetry; do not infer rollout state from env vars or filesystem paths in web code. Raw desktop host utilities under `electronAPI/*` still use `runtime/localRuntimeClient.ts` until Core owns those capabilities. Runtime product notification tests should inject a real `RuntimeLocalClient` through `CodeStoreConfig.runtimeNotificationSource`; production desktop still uses the selected local product runtime by default. Desktop route coverage for this bridge belongs in `Routes.runtimeProductStore.test.ts` and should install a real `RuntimeServer` behind the production runtime path instead of manually seeding `CodeStore` state. Reset cached Electron capability/platform state with the test-only reset helpers after installing a fake `window.openadeAPI`. Runtime-settlement after-event behavior must scan the unified `TaskManager` task view after refresh so DTO-backed and Yjs-backed tasks stay equivalent, but under the runtime product API terminal runtime notifications may refresh task detail only for already-open/cached tasks; background settlement should update running state without creating hidden `openade/task/read` calls or snapshot refreshes just to rediscover a repo id.
Product runtime notification subscriptions must follow the same selected runtime as requests. `localProductRuntimeClient.subscribe()` and `localProductRuntimeNotificationSource.subscribe()` should bind listeners through `runtime/localProductRuntimeClient.ts` so a switch between Electron IPC and Core WebSocket unsubscribes the stale transport and rebinds to the current one. Store-level notification source selection must use `resolveCoreRuntimeEndpoint()` rather than raw `window.openadeAPI.core.runtimeEndpoint`, otherwise malformed preload endpoint data can make the renderer try to subscribe through unavailable Electron IPC fallback.
Core-owned product helper calls must fail closed if the runtime product store is not initialized or the attached runtime does not advertise the exact `OPENADE_METHOD` being called; do not let `legacyProductClient()` silently route them through legacy Electron/Yjs or let stale handlers discover denials by issuing hidden runtime requests. Only real legacy-client fallback should emit `runtime_product_store_fallback` telemetry; Core-owned fail-closed paths must throw before logging a fallback that did not happen. `CodeStore.canUseProductMethod()`, `OpenADEProductStore.canUseMethod()`, and OpenADE product-client `hasMethod()` helpers must accept generated `OpenADEMethod` values rather than arbitrary strings. Desktop UI, page, and manager code should call `CodeStore.canUseProductMethod()` directly for visible controls and stale-handler guards; do not duplicate the older `!shouldUseRuntimeProductAPI() || canUseProductMethod(...)` policy expression outside `CodeStore`. TaskModel adapters for Files, Search, and SmartEditor file mentions should return an empty/null product result before issuing a runtime request when their exact file/search/image capability is absent, and they must not fall back to raw `filesApi`/`dataFolderApi` in runtime product mode. `OpenADEProductStore` clients must expose explicit `hasMethod()` and async `ensureMethodAvailable()` predicates, with no permissive optional fallback. Product-store methods should call the async guard before returning cached data or issuing a client call so capability changes cannot leave stale direct handlers alive. Legacy fallback remains only for rollout states where old data is still the active source.
Core-owned repo host preparation is selected by `CodeStore.usesCoreOwnedProductRuntime()`, not by `shouldUseRuntimeProductAPI()`. Workspace create, onboarding, and workspace settings must fail closed while Core owns repo creation/path inspection but the product store is not attached, instead of falling back to Electron `resolvePath`, `git/directory/read`, or `git/repo/init`. `RepoManager` repo CRUD must use the same Core-owned product-state predicate as the backend authority: do not require a legacy `repoStore` projection before forwarding allowed `openade/repo/*` mutations, and do not refresh legacy repo storage after Core-owned mutations.
Runtime task-detail helpers (`getRuntimeProductTask()`, `loadRuntimeProductTask()`, `loadProductTaskForRead()`, cached task-model source checks, and cached OpenADE task detail reads) must guard `OPENADE_METHOD.taskRead` before serving cached DTOs or issuing `openade/task/read`; stale routes and sidebar/copy handlers should receive `null` instead of cached task detail or a legacy task-store fallback.
Runtime project/task-list refresh helpers (`loadRuntimeProductProjects()` and task-preview refreshes used after task mutations, creation, deletion, and notifications) must guard `OPENADE_METHOD.projectList` and `OPENADE_METHOD.taskList` before calling the product store. If the focused list capability is absent, keep existing projections and continue any independently allowed task-detail refresh instead of probing denied list methods or falling back to legacy Yjs.
Shared-shell adapter props are not authority by themselves. `OpenADEShell` must clamp task image loaders with `OPENADE_METHOD.taskImageRead`, task/new-task image upload affordances and draft previews with `OPENADE_METHOD.taskImageWrite` plus an available submit path (`OPENADE_METHOD.turnStart` or `OPENADE_METHOD.queuedTurnEnqueue` for existing tasks, `OPENADE_METHOD.turnStart` for new tasks), clamp Retry with `OPENADE_METHOD.turnStart`, and intersect similar medium-provided booleans with generated shell capabilities at the shell boundary so stale remote adapter state cannot surface denied controls or issue hidden reads.
Classic desktop attachment renderers must follow the same authority rule. Runtime-backed `ImageAttachments` should clear and revoke loaded object URLs when `OPENADE_METHOD.taskImageRead` is unavailable or disappears, and it must not fall back to `dataFolderApi` while Core/runtime owns product images.
Classic desktop task and task-create managers must also treat image refs as capability-owned payload: when `OPENADE_METHOD.taskImageWrite` is unavailable, omit stale image refs from turn-start and create-and-run requests instead of relying only on hidden upload controls.
Classic desktop task creation must treat Worktree isolation as capability-owned state too. If `OPENADE_METHOD.projectGitBranchesRead` is unavailable or disappears in a runtime/Core-owned session, `TaskCreatePage` and `TaskCreationManager` must submit `{ type: "head" }`, avoid hidden branch/git-summary reads from stale Worktree UI state, and keep the create action usable when task creation itself is still allowed.
Classic shell working-directory hints for runtime/Core worktree tasks must come from the prepared task environment, not the repo projection or project git-info root. If the worktree environment is not loaded yet, shell actions should await environment loading or fail closed instead of opening file/search/process/terminal surfaces against the repo root.
`OpenADEProductStore.refreshSnapshot()` and lightweight `getTask()` keep very short completed-result caches so duplicate route/render reads do not immediately re-hit `openade/snapshot/read` or `openade/task/read` after OpenADEClient in-flight coalescing resolves. Preserve `bypassCache` for explicit/manual snapshot refreshes and use `refreshTask()` for mutation/notification task refreshes; explicit `{ hydrateSessionEvents: true }` task reads must always fetch. Project-level notification projection should refresh through `openade/project/list` and patch `snapshot.repos` when a snapshot context already exists, preserving server/theme and working-task ids; fallback to `openade/snapshot/read` only for runtimes that lack or deny `openade/project/list` or when no snapshot context exists yet. Direct `OpenADEProductStore.subscribe()` consumers coalesce subscribed `openade/task/updated` and `openade/queuedTurn/updated` notifications per task before refreshing already-cached task detail only; background updates for uncached tasks must not create hidden `openade/task/read` calls. After accepted existing-task turn/review starts patch the local in-progress action event, `OpenADEProductStore` may suppress only the matching tagged self-accepted `openade/task/updated` notification with the same `eventId` and `eventStatus: "in_progress"`; accepted metadata/comment/queued-turn mutations may suppress matching echo notifications with the same sanitized `clientRequestId`. Untagged notifications, different request ids, and terminal event-status notifications must keep refreshing cached task detail. Stronger `openade/task/previewChanged` and `openade/task/deleted` notifications cancel pending detail refreshes and remain immediate unless `previewChanged` is the matching client-request echo for an accepted local mutation.
Accepted runtime product mutations sync their resulting DTO state through `CodeStore` wrappers. Metadata/title updates patch cached task and preview DTOs locally after the runtime method succeeds; explicit task creation patches cached task detail and repo preview DTOs before any execution starts; existing-task turn/review starts patch cached in-progress action events, preview last-event state, working-task state, and scoped git-summary caches from the accepted result metadata; legacy implicit new-task starts patch cached task detail, repo preview, and working-task state when the accepted result includes `task` and `preview`; comment create/edit/delete patch cached task comments locally; queued-turn cancel patches cached queued-turn state; task environment setup/prepare patches cached device environments, setup events, preview last-event state, and scoped host caches locally; usage backfill/recalculate patches cached preview usage; project process start/stop patch a fresh cached process list locally; task deletion and repo create/update/delete patch cached snapshot DTOs locally; and wrappers for task create, turn start, review start, queued-turn cancel, task environment setup/prepare, and comment mutations sync the product-store cache into observable `CodeStore` state. Unsupported source cases or older runtimes may still refresh until the accepted result contains enough preview/task data to patch safely. Runtime-backed manager/page code should not call `refreshProductStateAfterTaskMutation()`, `refreshProductStateAfterTaskCreation()`, or `refreshProductStateAfterRepoMutation()` merely to observe the mutation it just issued; keep those broad refresh helpers for legacy fallback paths, explicit external refreshes, deletion cleanup, or cases where the mutation wrapper did not already refresh/cache the affected DTOs.

`kernel/sessionStore.ts` owns browser-safe saved kernel session persistence, including active-session switching, legacy single-session migration, and invalid-session filtering; companion-specific storage keys and change events should wrap that helper instead of reimplementing config parsing in `remote/client.ts`. `kernel/productStore.ts` is also the shared client boundary for scoped project files/search/processes, scoped project git info/branch/summary reads, scoped task terminals, scoped task git scopes/reads/commit, scoped task image reads, scoped task resource inventory reads, scoped task title generation, and scoped snapshot patch/index/slice reads. OpenADE product DTO types come from `projects/openade-module/src`; do not add `Remote*` companion aliases for product DTOs. `persistence/repoStore.ts` stores `OpenADETaskPreview` values directly for legacy Yjs compatibility; do not re-add `TaskPreview`, last-event, or usage aliases in web code, and have settings/sidebar utilities consume OpenADE DTOs or narrow inputs derived from them. SmartEditor product file context should use `shouldUseRuntimeProductAPI()` plus a cached task DTO when available, so file mentions in a directly loaded Core-owned task still use scoped `openade/project/files/fuzzySearch` even when the snapshot projection is unavailable. Project-level SmartEditor surfaces such as scratchpads may lazily resolve and cache the repo path through Core git-info before the first non-empty `@file` query; do not make those editors require a snapshot-backed repo projection or run git-info reads on tray mount.
The existing desktop UI is the canonical product surface: runtime-backed desktop routes should keep `pages/TaskPage.tsx`, `TaskCreatePage`, `InputBar`, trays, shortcuts, settings, and desktop navigation behavior while replacing direct Yjs/local host assumptions with `OpenADEClient` and scoped runtime APIs. Shared UI must be desktop-derived. Do not ship `RemoteApp`, `OpenADEShell`, `TaskScreen`, `NewTaskScreen`, or compact companion screens as desktop replacements unless they first match classic desktop look and functionality.
Runtime/Core-backed `TaskCreatePage` file mention UI, editor guidance, and saved file favorites must be gated by `OPENADE_METHOD.projectFilesFuzzySearch`; slash-command discovery may keep its own SDK-capability resolver, but it must not implicitly re-enable `@file` search or stale local file favorites.
Under the runtime product API, classic `InputBar` command execution must use `CodeStore.startProductTurn()` and rely on that accepted-mutation wrapper to sync runtime DTO cache instead of forcing `getTaskStore()`, explicit follow-up task/snapshot reads, or other direct renderer Yjs reads. Classic repo-level git info used by `RepoManager` and explicit `TaskCreatePage` Worktree selection should use `CodeStore.readProductProjectGitInfo()`, `readProductProjectGitBranches()`, and `readProductProjectGitSummary()` when the runtime product API is active; raw `gitApi.isGitDirectory()`, `listBranches()`, `getGitSummary()`, and `checkGhCli()` are legacy/trusted-local fallback only. `RepoManager` must fail closed from `OPENADE_METHOD.projectGitInfoRead`, `projectGitBranchesRead`, and `projectGitSummaryRead` before calling those product reads, and must also fail closed while Core owns product state but the runtime product store is not attached, so lazy worktree/git UI does not discover denied capabilities or attach gaps by issuing hidden requests. Core-backed `TaskCreatePage` must not load project git info, branch reads, or file-favorite validation on screen open; keep branch reads lazy/manual from the Worktree control and file mention validation/search lazy from actual editor interactions so normal task creation opens stay lightweight. If a Core-backed task-create route lacks a snapshot-backed repo path, pass a lazy repo-path resolver so file mentions can resolve through scoped project git-info only after the user invokes file search. Classic desktop git status should use `CodeStore.readProductTaskGitSummary()`; classic desktop changes tray reads should use `CodeStore.readProductTaskChanges()`, `readProductTaskDiff()`, and `readProductTaskFilePair()` through `TaskModel`/`ChangesManager`; raw `gitApi` summary, file-list, file-pair, and patch reads are the trusted-local fallback only. `ChangesManager` must guard `OPENADE_METHOD.taskChangesRead`, `taskDiffRead`, and `taskFilePairRead` before each runtime-backed read so stale viewers do not discover denials through product-wrapper errors. Classic desktop Git Log task-scope discovery should use `CodeStore.readProductTaskGitScopes()`, and task branch/worktree history should use `CodeStore.readProductTaskGitLog()`, `readProductTaskGitCommitFiles()`, `readProductTaskGitFileAtTreeish()`, and `readProductTaskGitCommitFilePatch()` for commit history/details. Runtime-backed task git panels must fail closed when a scoped product repo/task context cannot be resolved; `GitLogTray` must also guard `OPENADE_METHOD.taskGitScopesRead`, `taskGitLog`, `taskGitCommitFilesRead`, `taskGitFileAtTreeishRead`, and `taskGitCommitFilePatchRead` before each component-level product read so stale/direct mounts cannot discover denials by issuing hidden requests. Do not fall back to raw `gitApi` merely because a working directory string is available. Classic task-create and task-input slash-command SDK discovery in runtime/Core product sessions must use `CodeStore.readProductProjectSdkCapabilities()` / `openade/project/sdkCapabilities/read` and stay lazy from slash-command suggestion interaction; raw `agent/sdkCapabilities/read` is a trusted local legacy fallback only. Scratchpad editors are file-mention surfaces only and must not pass `SdkCapabilitiesManager` even when a repo working directory resolver is available.
Classic desktop task metadata, environment, comment, review, queued-turn, repeat/cron turn, task creation, and deletion mutations should use `CodeStore` product helpers. In runtime-backed sessions, Review and Review Plan command visibility plus `ReviewPickerModal` submission must fail closed from `OPENADE_METHOD.reviewStart`; do not show a review affordance that can only discover denial after issuing `openade/review/start`. Classic close/reopen/cancel-plan/last-viewed/MCP-selection/title-edit paths must fail closed from `OPENADE_METHOD.taskMetadataUpdate`, and runtime title generation must fail closed from `OPENADE_METHOD.taskTitleGenerate`; do not let route effects or task creation fire hidden denied metadata/title requests. Task route title editing/generation and sidebar rename/close/delete controls should also hide or disable from those same task metadata/title/delete/resource-inventory capabilities, not only rely on manager no-ops; if sidebar title editing is already open and `taskMetadataUpdate` disappears, close the edit field without committing. Classic comment annotations must derive create/edit/delete controls from `OPENADE_METHOD.commentCreate`, `OPENADE_METHOD.commentEdit`, and `OPENADE_METHOD.commentDelete`, with `CommentManager` as the final fail-closed boundary. Queued-turn cancel controls and stale handlers must fail closed from `OPENADE_METHOD.queuedTurnCancel` before suppressing accepted queue state locally. Runtime-backed task creation should call `CodeStore.createProductTask()` / `openade/task/create` first and then call `CodeStore.startProductTurn()` with `inTaskId` only when `OPENADE_METHOD.turnStart` is advertised; do not send the task's isolation strategy on the attach-turn request or require a snapshot-backed `RepoManager.getRepo()` projection. Classic `TaskCreatePage` must expose a create-only affordance when `OPENADE_METHOD.taskCreate` is advertised without `OPENADE_METHOD.turnStart`, and must keep execution-mode buttons plus new-task image upload hidden/disabled when their required capabilities are absent. Local cwd-based title generation is legacy fallback only, while Core-backed title generation goes through `CodeStore.generateProductTaskTitle()`. Runtime-backed task and task-create image upload must fail closed from `OPENADE_METHOD.taskImageWrite` plus turn-start availability before showing upload affordances, accepting paste/drop, or writing staged image blobs. Runtime-backed action image thumbnails and snapshot patch copy/download/index/slice views must also fail closed from `OPENADE_METHOD.taskImageRead`, `taskSnapshotPatchRead`, `taskSnapshotIndexRead`, and `taskSnapshotPatchReadSlice` before issuing reads; do not let existing task history rendering discover denied artifact capabilities through hidden requests. Runtime-backed desktop task and task-create slash-command discovery must only provide `SdkCapabilitiesManager` when `OPENADE_METHOD.projectSdkCapabilitiesRead` is advertised; otherwise the editor should keep slash suggestions disabled instead of probing `openade/project/sdkCapabilities/read` after the user types `/`. Repeat loops and renderer-owned cron execution are hidden/background turn-start paths, so they must also fail closed from `OPENADE_METHOD.turnStart` in runtime-backed sessions. Renderer-owned cron reuse that carries `inTaskId` must omit task-creation-only fields such as `isolationStrategy` and `title`; those belong only to `openade/task/create` or new-task legacy turn starts. Classic Files, Search, Changes, Git Log, Terminal, and Processes trays must hide from runtime-backed sessions unless the exact scoped product read/attach methods needed by the tray are advertised; `TrayManager.open()`/`toggle()` must respect those same visibility gates, and route/model backstops such as git summary refresh must return before calling denied product methods. The classic task, task-create, and pending-creation routes may bypass the missing-workspace screen only when `CodeStore.shouldUseRuntimeProductAPI()` and `usesCoreOwnedProductRuntime()` are both true, so Core-owned sessions can read/create from repo id plus task id after snapshot failure without weakening legacy not-found behavior. Base, workspace, and workspace settings routes should resolve missing Core-owned repo projections through `CodeStore.loadRuntimeProductProjects()` / `openade/project/list`, not by opening the legacy repo store or assuming no workspaces before the direct Core list has completed. In runtime-backed paths, rely on the product-store mutation cache sync unless the mutation truly needs deletion cleanup or an explicit external refresh; in legacy paths, keep `refreshProductStateAfterTaskMutation()`, `refreshProductStateAfterTaskCreation()`, or `refreshProductStateAfterTaskDeletion()` so old task-store/repo-store projection stays intact. Classic repo creation, update, archive, and deletion should use `CodeStore.createProductRepo()`, `updateProductRepo()`, `deleteProductRepo()`, and `refreshProductStateAfterRepoMutation()` so runtime-backed paths avoid legacy repo-store refreshes; runtime-backed repo-admin controls and stale handlers must fail closed from `OPENADE_METHOD.repoCreate`, `OPENADE_METHOD.repoUpdate`, and `OPENADE_METHOD.repoDelete`.
Runtime notifications and runtime-settlement refreshes must stay on runtime DTO helpers whenever `CodeStore.shouldUseRuntimeProductAPI()` is true; do not route normal runtime-active notifications through legacy Yjs refreshes. Core-owned product runtime startup must hydrate working-task runtime state from the selected product runtime/Core client, not from `runtime/localRuntimeClient.ts`, even when the initial snapshot read failed and `runtimeProductSnapshot` is null; request only active `starting`/`running` `openade-task` runtimes so startup does not scan historical runtime records, and keep `RuntimeManager`'s local IPC runtime-list fallback only for legacy product sessions where the runtime product API is not active. `OpenADEProductStore.listRuntimes()` must guard the generic `runtime/list` capability before cache reads or transport calls; runtimes that do not advertise it hydrate an empty active-runtime state with no denied request, no startup warning, and no legacy fallback. Core-owned cron scheduling is also selected by Core-owned rollout state, not by snapshot availability. `OpenADEProductStore.listRuntimes()` keeps a very short completed-result cache for duplicate active-runtime hydration reads and clears it on accepted runtime lifecycle mutations plus runtime lifecycle notifications before merging the notification into `RuntimeRecordCache`. Classic read helpers such as delete-resource inventory should use `CodeStore.readProductTaskResourceInventory()` when the runtime product API is active; `OpenADEProductStore.readTaskResourceInventory()` keeps a very short completed-result cache per task and clears it on task/runtime changes because inventory includes both durable artifacts and `isRunning`. Task title generation/regeneration should use `CodeStore.generateProductTaskTitle()` in runtime-backed contexts and `prompts/titleExtractor.generateTitle()` only as the legacy trusted-local fallback; sidebar copy-path should use `CodeStore.loadProductTaskForRead()` before any legacy task-store path. The desktop shared-screen flag and `DesktopShared*` route files were removed; do not reintroduce a desktop route that promotes compact remote/mobile shell screens.
Passive classic tray transitions must not bypass task git-summary caches. Changes tray open, Terminal tray close, and similar UI open/close effects should call freshness-aware `TaskModel.refreshGitState()` without `{ force: true }`; reserve forced git refreshes for explicit correctness-sensitive user commands such as Commit & Push.
`CodeStore.refreshRepoStoreFromStorage()`, `refreshTaskStoreFromStorage()`, `syncRepoStore()`, and `reloadRepoStoreFromStorage()` must short-circuit to runtime/Core refreshes or no-ops before touching legacy Yjs connections when runtime product APIs are selected. These helpers still exist for legacy callers, but in runtime-backed sessions they must not call `repoStoreConnection.refresh()`, `repoStoreConnection.sync()`, `repoStoreConnection.disconnect()`, or task-store `refresh()` because that reopens unchanged multi-megabyte Yjs documents during notification, mutation, settings-save, or reload churn.
Legacy Yjs store bootstrap helpers should only create the store connection and return `sync`/`refresh` handles. Do not fire an internal best-effort `sync()` from `connectRepoStore()`, `connectMcpServerStore()`, or `connectPersonalSettingsStore()`; `CodeStore` owns the first awaited sync, and hidden bootstrap syncs duplicate `code:repos`, `code:mcp_servers`, and `code:personal_settings` document loads during startup.
Runtime product rollout observability is emitted from `CodeStore`: `app_opened` includes runtime-product gate/status fields, Core transport/rollout fields, product projection counts, `runtime_product_store_error` records sanitized bridge error categories, and `runtime_product_store_fallback` records deduped legacy direct-read fallbacks without repo paths or task content. `analytics/analytics.ts` records those real `track()` calls to local storage only when Electron preload exposes `openadeAPI.app.smokeTest`, and packaged smoke must run `npm run review:runtime-product-rollout` against that export. A passing rollout review must prove a ready Core-backed `app_opened`, not only a ready runtime product store: require `runtimeProductTransport: "core-websocket"`, `coreRolloutStatus: "connected"`, `runtimeProductStoreHasProjectProjection: true`, nonnegative integer repo/task/cache projection counts, and an internally consistent product-Core reason (`managed-core`, `legacy-yjs-migration-accepted`, or `external-endpoint`) before counting the event as ready. Do not require `runtimeProductStoreHasSnapshot` for rollout readiness because clean/Core-owned startup may intentionally use scoped `openade/project/list` without a full snapshot. Before broad rollout or fallback removal, run `npm run review:runtime-product-rollout -- <telemetry-export.json-or-ndjson>` from `projects/web` against the internal/default-on cohort export and require a passing report. Extend `store/storeRuntimeProductStore.test.ts` with real `RuntimeServer`/`OpenADEClient` checks for each bridge slice and keep old-vs-new Yjs projection parity in Electron/OpenADE module fixture tests before removing fallback Yjs direct reads.

Cold same-repo git-info detection must be in-flight coalesced in `RepoManager.getGitInfo()` so environment setup, task creation, and sidebar reads do not duplicate `openade/project/git/info/read` or legacy `gitApi.isGitDirectory()` work.

Classic MCP settings should use `CodeStore.readProductMcpServers()`, `replaceProductMcpServers()`, `upsertProductMcpServer()`, and `deleteProductMcpServer()` through `McpServerManager` when the runtime product API is active. `McpServerManager` may keep the existing Yjs-backed observable list only as a classic UI projection and first-run legacy import path: if runtime settings are empty and `OPENADE_METHOD.settingsMcpServersReplace` is advertised, it imports the local `code:mcp_servers` rows through the product API, then mirrors product rows back into the local projection. Runtime-backed connector settings must fail closed from `OPENADE_METHOD.settingsMcpServersRead`, `settingsMcpServersReplace`, `settingsMcpServersUpsert`, and `settingsMcpServersDelete`; hidden buttons are not enough because OAuth callbacks, OAuth background token refresh, connector health checks, and stale modals can also attempt writes. In Core-owned product runtime sessions, renderer-owned background OAuth refresh must stay disabled; explicit user OAuth/test actions may still use the trusted-local host bridge until Core owns that flow, but connector health tests update `healthStatus`/`lastTested` and must require product settings read plus upsert before invoking `electronAPI/mcp.ts`. Idle renderer timers must not call `host/mcp/refreshOAuth`. `OpenADEProductStore` keeps a very short completed-result cache plus in-flight coalescing for MCP settings reads and patches it from accepted replace/upsert/delete results; settings writes must clear any active settings read before applying the accepted result. Do not add new settings UI writes that bypass the product MCP settings methods or force legacy document reads just to observe accepted writes.

Classic personal settings should continue flowing through `personalSettingsStore`, but runtime-backed product sessions must connect it with `connectProductPersonalSettingsStore()` and `OpenADEProductStore.readPersonalSettings()` / `replacePersonalSettings()` rather than opening legacy `code:personal_settings` once the product bridge is ready. Runtime-backed settings reads must fail closed from `OPENADE_METHOD.settingsPersonalRead`; denied profiles use local defaults for the renderer session and issue zero `openade/settings/personal/read` requests. Runtime-backed persistence must fail closed from `OPENADE_METHOD.settingsPersonalReplace` so env-var/theme/telemetry/shortcut writes do not discover denial after issuing `openade/settings/personal/replace`. `OpenADEProductStore` keeps a very short completed-result cache plus in-flight coalescing for personal settings reads and patches it from accepted replace results so connect/sync churn does not reopen the settings document; settings writes must clear any active personal-settings read before applying the accepted result. The Yjs-backed personal-settings store is a legacy/trusted-local fallback only. Preserve explicit `false` values when projecting through the product API, especially `renderMarkdownMessages` and `telemetryDisabled`.

Core migration triggers from desktop live in the System settings Core Migration section and must stay gated on `openadeAPI.core.runtimeEndpoint` or the migration-only `openadeAPI.core.migrationRuntimeEndpoint`; do not expose raw legacy Yjs document access, legacy resource directory imports, or migration marker writes/revokes to paired/browser/mobile clients. Full local repo/task data import should use `CodeStore.importProductLegacyYjsData()`, which builds an `OpenADEYjsProjection` over trusted local `data/yjs/*` runtime methods, runs `importOpenADELegacyYjsData()` through the selected product runtime/Core writer, runs `compareOpenADELegacyYjsToCore()` against the same runtime client, and refreshes cached runtime snapshots only when the normal product runtime store is active. Resource/blob migration should use `CodeStore.importProductLegacyResources()` so `openade/import/legacyResources` imports legacy images, snapshot patches, and transcripts after Core task rows exist; build those requests through `components/settings/coreResourceMigration.ts` so empty selections fail locally, optional paths are trimmed, and data-dir versus explicit resource/session roots keep the same typed contract as Core. The trusted local `host/core/legacyYjsMigration/accept` method may be called only after the same System settings flow has both a clean data/parity report and a clean resource import report with image, snapshot, and harness session summaries, no skipped, missing, conflicted, or failed resources, complete scanned/imported repo and task counts, matching parity scan counts, and internally consistent resource totals; pass only sanitized count summaries from those real reports so Electron can reject non-clean evidence before writing the narrow accepted-import marker used to auto-start Core over retained legacy Yjs docs on the next launch. Renderer marker responses and Electron marker reads must also reject missing or non-clean evidence, not just malformed versions. The trusted local `host/core/legacyYjsMigration/revoke` rollback removes only the accepted-import marker, requires restart, and should be surfaced only when rollout state is `legacy-yjs-migration-accepted`; it must not delete Core data or legacy Yjs data. Keep these as separate actions but do not present either one as complete migration by itself.

Classic desktop environment setup should use `CodeStore.prepareProductTaskEnvironment()` when the runtime product API is active, using only the task's repo id/task id and not requiring a snapshot-backed `RepoManager.getRepo()` projection. Runtime-backed environment prepare must fail closed from `OPENADE_METHOD.taskEnvironmentPrepare`, and legacy device-environment setup writes must fail closed from `OPENADE_METHOD.taskEnvironmentSetup` when the runtime product API is active. `EnvironmentSetupView` may keep `TaskEnvironment.setup()` and raw `gitApi` calls only as trusted-local fallback paths for legacy/unscoped operation. Runtime-backed setup completion should not immediately call `TaskModel.refreshGitState()` from `TaskPage`; setup may invalidate/refresh task DTOs, but task git reads stay explicit tray/user actions. `TaskEnvironment` should stay limited to environment derivation plus the lightweight legacy git-summary/setup fallbacks; do not re-add raw patch, file-pair, changed-file, or full-status helpers there. Use `TaskModel`/`ChangesManager` scoped product methods or explicit legacy fallback managers instead.

Pending task creation cancellation must not clean up worktrees through renderer `gitApi`. If the server has accepted a task, cancel through `CodeStore.interruptProductTurn()` and `CodeStore.deleteProductTask()` so OpenADE host adapters own task resource cleanup.

Classic desktop snapshot event patch/index/slice reads should go through `CodeStore.readProductTaskSnapshotPatch()`, `readProductTaskSnapshotIndex()`, and `readProductTaskSnapshotPatchSlice()` whenever the runtime product API is active; `electronAPI/snapshots.ts` is only the trusted-local fallback for legacy/unscoped paths. Runtime-backed `SnapshotEventModel`, `SnapshotEventItem`, and `ViewPatch` reads must fail closed when scoped product repo/task context cannot be resolved; do not fall back to raw snapshot files just because an event id or patch id is available. `OpenADEProductStore` keeps very short completed-result caches for these immutable snapshot artifacts using compact repo/task/event/range keys; task and repo deletion must clear those entries so removed task artifacts are not served from the renderer cache.

Classic desktop Files tray directory reads, file reads, and filename fuzzy search should use `CodeStore.listProductProjectFiles()`, `readProductProjectFile()`, and `fuzzySearchProductProjectFiles()` with the active task id when the runtime product API is active. Classic desktop Search tray content search and file preview should use `CodeStore.searchProductProject()` and `readProductProjectFile()` with the active task id in the same runtime-backed path. Classic SmartEditor file mentions and tracked-file validation should go through `SmartEditorManager` so task editors use `CodeStore.fuzzySearchProductProjectFiles()` with the active task id and task-create/scratchpad editors use the same product method with the repo id. Runtime-backed SmartEditor stashed image previews should restore through `CodeStore.readProductStagedTaskImage()` / `openade/task/image/staged/read`; `dataFolderApi` is only the legacy/unscoped fallback for old local drafts. `electronAPI/files.ts` is only the trusted-local fallback for legacy/unscoped paths; do not add new direct `filesApi` calls for task-owned file/search behavior or React editor components.
In Core-owned product runtime sessions, explicit task-scoped host tray opens such as Files, Search, Git Log, Terminal, and Processes may lazily resolve the task working directory through `openade/project/git/info/read` when no snapshot-backed repo projection is available; do not put that read back on task route mount. Task editors should pass the current `taskWorkingDirHint` when available and a lazy resolver for file mentions/slash-command suggestions when it is not. Once a direct Core task DTO is cached, Files/Search task contexts should remain valid from the task's repo id plus cached/lazily resolved working-dir context and must not fall back to stale legacy repo projections or raw `filesApi` reads just because `runtimeProductSnapshot` is null.
`OpenADEProductStore.listProjectFiles()`, `readProjectFile()`, `fuzzySearchProjectFiles()`, and `searchProject()` keep very short completed-result caches plus in-flight coalescing for identical scoped queries so desktop and remote editors/trays do not repeatedly hit `openade/project/files/tree`, `openade/project/file/read`, `openade/project/files/fuzzySearch`, or `openade/project/search` during mount/open churn. Keep scoped file writes, task environment setup/prepare, task updates, and repo update/delete invalidating those caches and matching in-flight entries for the affected repo/task scope, and clear all repo scopes when a repo-root write has no task id.
`OpenADEProductStore.readProjectGitInfo()`, `readProjectGitBranches()`, `readProjectGitSummary()`, `readTaskGitSummary()`, `readTaskGitScopes()`, `readTaskGitLog()`, `readTaskGitCommitFiles()`, `readTaskGitFileAtTreeish()`, `readTaskGitCommitFilePatch()`, `readTaskChanges()`, `readTaskDiff()`, and `readTaskFilePair()` keep very short completed-result caches plus in-flight coalescing for duplicate task-open/tray churn. Preserve the `bypassCache` path for explicit forced summary refreshes such as `TaskModel.refreshGitState({ force: true })`, and keep repo update/delete clearing project git-info/branches plus file writes, task git commits, repo update/delete, turn starts, and task update notifications clearing the affected repo/task git-summary, task-scope, task-log, commit-detail, changes, diff, and file-pair caches and matching in-flight entries.
`OpenADEProductStore.readTaskSnapshotPatch()`, `readTaskSnapshotIndex()`, `readTaskSnapshotPatchSlice()`, `readTaskImage()`, `readStagedTaskImage()`, and `readTaskResourceInventory()` also keep in-flight coalescing alongside their short completed-result caches. Task/repo deletion, image writes, runtime lifecycle changes, and task/runtime notifications must clear the matching in-flight entries anywhere they clear the completed cache.
SmartEditor file mentions must not run empty fuzzy searches just to warm the cache on editor mount or open the `@` popup; empty queries should render local frecency favorites only. Search on actual non-empty user queries, keep identical product fuzzy searches coalesced in `SmartEditorManager`, keep component-level mention search to one active request plus the latest queued query, and treat async runtime/Core working-directory resolution as coalesced latest-only work so stale adjacent `@file` queries cannot fan out into multiple `openade/project/files/fuzzySearch` or working-directory requests.

`persistence/storage/ElectronStorage.ts` tracks the last applied Yjs update bytes per cached document, skips `Y.applyUpdate()` when a refresh returns identical bytes, and skips encode plus renderer-to-runtime saves when a cached document has not changed locally. Keep these guards in place so notification/focus refreshes and disconnect/sync paths do not repeatedly decode, encode, or re-save unchanged multi-megabyte task documents; in-app saves must continue updating that marker so real changes still apply.

Classic desktop Terminal tray sessions should use `CodeStore.startProductTaskTerminal()`, `reconnectProductTaskTerminal()`, `writeProductTaskTerminal()`, `resizeProductTaskTerminal()`, and `stopProductTaskTerminal()` whenever the runtime product API is active. Product terminal visibility and mutations must derive from `CodeStore.canUseProductMethod()` for `openade/task/terminal/start`, `reconnect`, `write`, `resize`, and `stop`; if a runtime product session advertises neither start nor reconnect, do not fall back to raw PTY. The xterm component may use `components/terminalSession.ts` as the transport adapter, but direct `PtyHandle`/raw `pty/*` access belongs only in that adapter as the trusted-local fallback for legacy/unscoped terminal contexts.

Classic desktop Processes tray actions should use `CodeStore.listProductProjectProcesses()`, `startProductProjectProcess()`, `reconnectProductProjectProcess()`, and `stopProductProjectProcess()` whenever the runtime product API is active. The tray must check `CodeStore.canUseProductMethod(OPENADE_METHOD.projectProcessList)` before reading process definitions or live instances; stale mounted panels must fail closed instead of falling back to raw `readProcs()`. Product process action visibility and direct handlers must derive from `CodeStore.canUseProductMethod()` via scoped product process access: `openade/project/process/start`, `openade/project/process/reconnect`, and `openade/project/process/stop` are independent capabilities and denied methods must not be called from hidden buttons, cleanup paths, or modal callbacks. Classic cron/sidebar config hydration should use `CodeStore.readProductCronDefinitions()` / `openade/cron/definitions/read` so cron-only UI does not fetch process definitions or live instances; keep `CodeStore.listProductProjectProcesses()` for Processes tray/editor flows that need the full process shape. When opening or saving `openade.toml` from the Processes tray or Cron sidebar under the runtime product API, discover config files through `CodeStore.listProductProjectProcesses()`, load file content through `CodeStore.readProductProjectFile()`, parse/serialize in browser-safe OpenADE module helpers, write the config through `CodeStore.writeProductProjectFile()` / `openade/project/file/write`, refresh parsed config through the narrow cron or full process read that matches the caller, and stop stale runtime-owned processes through scoped product process access before the renderer drops them from local state. Keep `ProcsEditorModal` as the single cron/process config editor path; do not reintroduce a separate Cron sidebar editor that calls `electronAPI/procs.readConfigFile()` or `writeConfigFile()`. Process editor helpers must guard `OPENADE_METHOD.projectProcessList` before discovery or post-save process refreshes and `OPENADE_METHOD.projectFileRead` before loading editable config contents; denied profiles should return an empty discovery result or local unavailable error with zero product requests and no legacy fallback. Runtime-backed config saves must hide/disable save and fail closed from `OPENADE_METHOD.projectFileWrite`; do not let denied runtimes discover write denial only after submitting the editor. Raw `host/procs/*` reads/writes and direct `ProcessHandle` starts/stops are trusted-local fallback paths only.
`OpenADEProductStore.listProjectProcesses()`, `readCronDefinitions()`, `readCronInstallState()`, and `listCronInstallStateRepos()` keep in-flight coalescing plus very short completed-read caches so startup/sidebar/tray callers do not issue duplicate expensive `openade/project/process/list`, `openade/cron/definitions/read`, `openade/cron/installState/read`, or `openade/cron/installState/list` requests while the first call is still running or immediately after it resolves. A fresh `openade/project/process/list` result with config payloads also satisfies cron-definition reads for the same repo/task scope, because both routes parse the same `openade.toml` files; do not split that back into two host parses during nearby Processes/Cron UI churn. `CronManager` must check `OPENADE_METHOD.cronDefinitionsRead` and `OPENADE_METHOD.cronInstallStateRead` before sidebar/on-demand runtime reads; missing cron read capabilities produce an empty cron view with no denied product request and no legacy data-folder fallback. Accepted cron install-state mutations must invalidate the repo index cache so startup/sidebar state does not hold stale installed-repo membership. Accepted process start/stop should patch the process cache when it is already fresh; scoped `openade.toml` writes must still invalidate process and cron-definition reads so parsed config changes are visible on the next read.
`CronManager.startAll()` must not scan every repo's process config on app open. It should load persisted cron install state, eagerly refresh only repos with installed crons so schedules remain correct, coalesce same-repo config refreshes across startup/focus/event callers, and keep sidebar/task-route paint passive under the runtime product API. `CodeStore.initializeStores()` must start renderer cron scheduling only for legacy renderer-owned product sessions; runtime-backed product sessions should leave `CronManager` stopped on startup and rely on explicit cron UI actions or the product kernel's scheduler. When the runtime product API advertises `openade/cron/installState/list`, `startAll()` must use that index before reading per-repo install state so idle startup does not fan out one document read per repo. When `CodeStore.shouldUseCoreOwnedCronScheduler()` is true, `startAll()` and repo-add bookkeeping must be no-ops for renderer scheduling: do not load product cron state, do not call `openade/project/process/list`, do not install renderer focus/event refresh handlers, and do not mark the renderer cron manager started. If Core scheduler ownership becomes true after renderer scheduling has already started, cron focus/event refresh entry points must stop the renderer scheduler before issuing any process/config reads. Runtime-backed `CronsSidebarContent` must not call `ensureRepoConfigLoaded()` from mount; explicit cron editor actions may call it to lazily read Core cron definitions and install state for display/editing.
Legacy renderer cron scheduling uses `cron/_index.json` in the trusted data folder as the installed-repo index. `CronManager.startAll()` must not fall back to a per-repo install-state scan when the index is missing or invalid; it should skip automatic startup scheduling until a repo is explicitly loaded or install-state saves create/update the index. Install-state saves must keep that index in sync and store repo ids only, never repo paths or cron prompts.
Under the runtime product API, `CronManager` must load and save install state through `CodeStore.readProductCronInstallState()` and `replaceProductCronInstallState()` rather than direct `dataFolderApi` reads. `OpenADEProductStore.readCronInstallState()` keeps a very short completed-result cache per repo and patches that cache from accepted replace results so sidebar/startup sync does not reread `openade/cron/installState/read` just to observe its own save; repo update/delete notifications clear the affected repo cache. Runtime cron Run Now and install-state controls must derive visibility from advertised product methods through `CodeStore.canUseProductMethod()` and guard direct handlers the same way: `openade/cron/run` for Run Now and `openade/cron/installState/replace` for install/pause/resume. For Core-owned product runtime sessions (`resolveCoreRolloutState()` connected, non-legacy source, and either no legacy Yjs documents or accepted legacy import), renderer cron scheduling must stay off; Core owns headless scheduling and the renderer must not open raw local cron data-folder state during startup or drive cron run-now by directly calling `openade/turn/start`. Core-owned run-now must go through `CodeStore.runProductCron()` / `openade/cron/run`. Keep renderer cron scheduling and direct turn-start run-now only for legacy/Electron fallback.
When closing a worktree task, `InputManager` must pass scoped product process access into `RepoProcessesManager.stopAllForContext()` under the runtime product API so runtime-owned processes are stopped through `openade/project/process/stop` rather than only removed from renderer state. Runtime task opens should still avoid environment loading; close is an explicit user action, so cleanup should use `TaskModel.taskWorkingDirHint` first and only call `loadEnvironment()` at close time when no prepared worktree hint is cached.

Shared task shell primitives live under `shell/task`, but desktop parity is the gate. Desktop and remote task-thread scroll behavior should use `shell/task/useTaskThreadScroll.ts` instead of reimplementing bottom-follow or jump-to-latest behavior in medium-specific pages. Task event DTO presentation can use `shell/task/taskEventPresentation.ts` and `shell/task/TaskEventThread.tsx` only where it preserves classic desktop rendering behavior. Task command labels, composer ordering, and "queue while running" rules should use `shell/task/taskCommands.ts`; full command ids, labels, ordering, grouping, visibility, and enablement should use `shell/task/taskCommandModel.ts`. Classic desktop `InputManager` must still filter Do/Ask/Plan/Run Plan/Revise/Retry/Interrupt replacement turns/Repeat/Commit & Push through `CodeStore.canUseProductMethod(OPENADE_METHOD.turnStart)` whenever the runtime product API is active; stale handlers must no-op rather than issuing denied `openade/turn/start` calls. When a cached runtime task DTO contains plan/revise/HyperPlan events, `InputManager` should derive Run Plan/Revise visibility from that DTO so accepted runtime updates drive the command row; use the `TaskModel.hasActivePlan` fallback only when no plan event has reached the task DTO. Classic desktop task creation in runtime-backed sessions must use the `openade/task/create` gate first and treat `openade/turn/start` as optional execution attachment through `inTaskId`; legacy fallback may keep the older implicit create-and-run turn path. Task title generation must check `OPENADE_METHOD.taskTitleGenerate` before reading task detail, so stale regenerate-title handlers cannot issue hidden `openade/task/read` calls just to discover title generation is denied. New task composer UI under `shell/task/TaskComposer.tsx` is not a desktop replacement for `InputBar`; extract from or slot in the rich desktop composer so SmartEditor, attachments, desktop tray buttons, shortcuts, and desktop-only affordances remain intact. Desktop route smoke must verify those controls reach `openade/task/create` plus `openade/turn/start` through the real local runtime path. Task title/close/delete, review, queued-turn, comments, and scoped git controls can share `shell/task/TaskProductPanel.tsx` only after desktop behavior parity is covered. Do not use `shell/task/TaskScreen.tsx` as the default desktop route until it matches the classic desktop task page.

Classic desktop task event streams must keep task opening responsive. Runtime-backed task-route and notification refreshes should read persisted task data first with `hydrateSessionEvents: false`; streamy `openade/task/updated` and `openade/queuedTurn/updated` notifications should be coalesced per task before refreshing, and session-history hydration must be explicit user work for omitted stream payloads, not a hidden route-open timer. Route-open viewed-state persistence must only run when it changes unread state: skip tasks with no event timestamp, and skip tasks whose preview/cached task event timestamp is already covered by `lastViewedAt` or a local deferred viewed write. Lightweight task DTOs may carry bounded `execution.events` / HyperPlan sub-execution `events` plus `omittedEventCount`; renderers must pass that count into `InlineMessages` only when `openade/task/read` full-history hydration is actually available, so users can request full history without pretending the bounded array is complete or creating a denied hidden task read. Revealing cached older task-event rows in `components/EventLog` must stay local and must not call `openade/task/read` with `hydrateSessionEvents: true`; only omitted stream-event controls should request full hydration. `TaskModel.stats` should prefer runtime preview usage when available instead of rescanning full task history for navbar stats. `components/EventLog` and `components/InlineMessages` should render long histories tail-first before parsing/rendering older records and lazy-mount collapsed row/pill content; do not eagerly parse or mount all historical tool output, diffs, stderr, or markdown just because the latest task event auto-expands.
Runtime-backed classic task routes must not fetch project git-info, task git summary, task changes, SDK capabilities, MCP settings, or file/search trees just because `TaskPage` mounted. They also must not install the legacy 20s working-task git-status polling loop or run the legacy `TaskModel` after-event git refresh; Core-backed sessions should load task git state from explicit tray/user actions and runtime notifications, not from route/model-owned background polling. Direct Core task URLs should stay task-only after first paint: `CodeLayout` may initialize cheap shell probes and Core-backed personal settings for theme/defaults, but must not kick off broad `initializeStores()` project-list/snapshot work until the user enters a route or action that needs broader shell state. Use `TaskModel.taskWorkingDirHint` when UI surfaces need a stable repo/task-scoped directory identity without loading `TaskEnvironment`; load git/env/SDK/MCP/file/search data from explicit tray, connector-picker, slash-command, file-mention, or setup interactions.
Runtime-backed `Commit & Push` is an explicit user action, so it may stay reachable while task git state is unknown and then refresh scoped task git state on click before building the commit prompt. If Core owns product state but the runtime product API is not attached yet, stale command handlers must no-op instead of clearing input or starting a turn from stale/unknown git state. Do not restore route-open git polling merely to decide whether that button should appear.
`TaskManager.markTaskViewed()` intentionally throttles per-task `lastViewedAt` writes so route/render churn does not repeatedly save multi-megabyte runtime task documents. Runtime-backed task route opens should call it with `{ defer: true }`, which patches the runtime DTO cache immediately for unread UI and delays/coalesces persistence so task switching is not blocked by `openade/task/metadata/update`. Keep the interval long enough to absorb duplicate navigation effects, and do not bypass it from task route components.
`OpenADEProductStore.updateTaskMetadata()` patches `lastViewedAt` into cached task/preview DTOs without a follow-up task read, and `openade/task/previewChanged` notifications refresh the snapshot without also re-reading task detail. Identical concurrent metadata updates should stay in-flight coalesced so route/effect churn cannot send duplicate `openade/task/metadata/update` writes before the first request settles. Keep this split so sidebar metadata changes do not load full task documents.
Legacy `TaskPage` may still load the task environment independently from git-summary refresh, but runtime-backed `TaskPage` should not. Runtime-backed file mentions, Files/Search trays, Git Log, Terminal, and Processes should use `TaskModel.taskWorkingDirHint` or explicit tray/user-triggered environment loads so task open stays on the lightweight DTO path. For prepared Core-backed worktree tasks, prefer the completed setup event `workingDir` as the hint instead of loading project git-info just to derive the worktree subdirectory path.
`TaskModel.refreshGitState()` has a short fresh-result window for route/focus churn. Use `{ force: true }` only for explicit user actions that need current git status, such as opening Changes or closing Terminal.
`StatsTab` must not automatically backfill missing usage by loading historical task documents from a mount/effect path. Keep usage backfill explicit user work so opening settings or receiving a snapshot update cannot create a background burst of full task reads and metadata writes. In Core-owned product runtime sessions, StatsTab must call `CodeStore.backfillTaskUsagePreviews()`, which groups by repo and calls `OpenADEProductStore.backfillTaskUsage()` / `openade/task/usage/backfill` only when `OPENADE_METHOD.taskUsageBackfill` is advertised, so Core scans SQLite events and persists preview usage without issuing one runtime request per task. Renderer-side `computeTaskUsage()` over full task events is legacy/runtime-compat fallback only and must fail closed from `OPENADE_METHOD.taskMetadataUpdate` before writing computed usage.

Shared host panels live under `shell/project` and `shell/task`. Remote project file/search/process controls, including process reconnect/output viewing, must stay on the scoped product methods exposed by `kernel/productStore.ts`; raw `fs/*`, `host/*`, `process/*`, and `host/procs/*` are desktop/trusted-only. Remote task changes and diffs plus snapshot patch index/slice browsing must use scoped task product read methods from `kernel/productStore.ts`; raw `git/*`, `fs/*`, and legacy snapshot file APIs are trusted-local only, and commit/push controls need explicit permission gates before they appear in remote shells. Remote task opening should not eagerly call task changes/log/snapshot reads; keep git and patch panels explicit so task switches remain bounded task DTO reads.
Shared shell capability projection lives in `shell/capabilities.ts`. When adding a shared project/task/settings control or a new paired-safe product method, update that builder and its focused test instead of rebuilding method-to-boolean maps inside `remote/RemoteApp.tsx` or medium-specific screens. `OpenADEShell` should receive the single `OpenADEShellCapabilities` object and adapt it to narrower child-panel capability props, so medium adapters do not grow parallel shell prop lists. Runtime callers can still use the generated `OPENADE_METHOD` constants directly for stale-handler backstops, but visible shared-shell controls should derive from the shared projection so desktop, web, and mobile attachments do not drift.
Shared project creation may use trusted `openade/repo/path/inspect` when the attached runtime advertises it, but it must remain optional and absent from paired-safe profiles by default. `ProjectsScreen` should validate paths through the shell-projected capability before `openade/repo/create` only when available; runtimes without inspection keep the create-only path and must not issue hidden denied inspect requests.

Medium chrome and companion-local session screens belong in `shell` rather than in product/session containers. Use `shell/OpenADEShell.tsx` for remote project/task/new-task/session/settings route composition, `shell/OpenADEChrome.tsx` for responsive header/status/notices/navigation, `shell/RemotePairingScreen.tsx` for pairing/connect UI, and `shell/OpenADESessionScreens.tsx` for saved-session management, self-revoke, and shell theme selection so `remote/RemoteApp.tsx` can stay focused on pairing, session state, runtime refresh, and action handlers. These are remote adapter surfaces, not the desktop design source. Do not add a separate mobile product UI; mobile should eventually use desktop-derived shared components rather than preserving companion-only screens.

Shared project/task screens also live under `shell/project` and `shell/task`. Use `shell/project/ProjectsScreen.tsx` for OpenADE snapshot-backed project/session lists, `shell/project/ProjectTasksScreen.tsx` for project task lists plus scoped host panels, and `shell/task/NewTaskScreen.tsx` for remote/shared task creation forms. The desktop `TaskCreatePage` remains the production create route until `NewTaskScreen` or a shared create shell preserves desktop parity: SmartEditor file mentions/slash commands, image attachments, richer MCP selection, harness/model/thinking/fast-mode controls, rich drafts, pending creation state, and the full desktop shortcut set. `NewTaskScreen` already has capability-gated branch/worktree selection through `openade/project/git/branches/read`, last-used worktree source-branch preference, lightweight HyperPlan preset selection that sends `hyperplanStrategy` through `openade/turn/start`, Create More behavior that stays on New Task after real `openade/task/create` plus optional `openade/turn/start`, per-repo sticky Create More preference, background multi-pending Create More submission, basic desktop-style create-mode/Create More shortcuts, local draft stash/restore for title/prompt/mode/isolation/agent/MCP settings, same-session image-backed draft stashes after `openade/task/image/write`, and pending creation visibility with retry/dismiss/cancel/open-ready controls for shared remote task creation; keep branch loading lazy/manual and do not reintroduce eager git reads on screen open. Image draft preview URLs and image ids must not be persisted in remote localStorage; cross-session durable image-byte draft persistence still needs an explicit product/runtime format. Full desktop parity still requires the desktop-level strategy/editor affordances before replacing `TaskCreatePage`. Do not add another mobile-only project-list, project-task, or task-create screen unless a medium-specific adapter is genuinely required.

## Task Lifecycle

1. **Create** - User enters description, selects branch, chooses isolation strategy
2. **Setup** - Worktree created (if worktree mode), setup script runs
3. **Plan/Do** - Claude generates plan or executes directly
4. **Revise** - User leaves inline comments, Claude updates plan
5. **Execute** - Approved plan runs

## Isolation Strategies

Set at task creation, immutable:

| Strategy | Behavior |
|----------|----------|
| `worktree` | Isolated git worktree from source branch |
| `head` | Work directly in repo, no isolation |

## Event Types

| Type | What It Is |
|------|------------|
| `action` | LLM execution (plan/revise/review/do/ask/run_plan) |
| `setup_environment` | Worktree setup completed |
| `snapshot` | Frozen code state after action |

## Input Commands

`InputManager` computes available commands based on task state:

- **Stop** - Abort the current task execution (single-query and HyperPlan multi-agent runs)
- **Plan** - Generate new plan
- **Revise** - Update plan with feedback
- **Review Plan** - Launch external read-only review of the active plan (harness/model picker), then auto-handoff notes back to main thread
- **Run Plan** - Execute approved plan
- **Do** - Direct execution
- **Repeat** - Repeatedly sends the same prompt until stopped; optional stop-on-text halts on match
- **Ask** - Read-only exploration
- **Review** - Launch external read-only review of recent work (when no active plan), then auto-handoff notes back to main thread
- Review follow-up handoffs should require a `Criticality: N/10` score for each finding so users can judge whether the fix is worth the engineering effort
- Review events may persist the generated reviewer instructions on `source.userInstructions` so the exact prompt can be copied from the event log
- **Commit & Push** - Git commit (if needed) and push in one flow (accepts optional additional commit instructions from the editor)

## Comment System

Users leave inline comments on plans, diffs, code. Comments are "consumed" when sent to Claude:

1. Pending comments are editable
2. On action, pending comments included in prompt
3. `ActionEvent.includesCommentIds` tracks what was sent
4. Consumed comments become read-only

## Design System

**Philosophy: Flat, square, clean, spacious.** No rounded corners.

**IMPORTANT: All `<button>` elements must include the `btn` class.** The code module uses a low-specificity CSS reset (`.btn { all: unset }` in `tw.css`) to clear inherited browser/dashboard button styles. Without `btn`, buttons may render with unexpected padding, borders, or backgrounds.

**IMPORTANT: Always read `tw.css` before working with colors.** The code module has its own standalone theme system. Only use color tokens defined in `tw.css`. Never use legacy color tokens from the dashboard's `src/tw.css` or any other color system unless explicitly asked.

### Theme System

The code module supports multiple themes: `code-theme-light`, `code-theme-dark`, `code-theme-black`, `code-theme-synthwave` (applied in `CodeAppLayout.tsx`). Theme selection is managed via Settings → Vibes tab.

Key rule: `bg-{color}` pairs with `text-{color}-content`.

**Adding a new theme requires:**
1. Add CSS class in `tw.css` with `--editor-theme` and `--terminal-theme` variables
2. Register in `persistence/personalSettingsStore.ts`
3. (Optional) Add new terminal palette in `themes/terminalThemes.ts` if existing ones don't match

See `_docs/design.md` → "Adding a New Theme" for details.

**Portal elements** (dropdowns, modals, popups) must use `usePortalContainer()` hook to render inside the themed container:

```tsx
import { usePortalContainer } from "../hooks/usePortalContainer"

const portalContainer = usePortalContainer()
<SelectBase.Portal container={portalContainer}>...</SelectBase.Portal>
```

See `_docs/design.md` for full patterns and `tw.css` for color definitions.

## Data Folder (Unified Storage)

Files are stored at `~/.openade/data/{folder}/{id}.{ext}` through trusted local runtime methods:
- `data/file/save` — atomic write (temp+rename)
- `data/file/load` — returns base64 payload or null through the runtime wrapper
- `data/file/delete` — best-effort unlink

Allowed folders: `images`, `snapshots`, `cron`. Web side uses `dataFolderApi` from `electronAPI/dataFolder.ts` for trusted local generic blobs and legacy task-image fallback. Runtime-backed task image upload must go through `CodeStore.persistProductTaskImage()` and `OpenADEProductStore.writeTaskImage()` so Core or the product runtime owns the bytes before `openade/turn/start` receives image references. Classic event image thumbnails and shared/remote task image rendering must use `CodeStore.readProductTaskImage()` / `openade/task/image/read` whenever the runtime product API is active; that product method verifies the image is referenced by the task before loading bytes. Pending SmartEditor stashed previews should use `CodeStore.readProductStagedTaskImage()` / `openade/task/image/staged/read` for unreferenced staged blobs and fall back to `dataFolderApi` only for legacy/unscoped drafts. `OpenADEProductStore` keeps very short completed-result caches for task image and staged-image reads, clears task image entries on task/repo deletion and task update notifications, and patches staged-image cache entries from accepted `writeTaskImage()` results. Snapshot diffs use trusted runtime methods in `electronAPI/snapshots.ts` that store `{id}.patch` plus `{id}.json`, load the index first, and range-read only the selected file slice.

### Image Attachments

Users can paste images (Cmd+V) or click the attach button. Flow:
1. **Capture**: Paste handler or file input → `processImageBlob()` in `utils/imageAttachment.ts`
2. **Resize**: `resizeImage()` constrains to 1568px max dimension / 1.15MP (configurable in `IMAGE_CONSTRAINTS`)
3. **Store**: Resized bytes go through the caller-provided `persistImage` callback. Runtime-backed task/create screens call `CodeStore.persistProductTaskImage()` → `openade/task/image/write`; legacy or unscoped editors fall back to `~/.openade/data/images/{ulid}.{ext}`.
4. **Submit**: `SmartEditorManager.pendingImages` → `InputManager.captureAndClear()` → `openade-client` → `openade/turn/start`
5. **Prompt**: Runtime host loads stored product image bytes, base64-encodes them, and sends `ContentBlock[]` to the harness provider
6. **Render**: `ActionEvent.images` → `ImageAttachments` loads referenced images through `openade/task/image/read`; pending stashed previews use `openade/task/image/staged/read`; legacy/unscoped paths load from disk

The `UserInputContext` type bundles `userInput` + `images` and threads from UI through execution to prompt building. `PromptBuildContext` extends it with `comments`.

## Settings & Environment Variables

User settings managed via Settings modal (accessed from sidebar). Uses `PersonalSettingsStore`; Core-owned product runtime sessions back it with product settings APIs, while legacy desktop fallback still uses Yjs persistence.
The new task page's last selected harness/model also lives in personal settings so it survives renderer refreshes.

### Environment Variables

Custom env vars automatically propagate to the product backend that owns subprocesses.

For legacy/Electron fallback sessions, env vars propagate to **all Electron subprocess calls**:
- Terminal PTYs (`pty.ts`)
- Process handles (`process.ts`)
- Git operations (`git.ts`)
- File search (`files.ts`)
- Binary checks (`platform.ts`)

**How it works:**

1. User configures env vars in Settings modal
2. `CodeStore.initializeStores()` pushes env vars to Electron through trusted runtime method `host/subprocess/setGlobalEnv`
3. MobX reaction pushes updates whenever env vars change
4. Electron's `subprocess.ts` caches env vars and merges them into all subprocess calls

For Core-owned product runtime sessions, `personalSettingsStore` is backed by `openade/settings/personal/*`; Core reads those SQLite settings and applies env vars to Core-owned subprocesses. Do not call Electron `host/subprocess/setGlobalEnv` from Core-owned startup or settings reactions.

**No manual env var passing needed on dashboard side.** Backend subprocess modules automatically include global env vars. The legacy Electron merge order is:
- `process.env` (system)
- `globalEnvVars` (user settings from Settings modal)
- `params.env` (call-specific, for future use)

### Key Files

| File | Purpose |
|------|---------|
| `persistence/personalSettingsStore.ts` | YJS store for personal settings |
| `persistence/personalSettingsStoreBootstrap.ts` | Store connection setup |
| `components/settings/SettingsModal.tsx` | Settings modal with sidebar tabs |
| `components/settings/SystemConfigTab.tsx` | Binary status, env vars editor |
| `electronAPI/subprocess.ts` | Global env vars push through local runtime |

## MCP Connectors

MCP (Model Context Protocol) servers extend Claude's capabilities. Managed via `ConnectorsPage` and `TaskMcpSelector`.

MCP test/OAuth operations go through trusted runtime methods in `electronAPI/mcp.ts`; OAuth completion is delivered by runtime notification `host/mcp/oauthComplete`. Keep `electronAPI/mcp.test.ts` on the production `runtime/localRuntimeClient.ts` bridge with a real `RuntimeServer` when changing this path.

### Presets

Presets are defined in `constants.ts` with `simple-icons` for brand icons:

```typescript
import { siNotion } from "simple-icons"

export const MCP_PRESETS = {
    notion: {
        id: "notion",
        name: "Notion",
        description: "Access pages, databases, and workspace content",
        transportType: "http",
        url: "https://mcp.notion.com/mcp",
        icon: siNotion,
    },
    // ...
}
```

To add a preset:
1. Find the icon at https://simpleicons.org
2. Import it: `import { siIconname } from "simple-icons"`
3. Add the preset with verified URL

### Key Components

| Component | Purpose |
|-----------|---------|
| `ConnectorsPage` | Global connector management (install/remove/connect) |
| `TaskMcpSelector` | Per-task connector selection (compact chips) |
| `McpServerIcon` | Renders brand icon or fallback Globe/Terminal |
| `AddMcpServerModal` | Custom server configuration form |

### Local UI Components

The code module has its own Modal components in `components/ui/`:
- `Modal` - Base modal with flat, square design
- `ModalConfirm` - Confirmation dialog for destructive actions

Import from `../components/ui` not `@/funktionalChat/components`.

## Key Files

| Purpose | File |
|---------|------|
| Data types, CRUD | `api.ts` |
| Prompt templates | `prompts/prompts.ts` |
| Review prompt templates and handoff text | `projects/openade-module/src/review.ts` |
| Task thread serializer (Task -> JSON/XML, supports bounded export via `maxEvents`) | `prompts/taskThreadSerializer.ts` |
| XML helpers | `utils/makeXML.ts` |
| Local routing | `routing.ts` |
| MCP presets & icons | `constants.ts` |
| Model catalog (from harness) | `constants.ts` (re-exports from `@openade/harness`; source of truth is `projects/harness/src/models.ts`) |
| Store coordinator | `store/store.ts` |
| Task observable | `store/TaskModel.ts` |
| Harness execution | `store/managers/ExecutionManager.ts` |
| Available commands | `store/managers/InputManager.ts` |
| MCP server manager | `store/managers/McpServerManager.ts` |
| Harness runtime bridge | `electronAPI/harnessQuery.ts` |
| Harness event types | `electronAPI/harnessEventTypes.ts` |
| Harness event compat | `electronAPI/harnessEventCompat.ts` |
| Git runtime bridge | `electronAPI/git.ts` |
| Shell IPC | `electronAPI/shell.ts` |
| Data folder runtime bridge | `electronAPI/dataFolder.ts` |
| Image resize utility | `utils/imageResize.ts` |
| Image attachment pipeline | `utils/imageAttachment.ts` |
| Image lightbox | `components/ui/ImageLightbox.tsx` |
| Image thumbnails (events) | `components/events/ImageAttachments.tsx` |
| Portal container hook | `hooks/usePortalContainer.tsx` |
| Terminal themes | `themes/terminalThemes.ts` |
| Terminal theme hook | `hooks/useTerminalTheme.ts` |

HyperPlan planning can pass serialized main-thread context to sub-planners using `prompts/taskThreadSerializer.ts`.
HyperPlan execution is server-owned through the OpenADE runtime module. The renderer may define/select strategies and display persisted sub-executions, but it must not reintroduce a renderer-owned HyperPlan executor or direct harness orchestration path.
This context is capped by UTF-8 byte budget (default `240_000`) and includes the newest events that fit.

Model version bumps should be made in `projects/harness/src/models.ts`. Web pickers and execution helpers read from that shared catalog, so avoid hardcoding new model versions in web components.

## MobX Patterns

### Disposer Pattern

Classes with subscriptions store disposers:

```typescript
class TaskModel {
    private disposers: Array<() => void> = []

    constructor() {
        this.disposers.push(
            this.store.execution.onAfterEvent((id) => { ... })
        )
    }

    dispose(): void {
        for (const d of this.disposers) d()
        this.disposers = []
    }
}
```

Call `TaskManager.invalidateTaskModel(taskId)` when task changes significantly.

### Event Hooks

ExecutionManager only broadcasts after-event notifications now. Server-owned runtime notifications refresh Yjs task state and call `onAfterEvent()` subscribers when a task leaves the working set.


## Access Control

- **Admin only** - `isAdmin` check
- **Electron only** - `"require" in window` check
- **Feature flag** - `ENABLE_CODE_MODULE`

## Detailed Documentation

| Topic | Doc |
|-------|-----|
| Data models | [`_docs/data-models.md`](_docs/data-models.md) |
| Store architecture | [`_docs/store-architecture.md`](_docs/store-architecture.md) |
| Electron API | [`_docs/electron-api.md`](_docs/electron-api.md) |
| Prompts system | [`_docs/prompts.md`](_docs/prompts.md) |
| Design system | [`_docs/design.md`](_docs/design.md) |

## Keeping This Document Updated

This document (and its subdocs in `_docs/`) should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
