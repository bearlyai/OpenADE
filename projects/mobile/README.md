# OpenADE Mobile

Thin Capacitor shell for the OpenADE remote-control surface.

## Development

1. Enable Companion in the desktop app settings.
2. Start a pairing session and scan the HTTP QR from inside the Companion app, or paste the full HTTP pairing link into the host field.
3. Run:

```sh
yarn install
yarn ios
```

The mobile host mirrors paired device tokens into `capacitor-secure-storage-plugin`, which uses Keychain on iOS. One phone can keep multiple OpenADE hosts and switch between them from the shared remote shell sessions screen.

The iOS deployment target is 15.5 because the in-app QR scanner uses ML Kit Barcode Scanning.

## Release

Mobile releases are split into two GitHub Actions workflows:

- `.github/workflows/mobile-testflight.yml` builds, signs, and uploads the iOS wrapper to App Store Connect/TestFlight.
- `.github/workflows/mobile-ota.yml` builds the web UI, zips `dist`, uploads it to Cloudflare R2, and updates the static OTA manifest.

Both workflows use the `mobile-release` GitHub environment.

### Release Setup

Keep signing credentials and storage credentials out of git. The public repo should only contain workflow code and non-secret config.

Required GitHub environment secrets for `mobile-release`:

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_PRIVATE_KEY`
- `IOS_SIGNING_CERTIFICATE_P12`
- `IOS_SIGNING_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Required GitHub environment variables for `mobile-release`:

- `APP_STORE_APP_ID`
- `OPENADE_OTA_CHANNEL`
- `OPENADE_OTA_UPDATE_URL`
- `OTA_PUBLIC_BASE_URL`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ENDPOINT_URL`
- `R2_BUCKET`

Current production values are intentionally safe to store as variables, not secrets:

```sh
OPENADE_OTA_CHANNEL=production
OPENADE_OTA_UPDATE_URL=https://static.openade.ai/openade-companion/ios/updates.json
OTA_PUBLIC_BASE_URL=https://static.openade.ai/openade-companion/ios
R2_BUCKET=openade-app
```

### Ship To TestFlight

Use TestFlight for native changes:

- native dependency changes
- Capacitor plugin changes
- permissions
- entitlements
- bundle id, display name, icons, or App Store metadata expectations
- anything Apple must review

From GitHub Actions:

1. Open the `Mobile TestFlight` workflow.
2. Run the workflow from `main`.
3. Leave `version` empty to use `projects/mobile/package.json`.
4. Leave `build_number` empty to use the GitHub run number.
5. Use `internal_only=true` for fast internal TestFlight builds.
6. Use `internal_only=false` for builds that may later go to external TestFlight.

Equivalent CLI:

```sh
gh workflow run mobile-testflight.yml --ref main -f internal_only=true
gh run watch --exit-status
```

After upload succeeds, App Store Connect may show the build as `Processing` for several minutes. Check App Store Connect -> OpenADE -> TestFlight -> iOS Builds.

The TestFlight workflow uses the `macos-26` runner because App Store Connect requires uploads to be built with the iOS 26 SDK or newer.

### Ship Web UI OTA

Use OTA for web-only changes:

- React UI changes in the mobile remote surface
- CSS/theme polish
- remote client behavior
- copy
- message rendering, navigation, and other web bundle fixes

From GitHub Actions:

1. Open the `Mobile OTA` workflow.
2. Run the workflow from `main`.
3. Optionally set `version`; otherwise it uses package version, run number, and commit SHA.
4. Add short release notes.

Equivalent CLI:

```sh
gh workflow run mobile-ota.yml --ref main -f release_notes="Describe the web UI change"
gh run watch --exit-status
```

The workflow writes:

- immutable zip bundles under `https://static.openade.ai/openade-companion/ios/bundles/...`
- the current manifest at `https://static.openade.ai/openade-companion/ios/updates.json`

The R2 token only needs object upload permissions. Bucket CORS updates are best-effort; if OTA fetches fail in the installed app, configure CORS once in Cloudflare for `GET` and `HEAD` from allowed origins.

### Normal Release Order

For the first release or any native change:

1. Run `Mobile TestFlight`.
2. Wait for App Store Connect processing.
3. Add the build to internal TestFlight testers.
4. Run `Mobile OTA` after the TestFlight upload if the bundled web UI should also be available through the OTA manifest.

For web-only follow-up releases:

1. Run `Mobile OTA`.
2. Launch the installed app twice if needed: the first launch downloads/stages the bundle, and the next app restart applies it.

### Local Preflight

Before triggering release workflows:

```sh
cd projects/mobile
yarn install
yarn build
npx cap sync ios
```

Do not commit `.env.local`, p12 files, `.mobileprovision` files, `.p8` keys, generated keychains, or exported archives.

## OTA UI Updates

The app uses the open-source `@capgo/capacitor-updater` plugin in manual static-manifest mode. Native auto-update is disabled because static R2 objects cannot serve Capgo's native POST update endpoint. The app instead fetches `updates.json` over HTTPS, downloads the zip natively, and stages it for the next app background/restart.

Build-time config for an OTA-enabled binary:

```sh
VITE_OPENADE_OTA_UPDATE_URL=https://static.openade.ai/openade-companion/ios/updates.json
VITE_OPENADE_OTA_CHANNEL=production
OPENADE_OTA_CHANNEL=production
```

If `VITE_OPENADE_OTA_UPDATE_URL` is empty, the app uses the bundled UI only. `statsUrl` is intentionally set to an empty string so the plugin does not send update telemetry to a third party by default.

To prepare an OTA bundle locally:

```sh
npm run build
OTA_PUBLIC_BASE_URL=https://static.openade.ai/openade-companion/ios npm run prepare:ota
```

Use OTA only for web UI changes. Native plugin, permission, entitlement, bundle id, display name, and app-purpose changes still require a reviewed TestFlight/App Store binary.
