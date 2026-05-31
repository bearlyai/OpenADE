const fs = require("fs")
const path = require("path")

function getLinuxExecutableName(params) {
    if (typeof params.packager.executableName === "string" && params.packager.executableName.length > 0) {
        return params.packager.executableName
    }

    const appInfo = params.packager.appInfo
    if (typeof appInfo.sanitizedName === "string" && appInfo.sanitizedName.length > 0) {
        return appInfo.sanitizedName.toLowerCase()
    }

    if (typeof appInfo.productFilename === "string" && appInfo.productFilename.length > 0) {
        return appInfo.productFilename
    }

    throw new Error("Cannot resolve Linux executable name for launcher wrapper")
}

function buildLinuxLauncherScript(executableName) {
    return `#!/bin/sh
self_path=$0

case "$self_path" in
    /*) ;;
    *) self_path=$(command -v "$self_path" 2>/dev/null || printf '%s\\n' "$self_path") ;;
esac

if command -v readlink >/dev/null 2>&1; then
    resolved_path=$(readlink -f "$self_path" 2>/dev/null || true)
    if [ -n "$resolved_path" ]; then
        self_path=$resolved_path
    fi
fi

app_dir=$(dirname "$self_path")
app_dir=$(CDPATH= cd "$app_dir" && pwd)
bin="$app_dir/${executableName}.bin"

has_ozone_platform() {
    for arg in "$@"; do
        case "$arg" in
            --ozone-platform|--ozone-platform=*) return 0 ;;
        esac
    done
    return 1
}

if has_ozone_platform "$@"; then
    exec "$bin" "$@"
fi

case "\${OPENADE_LINUX_OZONE_PLATFORM:-}" in
    x11|wayland|auto)
        exec "$bin" "--ozone-platform=\${OPENADE_LINUX_OZONE_PLATFORM}" "$@"
        ;;
esac

case "\${XDG_SESSION_TYPE:-}" in
    [Ww][Aa][Yy][Ll][Aa][Nn][Dd])
        exec "$bin" --ozone-platform=x11 "$@"
        ;;
esac

exec "$bin" "$@"
`
}

function wrapLinuxExecutable(params) {
    if (params.electronPlatformName !== "linux") {
        return
    }

    const executableName = getLinuxExecutableName(params)
    const executablePath = path.join(params.appOutDir, executableName)
    const realExecutablePath = `${executablePath}.bin`

    if (!fs.existsSync(executablePath)) {
        throw new Error(`Cannot find Linux executable to wrap at: ${executablePath}`)
    }

    fs.rmSync(realExecutablePath, { force: true })
    fs.renameSync(executablePath, realExecutablePath)
    fs.writeFileSync(executablePath, buildLinuxLauncherScript(executableName), { mode: 0o755 })
    fs.chmodSync(executablePath, 0o755)

    console.log(`Wrapped Linux executable launcher: ${executablePath}`)
}

module.exports = wrapLinuxExecutable
module.exports.buildLinuxLauncherScript = buildLinuxLauncherScript
module.exports.getLinuxExecutableName = getLinuxExecutableName
