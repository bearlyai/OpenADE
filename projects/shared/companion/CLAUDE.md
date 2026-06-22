# Shared Companion Contracts

Shared TypeScript contracts for companion-only device, pairing, and service state.

## Role

- This package defines companion-specific wire contracts. Keep it browser-safe and Node-free.
- Types here are consumed by Electron main, the renderer remote controller, and the Capacitor shell.
- Do not mirror OpenADE product DTOs here. Import product/session/task/file/git/process types directly from `projects/openade-module/src`.
- Do not use explicit `any` in non-test source. Run `npm run typecheck` from this directory after changing shared companion contracts; it runs the self-tested no-`any` scanner before strict TypeScript. The root `scripts/check-no-explicit-any.mjs --self-test projects scripts` release guard also covers this package.

## Contract Choices

- OpenADE product read and mutation payloads use the OpenADE module types directly over `/v1/runtime`.
- PairingPayload uses HTTP URL data, not custom deep-link schemes.
- RemoteDevice list/revoke/drop-all/self-revoke result DTOs describe runtime method results for desktop trusted-local admin and paired self-revoke flows; they do not imply paired-device permission to administer other devices.
- Paired runtime method and notification grants are generated from `projects/openade-client/openade-contracts.json`; `COMPANION_RUNTIME_PERMISSIONS` and `COMPANION_RUNTIME_NOTIFICATION_PERMISSIONS` re-export that generated policy so Electron, shared-shell tests, and Core consume one contract-owned profile. Keep contract/integration tests covering the profile when grants change.
- Paired grants may include `openade/settings/mcpServers/read` only because Core and the TypeScript OpenADE module redact read-only responses to connector summaries. Do not add MCP replace/upsert/delete grants here without a settings-admin role and real paired-runtime tests.
- CompanionEvent is intentionally coarse. The client refreshes affected read models instead of syncing Yjs.
- Do not add renderer request/response command DTOs here. Companion commands go through runtime protocol methods.
- Scoped project and task host features should use OpenADE module DTOs and runtime methods (`openade/project/*`, `openade/project/process/*`, `openade/task/terminal/*`, `openade/task/changes/read`, `openade/task/diff/read`, `openade/task/git/*`, `openade/task/image/read`, `openade/task/snapshot/*`) rather than introducing companion-specific file/search/process/terminal/git/image/snapshot command shapes.

## Compatibility

- Add optional fields for new data where possible.
- Do not rename or remove persisted or wire fields without tolerant readers in projects/web/src/remote/client.ts.
- Keep values structured-clone and JSON safe. These objects may cross IPC and fetch boundaries.

## Security

- Do not add raw shell, filesystem, process, PTY, Electron IPC, or Yjs write contracts here.
- Remote control should stay scoped to OpenADE runtime methods, pairing, device state, and events.
