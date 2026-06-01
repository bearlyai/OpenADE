# Runtime Node

Target package for Node host adapters.

- Own generic Node adapters for fs, git, process, PTY, agent harnesses, checkpoints, and OS liveness probes.
- Do not import React or Electron UI code.
- Electron may use this package, but host powers should stay behind adapter interfaces.
- fsWatch.ts owns runtime `fs/watch/*` registration and watcher cleanup.
- files.ts owns runtime `fs/path/*`, `fs/file/*`, `fs/directory/*`, and `fs/search/*` registration plus the generic browser-safe DTO types for those methods. Electron and renderer bridge code should import those types instead of duplicating them.
- localFiles.ts owns the default headless Node filesystem adapter used by `runtime-node serve`.
- git.ts owns runtime `git/*` registration through an adapter.
- localGit.ts owns the default headless Node Git adapter used by `runtime-node serve`.
- process.ts owns runtime `process/*` registration and lifecycle projection through an adapter.
- localProcess.ts owns the default headless Node process adapter used by `runtime-node serve`.
- pty.ts owns runtime `pty/*` registration and lifecycle projection through an adapter.
- localPty.ts owns the default headless shell-backed PTY adapter used by `runtime-node serve`. It provides PTY lifecycle semantics without depending on Electron or native `node-pty`; embedders can inject a richer native PTY adapter later.
- Host adapter mutable state must be per adapter/server instance, not module global. Multiple embedded runtime servers in one process must not see each other's process, PTY, or watch records.
- agents.ts owns generic runtime `agent/*` registration for process-backed Claude Code and Codex harnesses in headless Node mode.
- Server-protocol agent bridge registration should use a runtime-specific bridge registry. Do not put Codex/app-server provider connections in module-global state.
- process.ts, pty.ts, fsWatch.ts, and agents.ts should register `runtime/stop` handlers so the generic lifecycle stop path reaches the host adapter instead of only changing supervisor state.
- validation.ts owns shared method-boundary validation helpers. Low-level adapters should reject malformed params as `invalid_params` before touching filesystem, process, PTY, git, or agent state.
- Mutating filesystem methods (`fs/file/write`, `fs/directory/create`, `fs/path/copy`, `fs/path/remove`) are generic host primitives. They may accept `clientRequestId` for runtime-server idempotency, but must not encode OpenADE task, turn, or command semantics.
- Process-backed agent work should use `agent/execution/*` primitives.
- Server-protocol providers may expose provider-native `agent/thread/*`, `agent/turn/*`, and `agent/goal/*` methods only when the upstream provider requires those concepts.
- OpenADE product execution modes belong in openade-module.
- Do not add `do`, `ask`, `plan`, `run`, `run_plan`, `review`, `revise`, or `hyperplan` as runtime-node method segments, adapter modes, env names, provider modes, or low-level options.
- Core Node adapters should say `start` or `execute` for generic work, not product/control verbs.
- agents.ts must propagate spawned harness PID/process-group metadata to runtime records through RuntimeNodeAgentStartCallbacks.onSpawn.
- Electron may inject its desktop harness executor into registerRuntimeNodeAgentModule, but method registration should stay here instead of being duplicated in the Electron companion package.
- codexAppServerBridge.ts owns the Node Codex app-server JSON-RPC bridge for server-protocol providers. Keep it generic to Codex protocol concepts: thread, turn, goal, approval, and provider notification semantics only.
- Provider status must redact credential-like URL components before exposing configured server endpoints to runtime clients.
- server.ts owns the reusable Node HTTP/WebSocket host for `RuntimeServer`; keep transport/auth/backpressure generic and OpenADE-free.
- Runtime WebSocket bearer tokens must travel in the `Sec-WebSocket-Protocol` bearer subprotocol, not URL query strings.
- cli.ts owns the `runtime-node serve` source entrypoint, config loading, and composition of a headless runtime server.
- CLI env vars use the generic `RUNTIME_NODE_*` prefix. Do not add OpenADE-prefixed env vars to this package.
- Do not add OpenADE module registration, task persistence, or product turn semantics to this package. Load `openade-module/src/node.ts` into the same RuntimeServer from the OpenADE host when product behavior is needed.
- Do not add an unsupported-agent fallback for normal headless turns; missing provider/auth should be reported as a real runtime execution failure.
- checkpoint.ts owns JSON checkpoint file persistence; embedders choose the file path.
- liveness.ts owns generic PID liveness probing. It may verify process labels and process start times, but it must report `unknown` rather than claiming ownership when verification is weak.
