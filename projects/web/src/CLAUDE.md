# Code Module

Task planning and execution system with pluggable AI harnesses (`@openade/harness`). Supports multiple execution engines (Claude Code, Codex, etc.) through a unified interface. Users describe tasks, the AI generates plans, users can review/revise before execution.

This is a TypeScript-first codebase. When fixing type errors, focus on proper TypeScript solutions rather than workarounds.


## Tray System

Slide-out panels (Files, Search, Changes, Terminal, Processes) managed by `TrayManager`. Each tray type is defined declaratively in `components/tray/trayConfigs.tsx`.

Diff rendering uses `@pierre/diffs` under `components/FilesAndDiffs.tsx`, with `DiffsWorkerProvider` mounted at the code-app root so syntax highlighting runs off the main thread. The Changes tray must stay on the lightweight git-summary path (`getGitSummary()` locally, `readProductTaskGitSummary()` under runtime product reads) until a specific file is selected.

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

Run React Doctor from `projects/web` when changing React state, effects, accessibility, security-sensitive rendering, or shared shell UI. Use [`../doctor.config.json`](../doctor.config.json) as the project baseline: cleanup, fresh effect dependencies, mutable deps, and unsafe rendering are blocking errors; ambiguous prop-to-state reset findings remain warnings until they are reviewed with behavior coverage. The scoped `MarkdownMessage.tsx` `no-danger` override depends on DOMPurify sanitization and the adjacent Biome suppressions in that file. Do not mass-fix the full backlog without targeted tests or a browser/runtime verification for the affected workflow.

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

Task execution goes through the OpenADE runtime module (`openade/turn/start`, `openade/review/start`, `openade/turn/interrupt`). Durable repo/task/comment/task-metadata/queued-turn/environment mutations should enter through `CodeStore` product helpers; those helpers use the injected `OpenADEProductStore` when runtime product reads are active and `runtime/localOpenADEClient.ts` only as the legacy fallback. Use `getHarnessQueryManager()` only for low-level harness helpers that are not task turns, such as small JSON-constrained helpers (cron generation, config suggestions).

Low-level harness IPC event/query types and harness install status DTOs come from `@openade/harness/browser` as `HarnessIpc*` and `HarnessInstallStatus`; `electronAPI/harnessEventTypes.ts` and `electronAPI/harnessStatus.ts` may keep renderer helper functions, runtime response normalizers, and compatibility aliases, but they must not redeclare the Electron/runtime harness bridge contracts.

Companion device administration in desktop settings should use `electronAPI/companion.ts` wrappers backed by `runtime/localRuntimeClient.ts` for `remote/device/list`, `remote/device/revoke`, and `remote/device/dropAll`. Keep native companion enablement, pairing, keep-awake, and bound-URL state on narrow Electron IPC because those are shell adapter responsibilities.

`CodeStore` has a default-on runtime product read bridge controlled by `VITE_OPENADE_ENABLE_RUNTIME_PRODUCT_STORE` or `CodeStoreConfig.enableRuntimeProductStore`; explicit false values still disable it. It hydrates `runtimeProductSnapshot` and task DTOs from `kernel/productStore.ts`; when a runtime snapshot is cached, `RepoManager.repos`, `CodeStore.getTaskPreviewsForRepo()`, `CodeLayout` task loading, and `TaskModel` reads should keep serving runtime DTOs even during transient bridge errors, otherwise they fall back to legacy Yjs stores. Runtime product notification tests should inject a real `RuntimeLocalClient` through `CodeStoreConfig.runtimeNotificationSource`; production desktop still uses `runtime/localRuntimeClient.ts` by default. Desktop route coverage for this bridge belongs in `Routes.runtimeProductStore.test.ts` and should install a real `RuntimeServer` behind the production `runtime/localRuntimeClient.ts` path instead of manually seeding `CodeStore` state. Reset cached Electron capability/platform state with the test-only reset helpers after installing a fake `window.openadeAPI`. Runtime-settlement after-event behavior must scan the unified `TaskManager` task view after refresh so DTO-backed and Yjs-backed tasks stay equivalent.

`kernel/sessionStore.ts` owns browser-safe saved kernel session persistence, including active-session switching, legacy single-session migration, and invalid-session filtering; companion-specific storage keys and change events should wrap that helper instead of reimplementing config parsing in `remote/client.ts`. `kernel/productStore.ts` is also the shared client boundary for scoped project files/search/processes, scoped project git info/branch/summary reads, scoped task terminals, scoped task git scopes/reads/commit, scoped task image reads, scoped task resource inventory reads, scoped task title generation, and scoped snapshot patch reads. OpenADE product DTO types come from `projects/openade-module/src`; do not add `Remote*` companion aliases for product DTOs. `persistence/repoStore.ts` stores `OpenADETaskPreview` values directly for legacy Yjs compatibility; do not re-add `TaskPreview`, last-event, or usage aliases in web code, and have settings/sidebar utilities consume OpenADE DTOs or narrow inputs derived from them. The existing desktop UI is the canonical product surface: runtime-backed desktop routes should keep `pages/TaskPage.tsx`, `TaskCreatePage`, `InputBar`, trays, shortcuts, settings, and desktop navigation behavior while replacing direct Yjs/local host assumptions with `OpenADEClient` and scoped runtime APIs. Shared UI must be desktop-derived. Do not ship `RemoteApp`, `OpenADEShell`, `TaskScreen`, `NewTaskScreen`, or compact companion screens as desktop replacements unless they first match classic desktop look and functionality. Under runtime-backed reads, classic `InputBar` command execution must use `CodeStore.startProductTurn()` and refresh runtime DTOs through `CodeStore.refreshRuntimeProductSnapshot()` and `CodeStore.refreshRuntimeProductTaskForTaskId()` instead of forcing `getTaskStore()` or other direct renderer Yjs reads. Classic repo-level git info used by `RepoManager` and `TaskCreatePage` should use `CodeStore.readProductProjectGitInfo()`, `readProductProjectGitBranches()`, and `readProductProjectGitSummary()` when runtime-backed reads are active; raw `gitApi.isGitDirectory()`, `listBranches()`, `getGitSummary()`, and `checkGhCli()` are legacy/trusted-local fallback only. Classic desktop git status should use `CodeStore.readProductTaskGitSummary()`; classic desktop changes tray reads should use `CodeStore.readProductTaskChanges()`, `readProductTaskDiff()`, and `readProductTaskFilePair()` through `TaskModel`/`ChangesManager`; raw `gitApi` summary, file-list, file-pair, and patch reads are the trusted-local fallback only. Classic desktop Git Log task-scope discovery should use `CodeStore.readProductTaskGitScopes()`, and task branch/worktree history should use `CodeStore.readProductTaskGitLog()`, `readProductTaskGitCommitFiles()`, `readProductTaskGitFileAtTreeish()`, and `readProductTaskGitCommitFilePatch()` for commit history/details; raw `gitApi` branch/worktree/log/detail calls are the trusted-local fallback only for legacy or unscoped contexts. Classic desktop task metadata, environment, comment, review, queued-turn, repeat/cron turn, task creation, and deletion mutations should use `CodeStore` product helpers plus `refreshProductStateAfterTaskMutation()`, `refreshProductStateAfterTaskCreation()`, or `refreshProductStateAfterTaskDeletion()` so runtime-backed paths avoid legacy task-store/repo-store refreshes while the fallback path stays intact. Classic repo creation, update, archive, and deletion should use `CodeStore.createProductRepo()`, `updateProductRepo()`, `deleteProductRepo()`, and `refreshProductStateAfterRepoMutation()` so runtime-backed paths avoid legacy repo-store refreshes. Runtime notifications and runtime-settlement refreshes must also stay on runtime DTO helpers when `CodeStore.shouldUseRuntimeProductReads()` is true; do not route normal runtime-active notifications through `refreshRepoStoreFromStorage()` or `refreshTaskStoreFromStorage()`. Classic read helpers such as delete-resource inventory should use `CodeStore.readProductTaskResourceInventory()` when runtime-backed reads are active; task title generation/regeneration should use `CodeStore.generateProductTaskTitle()` in runtime-backed contexts and `prompts/titleExtractor.generateTitle()` only as the legacy trusted-local fallback; sidebar copy-path should use `CodeStore.loadProductTaskForRead()` before any legacy task-store path. The desktop shared-screen flag and `DesktopShared*` route files were removed; do not reintroduce a desktop route that promotes compact remote/mobile shell screens. Runtime product rollout observability is emitted from `CodeStore`: `app_opened` includes runtime-product gate/status fields, `runtime_product_store_error` records sanitized bridge error categories, and `runtime_product_store_fallback` records deduped legacy direct-read fallbacks without repo paths or task content. `analytics/analytics.ts` records those real `track()` calls to local storage only when Electron preload exposes `openadeAPI.app.smokeTest`, and packaged smoke must run `npm run review:runtime-product-rollout` against that export. Before broad rollout or fallback removal, run `npm run review:runtime-product-rollout -- <telemetry-export.json-or-ndjson>` from `projects/web` against the internal/default-on cohort export and require a passing report. Extend `store/storeRuntimeProductStore.test.ts` with real `RuntimeServer`/`OpenADEClient` checks for each bridge slice and keep old-vs-new Yjs projection parity in Electron/OpenADE module fixture tests before removing fallback Yjs direct reads.

Classic desktop environment setup should use `CodeStore.prepareProductTaskEnvironment()` when runtime-backed reads are active. `EnvironmentSetupView` may keep `TaskEnvironment.setup()` and raw `gitApi` calls only as trusted-local fallback paths for legacy/unscoped operation. `TaskEnvironment` should stay limited to environment derivation plus the lightweight legacy git-summary/setup fallbacks; do not re-add raw patch, file-pair, changed-file, or full-status helpers there. Use `TaskModel`/`ChangesManager` scoped product methods or explicit legacy fallback managers instead.

Pending task creation cancellation must not clean up worktrees through renderer `gitApi`. If the server has accepted a task, cancel through `CodeStore.interruptProductTurn()` and `CodeStore.deleteProductTask()` so OpenADE host adapters own task resource cleanup.

Classic desktop snapshot event patch/index/slice reads should go through `CodeStore.readProductTaskSnapshotPatch()`, `readProductTaskSnapshotIndex()`, and `readProductTaskSnapshotPatchSlice()` whenever runtime-backed reads are active; `electronAPI/snapshots.ts` is only the trusted-local fallback for legacy/unscoped paths.

Classic desktop Files tray directory reads, file reads, and filename fuzzy search should use `CodeStore.listProductProjectFiles()`, `readProductProjectFile()`, and `fuzzySearchProductProjectFiles()` with the active task id when runtime-backed reads are active. Classic desktop Search tray content search and file preview should use `CodeStore.searchProductProject()` and `readProductProjectFile()` with the active task id in the same runtime-backed path. Classic SmartEditor file mentions and tracked-file validation should go through `SmartEditorManager` so task editors use `CodeStore.fuzzySearchProductProjectFiles()` with the active task id and task-create/scratchpad editors use the same product method with the repo id. `electronAPI/files.ts` is only the trusted-local fallback for legacy/unscoped paths; do not add new direct `filesApi` calls for task-owned file/search behavior or React editor components.

Classic desktop Terminal tray sessions should use `CodeStore.startProductTaskTerminal()`, `reconnectProductTaskTerminal()`, `writeProductTaskTerminal()`, `resizeProductTaskTerminal()`, and `stopProductTaskTerminal()` whenever runtime-backed reads are active. The xterm component may use `components/terminalSession.ts` as the transport adapter, but direct `PtyHandle`/raw `pty/*` access belongs only in that adapter as the trusted-local fallback for legacy/unscoped terminal contexts.

Classic desktop Processes tray actions should use `CodeStore.listProductProjectProcesses()`, `startProductProjectProcess()`, `reconnectProductProjectProcess()`, and `stopProductProjectProcess()` whenever runtime-backed reads are active. Classic cron config refresh should read parsed `openade.toml` config groups from `CodeStore.listProductProjectProcesses()` in the same runtime-backed path. Raw `host/procs/*` reads and direct `ProcessHandle` starts/stops are trusted-local fallback paths only.
When closing a worktree task, `InputManager` must pass scoped product process access into `RepoProcessesManager.stopAllForContext()` under runtime-backed reads so runtime-owned processes are stopped through `openade/project/process/stop` rather than only removed from renderer state.

Shared task shell primitives live under `shell/task`, but desktop parity is the gate. Desktop and remote task-thread scroll behavior should use `shell/task/useTaskThreadScroll.ts` instead of reimplementing bottom-follow or jump-to-latest behavior in medium-specific pages. Task event DTO presentation can use `shell/task/taskEventPresentation.ts` and `shell/task/TaskEventThread.tsx` only where it preserves classic desktop rendering behavior. Task command labels, composer ordering, and "queue while running" rules should use `shell/task/taskCommands.ts`; full command ids, labels, ordering, grouping, visibility, and enablement should use `shell/task/taskCommandModel.ts`. New task composer UI under `shell/task/TaskComposer.tsx` is not a desktop replacement for `InputBar`; extract from or slot in the rich desktop composer so SmartEditor, attachments, desktop tray buttons, shortcuts, and desktop-only affordances remain intact. Desktop route smoke must verify those controls reach `openade/turn/start` through the real local runtime path. Task title/close/delete, review, queued-turn, comments, and scoped git controls can share `shell/task/TaskProductPanel.tsx` only after desktop behavior parity is covered. Do not use `shell/task/TaskScreen.tsx` as the default desktop route until it matches the classic desktop task page.

Classic desktop task event streams must keep task opening responsive. Runtime-backed task-route and notification refreshes should read persisted task data first with `hydrateSessionEvents: false`; streamy `openade/task/updated` notifications should be coalesced per task before refreshing, and session-history hydration must be explicit user work such as expanding earlier history, not a hidden route-open timer. Lightweight task DTOs may carry bounded `execution.events` / HyperPlan sub-execution `events` plus `omittedEventCount`; renderers must pass that count into `InlineMessages` so users can request full history without pretending the bounded array is complete. `TaskModel.stats` should prefer runtime preview usage when available instead of rescanning full task history for navbar stats. `components/EventLog` and `components/InlineMessages` should render long histories tail-first before parsing/rendering older records and lazy-mount collapsed row/pill content; do not eagerly parse or mount all historical tool output, diffs, stderr, or markdown just because the latest task event auto-expands.
The classic `TaskPage` must still load the task environment independently from git-summary refresh so file mentions, Files/Search trays, Git Log, Terminal, and Processes get a working directory through runtime-backed scoped APIs without reintroducing hidden full-history hydration.

Shared host panels live under `shell/project` and `shell/task`. Remote project file/search/process controls, including process reconnect/output viewing, must stay on the scoped product methods exposed by `kernel/productStore.ts`; raw `fs/*`, `host/*`, `process/*`, and `host/procs/*` are desktop/trusted-only. Remote task changes and diffs must use scoped task git read methods from `kernel/productStore.ts`; raw `git/*` is trusted-local only, and commit/push controls need explicit permission gates before they appear in remote shells.

Medium chrome and companion-local session screens belong in `shell` rather than in product/session containers. Use `shell/OpenADEShell.tsx` for remote project/task/new-task/session/settings route composition, `shell/OpenADEChrome.tsx` for responsive header/status/notices/navigation, `shell/RemotePairingScreen.tsx` for pairing/connect UI, and `shell/OpenADESessionScreens.tsx` for saved-session management, self-revoke, and shell theme selection so `remote/RemoteApp.tsx` can stay focused on pairing, session state, runtime refresh, and action handlers. These are remote adapter surfaces, not the desktop design source. Do not add a separate mobile product UI; mobile should eventually use desktop-derived shared components rather than preserving companion-only screens.

Shared project/task screens also live under `shell/project` and `shell/task`. Use `shell/project/ProjectsScreen.tsx` for OpenADE snapshot-backed project/session lists, `shell/project/ProjectTasksScreen.tsx` for project task lists plus scoped host panels, and `shell/task/NewTaskScreen.tsx` for remote/shared task creation forms. The desktop `TaskCreatePage` remains the production create route until `NewTaskScreen` or a shared create shell preserves desktop parity: SmartEditor file mentions/slash commands, image attachments, MCP selection, harness/model/thinking/fast-mode controls, branch/worktree selection, drafts, pending creation state, shortcuts, create-more behavior, and HyperPlan strategy selection. Do not add another mobile-only project-list, project-task, or task-create screen unless a medium-specific adapter is genuinely required.

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

Allowed folders: `images`, `snapshots`, `cron`. Web side uses `dataFolderApi` from `electronAPI/dataFolder.ts` for trusted local generic blobs. Shared/remote task image rendering must use `openade/task/image/read`, which verifies the image is referenced by the task before loading bytes. Snapshot diffs use trusted runtime methods in `electronAPI/snapshots.ts` that store `{id}.patch` plus `{id}.json`, load the index first, and range-read only the selected file slice.

### Image Attachments

Users can paste images (Cmd+V) or click the attach button. Flow:
1. **Capture**: Paste handler or file input → `processImageBlob()` in `utils/imageAttachment.ts`
2. **Resize**: `resizeImage()` constrains to 1568px max dimension / 1.15MP (configurable in `IMAGE_CONSTRAINTS`)
3. **Store**: Original saved to `~/.openade/data/images/{ulid}.{ext}`, preview held as in-memory data URL
4. **Submit**: `SmartEditorManager.pendingImages` → `InputManager.captureAndClear()` → `openade-client` → `openade/turn/start`
5. **Prompt**: Runtime host loads stored image files, base64-encodes them, and sends `ContentBlock[]` to the harness provider
6. **Render**: `ActionEvent.images` → `ImageAttachments` component loads from disk, renders thumbnails with lightbox

The `UserInputContext` type bundles `userInput` + `images` and threads from UI through execution to prompt building. `PromptBuildContext` extends it with `comments`.

## Settings & Environment Variables

User settings managed via Settings modal (accessed from sidebar). Uses YJS persistence (`PersonalSettingsStore`).
The new task page's last selected harness/model also lives in personal settings so it survives renderer refreshes.

### Environment Variables

Custom env vars automatically propagate to **all Electron subprocess calls**:
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

**No manual env var passing needed on dashboard side.** Electron modules automatically include global env vars. The merge order is:
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
