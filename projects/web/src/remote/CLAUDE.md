# Web Remote UI

Renderer-side remote control surface shared by the desktop-hosted mobile view and the Capacitor companion shell.

## Architecture

- Keep only not-yet-migrated desktop dashboard domain logic in the existing renderer store; companion commands are server-owned through the OpenADE module.
- The desktop renderer should listen to runtime OpenADE notifications and refresh cached Yjs documents from storage after server-owned writes.
- Remote invalidations come from runtime OpenADE notifications; do not reintroduce renderer-origin companion event bridges.
- RemoteApp.tsx is the mobile-sized UI and should stay thin over client.ts and shared types.
- `projects/web/src/kernel/session.ts` owns shared pairing URL parsing, private-host validation, runtime WebSocket URL construction, runtime client caching, and OpenADE client construction. `client.ts` owns companion config persistence and remote-specific read/action helpers on top of that shared session layer.
- `projects/web/src/kernel/productStore.ts` owns runtime-backed product DTO caching and product mutations. RemoteApp product controls must call the helpers in `client.ts`, which route through this store instead of bespoke companion commands.
- client.ts must cache one runtime WebSocket client per paired host id; navigation, refresh, and multiple subscriptions must not create extra sockets for the same saved credentials.
- Shared `projects/web/src/shell/task/taskEventPresentation.ts` turns task events into message and activity rows; keep remote-specific code limited to image loading and session wiring.
- Task-thread scroll behavior is shared with desktop through `projects/web/src/shell/task/useTaskThreadScroll.ts`; do not add remote-only bottom-follow logic back into `RemoteApp.tsx`.
- Task command labels, mode ordering, queueability rules, and desktop command-state descriptors are shared through `projects/web/src/shell/task/taskCommands.ts` and `projects/web/src/shell/task/taskCommandModel.ts`; do not reintroduce remote-only command label or enablement helpers.
- Mobile route composition lives in `projects/web/src/shell/MobileOpenADEShell.tsx`; `RemoteApp.tsx` should own pairing/session state, runtime refresh, and action handlers, then pass DTOs and callbacks into the shared shell wrapper.
- Project task lists, project file/search/process panels, new-task form, full task route composition, task changes panels, task event rendering, task composer controls, and task metadata/review/comment/queued-turn controls live under `projects/web/src/shell/*`; keep new reusable product panels there instead of adding more product-control JSX directly to `RemoteApp.tsx`.

## Data Flow

- Electron main owns companion auth, runtime transport, Yjs-backed read projections, and low-level host methods.
- The desktop renderer is not a companion command adapter. Product commands from remote clients go through runtime WebSocket methods.
- The mobile client reads snapshots, projects, task detail, and runtime updates over the `/v1/runtime` WebSocket.
- Mobile product mutations include turn start/interrupt, review start, queued-turn cancel, comment create/edit/delete, task metadata update, and task delete. Keep them high-level OpenADE methods; never replace them with raw Yjs or host calls.
- Mobile project files and search use scoped `openade/project/files/tree`, `openade/project/file/read`, and `openade/project/search` methods through `client.ts` and `OpenADEProductStore`; do not call raw `fs/*`, `host/*`, or direct repo paths from `RemoteApp`.
- Mobile task change views use scoped `openade/task/changes/read`, `openade/task/diff/read`, and `openade/task/git/log` through `client.ts` and `OpenADEProductStore`; do not call raw `git/*` or `fs/*` from `RemoteApp`.
- Mobile project process controls and output viewing use scoped `openade/project/process/*` methods through `client.ts` and `OpenADEProductStore`; do not call raw `process/*` or `host/procs/*` from `RemoteApp`.
- Mobile settings may call `remote/device/selfRevoke` for the current paired token only. Do not add other device-management methods to the mobile shell without explicit admin-role permissions and integration tests.
- Do not sync Yjs to the phone for the companion MVP.
- Do not expose raw Electron APIs, filesystem APIs, or shell APIs to RemoteApp.

## Important Learned Fixes

- Pairing uses HTTP URLs and full-link paste. Deep-link pairing is intentionally rejected.
- Multiple OpenADE sessions are stored in a versioned config store with an active id.
- Snapshot and task payloads must be plain JSON. Use the OpenADE module's Yjs-backed projection for remote reads.
- If a task document is missing or has mismatched metadata, return a readable unavailable state instead of crashing the mobile UI.
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
- Keep the local mobile theme override and a way to switch back to matching desktop.
- Avoid visible explanatory copy. The UI should expose controls directly.

## Testing

- Run npm run typecheck from projects/web after changes.
- Add Vitest coverage for parsing, persistence migration, runtime reconnect, message presentation, task sorting, and product-control changes. Prefer real `RuntimeServer`/`RuntimeLocalClient`/`OpenADEClient` paths for integration confidence.
- `remote/RemoteApp.integration.test.ts` renders RemoteApp against real in-memory runtime clients and should be extended when adding mobile product controls or session shell behavior. It now covers multi-session switching, stale-host removal, and local mobile theme persistence through separate `RuntimeServer` instances selected by the production runtime URL builder.
- For visual changes, also build projects/mobile, sync iOS, and inspect the simulator.
