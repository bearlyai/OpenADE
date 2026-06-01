# Companion Module

The Companion module exposes a narrow remote-control API from Electron main.

## Product Shape

- The desktop app is the authority. Mobile is only a controller/view.
- The service is for private networks such as Tailscale, LAN, or loopback development.
- Do not add a cloud relay, public broker, or vendor-hosted path without redesigning the trust model.
- QR pairing uses normal HTTP URLs so the same link can be scanned or pasted. Do not reintroduce custom deep links.
- One mobile device can pair with multiple OpenADE hosts; each host keeps an independent device token.

## Trust Model

- Default off.
- Binds only to loopback and detected Tailscale IPv4 addresses by default.
- Pairing uses a short-lived, one-use bootstrap token.
- Pairing QR payloads use normal HTTP URLs, not custom app deep links.
- Paired devices receive independent bearer tokens.
- Stored tokens are SHA-256 hashes only.
- Detailed task/project state is authenticated; unauthenticated health responses intentionally stay minimal.
- Remote calls never expose raw Electron IPC, shell, filesystem, or Yjs write access.
- Raw Yjs backup methods (`data/yjs/*`) are trusted-local runtime methods only; paired mobile permissions must not include them.
- Do not add wildcard Private Network Access CORS. Browser access should stay constrained.
- Revoke-one should only close that device's streams. Drop-all may close every stream.
- Persist last-seen style metadata sparingly; avoid synchronous disk writes on every authenticated request.

## Runtime Shape

- HTTP server: server.ts
- Runtime WebSocket transport: runtimeSocket.ts
- Runtime OpenADE module bridge: runtimeGateway.ts
- Runtime low-level host bridge: runtimeHost.ts
- Runtime server-protocol agent bridge: runtimeAgents.ts
- Runtime Yjs-backed OpenADE data projection: projects/openade-module/src/yjsProjection.ts
- Runtime Yjs-backed OpenADE task and action-event writes: projects/openade-module/src/yjsMutation.ts
- Device auth and pairing: auth.ts
- Trusted-local device admin runtime methods: deviceRuntime.ts
- Runtime socket stream closer registry: runtimeDeviceStreams.ts
- Keep-awake control: powerKeeper.ts

- Snapshot, project, and task reads should go through the OpenADE module projection against persisted Yjs documents.
- New head/worktree task creation and plan/do/ask/HyperPlan execution goes through the OpenADE module writer plus the runtime harness path in Electron main.
- Desktop new-task creation and programmatic turn/Cron starts should use the local runtime IPC transport and the same `openade/turn/start` method as remote clients.
- Desktop task-thread Do/Plan/Ask/Revise Plan/Run Plan actions should use the runtime-backed OpenADE existing-task path. Review should use `openade/review/start` so the review event and follow-up Ask are both created by the runtime host.
- Runtime execution must persist task environment setup, action event create/append/complete/error/stopped writes, HyperPlan sub-execution writes, git ref updates, and snapshot events through OpenADE module writer primitives.
- OpenADE-owned `runtime/stop` must persist the current task action event as `stopped` in the same stop request that interrupts the harness; do not leave this to a best-effort harness settlement callback.
- OpenADE-owned runtime records must carry action-event labels (`eventId`, `executionId`) in `scope.labels` when Electron main starts server-owned work. Startup reconciliation may use those labels to settle matching in-progress task action events after checkpoint reload, but must not infer or overwrite unrelated task history.
- Server-owned HyperPlan should stop the parent turn when a child execution is aborted/stopped. Preserve child status as `stopped`; do not turn it into a generic error.
- Snapshot patch generation and patch-file storage for completed server-owned plan/do/ask/HyperPlan turns live in Electron main.
- OpenADE invalidation comes from server-owned runtime notifications. Do not reintroduce companion request/response commands or renderer-origin event bridges.
- Runtime-backed Yjs reads use `projects/electron/src/modules/code/yjsStorage.ts`; loads, deletes, and document listing must wait for in-flight per-document saves so existing-task mutations see the task that the previous runtime turn just wrote.
- Existing-task mutation starts may retry transient `Task not found` reads, but only for that exact not-found condition. Do not broaden this into blanket retrying of permission, schema, or task-document mismatch errors.
- Image prompt assembly and enabled MCP server config assembly live in Electron main host adapter code before runtime-owned harness starts.
- Repo create/update/delete, comment create/edit/delete, task metadata updates, plan cancellation, preview usage backfill, and task delete should route through OpenADE module host methods. Deep task delete cleanup is host-owned and must preserve durable task docs until resource cleanup has been attempted.
- Generic `agent/*` method registration comes from projects/runtime-node/src/agents.ts. Electron should inject host harness behavior through an executor, not duplicate the registration layer here.
- Codex server-protocol support can connect to a configured app-server URL or launch an explicitly configured app-server process. Keep this opt-in; do not spawn arbitrary agent servers without user/admin configuration.
- Codex app-server env knobs: `OPENADE_CODEX_APP_SERVER_URL`, optional `OPENADE_CODEX_APP_SERVER_TOKEN`, optional `OPENADE_CODEX_APP_SERVER_COMMAND`, optional JSON array `OPENADE_CODEX_APP_SERVER_ARGS_JSON`, optional `OPENADE_CODEX_APP_SERVER_CWD`, and optional `OPENADE_CODEX_APP_SERVER_READY_URL`.

## API Boundaries

- WebSocket `/v1/runtime` is the preferred companion surface.
- Runtime WebSocket device tokens must use the bearer subprotocol, not URL query strings. Pairing URLs are the only token-bearing URLs and are short-lived.
- HTTP is only for health, pairing, and the human-readable pairing page.
- Do not add REST command endpoints or SSE event streams; runtime notifications are the realtime path.
- Do not add Electron IPC handlers for device revoke/drop-all. Trusted desktop settings must use the local runtime IPC transport and `remote/device/list`, `remote/device/revoke`, and `remote/device/dropAll`.
- Keep response payloads plain JSON. Renderer responses cross IPC and must be structured-clone safe.
- Paired-device method and notification grants live in `runtimeSocket.ts` as `COMPANION_RUNTIME_PERMISSIONS` and `COMPANION_RUNTIME_NOTIFICATION_PERMISSIONS`; update those constants and their integration tests together.
- Trusted local clients may use `remote/device/list`, `remote/device/revoke`, and `remote/device/dropAll`; paired devices must not see or call those methods without explicit admin-role permissions and real WebSocket tests. Paired devices may only call `remote/device/selfRevoke`.
- Do not grant paired mobile devices direct `process/*`, `pty/*`, `fs/*`, or `git/*` access by default.
- Do not grant paired mobile devices scoped `openade/task/terminal/*` by default. The kernel/client path exists for trusted or explicitly granted clients, but an interactive shell is stronger than repo-declared process execution.
- Do not grant paired mobile devices direct `openade/action/*` access by default; use high-level `openade/turn/*` for remote control.
- Do not grant paired mobile devices direct `openade/snapshot/create` access by default; snapshot event writes are trusted-local runtime plumbing.
- Paired devices may use high-level product mutations intentionally surfaced in the companion UI: repo create/update/delete, turn start/interrupt, review start, queued-turn cancel, comment create/edit/delete, task metadata update, and task delete.
- Paired devices may use reviewed scoped project and task methods such as `openade/project/files/tree`, `openade/project/file/read`, `openade/project/search`, `openade/project/process/*`, `openade/task/changes/read`, `openade/task/diff/read`, `openade/task/filePair/read`, `openade/task/git/log`, `openade/task/image/read`, and `openade/task/snapshot/*` reads. These methods must resolve repo/task paths server-side and must not become shortcuts to raw filesystem, git, process, PTY, snapshot storage, host, or Yjs/data access. Scoped image reads must prove task ownership before loading bytes. Scoped process start may run only server-resolved `openade.toml` process definitions. `openade/project/file/write`, `openade/task/git/commit`, and `openade/task/terminal/*` exist for trusted/local product clients but must not be granted to paired devices without an explicit role/permission decision and matching integration tests.
- Do not grant paired mobile devices direct `host/*` access. These trusted-local methods include platform probes, managed binaries, subprocess env, directory creation, MCP OAuth/test operations, Procs config editing, raw Yjs, blob data, and snapshot storage.
- Paired mobile devices may read agent provider list/status, but must not get provider lifecycle methods like `agent/provider/connect` or `agent/provider/disconnect`; those can start or stop host-managed provider processes.
- Grant paired mobile devices only the high-level OpenADE mutation methods intentionally surfaced in the mobile product.
- Paired mobile `initialize` capabilities must show only allowed methods/notifications. Keep integration coverage proving raw `runtime/*`, process, PTY, fs, git, host, snapshot, and data capabilities stay hidden.
- Filter paired mobile notifications too. Do not let `runtime/*`, `process/*`, `pty/*`, `fs/*`, `git/*`, `host/*`, `snapshot/*`, or `data/*` notifications leak raw host records to remote devices.
- Low-level host methods may exist on the runtime server for trusted local/in-process clients.
- Main process owns auth, pairing, CORS, network binding, device revocation, and keep-awake.
- Electron main owns runtime auth, raw host powers, and Yjs-backed read projections.
- Companion commands must stay on `/v1/runtime` and OpenADE module methods. There is no renderer command fallback.

## Keep Awake

- Use Electron powerSaveBlocker for the normal path.
- macOS locked-screen GUI control is not part of this module. Codex Locked Use is a separate Codex App feature, not an OpenADE companion API.
- If adding stronger macOS behavior later, treat it as a native security project with explicit user consent and documentation.

## Tests

- Unit test auth, token expiry, one-use pairing, revocation, and network binding.
- Unit test runtime permissions, reconnect behavior, and stream closure by device id.
- Integration test loopback pair, authenticated runtime WebSocket, Yjs-backed reads, paired denial of admin device methods and `host/*` MCP operations, trusted-local revoke/drop-all stream closure, trusted-local-only MCP OAuth notifications including replay filtering, self-revoke, and unauthorized access.
