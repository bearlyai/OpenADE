# OpenADE Companion

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

## OTA UI Updates

The companion uses the open-source `@capgo/capacitor-updater` plugin for web-layer OTA updates. This keeps native capabilities in reviewed binaries while allowing incremental companion UI fixes without waiting for a new App Store build.

Build-time config for an OTA-enabled binary:

```sh
OPENADE_OTA_UPDATE_URL=https://updates.example.com/openade-companion/ios/updates.json
OPENADE_OTA_CHANNEL=production
```

If `OPENADE_OTA_UPDATE_URL` is empty, auto-update is disabled and the app uses the bundled UI only. `statsUrl` is intentionally set to an empty string so the plugin does not send update telemetry to a third party by default.

After changing OTA config:

```sh
npm run build
npx cap sync ios
```

The self-hosted update endpoint must return the Capgo updater response shape with a bundle `version`, HTTPS zip `url`, and `checksum`. Use OTA only for web UI changes. Native plugin, permission, entitlement, and app-purpose changes still require a reviewed App Store build.
