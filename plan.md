# OpenADE Runtime Protocol Rewrite Plan

## Goal

Move OpenADE onto a reusable low-level runtime protocol where a small host runtime owns agent executions, process management, PTYs, file system access, git operations, directory watching, lifecycle state, and streaming.

OpenADE-specific concepts should live above that low-level runtime. The runtime should be useful for other non-OpenADE projects.

The target shape:

- A generic runtime server exposes agent, process, PTY, git, fs, and streaming APIs.
- A mid-level OpenADE module builds projects, tasks, turns, comments, and snapshots on top of the generic runtime.
- The desktop dashboard connects to the same runtime server and calls OpenADE module methods.
- The mobile app connects to the same runtime server and calls OpenADE module methods.
- Electron embeds one runtime server and registers the OpenADE module into it.
- A future headless Node process can run the same runtime server without Electron.
- A future light JavaScript library can embed the same runtime protocol for tests, tools, and alternate UIs.
- All remote and local control flows use the same protocol instead of special-case REST, Electron IPC, or renderer-only APIs.

Hard boundary:

- The low-level runtime protocol must not know about OpenADE projects, tasks, HyperPlan, task comments, or UI layout.
- The low-level runtime protocol may know about directories, workspaces, agents, sessions, processes, git repositories, files, and streaming items.
- OpenADE can expose a mid-level library for project/task workflows by registering methods on the low-level server.
- There should be one server process and one transport stack.

## Implementation Status

Implemented in this branch:

- Added package boundaries for `projects/runtime-protocol`, `projects/runtime`, and `projects/runtime-client`.
- Added target package shells for `projects/runtime-node`, `projects/openade-module`, and `projects/openade-client`.
- Added `/v1/runtime` WebSocket transport on the existing companion HTTP server.
- Added trusted renderer IPC transport for the same runtime server so the desktop dashboard can migrate without going through the network listener.
- Added request/response and notification flow with reconnecting client support.
- Moved the dashboard's trusted local runtime transport helper into `projects/runtime-client` as a generic local transport client; `projects/web` now only binds that helper to Electron IPC.
- Added `OpenADEClient` typed facade over runtime-client for snapshot/task/turn calls and OpenADE-scoped subscriptions.
- Added runtime lifecycle supervision for OpenADE turns, processes, and PTYs.
- Added host method registration for low-level file, git, process, and PTY methods.
- Added server-protocol agent method surface for threads, turns, goals, approvals, and Codex app-server style adapters.
- Kept OpenADE-specific task/project/snapshot methods in the `openade/*` namespace.
- Moved mobile companion reads/turn starts/interrupts/change subscriptions to the runtime WebSocket path and removed REST/SSE command/update compatibility.
- Added a local runtime client facade for renderer-side migrations.
- Added method permissions so paired companion devices do not automatically get direct low-level `process/*`, `pty/*`, `fs/*`, or `git/*` access.
- Tightened paired-device permissions to high-level OpenADE read/turn/review/interrupt methods instead of blanket `openade/*`, keeping raw action-event, repo mutation, task metadata/delete, host, fs, git, process, PTY, and storage methods trusted-local.
- Added WebSocket unique connection ids, heartbeat, lag notifications, and buffered-send protection with real WebSocket coverage for over-buffered 1013 closes.
- Added runtime checkpoint persistence so active runtimes reload as orphaned after process restart.
- Added low-level `fs/watch/*` runtime methods backed by real filesystem watchers.
- Migrated desktop file, git, process, and PTY bridge functions to trusted runtime IPC only.
- Removed the old files/git/process/PTY/dir/claude preload API surfaces from the renderer bridge.
- Moved generic `fs/watch/*` registration and watcher cleanup into `projects/runtime-node`.
- Moved generic `fs/path/*`, `fs/search/*`, and `git/*` runtime registration into `projects/runtime-node`.
- Moved generic `process/*` and `pty/*` runtime registration/lifecycle projection into `projects/runtime-node`.
- Moved runtime checkpoint JSON file persistence into `projects/runtime-node`.
- Added direct Yjs-backed OpenADE runtime reads for snapshots, projects, and tasks in Electron main.
- Moved OpenADE `openade/*` method registration into `projects/openade-module`.
- Moved the Yjs-backed OpenADE snapshot/project/task projection into `projects/openade-module`.
- Added a headless OpenADE Yjs writer primitive in `projects/openade-module` that creates head-mode task documents and repo previews in the existing storage format.
- Added headless OpenADE Yjs writer primitives for action-event creation, stream append, execution metadata updates, complete, error, and stopped transitions using the existing task document and repo preview format.
- Exposed trusted-local OpenADE action mutation protocol methods (`openade/action/*`) backed by the Yjs writer.
- Added a trusted-local `openade/snapshot/create` protocol method for persisting snapshot events once a host adapter has produced the patch and stats.
- Added trusted-local `openade/comment/*` protocol methods for comment create/edit/delete against task Yjs documents.
- Added trusted-local `openade/task/metadata/update` for title, closed state, viewed/event timestamps, MCP server ids, and session-id patches.
- Wired new head-mode `openade/turn/start` requests through the OpenADE module writer before runtime harness execution, with deterministic task ids from stable `clientRequestId` values.
- Moved head-mode plan/do/ask live execution for OpenADE turns into Electron main: it creates action events, starts the runtime harness, persists session/stream/terminal events into task Yjs docs, updates runtime state, and interrupts through the harness without renderer command ownership.
- Moved worktree setup and plan/do/ask execution into Electron main for OpenADE turns: it creates or reuses a git worktree, records the task device environment and setup event in Yjs, and starts the runtime harness from the worktree cwd.
- Moved snapshot generation for completed server-owned plan/do/ask turns into Electron main: it builds git patch bundles, stores patch files, and persists snapshot events through the OpenADE module writer without renderer ownership.
- Added a portable text-only OpenADE prompt builder in `projects/openade-module` for server-owned plan/do/ask turns.
- Added portable OpenADE-layer HyperPlan strategy helpers in `projects/openade-module` so HyperPlan stays above the generic runtime protocol.
- Added OpenADE HyperPlan sub-execution mutation methods (`openade/hyperplan/*`) backed by existing task Yjs documents.
- Moved non-standard HyperPlan orchestration into Electron main: it creates the parent action event, executes child harness steps through runtime-owned harness starts, persists child sub-executions, reconciles labels, writes terminal state, and generates snapshots without renderer command ownership.
- Added server-owned image prompt assembly for OpenADE turns by resolving persisted image descriptors from the host data directory and passing structured content blocks into runtime-owned harness starts.
- Added server-owned MCP config assembly for OpenADE turns by reading enabled task MCP server ids from Yjs and passing selected HTTP/stdio MCP server configs into runtime-owned harness starts.
- Added OpenADE turn-start adapter context so `openade/turn/start` reuses the module-created runtime record instead of creating duplicate task/turn runtime records.
- Moved OpenADE product request/snapshot/project/task type ownership into `projects/openade-module`.
- Added trusted-only raw Yjs backup read/write/delete through `data/yjs/*`.
- Migrated dashboard harness execution helpers to runtime `agent/*` methods.
- Migrated desktop new-task creation and programmatic OpenADE turn/Cron task starts to local `openade/turn/start`, then refreshed the renderer store from runtime notifications and persisted Yjs state.
- Migrated the desktop task-thread composer for standard Do, Plan, Ask, Retry, Commit & Push, and Repeat actions onto the same runtime-backed OpenADE turn existing-task path.
- Removed direct renderer access to the old harness preload API.
- Removed old low-level files/git/process/PTY/harness IPC handlers from Electron main registration.
- Removed the old renderer Yjs preload API; desktop Yjs persistence now goes through trusted local runtime `data/yjs/*` calls and still lands on the existing atomic CRDT-merge storage implementation.
- Removed the old companion renderer request/response command bridge.
- Guarded harness cleanup so active in-progress executions cannot be deleted by retention or clear-buffer paths.
- Added a Codex app-server WebSocket bridge that speaks Codex's initialize/initialized handshake, thread/turn requests, thread goal lifecycle, approval request/response flow, optional managed app-server process launch, and maps Codex app-server notifications back into runtime agent notifications.
- Added runtime guidance docs in the new runtime and OpenADE package directories.
- Added actual integration tests for HTTP pairing + authenticated runtime WebSocket, runtime checkpoint recovery, and real filesystem watch notifications.
- Added retained `clientRequestId` idempotency for `openade/turn/start` so completed mobile retries or double-submits do not create duplicate turns.
- Added generic runtime-server `clientRequestId` idempotency for mutating low-level method segments, so retried process/agent/runtime writes can reuse a successful result without re-invoking the handler.
- Added stable hashed runtime-node token principals for `clientRequestId` idempotency, so token-authenticated headless clients keep dedupe protection across WebSocket reconnects without storing raw tokens.
- Added retained `clientRequestId` idempotency coverage for non-turn OpenADE mutations so successful retries return the original result and failed attempts can be retried.
- Scoped retained OpenADE `clientRequestId` entries by method so `openade/turn/start`, `openade/review/start`, and other mutating methods cannot return each other's retained result when a client reuses a request id.
- Made `OpenADEClient` attach a `clientRequestId` to every typed OpenADE mutation by default, not only turn/review starts, so normal dashboard/mobile callers use the server's idempotency path without remembering request-id plumbing.
- Added integration coverage proving server-owned head-mode turns create task/action docs, start the runtime harness, persist session and completion events, dedupe stable request ids, and interrupt through the harness.
- Added OpenADE module host methods for repo create/update/delete and task delete, with dashboard manager mutations routed through the runtime client.
- Added host-side deep task cleanup for active executions, PTYs, snapshots, images, harness sessions, worktrees, and generated branches before durable task deletion.
- Added runtime-node process liveness probing and wired it into runtime reconciliation so stale checkpointed/active runtimes can be marked failed only when the host verifies the PID is dead.
- Replaced the renderer-owned `workingTaskIds` set with a `RuntimeManager` view cache hydrated from `runtime/list` and updated by `runtime/*` lifecycle notifications.
- Added a reusable runtime-node HTTP/WebSocket server helper so a `RuntimeServer` can run outside Electron, with loopback-only unauthenticated mode, token auth for private-network listeners, heartbeat, backpressure checks, and real WebSocket integration coverage.
- Added `runtime-node serve` source entrypoint support in `projects/runtime-node`, with JSON/env/flag config loading, checkpoint configuration, and token auth for a generic runtime server.
- Renamed the headless runtime CLI/env surface away from OpenADE product branding: `runtime-node serve` and `RUNTIME_NODE_*`.
- Added a file-backed OpenADE Node Yjs storage adapter compatible with existing OpenADE document ids and atomic CRDT-merge saves.
- Added a runtime-node agent module that exposes process-backed Claude Code and Codex providers through generic `agent/provider/*`, `agent/execution/start`, and `agent/execution/interrupt` runtime methods.
- Collapsed Electron's duplicate agent method registration into the shared runtime-node agent module; Electron now injects a desktop harness executor for reconnect, tool responses, buffer clearing, structured queries, and session deletion instead of owning a parallel `agent/*` implementation.
- Added a runtime-node server-protocol agent bridge path for Codex app-server style providers, including JSON/env/flag config, provider discovery, thread/turn/goal methods, approval queue plumbing with list/respond/reject coverage, notification forwarding, and real WebSocket integration coverage.
- Added RuntimeSupervisor projection for server-protocol agent turns, so Codex/app-server `agent/turn/start` work is visible through generic `runtime/list` and terminal bridge notifications update runtime lifecycle state.
- Expanded server-protocol goal lifecycle coverage so `agent/goal/create`, `agent/goal/read`, `agent/goal/update`, `agent/goal/complete`, `agent/goal/block`, `agent/goal/set`, `agent/goal/get`, and `agent/goal/clear` all route through the generic provider bridge surface, including real runtime WebSocket coverage for Codex-style `thread/goal/*` calls.
- Removed Electron's duplicate Codex app-server bridge implementation; Electron imports the shared runtime-node bridge and only supplies host configuration.
- Added generic `agent/provider/connect` and `agent/provider/disconnect` methods for server-protocol providers, with paired-device permissions narrowed so remote devices keep list/status access without gaining provider lifecycle control.
- Added generic provider/model/session/replay methods (`agent/provider/read`, `agent/serverProtocol/list`, `agent/model/list`, `agent/session/list`, `agent/session/read`, `agent/session/active`, `agent/session/delete`, `agent/turn/replay`) so server-protocol and process-backed harnesses expose low-level discovery without OpenADE task semantics.
- Added `remote/device/selfRevoke` for paired devices, revoking the current device credential over the runtime protocol and closing only that device's sockets.
- Expanded real companion WebSocket permission coverage so paired devices are proven denied for raw fs, process command/script, PTY, Git status/commit, raw Yjs, host utility, snapshot storage, provider lifecycle, direct agent execution, and trusted OpenADE mutation methods while still using the allowed OpenADE/runtime read path.
- Added an OpenADE Node adapter in `projects/openade-module/src/node.ts` that registers OpenADE project/task/comment/snapshot methods against file-backed Yjs data outside Electron, starts headless turns through an injected runtime-node agent executor, and persists action streams/terminal state back into existing Yjs task documents.
- Added integration coverage proving a headless runtime can load OpenADE, create a repo through `openade/repo/create`, read it back through `openade/project/list`, run `openade/turn/start`, run `openade/review/start`, and orchestrate non-standard HyperPlan strategies over a real WebSocket with persisted session, stream, completed action state, sub-executions, and reviewer follow-up Ask creation.
- Removed duplicate OpenADE request payload types from the low-level runtime protocol; `plan`, `do`, `ask`, `run_plan`, `hyperplan`, and related task/review payloads are owned by `projects/openade-module`, not `projects/runtime-protocol`.
- Added regression coverage that low-level runtime protocol source, runtime-node generic adapter source, and runtime method names do not contain OpenADE product mode literals (`do`, `ask`, `plan`, `run`, `run_plan`, `review`, `revise`, or `hyperplan`).
- Added runtime record process metadata (`pid`, `pgid`, `processLabel`, `processStartedAt`, `exitedAt`, `exitCode`, `signal`) plus process start-time verification in the Node liveness probe; process-backed agent runtimes now capture spawned harness PID/process-group metadata through `spawnJsonl.onSpawn`.
- Removed renderer `beforeunload` process/PTYS cleanup; renderer reloads now only warn for active runtime work and no longer own process shutdown.
- Moved Electron quit warning from old harness record checks to runtime-supervisor active work checks.
- Added direct package `typecheck` scripts that use `tsgo` for the new runtime/OpenADE packages.
- Migrated dashboard blob storage and snapshot bundle wrappers to trusted local runtime methods (`data/file/*`, `snapshot/*`) and removed the old preload IPC surfaces for those paths.
- Migrated dashboard capability and SDK probe wrappers to trusted local runtime methods (`host/capabilities/read`, `agent/sdkCapabilities/*`) and removed the old capability preload IPC surface.
- Migrated dashboard host utility wrappers to trusted local runtime methods for platform/system probes, managed binaries, subprocess env propagation, directory creation, and `openade.toml` Procs config editing (`host/platform/*`, `host/system/*`, `host/binaries/*`, `host/subprocess/*`, `host/shell/createDirectory`, `host/procs/*`) and removed their old preload IPC surfaces.
- Renamed the low-level process command bridge types to StartCommand/startCommand so generic runtime process APIs use lifecycle vocabulary instead of product/action vocabulary.
- Migrated MCP connection tests and OAuth request/response calls to trusted local runtime methods (`host/mcp/*`) and moved OAuth completion to runtime notification `host/mcp/oauthComplete`, removing the old MCP preload request/event surface.
- Removed the old renderer-owned task event mutation surface from `EventManager`; task action/snapshot/HyperPlan event writes now go through OpenADE module writer methods in Electron main.
- Migrated comments, plan cancellation, and task preview usage backfill to `openade/comment/*` and `openade/task/metadata/update` instead of direct renderer Yjs mutations.
- Simplified `QueryManager` to interrupt server-owned OpenADE task turns through `openade/turn/interrupt`; renderer-owned harness/custom run abort state is gone.
- Removed the obsolete `TaskManager.tasksById` cache; task and event models now derive from loaded task stores refreshed from runtime notifications and persisted Yjs storage.
- Removed the renderer `OpenADETurnManager` facade; dashboard command, repeat, and cron flows now call `openade/turn/start` through `openade-client` directly and refresh their view caches from persisted runtime state.
- Removed the stale renderer `HyperPlanExecutor`; HyperPlan orchestration is now server-owned in the OpenADE module/runtime host path, while the renderer keeps only strategy/type helpers for UI configuration and tests.
- Removed stale renderer HyperPlan prompt-building and output-extraction helpers; those server-owned concerns now live in `projects/openade-module`, while the renderer keeps only HyperPlan strategy/type helpers needed for UI configuration.
- Added initialize-time protocol version rejection with a structured `unsupported_protocol_version` error, and mapped that error in the mobile/remote UI to a clear "Desktop update required" message.
- Added runtime notification cursors, retained notification replay through `subscription/update`, lag reporting for too-old cursors, and client-side cursor replay after reconnect.
- Added runtime-protocol envelope schemas and strict request/response/notification validators; RuntimeServer now rejects malformed network frames with structured `invalid_message` errors instead of silently ignoring them.
- Added RuntimeServer method-level parameter validators for core initialize, subscription, runtime lifecycle, and provider status methods; malformed method params now fail at the protocol boundary with structured `invalid_params` errors.
- Added runtime-node agent method validators for server-protocol provider lifecycle/turn/goal calls and process-backed `agent/execution/*` calls, so malformed agent params fail as `invalid_params` before host adapters run.
- Added OpenADE module method validators as module-boundary guards, so malformed `openade/*` and OpenADE Yjs params fail as `invalid_params` before idempotency, runtime records, or host adapters run while product verbs stay outside the core runtime protocol.
- Added generic `runtime/stop` host stop handlers so stopping a runtime routes through agent/process/PTY/fs-watch/OpenADE adapters before the supervisor marks it stopped, with real-process integration coverage.
- Hardened OpenADE-owned `runtime/stop` handling so a stopped OpenADE turn persists the task action event as `stopped` through the OpenADE module writer before the generic supervisor marks the runtime terminal, even if the harness does not emit a later abort settlement.
- Added runtime-node host method validators for low-level process, PTY, fs-watch, file, and git methods so malformed host params fail as `invalid_params` before adapters touch the filesystem, process table, or git state.
- Added protocol envelope schema snapshot coverage so request, response, notification, initialize, and subscription schema changes are deliberate.
- Enforced `initialize` before WebSocket/runtime wire methods and made the generic runtime WebSocket client perform the handshake before replaying subscriptions.
- Enforced the same initialize-before-domain discipline on trusted local runtime IPC: `RuntimeLocalClient` now performs the initialize handshake before its first request and Electron's runtime IPC bridge rejects uninitialized local requests like the WebSocket transport.
- Added `server/status/read` for low-level runtime server metadata and capability inspection without depending on OpenADE.
- Moved OpenADE headless module loading out of `projects/runtime-node`; `plan`, `do`, `ask`, `run_plan`, review, and HyperPlan semantics now live in `projects/openade-module`, while runtime-node stays limited to generic transport, host adapters, process/PTY/fs/git, agent providers, checkpoints, and liveness.
- Renamed the generic process-backed agent API to execution primitives (`agent/execution/start`, `agent/execution/interrupt`, `agent/execution/reconnect`, `agent/tool/respond`, `agent/execution/buffer/clear`, and `agent/query/structured`) so `do`, `ask`, `run_plan`, and other OpenADE product verbs remain only in the OpenADE module.
- Removed the stale renderer-origin companion invalidation bridge (`companion:event` IPC, preload `notifyEvent`, and web `registerCompanionNotifications`); OpenADE invalidation now comes from server-owned runtime notifications only.
- Moved the file-backed OpenADE Yjs document adapter out of `projects/runtime-node` and into `projects/openade-module/src/nodeYjsStorage.ts`, since OpenADE document ids are product state rather than generic runtime state.
- Removed the old unused `dirAccess` main-process IPC module (`list-dir`, `file-contents`, `get-dir-from-path`, and legacy `select-directory` handlers); host file access now goes through runtime file methods and the narrow code shell directory picker.
- Removed the stray `shared/companion` tsconfig include from `projects/runtime-node`; the generic Node runtime package no longer typechecks against companion product types.
- Removed the unused CORS-free fetch preload surface; renderer host powers now avoid that broad legacy IPC escape hatch.
- Added disconnect-time Yjs flushes for both runtime-backed Electron storage and browser IndexedDB storage so pending debounced repo/settings/scratchpad updates are not dropped on unmount, with browser integration tests proving merged state survives the flush.
- Renamed companion-side `RemoteRunRequest`/`runRemote` wrappers to `RemoteTurnStartRequest`/`startRemoteTurn` so product `do`/`ask`/`run_plan` choices read as OpenADE turn payloads over the runtime transport, not core runtime verbs.
- Removed active renderer compatibility aliases (`viewingFile`/`viewingFileData`) and the unused legacy `git/dir/read` method path; callers use the current file-browser fields and `git/directory/read`, with runtime protocol coverage proving the old git method is not registered.
- Re-audited the generic runtime packages and confirmed OpenADE verbs such as `do`, `ask`, `plan`, `run`, `run_plan`, `review`, `revise`, and `hyperplan` are not core runtime method names, low-level protocol request types, or runtime-node low-level agent options; those values live only in the OpenADE module/client product layer.
- Removed the `disablePlanningTools` option from runtime-node's generic agent execution surface; any planner/tool-policy behavior must stay in product or harness-specific layers, not in the reusable runtime API.
- Added OpenADE action/runtime reconciliation above the core runtime: server-owned OpenADE runtime records now carry `eventId` and `executionId` labels, and terminal generic runtime states reconcile only the matching in-progress OpenADE action event through `openade/action/reconcileRuntime`.
- Added startup reconciliation for checkpointed OpenADE-owned terminal runtimes in both Electron and headless Node OpenADE adapters, so a crash/restart can settle matching task action events without guessing missing events or overwriting already-terminal history.
- Matched headless OpenADE task idempotency to Electron's hashed `repoId + clientRequestId` task ids, so caller-provided request ids are not leaked into durable task document ids or filenames.
- Re-audited runtime-node host adapters so generic temporary process/script artifacts are no longer OpenADE-branded.
- Hardened the file-backed OpenADE Node Yjs storage adapter with the same legacy nested-path recovery and mismatched-task-document tolerance as the desktop storage, preserving readable data before stricter module-level task metadata checks run.
- Removed long-lived runtime bearer-token acceptance from WebSocket URL query strings in both Electron companion and headless runtime-node servers; runtime socket auth now uses the WebSocket subprotocol token path, while short-lived HTTP pairing links remain separate.
- Added concrete headless runtime-node filesystem, process, Git, and shell-backed PTY host adapters, wired them into `runtime-node serve` alongside fs-watch and agent providers, and covered the real WebSocket path for `fs/path/describe`, `fs/file/read`, `fs/file/write`, `fs/directory/create`, `fs/path/copy`, `fs/path/remove`, `fs/watch/start`, `fs/watch/list`, `fs/watch/stop`, `process/command/start`, `pty/spawn`, `git/repo/init`, and `git/directory/read`.
- Runtime-node serve shutdown now asks the owned local process and PTY adapters to terminate active child processes before unregistering runtime modules, avoiding orphaned headless process runtimes.
- Runtime-node local process `killAll` now emits terminal process and runtime lifecycle notifications before adapter cleanup, so direct `process/killAll` and headless shutdown cannot silently leave active process runtimes without terminal state.
- Runtime-node local PTY termination now guards late child exit/error events after `pty/kill` or `pty/killAll`, preserving stopped runtime state instead of letting a killed PTY emit later completed/failed terminal churn.
- Hardened direct process/PTY kill and generic `runtime/stop` so adapter terminal events and supervisor stop calls produce one terminal runtime notification while preserving the low-level `process/exit` or `pty/killed` event for clients.
- Preserved user-stop semantics for server-owned OpenADE turns when harness abort races with completion: a runtime/stop request made while a turn is still active now settles the OpenADE action as stopped rather than completed.
- Isolated headless process, PTY, and fs-watch mutable state per adapter/server instance so multiple embedded runtimes in one Node process cannot see each other's host records or receive each other's lifecycle notifications.
- Isolated server-protocol agent bridge registries per runtime server so a Codex/app-server provider registered on one embedded runtime does not appear in another runtime's capabilities or provider status.
- Redacted credential-like Codex app-server URL components from provider status so remote clients cannot learn token, key, auth, password, username, or password values from configured provider endpoints.
- Added concrete headless runtime-node integration coverage that its generic server capabilities do not advertise OpenADE product method segments like `do`, `ask`, `plan`, `run`, `review`, `revise`, or `hyperplan` unless the OpenADE module is explicitly registered under `openade/*`.
- Removed product-verb awareness from `projects/runtime/src/server.ts`; the generic runtime server is now product-agnostic, while boundary coverage lives in OpenADE module and low-level capability tests.
- Hardened runtime terminal cleanup so `orphaned` records are not deleted by terminal-retention cleanup; orphaned remains an unresolved reconcile state until the host proves terminal liveness.
- Removed no-op Electron code-module `load` exports and startup calls for runtime-backed modules whose legacy IPC registration has been removed; startup now keeps only real side-effect loads plus cleanup paths for owned host resources.
- Migrated runtime records to a generic `scope` object (`ownerType`, `ownerId`, paths, labels, and correlation ids) instead of flat owner/path fields, with checkpoint hydration that preserves older flat checkpoint records by normalizing them into `scope`.
- Added shared runtime-protocol schema/validation for scoped runtime records and moved dashboard runtime notification ingestion to that validator, while keeping legacy flat checkpoint recovery inside the supervisor only.
- Added a generic `RuntimeRecordCache` to `projects/runtime-client` for validated normalized runtime lifecycle state, and made the dashboard RuntimeManager use it as the cache primitive instead of owning all runtime normalization locally.
- Added runtime record and scope schemas to the protocol snapshot test so lifecycle payload shape changes are reviewed alongside envelope and parameter schemas.
- Added real WebSocket runtime-client reconnect coverage proving reconnect sends the last notification cursor through `subscription/update` so missed runtime notifications can be replayed instead of leaving clients stale after a dropped socket.
- Removed duplicate `initialize` calls from OpenADEClient; runtime-client now remains the sole owner of transport initialization while OpenADEClient is only the typed product-method facade.
- Added a mobile `tsgo` typecheck script and narrowed mobile/shared client imports so the companion shell typechecks against the remote UI and reusable clients without pulling in desktop Electron preload APIs or OpenADE server-side Yjs writers.
- Added remote-client cache coverage proving mobile snapshot/task/subscription/turn calls for the same paired host reuse one runtime WebSocket client, while changed credentials close and replace the cached client.
- Added runtime notification permission filtering and narrowed paired mobile sockets so remote devices do not receive raw `runtime/*`, process, PTY, fs, git, host, snapshot, or data notifications; paired devices now use OpenADE notifications rather than broad runtime/list/read/reconcile access.
- Routed replay lag notifications through the same notification permission filter so restricted transports cannot receive unapproved `connection/lagged` messages while replaying from old cursors.
- Added mobile/remote lagged-state handling so `connection/lagged` notifications are treated as OpenADE-relevant realtime events, surfaced to the mobile UI as a warning state, and covered by remote-client/status tests.
- Hardened the generic runtime WebSocket client so sockets that close before `initialize` settles reject or retry instead of hanging the client connection state, with real WebSocket coverage for both fail-fast and reconnect paths.
- Added focused mobile remote UI tests for duplicate-submit locking and thread auto-follow behavior, with RemoteApp using the tested helpers for send/create-task submission state and near-bottom live-delta scrolling.
- Added sidebar runtime-first display coverage so an active runtime synthesizes an in-progress display event before stale completed/error transcript state, keeping task lists visibly spinning while Electron still owns the runtime.
- Added RuntimeManager orphaned-state coverage proving orphaned/detached liveness is derived from runtime records and is not persisted as an OpenADE task event status.
- Preserved OpenADE HyperPlan child stop semantics end to end: `openade/hyperplan/*` mutation validation accepts `stopped`, Electron-main and headless OpenADE HyperPlan stop the parent action when a child aborts/stops, and the desktop renderer can display stopped sub-executions.
- Scoped `initialize` and `server/status/read` capabilities to the current runtime connection permissions so paired devices cannot discover raw runtime/process/host methods they are not allowed to call.

Intentional remaining boundaries and future hardening:

- The desktop dashboard still uses the existing renderer store as a view/cache for UI state. Durable repo/task/comment/task-metadata mutations and all task turns enter through the OpenADE runtime module.
- Head-mode and worktree plan/do/ask/HyperPlan turns are server-owned end to end for task/environment/action document creation, harness start, stream persistence, terminal state, HyperPlan sub-execution persistence, snapshot patch generation/storage, and interrupt.
- Runtime terminal reconciliation is deliberately OpenADE-layer behavior. The generic runtime may say a scoped runtime is completed, failed, stopped, orphaned, or missing; only the OpenADE module maps that state into task action-event history, and only when it can match the intended action event by `eventId` or `executionId`.
- HyperPlan child lifecycle is OpenADE-layer state, not a runtime-layer concept. A stopped child remains `stopped` in persisted sub-execution data and stops the parent turn rather than being coerced into an error or false completed result.
- Dashboard UI state is still cached through CodeStore models. Runtime liveness now comes from `RuntimeManager`, not renderer-owned task ids.
- Codex server-protocol now supports configured managed process launch, but production use should prefer Codex's supported local control socket/daemon path once OpenADE has a transport adapter for it.
- Headless OpenADE can load project/task storage, accept OpenADE mutations outside Electron, run plan/do/ask, HyperPlan, and review/follow-up turns through the runtime-node process-backed harness executor, and expose Codex app-server style providers through generic `agent/thread/*`, `agent/turn/*`, and `agent/goal/*` methods. Production hardening can add richer provider configuration UX and credential checks.
- Directory watching, checkpoint reload, PID-dead verification, process label verification, process start-time verification, process-group metadata capture, and cold-start adoption of verified live process groups are implemented. PID-only alive records remain orphaned instead of being adopted.

## Original Architecture Problem

OpenADE was split in a way that made the desktop renderer too authoritative:

- projects/web/src/store/store.ts owns the main application store.
- Dashboard command, repeat, and cron flows call `openade/turn/start` through `openade-client`; the renderer no longer owns a programmatic turn facade.
- projects/web/src/store/managers/ExecutionManager.ts owns execution orchestration.
- projects/electron/src/modules/code/harness.ts owns host-side harness execution and buffering.
- projects/electron/src/modules/code/process.ts owns process spawning and output buffering.
- projects/electron/src/modules/code/git.ts owns git operations.
- projects/electron/src/modules/code/yjsStorage.ts owns persisted Yjs storage.
- projects/electron/src/modules/companion/server.ts exposes the remote API.
- projects/shared/companion/src/index.ts defines companion pairing/mobile projection types.
- projects/web/src/remote/RemoteApp.tsx consumed the companion API from mobile before the runtime transport migration.

This created an inverted ownership model:

- The renderer owns the domain model.
- Electron owns host powers behind IPC.
- The companion server proxies remote requests back into the renderer.
- Mobile receives invalidation events and then refetches snapshots.

The result was:

- Remote control depends on the desktop renderer being alive and healthy.
- The server is not the real source of truth.
- Streaming is fragile when product-level task events still depend on renderer invalidation instead of a durable runtime event log.
- Multiple clients are hard to support cleanly.
- It is difficult to build a headless runtime or reusable JS library.

## Codex Architecture Patterns To Copy

The Codex app-server codebase has the right shape for this problem:

- Protocol is separate from implementation.
  - bearly/external_repos/codex/codex-rs/app-server-protocol

- Server runtime is separate from transport.
  - bearly/external_repos/codex/codex-rs/app-server

- Client facade is separate from server runtime.
  - bearly/external_repos/codex/codex-rs/app-server-client

- Transport supports multiple connection modes.
  - stdio JSONL
  - WebSocket
  - Unix socket WebSocket upgrade
  - in-process transport

- In-process transport still uses the same protocol.
  - This is important because the dashboard can be fast and local without becoming a special code path.

- WebSocket transport has explicit auth requirements.
  - Non-loopback listeners are refused without auth.
  - Auth supports capability tokens or signed bearer tokens.

- Connections use bounded queues and backpressure handling.
  - Slow clients are disconnected instead of letting memory grow forever.

- Event delivery is classified.
  - Some events are lossless.
  - Some events are best effort and may be dropped with a lag notification.

- The protocol has clear lifecycle concepts.
  - initialize
  - initialized
  - thread/start
  - turn/start
  - turn/steer
  - turn/interrupt
  - item deltas
  - turn completed

OpenADE should not copy Codex implementation details directly, but it should copy the architecture:

- protocol first
- typed clients
- transport independence
- host adapters
- durable event ids
- stable streaming
- explicit auth and permissions

## Layered Package Layout

There should be one runtime server.

- The runtime server owns transports, auth, subscriptions, backpressure, and message routing.
- OpenADE is a module loaded into that server.
- OpenADE registers method handlers and notification schemas under the `openade/*` namespace.
- OpenADE can also export a library API for in-process callers.
- There should not be a separate OpenADE server process or second transport stack.

### projects/runtime-protocol

Owns the low-level wire contract.

Responsibilities:

- JSON-RPC-like message envelope.
- Request and response types.
- Notification types.
- Protocol versioning.
- Zod or TypeBox schemas.
- Generated TypeScript client/server type helpers.
- Error codes.
- Capability declarations.
- Runtime status types.
- Agent execution event types.
- Process and PTY event types.
- Fs/git request and notification types.

Rules:

- No React imports.
- No Electron imports.
- No Node-only runtime assumptions unless isolated behind types.
- No OpenADE project/task/comment/HyperPlan concepts.
- No app UI state.
- No direct file/git/process execution.

### projects/runtime

Owns the generic runtime server.

Responsibilities:

- Agent execution orchestration.
- Runtime lifecycle supervision.
- Process lifecycle supervision.
- PTY lifecycle supervision.
- Runtime status reconciliation.
- Directory roots/workspaces.
- File system operations through adapters.
- Git operations through adapters.
- MCP server access through adapters.
- Subscription registry.
- Event log and cursoring.
- Permission checks.
- Runtime service interfaces.
- Cold-start runtime checkpoint handling.

Rules:

- No Electron imports.
- No React imports.
- No direct shell/git/fs access.
- Host powers only through adapters.
- No OpenADE task/project assumptions.

### projects/runtime-node

Owns Node host adapters for the generic runtime.

Responsibilities:

- File system adapter.
- Git adapter.
- Process adapter.
- PTY adapter.
- Agent/harness adapter.
- Secret/config adapter.
- Power/notification adapter hooks where needed.
- OS process liveness probes.
- Cold-start checkpoint persistence.

This package is what Electron main should use first. A future CLI daemon should use the same package.

### projects/runtime-client

Owns typed client APIs.

Responsibilities:

- In-process client.
- WebSocket client.
- Electron IPC transport adapter.
- Request helpers.
- Subscription helpers.
- Reconnect and replay support.
- Client-side normalized cache primitives.

Rules:

- OpenADE libraries and UIs should use this package for low-level runtime work.
- No direct REST fetches for runtime operations.
- No direct Electron IPC for runtime operations.

### projects/openade-module

Owns the OpenADE product library loaded into the runtime server.

Responsibilities:

- Project model.
- Task model.
- Turn model.
- Item/message projection.
- Comment model.
- Snapshot model.
- OpenADE task execution orchestration.
- Translation from OpenADE tasks/turns to runtime agent executions.
- Translation from runtime notifications to OpenADE task/thread updates.
- Existing Yjs task/repo compatibility.
- Method schemas for OpenADE-specific server methods.
- Handler registration into the runtime server.

Rules:

- May depend on projects/runtime-protocol.
- Node-specific OpenADE host adapters may depend on projects/runtime-node.
- Registers methods on the single runtime server.
- Does not start a second server.
- May contain HyperPlan orchestration if HyperPlan remains an OpenADE feature.
- Must not push HyperPlan into the generic runtime protocol.
- Must not call Electron IPC directly.

### projects/openade-client

Owns typed OpenADE-level client APIs.

Responsibilities:

- Project/task/thread client facade.
- Mobile and dashboard view cache.
- OpenADE-level subscriptions.
- Duplicate submit protection using clientRequestId.
- Friendly online/offline/lagged state for OpenADE UIs.

Rules:

- Dashboard and mobile should both use this package.
- It should call OpenADE module methods through runtime-client, not a companion REST domain API.

### projects/electron

Embeds the generic runtime server and registers the OpenADE module.

Responsibilities:

- Start the runtime server.
- Register the OpenADE module.
- Provide host adapters.
- Provide local dashboard transport.
- Provide remote WebSocket listener.
- Keep OS integrations here:
  - windows
  - tray
  - notifications
  - powerSaveBlocker
  - app lifecycle

### projects/web

Becomes the dashboard client.

Responsibilities:

- UI rendering.
- Client-side cache and view models.
- Desktop-specific UX.
- No direct task execution ownership.
- No direct domain persistence ownership.

Eventually, CodeStore should be reduced into a client cache/view model over openade-client.

### projects/mobile

Becomes the mobile client.

Responsibilities:

- Pairing UX.
- Multi-session/device selection.
- Project/task/thread UI.
- New task/follow-up UI.
- WebSocket connection lifecycle.
- Offline/loading/lag indicators.

Mobile should not have a separate companion domain API. It should speak the same runtime protocol envelope as the desktop dashboard and call OpenADE module methods through that server.

## Low-Level Runtime Model

The low-level runtime model must be generic. It should be useful for other projects that need to execute agents, supervise processes, watch files, and stream activity.

Boundary rule:

- `plan`, `do`, `ask`, `run`, `run_plan`, `review`, `revise`, and `hyperplan` are OpenADE product verbs.
- They must not appear as core runtime request types, runtime status enums, runtime method names, or provider modes.
- The core runtime should describe generic lifecycle actions as `start`, `interrupt`, `reconnect`, `stop`, `read`, `list`, `update`, or `delete`.
- `run` is allowed only as the lifecycle status `running` or in OpenADE-owned product names such as Run Plan.
- The universal low-level agent path is `agent/execution/*`.
- Provider-native `agent/thread/*`, `agent/turn/*`, and `agent/goal/*` methods are allowed only as server-protocol adapter surface for providers like Codex that expose those concepts directly.
- The core runtime may expose generic `agent/execution/*`, provider-native `agent/thread/*` / `agent/turn/*` / `agent/goal/*`, `process/*`, `pty/*`, `fs/*`, and `git/*` operations.
- OpenADE translates its verbs into generic runtime operations through `projects/openade-module`.

### Runtime

A supervised unit of live work.

Kinds:

- agent
- process
- pty
- git
- fsWatch
- composite

Fields:

- runtimeId
- kind
- status
- scope
- nativeId
- pid
- pgid
- processLabel
- processStartedAt
- startedAt
- updatedAt
- lastActivityAt
- exitedAt
- exitCode
- signal
- error

Status:

```ts
export type RuntimeStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "orphaned"
```

Rules:

- Runtime status is live host state.
- Runtime status is not the same as transcript status.
- Running records must not be silently deleted.
- Terminal records may be retained and later deleted.
- Orphaned means the runtime may still exist outside an attachable handle.

### Runtime Scope

A generic association with a directory or caller-defined owner.

Fields:

- workspaceId
- rootPath
- repoPath
- correlationId
- ownerType
- ownerId
- labels

Rules:

- The runtime layer may store caller-provided owner ids.
- The runtime layer must not interpret OpenADE task ids as task semantics.
- OpenADE can pass taskId/eventId as opaque owner ids.

### Agent Execution

A request to start an agent harness execution.

Fields:

- runtimeId
- harnessId
- prompt
- cwd
- additionalDirectories
- env
- model
- mode
- thinking
- fastMode
- resumeSessionId
- forkSession
- mcpServers
- clientTools
- outputSchema
- processLabel
- signal

Rules:

- The runtime knows how to start, stream, steer, interrupt, and stop agent executions.
- The runtime does not know whether an execution came from an OpenADE task, HyperPlan step, CLI command, or another app.
- `mode` here means generic harness execution safety/capability mode, such as read-only versus write-enabled. It must not encode OpenADE modes like Do, Ask, Plan, or Run Plan.

### Agent Provider

An implementation of an agent harness.

Provider modes:

- process
  - Starts a CLI subprocess.
  - Streams JSONL/stdout/stderr.
  - Current Claude/Codex/OpenCode integrations mostly fit here.

- serverProtocol
  - Connects to a long-lived agent server protocol.
  - The provider owns threads, turns, goals, approvals, and richer bidirectional control.
  - Codex app-server style integrations fit here.

Rules:

- The runtime must treat server-protocol harnesses as first-class providers, not as subprocess hacks.
- The runtime protocol should expose provider capabilities.
- OpenADE should choose serverProtocol mode when a harness feature requires it.
- If a feature is only available through a server protocol, do not fake it through plain CLI spawn.

Required provider capabilities:

```ts
export interface AgentProviderCapabilities {
  execution: boolean
  streaming: boolean
  sessions: boolean
  steering: boolean
  interrupt: boolean
  goals: boolean
  approvals: boolean
  filesystem: boolean
  processExec: boolean
}

export interface AgentProvider {
  providerId: string
  kind: "process" | "serverProtocol"
  capabilities: AgentProviderCapabilities
  connect?(): Promise<void>
  disconnect?(): Promise<void>
  status(): Promise<AgentProviderStatus>
  invoke(input: AgentInvocation): AsyncIterable<AgentEvent>
  steer?(runtimeId: string, input: AgentSteerInput): Promise<void>
  interrupt?(runtimeId: string): Promise<void>
  createGoal?(input: AgentGoalCreateInput): Promise<AgentGoal>
  updateGoal?(goalId: string, input: AgentGoalUpdateInput): Promise<AgentGoal>
  completeGoal?(goalId: string): Promise<AgentGoal>
  blockGoal?(goalId: string, reason: string): Promise<AgentGoal>
}
```

Codex-specific implication:

- Codex should have a serverProtocol provider path.
- Features like Goals should use that provider path when Codex requires the app-server/serve protocol.
- The generic runtime should expose goals as optional agent provider capability, not as an OpenADE task feature.
- OpenADE can project provider goals into task UI, but the runtime remains the owner of the low-level goal lifecycle.

### Runtime Item

A streamed low-level activity unit.

Examples:

- agent message delta
- reasoning delta
- tool call started
- tool call completed
- process output delta
- stderr
- session started
- runtime completed
- runtime failed

Fields:

- itemId
- runtimeId
- sequence
- type
- status
- createdAt
- updatedAt
- payload

### Process

A supervised child process.

Fields:

- runtimeId
- processId
- command
- args
- cwd
- env
- pid
- pgid
- status
- outputCursor

### PTY

A supervised terminal session.

Fields:

- runtimeId
- ptyId
- shell
- cwd
- cols
- rows
- pid
- status
- outputCursor

### Directory Root

A generic host directory that a client may operate against.

Fields:

- rootId
- path
- name
- trusted
- capabilities

This can back OpenADE projects, but it should not be called Project in the low-level runtime.

## OpenADE Mid-Level Model

The OpenADE layer builds product concepts on top of the low-level runtime.

### Project

Maps to a repo/directory root plus OpenADE metadata.

Fields:

- id
- name
- path
- archived
- createdAt
- updatedAt
- lastOpenedAt
- gitSummary
- runningTaskCount
- taskPreviewIds

### Task

A durable unit of work inside a project.

Fields:

- id
- projectId
- title
- slug
- mode
- status
- archived
- createdAt
- updatedAt
- lastEventAt
- lastViewedAt
- currentTurnId
- turnIds
- commentIds
- snapshotIds
- worktree
- metadata

### Turn

One execution attempt or follow-up.

Examples:

- do
- plan
- ask
- review
- review follow-up
- hyperplan, but only in the OpenADE layer

Rules:

- OpenADE turn kinds are product semantics, not low-level runtime semantics.
- The OpenADE layer owns prompts, labels, review follow-ups, HyperPlan orchestration, snapshots, task persistence, and idempotent OpenADE request ids.
- The low-level runtime only sees the resulting generic agent/process/git/fs operations and opaque owner/correlation ids.
- Even when OpenADE is registered into the same server process, `do`, `ask`, `plan`, `run_plan`, review, and HyperPlan must remain OpenADE module payload values, not core runtime method names, provider modes, or lifecycle statuses.

Fields:

- id
- taskId
- kind
- prompt
- status
- harnessId
- model
- startedAt
- completedAt
- interruptedAt
- error
- itemIds
- usage

### Item

A projected transcript or activity unit built from runtime items plus OpenADE metadata.

Examples:

- user message
- assistant message
- assistant text delta
- reasoning summary
- tool call
- tool result
- process output
- git snapshot
- error

Fields:

- id
- taskId
- turnId
- type
- status
- createdAt
- updatedAt
- sequence
- payload

### Comment

User-authored comment or instruction outside a running turn.

Fields:

- id
- taskId
- body
- anchor
- createdAt
- updatedAt

### Snapshot

Git/file state captured during task history.

Fields:

- id
- taskId
- kind
- status
- summary
- gitRefs
- changedFiles
- createdAt

### HyperPlan Boundary

HyperPlan is not a low-level runtime concept.

If OpenADE keeps HyperPlan:

- OpenADE owns the HyperPlan composite plan/executor.
- OpenADE starts low-level agent runtimes for child steps.
- OpenADE maps child runtime lifecycle back into the main task turn.
- The runtime only sees generic agent/process runtimes with opaque correlation ids.

This keeps the low-level runtime useful outside OpenADE.

## Protocol Shape

Use a JSON-RPC-like envelope:

```ts
export type RuntimeRequest = {
  id: string | number
  method: string
  params?: unknown
}

export type RuntimeResponse =
  | { id: string | number; result: unknown }
  | { id: string | number; error: RuntimeError }

export type RuntimeNotification = {
  method: string
  params?: unknown
}

export type RuntimeMessage = RuntimeRequest | RuntimeResponse | RuntimeNotification
```

Method naming rules:

- Use resource/method.
- Use singular resource names.
- Use camelCase fields on the wire.
- Use plain string ids at the protocol boundary.
- Use ISO timestamp strings consistently for runtime records and OpenADE persisted metadata. Provider-native elapsed counters may remain numeric when they are durations or usage counters, not wall-clock timestamps.
- Every mutating request should accept clientRequestId for idempotency.

Runtime lifecycle methods:

- initialize
- server/status/read
- subscription/update

Runtime methods:

- runtime/list
- runtime/read
- runtime/stop
- runtime/reconcile

Agent methods:

- agent/provider/list
- agent/provider/read
- agent/provider/status
- agent/provider/connect
- agent/provider/disconnect
- agent/serverProtocol/list
- agent/model/list
- agent/session/list
- agent/session/read
- agent/session/active
- agent/session/delete
- agent/execution/start
- agent/execution/interrupt
- agent/execution/reconnect
- agent/execution/buffer/clear
- agent/tool/respond
- agent/query/structured
- agent/thread/start, provider-native server-protocol only
- agent/thread/resume, provider-native server-protocol only
- agent/turn/start, provider-native server-protocol only
- agent/turn/steer, provider-native server-protocol only
- agent/turn/interrupt, provider-native server-protocol only
- agent/turn/replay, provider-native server-protocol only
- agent/goal/create
- agent/goal/read
- agent/goal/update
- agent/goal/complete
- agent/goal/block
- agent/goal/set
- agent/goal/get
- agent/goal/clear
- agent/approval/list
- agent/approval/respond
- agent/approval/reject

Git methods:

- git/installed/read
- git/directory/read
- git/gh/read
- git/status/read
- git/summary/read
- git/mergeBase/read
- git/branch/list
- git/branch/merged/read
- git/branch/delete
- git/worktree/list
- git/worktree/getOrCreate
- git/worktree/diffPatch
- git/worktree/commit
- git/worktree/delete
- git/file/list
- git/path/resolve
- git/repo/init
- git/log/read
- git/changedFiles/read
- git/commit/files/read
- git/fileAtTreeish/read
- git/filePair/read
- git/worktree/filePatch/read
- git/commit/filePatch/read

File system methods:

- fs/path/describe
- fs/file/read
- fs/file/write
- fs/directory/create
- fs/path/copy
- fs/path/remove
- fs/search/fuzzy
- fs/search/content
- fs/watch/start
- fs/watch/stop
- fs/watch/list

Process methods:

- process/command/start
- process/script/start
- process/reconnect
- process/kill
- process/killAll
- process/list

PTY methods:

- pty/spawn
- pty/write
- pty/resize
- pty/reconnect
- pty/kill
- pty/killAll

OpenADE project methods:

- openade/project/list
- openade/repo/create
- openade/repo/update
- openade/repo/delete

OpenADE task methods:

- openade/task/list
- openade/task/read
- openade/task/delete
- openade/task/metadata/update
- openade/task/environment/setup

OpenADE turn methods:

- openade/turn/start
- openade/turn/interrupt
- openade/review/start
- openade/action/create
- openade/action/stream/append
- openade/action/complete
- openade/action/error
- openade/action/stopped
- openade/action/reconcileRuntime
- openade/action/execution/update
- openade/hyperplan/subExecution/add
- openade/hyperplan/subExecution/stream/append
- openade/hyperplan/subExecution/update
- openade/hyperplan/reconcileLabels/set
- openade/snapshot/read
- openade/snapshot/create

OpenADE comment methods:

- openade/comment/create
- openade/comment/edit
- openade/comment/delete

Runtime notifications:

- runtime/created
- runtime/updated
- runtime/completed
- runtime/failed
- runtime/stopped
- agent/event
- agent/thread/started
- agent/thread/resumed
- agent/turn/started
- agent/turn/delta
- agent/turn/completed
- agent/turn/failed
- agent/approval/requested
- agent/goal/updated
- agent/goal/cleared
- process/started
- process/output
- process/exit
- process/error
- pty/started
- pty/output
- pty/exit
- pty/killed
- fs/watch/event
- fs/watch/stopped
- connection/lagged
- host/mcp/oauthComplete

OpenADE notifications:

- openade/snapshotChanged
- openade/repo/updated
- openade/repo/deleted
- openade/task/updated
- openade/task/deleted
- openade/task/previewChanged
- openade/workingTasks
- remote/device/changed

## Runtime Liveness Model

The old runtime stabilization plan is still valid, but it should be generalized and moved below the low-level runtime protocol.

Current problem:

- Electron can still own a child process while the renderer thinks the task failed or stopped.
- Renderer reload can mutate durable task state before asking the host whether work is still alive.
- Cleanup timers and clear-buffer paths can drop in-memory execution records too early.
- HyperPlan exposed a bug because one OpenADE event could correspond to multiple child agent runtimes.

New rule:

- The runtime server is authoritative for live liveness.
- OpenADE task/event history is durable transcript state.
- The UI derives spinners from runtime liveness first, then falls back to durable OpenADE status.

Status layers:

```ts
export type AgentInvocationStatus =
  | "in_progress"
  | "completed"
  | "error"
  | "aborted"

export type RuntimeStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "orphaned"

export type OpenADEEventStatus =
  | "in_progress"
  | "completed"
  | "error"
  | "stopped"

export function mapAgentStatusToRuntime(status: AgentInvocationStatus): RuntimeStatus {
  switch (status) {
    case "in_progress":
      return "running"
    case "completed":
      return "completed"
    case "error":
      return "failed"
    case "aborted":
      return "stopped"
  }
}
```

Rules:

- Preserve existing harness wire status spelling where it exists.
- Map harness `"aborted"` to runtime `"stopped"`.
- Map runtime `"stopped"` to OpenADE event `"stopped"`.
- Do not persist `"detached"` in OpenADE event history initially.
- Detached/orphaned is derived from runtime reconciliation.
- Running runtime records cannot be deleted by retention timers or clear-buffer paths.
- Terminal runtime records can be retained and cleaned later.
- PID existence alone is not proof of ownership.
- A process must be verified by handle, process group, command label, and ideally start time before adoption.

Guarded runtime deletion:

```ts
type RuntimeDeleteReason = "timer" | "clear_buffer" | "shutdown" | "manual"

function deleteRuntimeRecord(runtimeId: string, reason: RuntimeDeleteReason): boolean {
  const runtime = runtimes.get(runtimeId)
  if (!runtime) return false

  if (runtime.status === "starting" || runtime.status === "running") {
    log.warn("Refusing to delete active runtime", {
      runtimeId,
      reason,
      status: runtime.status,
    })
    resetRuntimeCleanupTimer(runtimeId)
    return false
  }

  clearRuntimeCleanupTimer(runtimeId)
  runtimes.delete(runtimeId)
  return true
}
```

Runtime reconciliation:

- On reconnect, ask runtime server first.
- If runtime is running, keep the OpenADE event in progress.
- If runtime is completed, apply completion to OpenADE state.
- If runtime is failed, apply error to OpenADE state.
- If runtime is stopped, apply stopped to OpenADE state.
- If runtime is missing, show derived detached/orphaned UI until stronger evidence is available.
- Do not mark an event as error just because the renderer could not find a local record.

Cold-start behavior:

- Normal quit stops owned runtimes.
- Crash/restart loads runtime checkpoints.
- Verified live runtimes are adopted or marked orphaned.
- Missing runtimes are reconciled into stopped/failed at the OpenADE layer.
- Runtime checkpoints must be minimal and must not persist prompts beyond existing app storage.

Suggested constants:

```ts
const TERMINAL_RUNTIME_RETENTION_MS = 30 * 60 * 1000
const STARTING_TIMEOUT_MS = 2 * 60 * 1000
const STALE_RUNNING_PROBE_MS = 10 * 60 * 1000
const ORPHANED_RUNTIME_RETENTION_MS = 24 * 60 * 60 * 1000
```

OpenADE-specific composite runtimes:

- HyperPlan should be modeled in openade-module, not runtime.
- openade-module can create a composite owner record that references child runtimeIds.
- The low-level runtime only sees child agent/process runtimes.
- The OpenADE UI can show the parent turn as running while any child runtime is running.

### RuntimeSupervisor API

RuntimeSupervisor should live in projects/runtime, with host-specific probe support supplied by projects/runtime-node.

```ts
export interface RuntimeScope {
  workspaceId?: string
  rootPath?: string
  repoPath?: string
  correlationId?: string
  ownerType?: string
  ownerId?: string
  labels?: Record<string, string>
}

export interface RuntimeRecord {
  runtimeId: string
  kind: "agent" | "process" | "pty" | "git" | "fsWatch" | "composite"
  status: RuntimeStatus
  scope: RuntimeScope
  nativeId?: string
  pid?: number
  pgid?: number
  processLabel?: string
  processStartedAt?: string
  startedAt: string
  updatedAt: string
  lastActivityAt: string
  exitedAt?: string
  exitCode?: number | null
  signal?: string | null
  error?: string
}

export interface RuntimeCheckpoint {
  runtimeId: string
  kind: RuntimeRecord["kind"]
  status: RuntimeStatus
  scope: RuntimeScope
  nativeId?: string
  pid?: number
  pgid?: number
  processLabel?: string
  processStartedAt?: string
  startedAt: string
  updatedAt: string
  lastActivityAt: string
}

export interface RuntimeSupervisor {
  register(record: RuntimeRecord): RuntimeRecord
  update(runtimeId: string, patch: Partial<RuntimeRecord>): RuntimeRecord | undefined
  get(runtimeId: string): RuntimeRecord | undefined
  list(filter?: RuntimeListFilter): RuntimeRecord[]
  attach(runtimeId: string, clientId: string): RuntimeAttachResult
  stop(runtimeId: string, reason?: string): Promise<RuntimeStopResult>
  deleteTerminal(runtimeId: string, reason: string): boolean
  reconcileRuntime(runtimeId: string): Promise<RuntimeReconcileResult>
  reconcileColdStart(): Promise<void>
}
```

## Host Adapter Interfaces

The runtime server should call host powers through interfaces.

```ts
export interface FsAdapter {
  readFile(path: string): Promise<{ content: string; encoding: "utf8" | "base64" }>
  writeFile(path: string, content: string, options?: { encoding?: "utf8" | "base64" }): Promise<void>
  readDirectory(path: string): Promise<FsEntry[]>
  createDirectory(path: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
  copy(from: string, to: string): Promise<void>
  watch(path: string, options?: FsWatchOptions): AsyncIterable<FsChange>
}

export interface GitAdapter {
  status(repoPath: string): Promise<GitStatus>
  diff(repoPath: string, options: GitDiffOptions): Promise<GitDiff>
  listBranches(repoPath: string): Promise<GitBranch[]>
  commit(repoPath: string, options: GitCommitOptions): Promise<GitCommitResult>
  createWorktree(repoPath: string, options: GitWorktreeOptions): Promise<GitWorktree>
  deleteWorktree(repoPath: string, worktreePath: string): Promise<void>
}

export interface ProcessAdapter {
  spawn(options: SpawnOptions): Promise<ProcessHandle>
  write(processId: string, data: string): Promise<void>
  resize(processId: string, cols: number, rows: number): Promise<void>
  kill(processId: string, signal?: string): Promise<void>
  list(): Promise<ProcessSummary[]>
}

export interface AgentAdapter {
  listProviders(): Promise<AgentProviderSummary[]>
  getProvider(providerId: string): Promise<AgentProvider>
  listSessions(providerId: string, cwd?: string): Promise<AgentSession[]>
  isSessionActive(providerId: string, sessionId: string): Promise<boolean>
}

export interface StorageAdapter {
  readDoc(collection: string, id: string): Promise<Uint8Array | null>
  writeDoc(collection: string, id: string, update: Uint8Array): Promise<void>
  listDocs(collection: string): Promise<string[]>
  deleteDoc(collection: string, id: string): Promise<void>
}

export interface SecretAdapter {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}
```

Initial adapter mapping:

- FsAdapter wraps current Electron file APIs and future Node fs implementation.
- GitAdapter wraps projects/electron/src/modules/code/git.ts.
- ProcessAdapter wraps projects/electron/src/modules/code/process.ts.
- AgentAdapter wraps projects/harness, projects/electron/src/modules/code/harness.ts behavior, and server-protocol providers such as Codex app-server.
- StorageAdapter initially wraps projects/electron/src/modules/code/yjsStorage.ts.
- SecretAdapter should stay host-local and never expose raw secrets to remote clients.

## Transport Plan

### In-process transport

Used by:

- Electron dashboard.
- Tests.
- Future embedded JS library.

Purpose:

- Avoid network overhead for local UI.
- Still force the dashboard to use the same protocol.
- Prevent renderer-only ownership from creeping back in.
- Let openade-module call runtime services without a network hop when embedded.

### WebSocket transport

Used by:

- Mobile app.
- Future browser dashboard pointed at a local daemon.
- Future remote dashboards over private network.

Requirements:

- One stable socket per connected client.
- Initialize handshake before any domain requests.
- Auth required for all non-loopback listeners.
- Heartbeat ping/pong.
- Server-side queue bounds.
- Slow-client disconnect.
- Replay cursor support.
- Device revocation closes only that device socket.

### HTTP transport

Keep only for:

- health
- ready
- pairing bootstrap
- static webapp hosting if needed
- debugging snapshots if explicitly enabled

Do not use HTTP as the main domain API.

### Electron IPC transport

Use only as a transport layer to runtime-client/openade-client, not as the domain API itself.

## Streaming Plan

The old REST + SSE domain model should be replaced with runtime notifications and OpenADE module notifications over WebSocket.

Current issue:

- Mobile opens an SSE stream.
- React navigation can recreate subscriptions.
- SSE mostly tells the client to refetch.
- Command submission is separate REST.
- The UI frequently flips into Connecting.

Target:

- Client opens one WebSocket.
- Client sends initialize.
- Client subscribes to scopes.
- Runtime server sends low-level runtime snapshots and notifications.
- openade-module projects those into OpenADE project/task/thread snapshots.
- Client updates a normalized cache.
- Navigation changes subscriptions but does not recreate the socket.
- Commands return immediate ack.
- Long-running work streams deltas.

Submission flow:

1. Mobile creates clientRequestId.
2. Mobile sends openade/turn/start.
3. openade-module creates or updates the task/turn.
4. openade-module calls runtime agent/execution/start with opaque owner ids.
5. Server returns taskId, turnId, and runtimeId immediately.
6. UI shows Sending until ack.
7. UI disables duplicate submit for that clientRequestId.
8. Server deduplicates repeated clientRequestId.
9. Runtime streams agent/runtime deltas.
10. openade-module projects runtime deltas into OpenADE item/thread updates.

Delivery classes:

- Lossless:
  - runtime created
  - runtime terminal state
  - OpenADE task created
  - OpenADE task updated
  - OpenADE turn started
  - OpenADE turn completed
  - agent message deltas
  - OpenADE item completed
  - errors

- Best effort:
  - transient progress
  - process output bursts
  - git refresh progress
  - activity spinner details

Lag behavior:

- If a client falls behind, send connection/lagged.
- Client refetches the current project/task snapshot.
- Do not keep appending unbounded buffered events.

## Permission Model

Clients should connect with a profile.

### Runtime local-owner profile

Allowed:

- fs read/write
- git operations
- process operations
- pty operations
- agent execution
- settings
- device management

### Runtime remote-limited profile

Allowed by default:

- agent execution only through approved owner scopes
- runtime/read for owned or allowed runtimes
- runtime/stop for owned or allowed runtimes
- directory/read for allowed roots
- git/status for allowed roots
- fs/readFile only if explicitly allowed

Denied by default:

- raw fs/writeFile
- raw process/command/start
- raw process/script/start
- raw pty/spawn
- raw git/commit
- secret access
- settings that affect the host machine

### OpenADE local dashboard profile

Allowed:

- project read/write
- task read/write
- turn start/steer/interrupt
- comment create/update/delete
- snapshot operations
- full allowed runtime access through openade-module

### OpenADE mobile remote profile

Allowed by default:

- openade/project/list
- openade/snapshot/read
- openade/task/list
- openade/task/read
- task creation through openade/turn/start
- openade/turn/start
- turn/interrupt
- openade/review/start
- remote/device/selfRevoke

Denied by default:

- openade/repo/create
- openade/repo/update
- openade/repo/delete
- openade/task/delete
- openade/task/metadata/update
- openade/action/*
- openade/snapshot/create
- openade/comment/* until mobile has validated comment UX

Future:

- Add per-device permission toggles.
- Add "require desktop confirmation for remote turns".
- Add per-project allowlist.

## Pairing And Auth

Keep QR pairing, but make it issue protocol credentials.

Pairing flow:

1. Desktop creates short-lived pairing session.
2. QR contains HTTP pairing URL with token, hostId, expiresAt.
3. Mobile confirms the host before pairing.
4. Mobile exchanges pairing token for device credential.
5. Mobile stores credential in secure storage.
6. Mobile opens authenticated WebSocket.

Credential requirements:

- Per-device.
- Revocable.
- Has explicit scope.
- Stored hashed server-side.
- Never committed to repo.
- Never displayed after initial pairing.

WebSocket auth:

- Loopback may allow local dev auth shortcuts.
- Tailscale/LAN must require auth.
- Reject unauthenticated non-loopback listeners.
- Consider capability-token first.
- Consider signed bearer token later if we need delegation.

## Storage Strategy

Do not rewrite storage at the same time as protocol.

Initial approach:

- Keep current Yjs persistence.
- Wrap it behind StorageAdapter.
- Runtime services and OpenADE module handlers read/write through adapters, not direct renderer stores.
- Preserve existing task/repo documents.

Later approach:

- Evaluate SQLite/event log for durable task and item storage.
- Keep Yjs only where collaborative editing is useful.
- Add migration from current Yjs docs.

Reason:

- Transport and ownership are the immediate problem.
- Rewriting persistence at the same time increases risk.

## Migration Plan

### Phase 0: Inventory and RFC

Deliverables:

- This plan.
- Inventory current IPC/domain APIs.
- Decide protocol schema library.
- Decide timestamp format.
- Decide initial package names.

Exit criteria:

- Clear method list.
- Clear adapter list.
- Clear first implementation slice.

### Phase 1: Protocol and WebSocket without moving ownership yet

Deliverables:

- projects/runtime-protocol.
- projects/runtime-client.
- projects/openade-module.
- projects/openade-client.
- WebSocket transport in Electron companion module.
- Stable mobile socket.
- initialize request.
- runtime/list.
- runtime/read.
- agent/provider/list.
- agent/provider/status.
- agent/execution/start.
- agent/execution/interrupt.
- agent/goal/read if provider supports goals.
- openade/project/list through OpenADE module handlers.
- openade/task/list through OpenADE module handlers.
- openade/task/read through OpenADE module handlers.
- openade/turn/start through OpenADE module handlers.
- openade/turn/interrupt through OpenADE module handlers.
- subscription/update.
- connection/heartbeat.
- connection/lagged.

Implementation detail:

- The first server implementation was allowed to call the renderer controller only as a stepping stone.
- The completed rewrite should not retain that renderer-controller fallback.

Exit criteria:

- Mobile no longer uses SSE for domain streaming.
- Mobile does not reconnect on navigation.
- Mobile shows live item deltas.
- Duplicate submit is prevented with clientRequestId.
- OpenADE mobile traffic is already shaped like the future protocol, even if the implementation still delegates to renderer code.

### Phase 2: Runtime facade plus OpenADE facade over current CodeStore

Deliverables:

- RuntimeServer interface.
- OpenADE module registration interface.
- AgentProvider interface with process and serverProtocol implementations.
- Adapter-backed services that wrap current CodeStore behavior.
- Dashboard uses openade-client.
- Mobile uses the same methods as dashboard.
- openade-module maps openade/turn/start to runtime agent/execution/start.

Implementation detail:

- CodeStore can remain underneath temporarily.
- UI code should no longer call OpenADETurnManager directly.
- UI code should call openade/turn/start through openade-client.
- OpenADE-specific features remain in openade-module.
- The runtime layer only sees generic agent/process/git/fs operations.
- Codex can initially keep a process provider path, but the serverProtocol provider path must exist before building Codex features that require it.

Exit criteria:

- Dashboard and mobile share the same protocol path for project/task/turn operations.
- Remote-specific domain request types are removed from the active control path.
- Low-level runtime methods are usable without OpenADE task/project concepts.

### Phase 3: Move runtime ownership into Electron main

Deliverables:

- Electron main starts the runtime server.
- Electron main registers openade-module.
- Current Electron IPC modules become host adapters.
- Renderer becomes a client only.
- Companion no longer depends on renderer for execution.
- RuntimeSupervisor exists in the runtime layer.
- Agent providers are owned by runtime, including server-protocol providers.

Implementation detail:

- Low-level lifecycle logic moves into runtime services.
- Codex server-protocol connection lifecycle moves into runtime services.
- Remaining ExecutionManager lifecycle glue moves into openade-module/runtime services.
- The web store becomes a view/cache layer.

Exit criteria:

- Remote tasks can run with dashboard renderer closed or reloaded.
- Dashboard can reconnect and resubscribe.
- Mobile and dashboard see the same task state.
- Runtime liveness is authoritative outside the renderer.

### Phase 4: Headless runtime

Deliverables:

- Node CLI entrypoint, for example `runtime-node serve`.
- WebSocket listener.
- Local config loading.
- Node adapters.
- Test harness with in-memory adapters.
- Optional openade-module loaded into the runtime server.

Exit criteria:

- Runtime can run outside Electron.
- Other projects can use runtime without OpenADE.
- Dashboard can connect to headless runtime with OpenADE module loaded.
- Mobile can connect to headless runtime with OpenADE module loaded over private network.

### Phase 5: Server-protocol harness providers

Deliverables:

- Add serverProtocol AgentProvider implementation.
- Add Codex app-server provider.
- Support provider connect/disconnect/status.
- Support provider capability discovery.
- Support agent/goal lifecycle methods for providers that expose goals.
- Map provider thread/turn/item notifications into runtime notifications.
- Keep process-backed providers for CLI-only harnesses.

Exit criteria:

- Codex can run through app-server/serve protocol when required.
- Codex Goals use agent/goal methods instead of OpenADE-specific task hacks.
- OpenADE can project Codex goal state into task UI if desired.
- Providers without goal support fail agent/goal calls with a typed unsupported-capability error.

### Phase 6: Storage redesign if needed

Deliverables:

- Storage decision doc.
- Migration path from current Yjs docs.
- Event log or SQLite prototype if needed.

Exit criteria:

- Persistence is simpler, testable, and no longer bound to renderer lifecycle.

### Phase 7: Process and PTY consolidation

Deliverables:

- Move repo processes onto runtime lifecycle.
- Move PTYs onto runtime lifecycle.
- Keep process stdout/stderr and PTY byte streams specialized, but share lifecycle/status/stop/reconnect logic.
- Replace renderer beforeunload cleanup once runtime-owned cleanup is proven.

Exit criteria:

- Runtime server owns agent, process, and PTY liveness consistently.
- Quit warning uses runtime active-state checks.
- workingTaskIds is removed as a source of truth.

## Compatibility Plan

During migration:

- Keep existing desktop UI working.
- Keep existing task docs readable.
- Keep current companion HTTP pairing.
- Introduce WebSocket as the preferred runtime channel.
- Remove REST/SSE command and update compatibility after mobile and dashboard use openade-client.

Backward compatibility:

- Protocol version included in initialize.
- Server can reject unsupported clients with a structured error.
- Mobile should show a clear "Desktop update required" message.

## Testing Plan

### Protocol tests

- Request/response parsing.
- Notification parsing.
- Unknown method error.
- Invalid params error.
- initialize required.
- Version mismatch.
- Generated schema snapshots.

### Runtime service tests

- runtime/list.
- runtime/read.
- runtime/stop.
- runtime/reconcile.
- active runtime cannot be deleted by timer cleanup.
- active runtime cannot be deleted by clear-buffer cleanup.
- terminal runtime can be retained and deleted.
- stale running runtime is probed.
- verified dead process transitions terminal.
- PID-only false positive does not adopt an unverified process.
- agent/execution/start streams deltas and terminal state.
- agent/execution/interrupt maps to runtime stopped.
- process-backed agent provider maps CLI JSONL to runtime events.
- server-protocol agent provider maps remote protocol events to runtime events.
- agent provider capabilities expose goals only when supported.
- agent/goal lifecycle works for a provider that supports goals.
- agent/goal requests fail cleanly for providers without goal support.
- process/command/start and process/script/start stream output and exit.
- pty/spawn streams output and exit.
- permission denial for raw fs/process/pty calls.

### OpenADE module tests

- openade/project/list.
- openade/task/create.
- openade/task/read.
- openade/turn/start.
- openade/turn/interrupt.
- task preview updates after item changes.
- clientRequestId dedupe.
- permission denial.
- openade/turn/start maps to runtime agent/execution/start.
- runtime terminal state maps to OpenADE event status.
- runtime running state keeps OpenADE event in_progress.
- missing runtime does not immediately mark event error.
- OpenADE composite work maps child runtime status into parent task/turn state.

### Transport tests

- WebSocket connect/initialize.
- heartbeat.
- reconnect.
- replay from cursor.
- lag notification.
- bounded queue behavior.
- revoked device disconnects only that device.

### Adapter tests

- fs path validation.
- git status/diff/commit wrappers.
- process output streaming.
- process kill.
- agent/harness event mapping.
- Yjs metadata id validation.

### UI tests

- Dashboard uses openade-client.
- Mobile uses one stable socket.
- Mobile does not duplicate submit.
- Mobile shows online/offline/lagged states.
- Thread auto-scrolls on live deltas.
- New task page receives ack and streams progress.
- Sidebar/task lists show runtime spinner before stale transcript state.
- Derived detached/orphaned state is not persisted as an OpenADE event status.

## Open Source Safety

This repo is open source, so the rewrite must keep secrets out of source control.

Rules:

- No checked-in tokens.
- No checked-in signing keys.
- No checked-in App Store credentials.
- No checked-in personal Tailscale URLs as defaults.
- Sample env files must use placeholders only.
- Protocol logs must redact credentials.
- Pairing URLs must be short-lived.
- Device tokens must be hashed at rest.

## First Implementation Slice

The first slice should fix the current streaming pain while laying the runtime protocol and OpenADE module foundation.

Build:

- projects/runtime-protocol
- projects/runtime-client
- projects/openade-module
- projects/openade-client
- WebSocket transport for companion
- initialize
- runtime/list
- runtime/read
- runtime/reconcile
- agent/execution/start
- agent/execution/interrupt
- openade/project/list
- openade/task/list
- openade/task/read
- openade/turn/start
- openade/turn/interrupt
- subscription/update
- heartbeat
- lag notification
- clientRequestId dedupe
- guarded active-runtime deletion

Do not build yet:

- full storage rewrite
- raw fs/process mobile permissions
- raw pty mobile permissions
- signed bearer token auth unless capability token is insufficient
- SQLite migration
- OpenADE-specific features in the runtime layer

Why this slice:

- It immediately improves mobile responsiveness.
- It removes SSE churn.
- It prevents double submits.
- It starts moving all clients to the same protocol.
- It starts separating generic runtime protocol from OpenADE task semantics.
- It avoids a high-risk full rewrite in one pass.

## Final Target State

The final architecture should feel like this internally:

- Runtime owns low-level liveness.
- Runtime protocol is useful outside OpenADE.
- OpenADE owns project/task/product semantics.
- UIs render projected state.
- Transports move protocol messages.
- Adapters provide host powers.
- Agent harnesses execute behind runtime.
- Streaming is a first-class event log, not a side channel.
- Mobile and desktop are peers on the same runtime server, with different permissions and OpenADE module capabilities.
