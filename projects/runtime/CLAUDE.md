# OpenADE Runtime Guidance

## Intent

- This package owns the reusable runtime protocol surface.
- Keep it low level enough to use outside OpenADE.
- Put OpenADE product concepts in an OpenADE module, not in the generic runtime protocol.

## Layering

- `projects/runtime-protocol/src/protocol.ts` defines wire types and stable method payloads.
- `projects/runtime/src/server.ts` owns request routing, capabilities, subscriptions, and method permissions.
- `projects/runtime-client/src/client.ts` owns WebSocket request/response and notification reconnect behavior.
- `projects/runtime/src/supervisor.ts` owns generic runtime lifecycle state.
- Electron registers host adapters and OpenADE-specific handlers on one runtime server.

## Boundaries

- Generic runtime concepts are allowed:
  - agent providers
  - generic agent executions
  - provider-native server-protocol threads, turns, goals, approvals when an adapter requires them
  - processes
  - PTYs
  - git repositories
  - files and directories
  - runtime lifecycle records
- OpenADE concepts do not belong in the generic runtime:
  - projects
  - tasks
  - comments
  - snapshots
  - HyperPlan
  - product execution modes and review workflows
  - UI layout or route state
- OpenADE-specific methods must use the `openade/*` namespace.
- OpenADE product modes may appear only as OpenADE module payload values. They must not become core method segments, runtime statuses, agent provider modes, or low-level agent options.
- Do not add `do`, `ask`, `plan`, `run`, `run_plan`, `review`, `revise`, or `hyperplan` to core method names, runtime statuses, request payload types, provider modes, or low-level agent options. Those are OpenADE product verbs over generic runtime execution.
- `RuntimeServer.register()` and `RuntimeServer.registerNotification()` are product-agnostic. Enforce product boundaries in module tests and package ownership, not by teaching the generic server OpenADE vocabulary.
- Use generic verbs in core method names: `start`, `interrupt`, `reconnect`, `stop`, `read`, `list`, `update`, `delete`.
- Do not add product-specific task modes as core method names.
- Use `agent/execution/*` as the universal low-level agent execution path.
- Treat `agent/thread/*`, `agent/turn/*`, and `agent/goal/*` as provider-native server-protocol adapter methods, not as OpenADE task or product-turn semantics.

## Transport

- Prefer WebSocket at `/v1/runtime` for new clients.
- Prefer trusted runtime IPC for the desktop renderer.
- Do not add REST command endpoints or SSE streams for runtime work.
- HTTP may still bootstrap pairing and health checks.
- Use one server process and one transport stack; do not create a separate OpenADE server.
- All transports, including trusted local IPC, must initialize before domain/runtime requests. Do not add a local bypass that can invoke runtime methods before `initialize`.
- Local trusted clients may use all runtime methods.
- Paired companion devices are scoped to safe method prefixes and must not receive direct `process/*`, `pty/*`, `fs/*`, or `git/*` access by default.
- Restricted transports must set both request permissions and notification permissions. Method denial is not enough if raw host notifications can still leak through a `*` subscription.

## Streaming

- Runtime notifications are the realtime path.
- Use `runtime/*` for lifecycle updates.
- Use low-level namespaces like `process/output` and `pty/output` for host streams.
- Use `fs/watch/*` for low-level filesystem watching.
- Use `openade/*` notifications for product-level invalidation and projections.
- Slow clients should be treated as lagged instead of allowing unbounded buffering.

## Runtime State

- Runtime records carry caller ownership and path context in `scope`, not as flat top-level owner/path fields.
- Preserve older flat checkpoint records by normalizing their owner/path fields into `scope` during checkpoint hydration.
- Runtime wall-clock timestamps are ISO strings.
- `runtime/list` supports filtering by scoped `ownerType`, scoped `ownerId`, `status`, and `statuses`; active-only UI/product callers should use those filters instead of listing every runtime and filtering later.
- Persist only minimal runtime checkpoints.
- Active checkpointed runtimes should reload as `orphaned` unless a host adapter verifies an alive adoptable process group plus process identity metadata.
- Runtime reconciliation may use a host liveness probe to mark verified-dead runtimes terminal.
- `runtime/stop` is a lifecycle method, not just a state mutation; host adapters should register stop handlers with `RuntimeServer.registerRuntimeStopHandler` so agent/process/PTY/watch runtimes are stopped at the source before the supervisor marks them stopped.
- Do not treat PID existence alone as proof that OpenADE still owns a process; weak host evidence should return `unknown`.
- Mutating low-level method calls may carry `clientRequestId`. RuntimeServer deduplicates successful mutating method calls by principal, method, and request id while preserving the caller's current JSON-RPC response id; failures are not retained.
- RuntimeServer may receive product/host-owned `onSlowRequest` and `onNotificationBurst` observers. Keep those hooks generic and sanitized: slow requests may include service name, method name, sanitized/truncated request id, total duration, queue wait, handler time, connection id, failed flag, and error code; notification bursts may include service name, notification method, count, and window duration. Request params, notification params, file paths, prompts, task content, tokens, raw unbounded client-controlled ids, or product-specific payload fields are not allowed in these observer events.

## Agent Providers

- Support both subprocess CLI harnesses and server-protocol harnesses.
- Process-backed harnesses should route through generic `agent/execution/*` methods.
- Codex server-protocol support may route through provider-native `agent/thread/*`, `agent/turn/*`, and `agent/goal/*` methods because Codex exposes those protocol concepts directly.
- Server-protocol approvals should route through generic `agent/approval/*` methods rather than OpenADE task-specific control paths.
- Do not special-case Codex goals as OpenADE task state.
- Keep provider-specific protocol translation in an adapter bridge.

## Security

- Treat this repo as open source.
- Never commit private tokens, signing keys, App Store keys, R2 credentials, Tailscale keys, or user-specific secrets.
- Do not log bearer tokens, pairing tokens, private keys, prompts from secret files, or env values.
- Add explicit method permissions whenever exposing a runtime transport to an untrusted or semi-trusted client.
- Filter `initialize` and `server/status/read` capabilities through the current connection permissions. Do not leak methods or notifications the connection cannot use.
- Add notification permissions too; method permissions alone do not restrict pushed notifications.

## Tests

- Add protocol tests for new method namespaces.
- Add permission tests when exposing host powers.
- Add reconnect/backpressure tests when changing transport behavior.
- Keep renderer/mobile builds passing after shared runtime changes.
