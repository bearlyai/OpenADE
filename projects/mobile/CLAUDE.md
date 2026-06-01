# OpenADE Mobile

Thin Capacitor shell for the OpenADE remote-control surface.

## Product Shape

- Ship iOS first; keep the code path Android-capable where possible.
- The mobile app does not run OpenADE. It pairs to a desktop host and renders the shared remote shell from `projects/web/src/remote`.
- Mobile is not a separate product UI and is not the product design source. Keep it as a thin Capacitor host for QR scanning, secure storage, OTA readiness, safe-area constraints, and the same remote/shared OpenADE shell used by browser remote surfaces.
- The classic desktop UI is canonical. Because mobile is not production-critical yet, mobile/remote screens may be removed or rebuilt around desktop-derived shared components when that is cleaner than preserving the current companion UI.
- Support multiple paired OpenADE sessions on one device.
- Pairing is QR or paste of a normal HTTP URL. Do not use custom app deep links for pairing.
- Store paired host config and device tokens through capacitor-secure-storage-plugin so iOS uses Keychain.

## UI And Theme

- Follow projects/web/src/_docs/design.md and projects/web/src/tw.css.
- The visual language should match the desktop code module: flat, square, clean, spacious.
- Do not add rounded corners. Avoid mobile card aesthetics that diverge from desktop.
- Do not introduce mobile-first visual patterns that would be inappropriate on desktop; adapt desktop-derived components to mobile constraints instead.
- Use semantic theme tokens from the code module only.
- Buttons must use the btn class. Inputs and textareas must use the input class.
- The default shell theme setting is "desktop", which follows snapshot.server.theme.className from the connected host.
- Keep the local shell theme override so a user can choose a theme and switch back to matching desktop.
- Keep mobile zoom disabled in index.html and src/index.css unless there is an accessibility-driven replacement plan.

## Runtime

- src/App.tsx is the native shell boundary.
- It owns QR scanning, Keychain mirroring, startup error reset, and storage hydration.
- src/App.tsx calls CapacitorUpdater.notifyAppReady() on launch so downloaded OTA bundles do not roll back after a successful boot.
- src/App.tsx performs the static OTA manifest check. Keep native Capgo autoUpdate disabled unless a real POST-capable update endpoint replaces the static R2 manifest.
- The main app UI comes from `projects/web/src/remote/RemoteApp.tsx`, which delegates product screens to the shared `projects/web/src/shell/OpenADEShell.tsx`.
- Do not duplicate companion state or remote API logic in projects/mobile if it can stay in projects/web/src/remote.
- Remote reads, OpenADE turn starts, interrupts, and live updates use the runtime WebSocket at /v1/runtime.
- HTTP is only for initial pairing and health checks; do not add REST/SSE companion command paths.

## OTA Updates

- OTA uses the open-source @capgo/capacitor-updater plugin in manual static-manifest mode.
- OTA is for the web UI bundle only: React UI, remote client behavior, styles, copy, and demo/review-mode polish.
- Do not use OTA for native capabilities, new plugins, permission changes, entitlements, or app-purpose changes; those require a reviewed App Store binary.
- Build-time OTA variables for the web app are VITE_OPENADE_OTA_UPDATE_URL and VITE_OPENADE_OTA_CHANNEL.
- capacitor.config.ts keeps CapacitorUpdater.autoUpdate false because static R2 cannot handle the plugin's native POST update check.
- statsUrl stays empty by default. Do not add third-party telemetry without an explicit product decision and privacy-label update.
- OTA hosts must use HTTPS in production. Static manifests should provide a bundle version, zip URL, and checksum.
- The mobile-ota workflow publishes dist.zip and updates.json to Cloudflare R2 through the mobile-release environment.
- The mobile-testflight workflow signs with the Apple Distribution p12 and App Store provisioning profile stored in the mobile-release environment.

## Release Operations

- Use projects/mobile/README.md as the human release runbook.
- Keep all Apple, GitHub, and Cloudflare credentials in the mobile-release GitHub environment or local ignored files.
- Never commit .env.local, p12 files, .mobileprovision files, .p8 keys, exported archives, or generated keychains.
- Use Mobile TestFlight for native changes and Mobile OTA for web-only updates.
- Use internal_only=true for early internal TestFlight uploads unless there is an explicit external beta release decision.
- The TestFlight workflow must use a runner with the currently required App Store SDK. It is pinned to macos-26 for the iOS 26 SDK requirement.
- The App target Release signing settings are manual, but workflow-level signing overrides should not be passed globally because they also affect Pods targets.
- The R2 CORS update in Mobile OTA is best-effort. Lack of bucket-level CORS permission must not block object upload.
- After OTA publish, verify https://static.openade.ai/openade-companion/ios/updates.json and the referenced zip URL both return 200.

## Pairing

- Scan or paste the full HTTP pairing link from desktop.
- The client validates that pairing targets use HTTP or HTTPS and private/local/Tailscale-style hosts.
- Confirm the host before exchanging a bootstrap token for a long-lived device token.
- Do not split token entry into a required manual workflow; full-link paste should keep working.

## Verification

- Run npm run typecheck from projects/mobile after changing the Capacitor host, remote UI imports, or shared companion/runtime clients.
- Run npm run build from projects/mobile after UI or shell changes.
- Run npx cap sync ios after a successful build.
- For iOS verification, build and run the App workspace/scheme in the simulator and capture a screenshot.
