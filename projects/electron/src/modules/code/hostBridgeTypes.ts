export interface ManagedBinaryStatus {
    name: string
    displayName: string
    version: string
    status: "available" | "downloading" | "not_downloaded" | "error"
    path: string | null
    error: string | null
}

export interface ManagedBinaryEnsureResult {
    ok: boolean
    path?: string
    error?: string
}

export interface CodeModuleCapabilities {
    enabled: boolean
    version: string
}

export interface SdkCapabilities {
    slash_commands: string[]
    skills: string[]
    plugins: { name: string; path: string }[]
    cachedAt: number
}

export interface PlatformInfo {
    platform: "win32" | "darwin" | "linux"
    pathSeparator: "/" | "\\"
    homeDir: string
    isWindows: boolean
    isMac: boolean
    isLinux: boolean
}

export interface BinaryCheckResult {
    installed: boolean
    path?: string
    error?: string
}

export interface SelectDirectoryParams {
    defaultPath?: string
}

export interface SelectDirectoryResponse {
    path: string | null
}

export interface OpenUrlParams {
    url: string
}

export interface OpenPathParams {
    path: string
}

export interface CreateDirectoryParams {
    path: string
}

export interface CreateDirectoryResponse {
    success: boolean
    error?: string
}

export interface FrameColors {
    symbolColor: string
    color: string
}
