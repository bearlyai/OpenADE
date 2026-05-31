export interface SentryIntegrationLike {
    name: string
}

const nativeCrashReporterIntegrationNames = new Set(["SentryMinidump", "ElectronMinidump"])

export function shouldDisableNativeCrashReporter(platform: NodeJS.Platform): boolean {
    return platform === "linux"
}

export function filterMainProcessSentryIntegrations<T extends SentryIntegrationLike>(integrations: T[], platform: NodeJS.Platform): T[] {
    if (!shouldDisableNativeCrashReporter(platform)) {
        return integrations
    }

    return integrations.filter((integration) => !nativeCrashReporterIntegrationNames.has(integration.name))
}
