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
