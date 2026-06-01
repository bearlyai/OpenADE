# Shared Companion Contracts

Shared TypeScript contracts for the desktop companion service, web remote UI, and mobile shell.

## Role

- This package defines the wire contract. Keep it browser-safe and Node-free.
- Types here are consumed by Electron main, the renderer remote controller, and the Capacitor shell.
- Prefer small, explicit DTOs over exporting internal store models.

## Contract Choices

- RemoteSnapshot is the list/read model for projects, task previews, working task ids, and desktop theme metadata.
- RemoteTask is the task detail read model. Events and comments may stay unknown[] at the wire boundary.
- RemoteTurnStartRequest aliases the OpenADE module turn-start payload used over `/v1/runtime`.
- PairingPayload uses HTTP URL data, not custom deep-link schemes.
- RemoteDevice list/revoke/drop-all/self-revoke result DTOs describe runtime method results for desktop trusted-local admin and paired self-revoke flows; they do not imply paired-device permission to administer other devices.
- CompanionEvent is intentionally coarse. The client refreshes affected read models instead of syncing Yjs.
- Do not add renderer request/response command DTOs here. Companion commands go through runtime protocol methods.
- Scoped project and task host features should alias OpenADE module DTOs and runtime methods (`openade/project/*`, `openade/project/process/*`, `openade/task/terminal/*`, `openade/task/changes/read`, `openade/task/diff/read`, `openade/task/git/log`, `openade/task/git/commit`, `openade/task/image/read`, `openade/task/snapshot/*`) rather than introducing companion-specific file/search/process/terminal/git/image/snapshot command shapes.

## Compatibility

- Add optional fields for new data where possible.
- Do not rename or remove persisted or wire fields without tolerant readers in projects/web/src/remote/client.ts.
- Keep values structured-clone and JSON safe. These objects may cross IPC and fetch boundaries.

## Security

- Do not add raw shell, filesystem, process, PTY, Electron IPC, or Yjs write contracts here.
- Remote control should stay scoped to OpenADE runtime methods, pairing, device state, and events.
