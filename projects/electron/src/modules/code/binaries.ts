/**
 * Dynamic Binary Manager for Electron
 *
 * Downloads pre-built binaries from bearlyai/crossbins GitHub releases.
 * Binaries are already extracted and ready to run — no archive handling needed.
 * Downloads start automatically on app launch.
 */

import { app, ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import path from "path"
import fs from "fs"
import { execCommand } from "./subprocess"
import { isDev } from "../../config"
import { createWriteStream } from "fs"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep ManagedBinaryStatus in sync with projects/dashboard/src/pages/code/electronAPI/binaries.ts
// ============================================================================

interface ManagedBinaryStatus {
    name: string
    displayName: string
    version: string
    status: "available" | "downloading" | "not_downloaded" | "error"
    path: string | null
    error: string | null
}

// ============================================================================
// Binary Registry — hardcoded URLs from bearlyai/crossbins
// ============================================================================

interface BinaryDef {
    displayName: string
    version: string
    /** URL per Electron platform-arch key */
    urls: Record<string, string>
    /** Local filename (with .exe for win32) per platform */
    filename: Record<string, string>
    /** Args to verify the binary works after download */
    verifyArgs: string[]
}

const REGISTRY: Record<string, BinaryDef> = {
    bun: {
        displayName: "Bun",
        version: "1.3.8",
        urls: {
            "darwin-arm64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-darwin-aarch64",
            "darwin-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-darwin-x86_64",
            "linux-arm64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-linux-aarch64",
            "linux-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-linux-x86_64",
            "win32-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-windows-x86_64.exe",
        },
        filename: {
            darwin: "bun",
            linux: "bun",
            win32: "bun.exe",
        },
        verifyArgs: ["--help"],
    },
    rg: {
        displayName: "ripgrep",
        version: "15.1.0",
        urls: {
            "darwin-arm64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-darwin-aarch64",
            "darwin-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-darwin-x86_64",
            "linux-arm64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-linux-aarch64",
            "linux-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-linux-x86_64-musl",
            "win32-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-windows-x86_64.exe",
        },
        filename: {
            darwin: "rg",
            linux: "rg",
            win32: "rg.exe",
        },
        verifyArgs: ["--version"],
    },
}

// ============================================================================
// State
// ============================================================================

/** Track in-flight downloads to avoid duplicates */
const activeDownloads = new Map<string, Promise<string>>()

// ============================================================================
// Path Helpers
// ============================================================================

function getBinDir(): string {
    return path.join(app.getPath("userData"), "managed-binaries", "bin")
}

function getVersionsPath(): string {
    return path.join(getBinDir(), ".versions.json")
}

function readVersions(): Record<string, string> {
    try {
        return JSON.parse(fs.readFileSync(getVersionsPath(), "utf-8"))
    } catch (err) {
        logger.debug('[Binaries] Error reading versions file:', err)
        return {}
    }
}

function writeVersion(name: string, version: string): void {
    const versions = readVersions()
    versions[name] = version
    fs.mkdirSync(getBinDir(), { recursive: true })
    fs.writeFileSync(getVersionsPath(), JSON.stringify(versions, null, 2))
}

function removeVersion(name: string): void {
    const versions = readVersions()
    delete versions[name]
    try {
        fs.writeFileSync(getVersionsPath(), JSON.stringify(versions, null, 2))
    } catch (err) {
        logger.debug('[Binaries] Error writing versions file:', err)
    }
}

function getBinaryPath(def: BinaryDef): string | null {
    const filename = def.filename[process.platform]
    if (!filename) return null
    return path.join(getBinDir(), filename)
}

function getPlatformKey(): string {
    return `${process.platform}-${process.arch}`
}

/**
 * Check if a binary needs a version upgrade.
 */
function needsUpgrade(name: string): boolean {
    const def = REGISTRY[name]
    if (!def) return false
    const installed = readVersions()[name]
    return installed !== def.version
}

/**
 * Prepend the managed bin directory to the system PATH.
 */
function enhancePath(): void {
    const binDir = getBinDir()
    const currentPath = process.env.PATH || ""

    if (!currentPath.includes(binDir)) {
        const separator = process.platform === "win32" ? ";" : ":"
        process.env.PATH = `${binDir}${separator}${currentPath}`
        logger.info("[Binaries] Prepended to PATH:", binDir)
    }
}

/**
 * Get the path to the SDK's cli.js, using the asar-unpacked path in packaged builds.
 * Bun cannot read from asar archives, so we must point it at the unpacked copy.
 * Returns undefined in dev (SDK resolves it fine on its own).
 */
export function getCliJsPath(): string | undefined {
    if (isDev) return undefined

    // In production the SDK lives inside app.asar, but asarUnpack extracts it to app.asar.unpacked
    const sdkDir = path.dirname(require.resolve("@anthropic-ai/claude-agent-sdk/sdk.mjs"))
    const unpackedDir = sdkDir.replace("app.asar", "app.asar.unpacked")
    const cliPath = path.join(unpackedDir, "cli.js")

    if (fs.existsSync(cliPath)) {
        return cliPath
    }

    logger.warn("[Binaries] Unpacked cli.js not found at:", cliPath)
    return undefined
}

// ============================================================================
// Download
// ============================================================================

async function downloadBinary(url: string, destPath: string, name: string): Promise<void> {
    const { net } = await import("electron")

    logger.info(`[Binaries] Downloading ${name} from ${url}`)

    const response = await net.fetch(url, { redirect: "follow" })
    if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`)
    }

    const body = response.body
    if (!body) throw new Error("No response body")

    fs.mkdirSync(path.dirname(destPath), { recursive: true })

    const fileStream = createWriteStream(destPath)
    let bytesDownloaded = 0

    const reader = body.getReader()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            fileStream.write(value)
            bytesDownloaded += value.byteLength
        }
    } finally {
        reader.releaseLock()
    }

    fileStream.end()
    await new Promise<void>((resolve, reject) => {
        fileStream.on("finish", resolve)
        fileStream.on("error", reject)
    })

    if (process.platform !== "win32") {
        fs.chmodSync(destPath, 0o755)
    }

    logger.info(`[Binaries] Downloaded ${name}: ${bytesDownloaded} bytes`)
}

// ============================================================================
// Core API
// ============================================================================

/**
 * Resolve a managed binary. Returns its path if downloaded and version matches, or null.
 */
export function resolve(name: string): string | null {
    const def = REGISTRY[name]
    if (!def) return null

    const binaryPath = getBinaryPath(def)
    if (binaryPath && fs.existsSync(binaryPath) && !needsUpgrade(name)) return binaryPath
    return null
}

/**
 * Ensure a managed binary is available. Downloads if not present.
 * Deduplicates concurrent calls for the same binary.
 */
async function ensure(name: string): Promise<string> {
    const def = REGISTRY[name]
    if (!def) throw new Error(`Unknown binary: ${name}`)

    const existing = resolve(name)
    if (existing) return existing

    const platformKey = getPlatformKey()
    const url = def.urls[platformKey]
    if (!url) throw new Error(`${def.displayName} is not available for ${platformKey}`)

    // Deduplicate concurrent downloads
    const existingDownload = activeDownloads.get(name)
    if (existingDownload) return existingDownload

    const downloadPromise = (async () => {
        const binaryPath = getBinaryPath(def)
        if (!binaryPath) throw new Error(`No filename mapping for ${process.platform}`)

        try {
            await downloadBinary(url, binaryPath, name)

            const verifyResult = await execCommand(binaryPath, def.verifyArgs, { timeout: 10000 })
            if (!verifyResult.success) {
                try {
                    fs.unlinkSync(binaryPath)
                } catch (err) {
                    logger.debug('[Binaries] Error removing failed binary:', err)
                }
                throw new Error(`Verification failed: ${verifyResult.stderr}`)
            }

            writeVersion(name, def.version)
            logger.info(`[Binaries] ${def.displayName} ${def.version} ready at ${binaryPath}`)
            enhancePath()
            return binaryPath
        } finally {
            activeDownloads.delete(name)
        }
    })()

    activeDownloads.set(name, downloadPromise)
    return downloadPromise
}

/**
 * Get status of all managed binaries.
 */
function getStatuses(): ManagedBinaryStatus[] {
    const platformKey = getPlatformKey()
    return Object.entries(REGISTRY).map(([name, def]) => {
        const binaryPath = resolve(name)
        const isDownloading = activeDownloads.has(name)
        const supported = !!def.urls[platformKey]

        return {
            name,
            displayName: def.displayName,
            version: def.version,
            status: isDownloading ? "downloading" : binaryPath ? "available" : "not_downloaded",
            path: binaryPath,
            error: !supported ? `Not available for ${platformKey}` : null,
        }
    })
}

/**
 * Remove a managed binary.
 */
function remove(name: string): void {
    const def = REGISTRY[name]
    if (!def) return

    const binaryPath = getBinaryPath(def)
    if (!binaryPath) return

    if (fs.existsSync(binaryPath)) {
        fs.unlinkSync(binaryPath)
        removeVersion(name)
        logger.info(`[Binaries] Removed ${def.displayName} ${def.version}`)
    }
}

// ============================================================================
// IPC Handlers
// ============================================================================

function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        } else {
            return url.hostname.endsWith("localhost") || url.protocol === "file:"
        }
    } catch (err) {
        logger.error('[Binaries] Error parsing origin URL:', err)
        return false
    }
}

export const load = () => {
    logger.info("[Binaries] Registering IPC handlers")

    // Enhance PATH with any previously downloaded binaries
    enhancePath()

    // Eagerly download any binaries that aren't available yet — deferred until app is ready
    // because net.fetch requires the app to be fully initialized
    app.whenReady().then(() => {
        for (const name of Object.keys(REGISTRY)) {
            if (!resolve(name)) {
                ensure(name).catch((err) => {
                    logger.warn(`[Binaries] Background download of ${name} failed:`, err instanceof Error ? err.message : err)
                })
            }
        }
    })

    ipcMain.handle("code:binaries:statuses", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return getStatuses()
    })

    ipcMain.handle("code:binaries:ensure", async (event, { name }: { name: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        try {
            const binaryPath = await ensure(name)
            return { ok: true, path: binaryPath }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error"
            logger.error(`[Binaries] ensure(${name}) failed:`, message)
            return { ok: false, error: message }
        }
    })

    ipcMain.handle("code:binaries:remove", async (event, { name }: { name: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        remove(name)
        return { ok: true }
    })

    ipcMain.handle("code:binaries:resolve", async (event, { name }: { name: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return { path: resolve(name) }
    })

    logger.info("[Binaries] IPC handlers registered")
}

export const cleanup = () => {
    logger.info("[Binaries] Cleanup called")
}
