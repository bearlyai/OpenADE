# Electron Desktop Shell Guidance

## Linux Startup Stability

- `build/afterPack.js` wraps the packaged Linux executable so display-backend flags are present before Electron initializes. Read it before changing Linux packaging, launch flags, or AppImage startup behavior.
- `src/modules/linuxDisplayBackend.ts` is the runtime fallback for non-wrapped development launches. It is not early enough by itself for packaged AppImage startup.
- Wayland sessions default to `--ozone-platform=x11` for packaged Linux builds because native Wayland startup has produced AppImage SIGSEGV failures. Users can override this with `--ozone-platform=...` or `OPENADE_LINUX_OZONE_PLATFORM=x11|wayland|auto`.
- `src/modules/sentryConfig.ts` keeps Sentry JavaScript reporting enabled while disabling Electron native minidump integrations on Linux. Do not re-enable Linux native crash reporting without validating AppImage startup on real GNOME/KDE Wayland sessions.
