type LinuxOzonePlatform = "auto" | "wayland" | "x11"

export interface CommandLineSwitches {
    appendSwitch(name: string, value?: string): void
}

export interface LinuxDisplayBackendDecision {
    platform: LinuxOzonePlatform | null
    reason: "non-linux" | "explicit-switch" | "env-override" | "wayland-session" | "no-op"
}

const ozonePlatformSwitch = "ozone-platform"
const linuxOzonePlatformEnv = "OPENADE_LINUX_OZONE_PLATFORM"

function hasExplicitSwitch(argv: readonly string[], name: string): boolean {
    const switchPrefix = `--${name}=`
    return argv.some((arg) => arg === `--${name}` || arg.startsWith(switchPrefix))
}

function isLinuxOzonePlatform(value: string | undefined): value is LinuxOzonePlatform {
    return value === "auto" || value === "wayland" || value === "x11"
}

export function resolveLinuxDisplayBackend({
    platform,
    sessionType,
    envOverride,
    argv,
}: {
    platform: NodeJS.Platform
    sessionType: string | undefined
    envOverride: string | undefined
    argv: readonly string[]
}): LinuxDisplayBackendDecision {
    if (platform !== "linux") {
        return { platform: null, reason: "non-linux" }
    }

    if (hasExplicitSwitch(argv, ozonePlatformSwitch)) {
        return { platform: null, reason: "explicit-switch" }
    }

    if (isLinuxOzonePlatform(envOverride)) {
        return { platform: envOverride, reason: "env-override" }
    }

    if (sessionType?.toLowerCase() === "wayland") {
        return { platform: "x11", reason: "wayland-session" }
    }

    return { platform: null, reason: "no-op" }
}

export function configureLinuxDisplayBackend(commandLine: CommandLineSwitches): LinuxDisplayBackendDecision {
    const decision = resolveLinuxDisplayBackend({
        platform: process.platform,
        sessionType: process.env.XDG_SESSION_TYPE,
        envOverride: process.env[linuxOzonePlatformEnv],
        argv: process.argv,
    })

    if (decision.platform) {
        commandLine.appendSwitch(ozonePlatformSwitch, decision.platform)
        console.info(`[LinuxDisplay] Using --${ozonePlatformSwitch}=${decision.platform} (${decision.reason})`)
    }

    return decision
}
