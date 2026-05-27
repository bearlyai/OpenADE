# Web Remote UI

Renderer-side remote control surface shared by the desktop-hosted mobile view and the Capacitor companion shell.

## Architecture

- Keep only not-yet-migrated desktop dashboard domain logic in the existing renderer store; companion commands are server-owned through the OpenADE module.
- The desktop renderer should listen to runtime OpenADE notifications and refresh cached Yjs documents from storage after server-owned writes.
- Remote invalidations come from runtime OpenADE notifications; do not reintroduce renderer-origin companion event bridges.
- RemoteApp.tsx is the mobile-sized UI and should stay thin over client.ts and shared types.
- client.ts owns config persistence, pairing URL parsing, host validation, runtime WebSocket clients, and online/reconnecting/offline state.
- client.ts must cache one runtime WebSocket client per paired host id; navigation, refresh, and multiple subscriptions must not create extra sockets for the same saved credentials.
- messagePresentation.ts turns task events into mobile-readable message and activity rows.

## Data Flow

- Electron main owns companion auth, runtime transport, Yjs-backed read projections, and low-level host methods.
- The desktop renderer is not a companion command adapter. Product commands from remote clients go through runtime WebSocket methods.
- The mobile client reads snapshots, projects, task detail, and runtime updates over the `/v1/runtime` WebSocket.
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
- Add Vitest coverage for parsing, persistence migration, runtime reconnect, message presentation, and task sorting changes.
- For visual changes, also build projects/mobile, sync iOS, and inspect the simulator.
