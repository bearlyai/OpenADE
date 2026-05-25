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
- Do not add wildcard Private Network Access CORS. Browser access should stay constrained.
- Revoke-one should only close that device's streams. Drop-all may close every stream.
- Persist last-seen style metadata sparingly; avoid synchronous disk writes on every authenticated request.

## Runtime Shape

- HTTP server: server.ts
- Device auth and pairing: auth.ts
- Renderer request bridge: rendererBridge.ts
- SSE event replay: events.ts
- Keep-awake control: powerKeeper.ts

Renderer requests are intentionally limited to:

- getSnapshot
- getTask
- run
- abort

All task execution must flow through RunCmdManager in the renderer.

## API Boundaries

- REST commands plus SSE updates are the public companion surface.
- Keep response payloads plain JSON. Renderer responses cross IPC and must be structured-clone safe.
- Validate remote command inputs before forwarding to the renderer.
- Do not proxy arbitrary Electron APIs, file reads, shell commands, or Yjs document writes.
- Main process owns auth, pairing, CORS, network binding, device revocation, and keep-awake.
- Renderer owns OpenADE domain state, task sorting, task loading, and command execution.

## Keep Awake

- Use Electron powerSaveBlocker for the normal path.
- macOS locked-screen GUI control is not part of this module. Codex Locked Use is a separate Codex App feature, not an OpenADE companion API.
- If adding stronger macOS behavior later, treat it as a native security project with explicit user consent and documentation.

## Tests

- Unit test auth, token expiry, one-use pairing, revocation, and network binding.
- Unit test SSE replay, reconnect behavior, and stream closure by device id.
- Integration test loopback pair, authenticated snapshot, revoke, and unauthorized access.
