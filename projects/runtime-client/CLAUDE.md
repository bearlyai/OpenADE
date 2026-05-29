# Runtime Client

Typed client helpers for runtime protocol transports.

- Owns WebSocket request/response, notifications, reconnect, and status reporting.
- Owns generic local transport request/response and notification helpers for Electron IPC or in-process embeddings.
- WebSocket and local transports both perform `initialize` before domain/runtime requests. Keep this invariant covered when changing connection code.
- Owns generic runtime record cache primitives; product clients may layer OpenADE-specific view models on top, but runtime lifecycle normalization belongs here.
- WebSocket reconnect must preserve the last notification cursor and send it through `subscription/update` after reconnect. Keep real WebSocket integration coverage when changing this path.
- Browser/mobile clients import this package, not server internals.
- Do not add OpenADE project/task product logic here.
