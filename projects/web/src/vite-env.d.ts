/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// OpenADE Electron API exposed via preload contextBridge
interface OpenADEAPI {
    app: {
        quit: () => Promise<void>
        openUrl: (url: string) => Promise<void>
        applyUpdate: () => Promise<void>
        forceEnableDevTools: () => Promise<void>
        isWindowedWithFrame: () => Promise<boolean>
        onUpdateAvailable: (cb: () => void) => () => void
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
        setTelemetryDisabled: (disabled: boolean) => Promise<void>
    }
    dir: {
        enabled: () => Promise<boolean>
        list: (args: unknown) => Promise<unknown>
        getDirFromPath: (args: unknown) => Promise<unknown>
        fileContents: (args: unknown) => Promise<unknown>
        selectDirectory: (args?: unknown) => Promise<unknown>
    }
    fetch: {
        available: () => Promise<boolean>
        fetch: (args: unknown) => Promise<unknown>
    }
    capabilities: {
        get: () => Promise<unknown>
        getSdk: (args: { cwd: string }) => Promise<unknown>
        invalidateSdk: (args: { cwd: string }) => Promise<void>
    }
    files: {
        fuzzySearch: (params: unknown) => Promise<unknown>
        describePath: (params: unknown) => Promise<unknown>
        contentSearch: (params: unknown) => Promise<unknown>
    }
    git: {
        isGitInstalled: () => Promise<unknown>
        isGitDir: (params: unknown) => Promise<unknown>
        isGitDirectory: (params: unknown) => Promise<unknown>
        getOrCreateWorkTree: (params: unknown) => Promise<unknown>
        workTreeDiffPatch: (params: unknown) => Promise<unknown>
        getMergeBase: (params: unknown) => Promise<unknown>
        getGitStatus: (params: unknown) => Promise<unknown>
        listFiles: (params: unknown) => Promise<unknown>
        deleteWorkTree: (params: unknown) => Promise<unknown>
        listWorkTrees: (params: unknown) => Promise<unknown>
        commitWorkTree: (params: unknown) => Promise<unknown>
        listBranches: (params: unknown) => Promise<unknown>
        resolvePath: (params: unknown) => Promise<unknown>
        initGit: (params: unknown) => Promise<unknown>
        getChangedFiles: (params: unknown) => Promise<unknown>
        getFileAtTreeish: (params: unknown) => Promise<unknown>
        getFilePair: (params: unknown) => Promise<unknown>
    }
    process: {
        runCmd: (params: unknown) => Promise<unknown>
        runScript: (params: unknown) => Promise<unknown>
        reconnect: (args: unknown) => Promise<unknown>
        kill: (args: unknown) => Promise<unknown>
        list: () => Promise<unknown>
        killAll: () => Promise<unknown>
        // biome-ignore lint: callback types are cast by consumer
        onOutput: (processId: string, cb: (chunk: unknown) => void) => () => void
        // biome-ignore lint: callback types are cast by consumer
        onExit: (processId: string, cb: (data: unknown) => void) => () => void
        // biome-ignore lint: callback types are cast by consumer
        onError: (processId: string, cb: (error: unknown) => void) => () => void
    }
    pty: {
        spawn: (params: unknown) => Promise<unknown>
        write: (params: unknown) => Promise<void>
        resize: (params: unknown) => Promise<void>
        kill: (params: unknown) => Promise<void>
        reconnect: (params: unknown) => Promise<unknown>
        killAll: () => Promise<unknown>
        // biome-ignore lint: callback types are cast by consumer
        onOutput: (ptyId: string, cb: (chunk: unknown) => void) => () => void
        // biome-ignore lint: callback types are cast by consumer
        onExit: (ptyId: string, cb: (data: unknown) => void) => () => void
    }
    claude: {
        command: (command: unknown) => Promise<unknown>
        query: (args: unknown) => Promise<unknown>
        toolResponse: (args: unknown) => Promise<unknown>
        reconnect: (args: unknown) => Promise<unknown>
        abort: (args: unknown) => Promise<unknown>
        onEvent: (cb: (event: unknown) => void) => () => void
        onToolCall: (executionId: string, cb: (callId: string, name: string, args: unknown) => void) => () => void
        onMessage: (executionId: string, cb: (message: unknown) => void) => () => void
        onComplete: (executionId: string, cb: () => void) => () => void
        onError: (executionId: string, cb: (error: unknown) => void) => () => void
    }
    mcp: {
        testConnection: (params: unknown) => Promise<unknown>
        initiateOAuth: (params: unknown) => Promise<unknown>
        cancelOAuth: (params: unknown) => Promise<unknown>
        refreshOAuth: (params: unknown) => Promise<unknown>
        onOAuthComplete: (cb: (result: unknown) => void) => () => void
    }
    binaries: {
        statuses: () => Promise<unknown>
        ensure: (args: { name: string }) => Promise<unknown>
        remove: (args: { name: string }) => Promise<unknown>
        resolve: (args: { name: string }) => Promise<unknown>
    }
    platform: {
        getInfo: () => Promise<unknown>
        checkBinary: (args: { binary: string }) => Promise<unknown>
        checkVendoredRipgrep: () => Promise<unknown>
    }
    shell: {
        selectDirectory: (params: unknown) => Promise<unknown>
        openUrl: (params: unknown) => Promise<void>
    }
    subprocess: {
        setGlobalEnv: (args: { env: Record<string, string> }) => Promise<unknown>
    }
    yjs: {
        save: (args: { id: string; data: Uint8Array }) => Promise<void>
        load: (args: { id: string }) => Promise<unknown>
        delete: (args: { id: string }) => Promise<void>
        list: () => Promise<unknown>
    }
    snapshots: {
        save: (args: { id: string; patch: string }) => Promise<void>
        load: (args: { id: string }) => Promise<string | null>
        delete: (args: { id: string }) => Promise<void>
    }
    codeWindowFrame: {
        enabled: () => Promise<boolean>
        setColors: (colors: unknown) => Promise<void>
    }
    notifications: {
        getState: () => Promise<unknown>
        shouldShow: () => Promise<boolean>
    }
    procs: {
        read: (params: { path: string }) => Promise<unknown>
    }
}

// Make this file a module so declare global works
export {}

declare global {
    interface Window {
        openadeAPI?: OpenADEAPI
    }
}
