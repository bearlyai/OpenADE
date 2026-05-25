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

The mobile shell mirrors paired device tokens into `capacitor-secure-storage-plugin`, which uses Keychain on iOS. One phone can keep multiple OpenADE hosts and switch between them from the sessions screen.

The iOS deployment target is 15.5 because the in-app QR scanner uses ML Kit Barcode Scanning.

## Release

Mobile releases are split into two GitHub Actions workflows:

- `.github/workflows/mobile-testflight.yml` builds, signs, and uploads the iOS wrapper to App Store Connect/TestFlight.
- `.github/workflows/mobile-ota.yml` builds the web UI, zips `dist`, uploads it to Cloudflare R2, and updates the static OTA manifest.

Both workflows use the `mobile-release` GitHub environment.

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
