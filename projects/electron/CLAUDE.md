# Electron Desktop Shell Guidance

## Packaged Smoke Tests

- `tests/smoke.spec.ts` drives the packaged app artifact, not the dev server. Rebuild with `npm run build`, `npm run build:web`, and `NONOTARY=1 CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir` before trusting smoke results after main/preload/web changes.
- Packaged smoke is expected to cover bundled UI boot, runtime IPC initialization, repo creation, task workflow/reload, scoped file operations, and scoped project process list/start/reconnect-output/stop through the built Electron host.
- Smoke tests may set `OPENADE_SMOKE_TEST=1` and `OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER=1` so active-work quit/beforeunload prompts do not block Playwright teardown. Do not disable those blockers in normal app launches.
- Packaged smoke must set `OPENADE_YJS_STORAGE_DIR` to its temp user-data directory. `HOME`/`USERPROFILE` isolation alone is not enough to prove the packaged app is avoiding the developer's normal `~/.openade/data/yjs` documents.
- The smoke harness may use `OPENADE_SMOKE_DETERMINISTIC_HARNESS=1`; keep it guarded by `OPENADE_SMOKE_TEST=1` and limit it to deterministic packaged workflow coverage.

## Linux Startup Stability

- `build/afterPack.js` wraps the packaged Linux executable so display-backend flags are present before Electron initializes. Read it before changing Linux packaging, launch flags, or AppImage startup behavior.
- `src/modules/linuxDisplayBackend.ts` is the runtime fallback for non-wrapped development launches. It is not early enough by itself for packaged AppImage startup.
- Wayland sessions default to `--ozone-platform=x11` for packaged Linux builds because native Wayland startup has produced AppImage SIGSEGV failures. Users can override this with `--ozone-platform=...` or `OPENADE_LINUX_OZONE_PLATFORM=x11|wayland|auto`.
- `src/modules/sentryConfig.ts` keeps Sentry JavaScript reporting enabled while disabling Electron native minidump integrations on Linux. Do not re-enable Linux native crash reporting without validating AppImage startup on real GNOME/KDE Wayland sessions.
