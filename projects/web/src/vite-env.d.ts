/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// OpenADE Electron API exposed via preload contextBridge
interface OpenADEAPI {
    app: {
        activeWorkUnloadBlockerDisabled?: boolean
        quit: () => Promise<void>
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
    runtime: {
        connect: () => Promise<unknown>
        disconnect: () => Promise<unknown>
        request: (request: unknown) => Promise<unknown>
        onMessage: (cb: (message: unknown) => void) => () => void
    }
}

// Make this file a module so declare global works
export {}

declare global {
    interface Window {
        openadeAPI?: OpenADEAPI
    }
}
