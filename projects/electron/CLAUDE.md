# Electron Desktop Shell Guidance

## Preload Contract

- `src/preload-api.ts` owns the browser-safe `OpenADEAPI` shape exposed by `src/preload.ts` and consumed by `projects/web/src/vite-env.d.ts`.
- When changing the contextBridge surface, update `src/preload-api.ts` first and keep `src/preload.ts` using `satisfies OpenADEAPI` so the renderer global cannot drift from the actual preload object.

## Code Host Bridge Contracts

- `src/modules/code/hostBridgeTypes.ts` owns browser-safe DTOs for desktop-specific trusted host utilities such as binaries, platform, shell, frame colors, and code-module capability probes.
- `src/modules/code/gitBridgeTypes.ts` owns browser-safe DTOs for raw trusted-local `git/*` bridge methods. Product-scoped task git DTOs still come from `projects/openade-module/src/types.ts`.
- `src/modules/deviceConfigTypes.ts` owns browser-safe device config result DTOs, and `src/modules/code/snapshotsIndex.ts` owns snapshot patch index DTOs.
- Renderer wrappers under `projects/web/src/electronAPI` should alias those types instead of re-declaring matching Electron main-process interfaces.

## Packaged Smoke Tests

- `tests/smoke.spec.ts` drives the packaged app artifact, not the dev server. Rebuild with `npm run build`, `npm run build:web`, and `NONOTARY=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir` before trusting smoke results after main/preload/web changes.
- Packaged smoke is expected to cover bundled UI boot, runtime IPC initialization, repo creation, task workflow/reload, scoped file operations, and scoped project process list/start/reconnect-output/stop through the built Electron host.
- Packaged desktop smoke must keep proving the classic desktop UI path. The migration target is classic desktop look/functionality over runtime APIs, not rendering the compact remote/mobile shell in Electron.
- Smoke tests may set `OPENADE_SMOKE_TEST=1` and `OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER=1` so active-work quit/beforeunload prompts do not block Playwright teardown. Do not disable those blockers in normal app launches.
- Packaged smoke must set `OPENADE_YJS_STORAGE_DIR` to its temp user-data directory. `HOME`/`USERPROFILE` isolation alone is not enough to prove the packaged app is avoiding the developer's normal `~/.openade/data/yjs` documents.
- The smoke harness may use `OPENADE_SMOKE_DETERMINISTIC_HARNESS=1`; keep it guarded by `OPENADE_SMOKE_TEST=1` and limit it to deterministic packaged workflow coverage.
- In smoke mode, the preload exposes `openadeAPI.app.smokeTest` so the renderer records real analytics `track()` calls to local storage. `tests/smoke.spec.ts` must run `projects/web`'s `review:runtime-product-rollout` command against that export, proving the packaged classic desktop route emits a ready default-on `app_opened` and no runtime product fallback/error telemetry.

## Linux Startup Stability

- `build/afterPack.js` wraps the packaged Linux executable so display-backend flags are present before Electron initializes. Read it before changing Linux packaging, launch flags, or AppImage startup behavior.
- `src/modules/linuxDisplayBackend.ts` is the runtime fallback for non-wrapped development launches. It is not early enough by itself for packaged AppImage startup.
- Wayland sessions default to `--ozone-platform=x11` for packaged Linux builds because native Wayland startup has produced AppImage SIGSEGV failures. Users can override this with `--ozone-platform=...` or `OPENADE_LINUX_OZONE_PLATFORM=x11|wayland|auto`.
- `src/modules/sentryConfig.ts` keeps Sentry JavaScript reporting enabled while disabling Electron native minidump integrations on Linux. Do not re-enable Linux native crash reporting without validating AppImage startup on real GNOME/KDE Wayland sessions.
