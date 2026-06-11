# Web Remote UI

Renderer-side remote control surface shared by the desktop-hosted mobile view and the Capacitor companion shell.

## Architecture

- Keep only explicit legacy compatibility logic in the existing renderer/Yjs store. New remote product behavior should target the selected OpenADE runtime/Core product API through `OpenADEProductStore`.
- The desktop renderer should listen to runtime OpenADE notifications and refresh runtime product DTO caches after server-owned writes. Do not add new remote paths that refresh cached Yjs documents for normal product behavior.
- Remote invalidations come from runtime OpenADE notifications; do not reintroduce renderer-origin companion event bridges.
- Remote task-detail invalidations include `openade/task/updated` and `openade/queuedTurn/updated` only when they target the currently selected task; unrelated task and queued-turn updates must not refresh the visible task. Notification-driven task and snapshot refreshes must bypass `OpenADEProductStore` completed-result caches so remote/mobile views do not keep showing stale DTOs after Core or desktop-side writes.
- Accepted remote mutations that carry a `clientRequestId` may suppress matching echo notifications with the same `clientRequestId` after `OpenADEProductStore` patches the local cache. Do not suppress untagged task notifications or tagged notifications from other request ids; those are external state changes and must still refresh through the runtime path.
- `RemoteApp.tsx` is the remote session adapter and should stay thin over `client.ts`, shared session helpers, and shared shell components.
- `projects/web/src/kernel/session.ts` owns shared pairing URL parsing, private-host validation, runtime WebSocket URL construction, runtime client caching, and OpenADE client construction. `client.ts` owns companion config persistence, `getRemoteProductStore()`, `retryRemoteRead()`, and remote-only device/session actions on top of that shared session layer.
- `projects/web/src/kernel/productStore.ts` owns runtime-backed product DTO caching and product mutations. RemoteApp product controls should call `OpenADEProductStore` through `getRemoteProductStore()` instead of bespoke companion commands or per-method `readRemote*`/`startRemote*` aliases.
- OpenADE product types should be imported directly from `projects/openade-module/src`; `projects/shared/companion` is only for companion-owned pairing/device/service DTOs.
- client.ts must cache one runtime WebSocket client per paired host id; navigation, refresh, and multiple subscriptions must not create extra sockets for the same saved credentials.
- Shared `projects/web/src/shell/task/taskEventPresentation.ts` turns task events into message and activity rows; keep remote-specific code limited to image loading and session wiring.
- Task-thread scroll behavior is shared with desktop through `projects/web/src/shell/task/useTaskThreadScroll.ts`; do not add remote-only bottom-follow logic back into `RemoteApp.tsx`.
- Task command labels, mode ordering, queueability rules, and desktop command-state descriptors are shared through `projects/web/src/shell/task/taskCommands.ts` and `projects/web/src/shell/task/taskCommandModel.ts`; do not reintroduce remote-only command label or enablement helpers.
- Remote route composition lives in `projects/web/src/shell/OpenADEShell.tsx`; `RemoteApp.tsx` should own pairing/session state, runtime refresh, and action handlers, then pass DTOs and callbacks into the shared shell wrapper. Do not add a separate mobile product UI layer; mobile is only a Capacitor/native host adapter around this shell.
- Project task lists, project file/search/git/cron/process panels, new-task form, full task route composition, task changes/resource panels, task event rendering, task composer controls, and task metadata/review/comment/queued-turn controls live under `projects/web/src/shell/*`; keep new reusable product panels there instead of adding more product-control JSX directly to `RemoteApp.tsx`.

## Data Flow

- Electron main owns companion auth and runtime transport in legacy desktop-hosted sessions. OpenADE Core is the target owner for product state, host operations, permissions, and notification filtering; do not add new companion-only product projection logic in Electron main.
- The desktop renderer is not a companion command adapter. Product commands from remote clients go through runtime WebSocket methods.
- Remote clients read snapshots, projects, task detail, and runtime updates over the `/v1/runtime` WebSocket.
- Remote product mutations include task create, turn start/interrupt, review start, queued-turn enqueue/cancel/reorder, comment create/edit/delete, task metadata update, and capability-gated plain task delete. Keep them high-level OpenADE methods; never replace them with raw Yjs or host calls. The shared New Task route must use `openade/task/create` for the task record, then optionally attach an execution through `openade/turn/start` only when that capability is granted. The running-task composer must use `openade/queued-turn/enqueue` for queueable Do/Ask input instead of relying on turn-start fallback behavior. Remote task delete must not expose cleanup flags unless a future runtime capability explicitly grants that host-cleanup permission.
- Remote project files and search use scoped `openade/project/files/tree`, `openade/project/files/fuzzySearch`, `openade/project/file/read`, and `openade/project/search` methods through `OpenADEProductStore`; do not call raw `fs/*`, `host/*`, or direct repo paths from `RemoteApp`. Keep file-tree loading and file-name fuzzy search lazy/manual from the Files panel so project opens stay on lightweight task-list DTO reads. A fuzzy-search result may read a file without first loading the whole file tree.
- Remote/shared shell panels and sub-actions must derive visibility and handlers from runtime `initialize.capabilities`. Missing base read capabilities hide the panel; missing sub-action capabilities hide or disable only that action and handlers must return before issuing a denied runtime request.
- Remote project git views use scoped `openade/project/git/info/read`, `openade/project/git/branches/read`, and `openade/project/git/summary/read` through `OpenADEProductStore`; keep this lazy/manual from the project git panel so project opens do not pay git status cost.
- Remote project cron definition views use scoped `openade/cron/definitions/read` through `OpenADEProductStore`; keep remote cron controls read-only until scheduler install-state and run-now permissions have an explicit paired-device role decision.
- Remote task change views use scoped `openade/task/changes/read`, `openade/task/diff/read`, `openade/task/filePair/read`, `openade/task/git/summary/read`, `openade/task/git/scopes/read`, `openade/task/git/log`, `openade/task/git/commit/files/read`, `openade/task/git/commit/filePatch/read`, and `openade/task/git/fileAtTreeish/read` through `OpenADEProductStore`; do not call raw `git/*` or `fs/*` from `RemoteApp`. Task opening should not eagerly load git data; keep those reads lazy/manual from the task git panel so normal task switches stay on the lightweight task DTO path.
- Remote snapshot event patch views use scoped `openade/task/snapshot/index/read` plus `openade/task/snapshot/patch/readSlice` through `OpenADEProductStore` when both capabilities are advertised, falling back to `openade/task/snapshot/patch/read` for older runtimes. Keep these reads lazy/manual from the snapshot block so task opening stays on lightweight task DTOs.
- Remote task resource views use scoped `openade/task/resourceInventory/read` through `OpenADEProductStore`; keep this lazy/manual from the task resource panel because inventory can touch runtime state and git metadata.
- Remote task terminal views are capability-gated and use scoped `openade/task/terminal/start`, `openade/task/terminal/reconnect`, `openade/task/terminal/write`, `openade/task/terminal/resize`, and `openade/task/terminal/stop` through `OpenADEProductStore` and the shared Terminal product adapter; do not call raw `pty/*` from `RemoteApp`. Keep terminal mounting lazy/manual so task opening does not start or reconnect PTYs.
- Remote project process controls and output viewing use scoped `openade/project/process/*` methods through `OpenADEProductStore`; do not call raw `process/*` or `host/procs/*` from `RemoteApp`. Project navigation should not eagerly call `openade/project/process/list`; keep process-list loading lazy/manual from the process panel or a process action so normal project opens do not pay the host process-config cost. Render process start, output reconnect, and stop independently from runtime capabilities because paired clients may be read/output-only.
- Remote project task preview refreshes should use scoped `openade/task/list` through `OpenADEProductStore` when that capability is advertised. Do not use a full snapshot refresh when only the selected project's task list needs to be fresh; keep snapshot refreshes for session/global repair and runtimes without task-list support.
- Remote settings may call `remote/device/selfRevoke` for the current paired token only. Do not add other device-management methods to the remote shell without explicit admin-role permissions and integration tests.
- Do not sync Yjs to the phone for the companion MVP.
- Do not expose raw Electron APIs, filesystem APIs, or shell APIs to RemoteApp.

## Important Learned Fixes

- Pairing uses HTTP URLs and full-link paste. Deep-link pairing is intentionally rejected.
- Multiple OpenADE sessions are stored in a versioned config store with an active id.
- Snapshot and task payloads must be plain JSON. Remote reads should use the selected OpenADE runtime/Core product API through `OpenADEProductStore`; Yjs-backed projections are legacy compatibility only.
- If a task document is missing or has mismatched metadata, return a readable unavailable state instead of crashing the shared shell.
- Task sorting must match the desktop sidebar. Use sortTaskPreviewsLikeSidebar from components/sidebar/taskSorting.
- Harness ids from remote input must be validated at the OpenADE runtime boundary before starting a host harness.
- RuntimeClient should reconnect automatically and surface online/reconnecting/offline state in the UI.

## UI And Theme

- Follow projects/web/src/_docs/design.md and projects/web/src/tw.css.
- Read tw.css before changing colors.
- The remote UI should feel like the desktop code module: flat, square, clean, spacious.
- No rounded corners. Keep any floating shadow limited to true floating controls.
- Use btn on every button and input on every input/textarea/select-like native control.
- Use semantic theme tokens only. Pair solid bg-primary, bg-error, bg-success, bg-warning, and bg-info with their *-content text color.
- Default to matching snapshot.server.theme.className from the connected desktop.
- Keep the local remote-shell theme override and a way to switch back to matching desktop.
- Avoid visible explanatory copy. The UI should expose controls directly.

## Testing

- Run npm run typecheck from projects/web after changes.
- Add Vitest coverage for parsing, persistence migration, runtime reconnect, message presentation, task sorting, and product-control changes. Prefer real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` paths for integration confidence.
- `remote/RemoteApp.integration.test.ts` renders `RemoteApp` against real in-memory runtime clients and should be extended when adding remote product controls or session shell behavior. It now covers multi-session switching, stale-host removal, and local shell theme persistence through separate `RuntimeServer` instances selected by the production runtime URL builder.
- For visual changes, also build projects/mobile, sync iOS, and inspect the simulator.
