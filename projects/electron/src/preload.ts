/**
 * Preload Script for Electron Context Isolation
 *
 * This script runs in a sandboxed context before the renderer process loads.
 * It exposes a typed API to the renderer via contextBridge as `window.openadeAPI`.
 *
 * SECURITY: This is the only way the renderer can communicate with the main process.
 * All IPC communication MUST go through the exposed openadeAPI.
 */

import { type IpcRendererEvent, contextBridge, ipcRenderer } from "electron"
import type {
    OpenADEAPI as OpenADEPreloadAPI,
    OpenADECoreRolloutReason,
    OpenADECoreRolloutState,
    OpenADECoreRuntimeEndpoint,
} from "./preload-api"
import { envFlag } from "./modules/envFlag"

// Helper to create event listener with cleanup
const createListener = (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
}

const activeWorkUnloadBlockerDisabled = envFlag(process.env.OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER) || envFlag(process.env.OPENADE_SMOKE_TEST)
const smokeTest = envFlag(process.env.OPENADE_SMOKE_TEST)

function coreRuntimeEndpointFromEnv(prefix: "OPENADE_CORE" | "OPENADE_CORE_MIGRATION" = "OPENADE_CORE"): OpenADECoreRuntimeEndpoint | undefined {
    if (envFlag(process.env.OPENADE_DISABLE_OPENADE_CORE)) return undefined

    const rawUrl = process.env[`${prefix}_RUNTIME_URL`]?.trim()
    if (!rawUrl) return undefined

    let url: URL
    try {
        url = new URL(rawUrl)
    } catch {
        return undefined
    }
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return undefined

    return {
        url: url.toString(),
        token: process.env[`${prefix}_TOKEN`]?.trim() ?? "",
    }
}

function isCoreRolloutReason(value: string): value is OpenADECoreRolloutReason {
    return (
        value === "managed-core" ||
        value === "legacy-yjs-migration-accepted" ||
        value === "external-endpoint" ||
        value === "disabled" ||
        value === "legacy-yjs-documents" ||
        value === "development-default-off" ||
        value === "missing-core-binary" ||
        value === "invalid-managed-command" ||
        value === "invalid-external-endpoint" ||
        value === "unconfigured"
    )
}

function coreRolloutReasonFromEnv(endpoint: OpenADECoreRuntimeEndpoint | undefined): OpenADECoreRolloutReason {
    const configuredReason = process.env.OPENADE_CORE_ROLLOUT_REASON?.trim()
    if (configuredReason && isCoreRolloutReason(configuredReason)) {
        return configuredReason
    }
    if (envFlag(process.env.OPENADE_DISABLE_OPENADE_CORE)) return "disabled"
    if (endpoint) return envFlag(process.env.OPENADE_CORE_MANAGED) ? "managed-core" : "external-endpoint"
    return "unconfigured"
}

function coreRolloutStateFromEnv(endpoint: OpenADECoreRuntimeEndpoint | undefined): OpenADECoreRolloutState {
    const connected = endpoint !== undefined
    const managed = connected && envFlag(process.env.OPENADE_CORE_MANAGED)
    return {
        status: connected ? "connected" : "legacy-ipc",
        source: connected ? (managed ? "managed" : "external") : "legacy-ipc",
        reason: coreRolloutReasonFromEnv(endpoint),
        automatic: envFlag(process.env.OPENADE_CORE_ROLLOUT_AUTOMATIC),
        legacyYjsDocumentsPresent: envFlag(process.env.OPENADE_CORE_ROLLOUT_LEGACY_YJS_DOCUMENTS),
        legacyYjsMigrationAccepted: envFlag(process.env.OPENADE_CORE_ROLLOUT_LEGACY_YJS_MIGRATION_ACCEPTED),
    }
}

const coreRuntimeEndpoint = coreRuntimeEndpointFromEnv()
const coreMigrationRuntimeEndpoint = coreRuntimeEndpointFromEnv("OPENADE_CORE_MIGRATION")

const openadeAPI = {
    // ========================================================================
    // App Controls
    // ========================================================================
    app: {
        activeWorkUnloadBlockerDisabled,
        smokeTest,
        quit: () => ipcRenderer.invoke("quit-app"),
        restart: () => ipcRenderer.invoke("restart-app"),
        openUrl: (url: string) => ipcRenderer.invoke("open-url", url),
        applyUpdate: () => ipcRenderer.invoke("apply-update"),
        forceEnableDevTools: () => ipcRenderer.invoke("force-enable-dev-tools"),
        isWindowedWithFrame: () => ipcRenderer.invoke("is-windowed-with-frame"),
        setTerminalKeyboardCapture: (captured: boolean) => ipcRenderer.invoke("app:set-terminal-keyboard-capture", captured),
        onUpdateAvailable: (cb: () => void) => createListener("app:update-available", cb as (...args: unknown[]) => void),
        onUpdateError: (cb: () => void) => createListener("app:update-error", cb as (...args: unknown[]) => void),
        onFocusInputShortcut: (cb: () => void) => createListener("app:focus-input-shortcut", cb as (...args: unknown[]) => void),
        retryUpdateCheck: () => ipcRenderer.invoke("retry-update-check"),
    },

    // ========================================================================
    // Window Controls
    // ========================================================================
    window: {
        isPinned: () => ipcRenderer.invoke("window-is-pinned"),
        isAutoHide: () => ipcRenderer.invoke("window-is-autoHide"),
        action: (action: string) => ipcRenderer.invoke("window-action", action),
        frameEnabled: () => ipcRenderer.invoke("window-frame-enabled"),
        setFrameColors: (colors: unknown) => ipcRenderer.invoke("window-frame-set-colors", colors),
        findInPage: (action: unknown) => ipcRenderer.invoke("find-in-page", action),
    },

    // ========================================================================
    // Settings
    // ========================================================================
    settings: {
        getDeviceConfig: () => ipcRenderer.invoke("get-device-config"),
        setDeviceId: (deviceId: string) => ipcRenderer.invoke("set-device-id", deviceId),
        setTelemetryDisabled: (disabled: boolean) => ipcRenderer.invoke("set-telemetry-disabled", disabled),
    },

    // ========================================================================
    // Shell
    // ========================================================================
    shell: {
        selectDirectory: (params: unknown) => ipcRenderer.invoke("code:shell:selectDirectory", params),
        openUrl: (params: unknown) => ipcRenderer.invoke("code:shell:openUrl", params),
        openPath: (params: unknown) => ipcRenderer.invoke("code:shell:openPath", params),
    },

    // ========================================================================
    // Window Frame (code module variant)
    // ========================================================================
    codeWindowFrame: {
        enabled: () => ipcRenderer.invoke("code:windowFrame:enabled"),
        setColors: (colors: unknown) => ipcRenderer.invoke("code:windowFrame:setColors", colors),
    },

    // ========================================================================
    // Notifications
    // ========================================================================
    notifications: {
        getState: () => ipcRenderer.invoke("notifications:getState"),
        shouldShow: () => ipcRenderer.invoke("notifications:shouldShow"),
    },

    // ========================================================================
    // Companion remote control
    // ========================================================================
    companion: {
        getState: () => ipcRenderer.invoke("companion:getState"),
        setEnabled: (enabled: boolean) => ipcRenderer.invoke("companion:setEnabled", enabled),
        setKeepAwakeMode: (mode: string) => ipcRenderer.invoke("companion:setKeepAwakeMode", mode),
        startPairing: () => ipcRenderer.invoke("companion:startPairing"),
    },

    // ========================================================================
    // OpenADE Core product runtime endpoint
    // ========================================================================
    core: {
        runtimeEndpoint: coreRuntimeEndpoint,
        migrationRuntimeEndpoint: coreMigrationRuntimeEndpoint,
        rolloutState: coreRolloutStateFromEnv(coreRuntimeEndpoint),
    },

    // ========================================================================
    // Runtime protocol
    // ========================================================================
    runtime: {
        connect: () => ipcRenderer.invoke("runtime:connect"),
        disconnect: () => ipcRenderer.invoke("runtime:disconnect"),
        request: (request: unknown) => ipcRenderer.invoke("runtime:request", request),
        onMessage: (cb: (message: unknown) => void) => createListener("runtime:message", cb as (...args: unknown[]) => void),
    },
} satisfies OpenADEPreloadAPI

// Expose the API to the renderer
contextBridge.exposeInMainWorld("openadeAPI", openadeAPI)

// Export type for TypeScript consumers
export type { OpenADEAPI } from "./preload-api"
