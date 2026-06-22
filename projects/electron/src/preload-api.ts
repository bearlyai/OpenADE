export interface OpenADECoreRuntimeEndpoint {
    url: string
    token: string
}

export type OpenADECoreRolloutReason =
    | "managed-core"
    | "legacy-yjs-migration-accepted"
    | "external-endpoint"
    | "disabled"
    | "legacy-yjs-documents"
    | "development-default-off"
    | "missing-core-binary"
    | "invalid-managed-command"
    | "invalid-external-endpoint"
    | "unconfigured"

export type OpenADECoreRolloutStatus = "connected" | "legacy-ipc"
export type OpenADECoreRolloutSource = "managed" | "external" | "legacy-ipc"

export interface OpenADECoreRolloutState {
    status: OpenADECoreRolloutStatus
    source: OpenADECoreRolloutSource
    reason: OpenADECoreRolloutReason
    automatic: boolean
    legacyYjsDocumentsPresent: boolean
    legacyYjsMigrationAccepted: boolean
}

export interface OpenADEAPI {
    app: {
        activeWorkUnloadBlockerDisabled?: boolean
        smokeTest?: boolean
        quit: () => Promise<void>
        restart: () => Promise<void>
        openUrl: (url: string) => Promise<void>
        applyUpdate: () => Promise<void>
        forceEnableDevTools: () => Promise<void>
        isWindowedWithFrame: () => Promise<boolean>
        setTerminalKeyboardCapture: (captured: boolean) => Promise<void>
        onUpdateAvailable: (cb: () => void) => () => void
        onUpdateError: (cb: () => void) => () => void
        onFocusInputShortcut: (cb: () => void) => () => void
        retryUpdateCheck: () => Promise<void>
    }
    window: {
        isPinned: () => Promise<boolean>
        isAutoHide: () => Promise<boolean>
        action: (action: string) => Promise<void>
        frameEnabled: () => Promise<boolean>
        setFrameColors: (colors: unknown) => Promise<void>
        findInPage: (action: unknown) => Promise<unknown>
    }
    settings: {
        getDeviceConfig: () => Promise<unknown>
        setDeviceId: (deviceId: string) => Promise<unknown>
        setTelemetryDisabled: (disabled: boolean) => Promise<void>
    }
    shell: {
        selectDirectory: (params: unknown) => Promise<unknown>
        openUrl: (params: unknown) => Promise<void>
        openPath: (params: unknown) => Promise<void>
    }
    codeWindowFrame: {
        enabled: () => Promise<boolean>
        setColors: (colors: unknown) => Promise<void>
    }
    notifications: {
        getState: () => Promise<unknown>
        shouldShow: () => Promise<boolean>
    }
    companion: {
        getState: () => Promise<unknown>
        setEnabled: (enabled: boolean) => Promise<unknown>
        setKeepAwakeMode: (mode: string) => Promise<unknown>
        startPairing: () => Promise<unknown>
    }
    core?: {
        runtimeEndpoint?: OpenADECoreRuntimeEndpoint
        migrationRuntimeEndpoint?: OpenADECoreRuntimeEndpoint
        rolloutState?: OpenADECoreRolloutState
    }
    runtime: {
        connect: () => Promise<unknown>
        disconnect: () => Promise<unknown>
        request: (request: unknown) => Promise<unknown>
        onMessage: (cb: (message: unknown) => void) => () => void
    }
}
