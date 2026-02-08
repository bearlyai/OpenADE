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
        onUpdateAvailable: (cb: () => void) =>
            createListener("app:update-available", cb as (...args: unknown[]) => void),
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
        setTelemetryDisabled: (disabled: boolean) => ipcRenderer.invoke("set-telemetry-disabled", disabled),
    },

    // ========================================================================
    // Directory Access (legacy)
    // ========================================================================
    dir: {
        enabled: () => ipcRenderer.invoke("dir-access-enabled"),
        list: (args: unknown) => ipcRenderer.invoke("list-dir", args),
        getDirFromPath: (args: unknown) => ipcRenderer.invoke("get-dir-from-path", args),
        fileContents: (args: unknown) => ipcRenderer.invoke("file-contents", args),
        selectDirectory: (args?: unknown) => ipcRenderer.invoke("select-directory", args),
    },

    // ========================================================================
    // CORS-Free Fetch
    // ========================================================================
    fetch: {
        available: () => ipcRenderer.invoke("cors-free-fetch-available"),
        fetch: (args: unknown) => ipcRenderer.invoke("cors-free-fetch", args),
    },

    // ========================================================================
    // Capabilities
    // ========================================================================
    capabilities: {
        get: () => ipcRenderer.invoke("code:capabilities"),
        getSdk: (args: { cwd: string }) => ipcRenderer.invoke("code:sdk-capabilities", args),
        invalidateSdk: (args: { cwd: string }) => ipcRenderer.invoke("code:invalidate-sdk-capabilities", args),
    },

    // ========================================================================
    // Files
    // ========================================================================
    files: {
        fuzzySearch: (params: unknown) => ipcRenderer.invoke("files:fuzzySearch", params),
        describePath: (params: unknown) => ipcRenderer.invoke("files:describePath", params),
        contentSearch: (params: unknown) => ipcRenderer.invoke("files:contentSearch", params),
    },

    // ========================================================================
    // Git
    // ========================================================================
    git: {
        isGitInstalled: () => ipcRenderer.invoke("git:isGitInstalled"),
        isGitDir: (params: unknown) => ipcRenderer.invoke("git:isGitDir", params),
        isGitDirectory: (params: unknown) => ipcRenderer.invoke("git:isGitDirectory", params),
        getOrCreateWorkTree: (params: unknown) => ipcRenderer.invoke("git:getOrCreateWorkTree", params),
        workTreeDiffPatch: (params: unknown) => ipcRenderer.invoke("git:workTreeDiffPatch", params),
        getMergeBase: (params: unknown) => ipcRenderer.invoke("git:getMergeBase", params),
        getGitStatus: (params: unknown) => ipcRenderer.invoke("git:getGitStatus", params),
        listFiles: (params: unknown) => ipcRenderer.invoke("git:listFiles", params),
        deleteWorkTree: (params: unknown) => ipcRenderer.invoke("git:deleteWorkTree", params),
        listWorkTrees: (params: unknown) => ipcRenderer.invoke("git:listWorkTrees", params),
        commitWorkTree: (params: unknown) => ipcRenderer.invoke("git:commitWorkTree", params),
        listBranches: (params: unknown) => ipcRenderer.invoke("git:listBranches", params),
        resolvePath: (params: unknown) => ipcRenderer.invoke("git:resolvePath", params),
        initGit: (params: unknown) => ipcRenderer.invoke("git:initGit", params),
        getChangedFiles: (params: unknown) => ipcRenderer.invoke("git:getChangedFiles", params),
        getFileAtTreeish: (params: unknown) => ipcRenderer.invoke("git:getFileAtTreeish", params),
        getFilePair: (params: unknown) => ipcRenderer.invoke("git:getFilePair", params),
    },

    // ========================================================================
    // Process (with streaming)
    // ========================================================================
    process: {
        runCmd: (params: unknown) => ipcRenderer.invoke("process:runCmd", params),
        runScript: (params: unknown) => ipcRenderer.invoke("process:runScript", params),
        reconnect: (args: unknown) => ipcRenderer.invoke("process:reconnect", args),
        kill: (args: unknown) => ipcRenderer.invoke("process:kill", args),
        list: () => ipcRenderer.invoke("process:list"),
        killAll: () => ipcRenderer.invoke("process:killAll"),
        // Streaming events
        onOutput: (processId: string, cb: (chunk: string) => void) =>
            createListener(`process:output:${processId}`, cb as (...args: unknown[]) => void),
        onExit: (processId: string, cb: (data: { exitCode: number | null; signal: string | null }) => void) =>
            createListener(`process:exit:${processId}`, cb as (...args: unknown[]) => void),
        onError: (processId: string, cb: (error: unknown) => void) =>
            createListener(`process:error:${processId}`, cb as (...args: unknown[]) => void),
    },

    // ========================================================================
    // PTY (with streaming)
    // ========================================================================
    pty: {
        spawn: (params: unknown) => ipcRenderer.invoke("pty:spawn", params),
        write: (params: unknown) => ipcRenderer.invoke("pty:write", params),
        resize: (params: unknown) => ipcRenderer.invoke("pty:resize", params),
        kill: (params: unknown) => ipcRenderer.invoke("pty:kill", params),
        reconnect: (params: unknown) => ipcRenderer.invoke("pty:reconnect", params),
        killAll: () => ipcRenderer.invoke("pty:killAll"),
        // Streaming events
        onOutput: (ptyId: string, cb: (chunk: string) => void) =>
            createListener(`pty:output:${ptyId}`, cb as (...args: unknown[]) => void),
        onExit: (ptyId: string, cb: (data: { exitCode: number }) => void) =>
            createListener(`pty:exit:${ptyId}`, cb as (...args: unknown[]) => void),
    },

    // ========================================================================
    // Claude (with streaming)
    // ========================================================================
    claude: {
        // Unified command interface
        command: (command: unknown) => ipcRenderer.invoke("claude:command", command),
        // Legacy handlers (for backward compatibility)
        query: (args: unknown) => ipcRenderer.invoke("claude:query", args),
        toolResponse: (args: unknown) => ipcRenderer.invoke("claude:tool-response", args),
        reconnect: (args: unknown) => ipcRenderer.invoke("claude:reconnect", args),
        abort: (args: unknown) => ipcRenderer.invoke("claude:abort", args),
        // Streaming events
        onEvent: (cb: (event: unknown) => void) =>
            createListener("claude:event", cb as (...args: unknown[]) => void),
        onToolCall: (executionId: string, cb: (callId: string, name: string, args: unknown) => void) => {
            const handler = (_event: IpcRendererEvent, callId: string, name: string, args: unknown) =>
                cb(callId, name, args)
            ipcRenderer.on(`claude:tool-call:${executionId}`, handler)
            return () => ipcRenderer.removeListener(`claude:tool-call:${executionId}`, handler)
        },
        onMessage: (executionId: string, cb: (message: unknown) => void) =>
            createListener(`claude:message:${executionId}`, cb as (...args: unknown[]) => void),
        onComplete: (executionId: string, cb: () => void) =>
            createListener(`claude:complete:${executionId}`, cb as (...args: unknown[]) => void),
        onError: (executionId: string, cb: (error: unknown) => void) =>
            createListener(`claude:error:${executionId}`, cb as (...args: unknown[]) => void),
    },

    // ========================================================================
    // MCP (Model Context Protocol)
    // ========================================================================
    mcp: {
        testConnection: (params: unknown) => ipcRenderer.invoke("code:mcp:testConnection", params),
        initiateOAuth: (params: unknown) => ipcRenderer.invoke("code:mcp:initiateOAuth", params),
        cancelOAuth: (params: unknown) => ipcRenderer.invoke("code:mcp:cancelOAuth", params),
        refreshOAuth: (params: unknown) => ipcRenderer.invoke("code:mcp:refreshOAuth", params),
        // OAuth completion events (global - not per-server)
        onOAuthComplete: (cb: (result: unknown) => void) =>
            createListener("code:mcp:oauthComplete", cb as (...args: unknown[]) => void),
    },

    // ========================================================================
    // Binaries
    // ========================================================================
    binaries: {
        statuses: () => ipcRenderer.invoke("code:binaries:statuses"),
        ensure: (args: { name: string }) => ipcRenderer.invoke("code:binaries:ensure", args),
        remove: (args: { name: string }) => ipcRenderer.invoke("code:binaries:remove", args),
        resolve: (args: { name: string }) => ipcRenderer.invoke("code:binaries:resolve", args),
    },

    // ========================================================================
    // Platform
    // ========================================================================
    platform: {
        getInfo: () => ipcRenderer.invoke("code:platform:getInfo"),
        checkBinary: (args: { binary: string }) => ipcRenderer.invoke("code:system:checkBinary", args),
        checkVendoredRipgrep: () => ipcRenderer.invoke("code:system:checkVendoredRipgrep"),
    },

    // ========================================================================
    // Shell
    // ========================================================================
    shell: {
        selectDirectory: (params: unknown) => ipcRenderer.invoke("code:shell:selectDirectory", params),
        openUrl: (params: unknown) => ipcRenderer.invoke("code:shell:openUrl", params),
        createDirectory: (params: unknown) => ipcRenderer.invoke("code:shell:createDirectory", params),
    },

    // ========================================================================
    // Subprocess
    // ========================================================================
    subprocess: {
        setGlobalEnv: (args: { env: Record<string, string> }) =>
            ipcRenderer.invoke("code:system:setGlobalEnv", args),
    },

    // ========================================================================
    // YJS Storage
    // ========================================================================
    yjs: {
        save: (args: { id: string; data: Uint8Array }) => ipcRenderer.invoke("code:yjs:save", args),
        load: (args: { id: string }) => ipcRenderer.invoke("code:yjs:load", args),
        delete: (args: { id: string }) => ipcRenderer.invoke("code:yjs:delete", args),
        list: () => ipcRenderer.invoke("code:yjs:list"),
    },

    // ========================================================================
    // Snapshots
    // ========================================================================
    snapshots: {
        save: (args: { id: string; patch: string }) => ipcRenderer.invoke("code:snapshots:save", args),
        load: (args: { id: string }) => ipcRenderer.invoke("code:snapshots:load", args),
        delete: (args: { id: string }) => ipcRenderer.invoke("code:snapshots:delete", args),
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
    // Procs (process file reading)
    // ========================================================================
    procs: {
        read: (params: { path: string }) => ipcRenderer.invoke("procs:read", params),
    },
}

// Expose the API to the renderer
contextBridge.exposeInMainWorld("openadeAPI", openadeAPI)

// Export type for TypeScript consumers
export type OpenADEAPI = typeof openadeAPI
