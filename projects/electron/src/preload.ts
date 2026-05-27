/**
 * Preload Script for Electron Context Isolation
 *
 * This script runs in a sandboxed context before the renderer process loads.
 * It exposes a typed API to the renderer via contextBridge as `window.openadeAPI`.
 *
 * SECURITY: This is the only way the renderer can communicate with the main process.
 * All IPC communication MUST go through the exposed openadeAPI.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron"

// Helper to create event listener with cleanup
const createListener = (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
}

const openadeAPI = {
    // ========================================================================
    // App Controls
    // ========================================================================
    app: {
        quit: () => ipcRenderer.invoke("quit-app"),
        openUrl: (url: string) => ipcRenderer.invoke("open-url", url),
        applyUpdate: () => ipcRenderer.invoke("apply-update"),
        forceEnableDevTools: () => ipcRenderer.invoke("force-enable-dev-tools"),
        isWindowedWithFrame: () => ipcRenderer.invoke("is-windowed-with-frame"),
        setTerminalKeyboardCapture: (captured: boolean) => ipcRenderer.invoke("app:set-terminal-keyboard-capture", captured),
        onUpdateAvailable: (cb: () => void) =>
            createListener("app:update-available", cb as (...args: unknown[]) => void),
        onUpdateError: (cb: () => void) =>
            createListener("app:update-error", cb as (...args: unknown[]) => void),
        onFocusInputShortcut: (cb: () => void) =>
            createListener("app:focus-input-shortcut", cb as (...args: unknown[]) => void),
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
        revokeDevice: (deviceId: string) => ipcRenderer.invoke("companion:revokeDevice", deviceId),
        dropAllDevices: () => ipcRenderer.invoke("companion:dropAllDevices"),
    },

    // ========================================================================
    // Runtime protocol
    // ========================================================================
    runtime: {
        connect: () => ipcRenderer.invoke("runtime:connect"),
        disconnect: () => ipcRenderer.invoke("runtime:disconnect"),
        request: (request: unknown) => ipcRenderer.invoke("runtime:request", request),
        onMessage: (cb: (message: unknown) => void) =>
            createListener("runtime:message", cb as (...args: unknown[]) => void),
    },

}

// Expose the API to the renderer
contextBridge.exposeInMainWorld("openadeAPI", openadeAPI)

// Export type for TypeScript consumers
export type OpenADEAPI = typeof openadeAPI
