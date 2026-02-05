# Updating App Icons

This guide explains how to update the Electron app icons.

## Required Files

| File | Purpose |
|------|---------|
| `icon.png` | Main app icon for Windows/Linux (512x512 recommended) |
| `icon.icns` | macOS app icon (Dock, Finder, DMG installer) |

## Steps to Update

### 1. Prepare your source image

- Use a 512x512 PNG (or larger, ideally 1024x1024)
- Ensure it has transparency if needed
- Place it somewhere accessible (e.g., repo root)

### 2. Copy the PNG

```bash
cp /path/to/your-icon.png projects/electron/build/icon.png
```

### 3. Generate the macOS .icns file

Run this from the repo root (macOS only):

```bash
# Create iconset directory
mkdir -p /tmp/icon.iconset

# Generate all required sizes
sips -z 16 16 /path/to/your-icon.png --out /tmp/icon.iconset/icon_16x16.png
sips -z 32 32 /path/to/your-icon.png --out /tmp/icon.iconset/icon_16x16@2x.png
sips -z 32 32 /path/to/your-icon.png --out /tmp/icon.iconset/icon_32x32.png
sips -z 64 64 /path/to/your-icon.png --out /tmp/icon.iconset/icon_32x32@2x.png
sips -z 128 128 /path/to/your-icon.png --out /tmp/icon.iconset/icon_128x128.png
sips -z 256 256 /path/to/your-icon.png --out /tmp/icon.iconset/icon_128x128@2x.png
sips -z 256 256 /path/to/your-icon.png --out /tmp/icon.iconset/icon_256x256.png
sips -z 512 512 /path/to/your-icon.png --out /tmp/icon.iconset/icon_256x256@2x.png
sips -z 512 512 /path/to/your-icon.png --out /tmp/icon.iconset/icon_512x512.png
cp /path/to/your-icon.png /tmp/icon.iconset/icon_512x512@2x.png

# Convert to icns
iconutil -c icns /tmp/icon.iconset -o projects/electron/build/icon.icns

# Cleanup
rm -rf /tmp/icon.iconset
```

## Where Icons Are Used

- **macOS**: `icon.icns` is used for the Dock, Finder, and DMG installer
- **Windows**: `icon.png` is used for the taskbar and installer
- **Linux**: `icon.png` is used for the app launcher

## Notes

- electron-builder automatically picks up icons from the `build/` directory
- No configuration changes needed - just replace the files
- Rebuild the app after updating icons: `npm run build`
