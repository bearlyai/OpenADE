# Code Module

Task planning and execution system with pluggable AI harnesses (`@openade/harness`). Supports multiple execution engines (Claude Code, Codex, etc.) through a unified interface. Users describe tasks, the AI generates plans, users can review/revise before execution.

This is a TypeScript-first codebase. When fixing type errors, focus on proper TypeScript solutions rather than workarounds.


## Tray System

Slide-out panels (Files, Search, Changes, Terminal, Processes) managed by `TrayManager`. Each tray type is defined declaratively in `components/tray/trayConfigs.tsx`.

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

## Architecture

```
Routes.tsx          → Thin URL resolution, redirects to pages
CodeLayout.tsx      → Shared layout, sidebar, reconnection logic
pages/*.tsx         → Page components (TaskPage, TaskCreatePage, etc.)
store/              → MobX state management (runtime)
persistence/        → YJS-backed sync (RepoStore, TaskStore)
electronAPI/        → IPC wrappers for Electron main process
components/         → UI components
routing.ts          → Local typesafe routing (isolated from @/state/routing)
api.ts              → Data types, localStorage CRUD
prompts.ts          → Claude prompt templates
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

### Electron IPC

Dashboard (`electronAPI/`) ↔ Electron (`projects/electron/src/modules/code/`)

**All Electron APIs used in the code module must go through `electronAPI/`.** Do not import from `@/electronWindowApi` or other shared Electron utilities. This keeps the code module's dependencies isolated for easier migration.

Main modules: harness (execution via `@openade/harness`), git (worktrees, diffs), process (scripts), pty (terminal), files (search), shell (directory picker, open URL)

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
| `action` | LLM execution (plan/revise/do/ask/run_plan) |
| `setup_environment` | Worktree setup completed |
| `snapshot` | Frozen code state after action |

## Input Commands

`InputManager` computes available commands based on task state:

- **Stop** - Abort current execution
- **Plan** - Generate new plan
- **Revise** - Update plan with feedback
- **Run Plan** - Execute approved plan
- **Do** - Direct execution
- **Ask** - Read-only exploration
- **Commit** - Git commit

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

Files are stored at `~/.openade/data/{folder}/{id}.{ext}` via three IPC channels that take `folder` as a parameter:
- `code:data:save` — atomic write (temp+rename)
- `code:data:load` — returns Buffer/string or null
- `code:data:delete` — best-effort unlink

Allowed folders: `images`, `snapshots`. Web side uses `dataFolderApi` from `electronAPI/dataFolder.ts`. Snapshots use a thin wrapper (`snapshotsApi`) that delegates to `dataFolderApi` with `folder: "snapshots"`.

### Image Attachments

Users can paste images (Cmd+V) or click the attach button. Flow:
1. **Capture**: Paste handler or file input → `processImageBlob()` in `utils/imageAttachment.ts`
2. **Resize**: `resizeImage()` constrains to 1568px max dimension / 1.15MP (configurable in `IMAGE_CONSTRAINTS`)
3. **Store**: Original saved to `~/.openade/data/images/{ulid}.{ext}`, preview held as in-memory data URL
4. **Submit**: `SmartEditorManager.pendingImages` → `InputManager.captureAndClear()` → `UserInputContext` → `ExecutionManager` → prompt builders
5. **Prompt**: `buildImageContentBlocks()` loads from disk, resizes, base64-encodes → `ContentBlock[]` sent to Claude SDK
6. **Render**: `ActionEvent.images` → `ImageAttachments` component loads from disk, renders thumbnails with lightbox

The `UserInputContext` type bundles `userInput` + `images` and threads from UI through execution to prompt building. `PromptBuildContext` extends it with `comments`.

## Settings & Environment Variables

User settings managed via Settings modal (accessed from sidebar). Uses YJS persistence (`PersonalSettingsStore`).

### Environment Variables

Custom env vars automatically propagate to **all Electron subprocess calls**:
- Terminal PTYs (`pty.ts`)
- Process handles (`process.ts`)
- Git operations (`git.ts`)
- File search (`files.ts`)
- Binary checks (`platform.ts`)

**How it works:**

1. User configures env vars in Settings modal
2. `CodeStore.initializeStores()` pushes env vars to Electron via IPC
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
| `electronAPI/subprocess.ts` | Global env vars push to Electron |

## MCP Connectors

MCP (Model Context Protocol) servers extend Claude's capabilities. Managed via `ConnectorsPage` and `TaskMcpSelector`.

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
| Prompt templates | `prompts.ts` |
| Local routing | `routing.ts` |
| MCP presets & icons | `constants.ts` |
| Model catalog (from harness) | `constants.ts` (re-exports from `@openade/harness`) |
| Store coordinator | `store/store.ts` |
| Task observable | `store/TaskModel.ts` |
| Harness execution | `store/managers/ExecutionManager.ts` |
| Available commands | `store/managers/InputManager.ts` |
| MCP server manager | `store/managers/McpServerManager.ts` |
| Harness IPC | `electronAPI/harnessQuery.ts` |
| Harness event types | `electronAPI/harnessEventTypes.ts` |
| Harness event compat | `electronAPI/harnessEventCompat.ts` |
| Git IPC | `electronAPI/git.ts` |
| Shell IPC | `electronAPI/shell.ts` |
| Data folder IPC | `electronAPI/dataFolder.ts` |
| Image resize utility | `utils/imageResize.ts` |
| Image attachment pipeline | `utils/imageAttachment.ts` |
| Image lightbox | `components/ui/ImageLightbox.tsx` |
| Image thumbnails (events) | `components/events/ImageAttachments.tsx` |
| Portal container hook | `hooks/usePortalContainer.tsx` |
| Terminal themes | `themes/terminalThemes.ts` |
| Terminal theme hook | `hooks/useTerminalTheme.ts` |

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

ExecutionManager broadcasts after events complete. Use `onAfterEvent()` to subscribe - returns disposer.


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
