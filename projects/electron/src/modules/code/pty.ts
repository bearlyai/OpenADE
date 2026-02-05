import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import * as pty from "node-pty"
import * as os from "os"
import * as fs from "fs"
import logger from "electron-log"
import { isDev } from "../../config"

// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/pty.ts

interface SpawnParams {
    ptyId: string
    cwd: string
    env?: Record<string, string>
    cols: number
    rows: number
}

interface SpawnResponse {
    ok: boolean
    error?: string
}

interface WriteParams {
    ptyId: string
    data: string // base64 encoded
}

interface ResizeParams {
    ptyId: string
    cols: number
    rows: number
}

interface KillParams {
    ptyId: string
}

interface ReconnectParams {
    ptyId: string
}

interface ReconnectResponse {
    ok: boolean
    found: boolean
    exited?: boolean
    exitCode?: number
}

interface PtyOutputEvent {
    data: string // base64 encoded
    timestamp: number
}


interface ActivePty {
    pty: pty.IPty
    outputBuffer: PtyOutputEvent[]
    bufferSizeBytes: number
    webContents: WebContents | null
    exited: boolean
    exitCode: number | null
    cleanupTimeoutId?: NodeJS.Timeout
}

const MAX_BUFFER_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_ACTIVE_PTYS = 50
const CLEANUP_DELAY_MS = 30 * 60 * 1000 // 30 minutes

const activePtys = new Map<string, ActivePty>()

function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        } else {
            return url.hostname.endsWith("localhost") || url.protocol === "file:"
        }
    } catch (error) {
        logger.error("[Pty:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

function validateCwd(cwd: string): void {
    if (!cwd || typeof cwd !== "string") {
        throw new Error("cwd must be a non-empty string")
    }
    if (!fs.existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`)
    }
    if (!fs.statSync(cwd).isDirectory()) {
        throw new Error(`Path is not a directory: ${cwd}`)
    }
}

function getDefaultShell(): string {
    if (os.platform() === "win32") {
        // On Windows, prefer COMSPEC (cmd.exe) or PowerShell
        const comspec = process.env.COMSPEC
        if (comspec && fs.existsSync(comspec)) {
            logger.info("[Pty] Using Windows shell from COMSPEC:", JSON.stringify({ shell: comspec }))
            return comspec
        }
        // Fall back to PowerShell
        logger.info("[Pty] Using Windows PowerShell")
        return "powershell.exe"
    }

    // Unix: use SHELL env var with fallback cascade
    const shellEnv = process.env.SHELL
    if (shellEnv && fs.existsSync(shellEnv)) {
        logger.info("[Pty] Using shell from SHELL env:", JSON.stringify({ shell: shellEnv }))
        return shellEnv
    }

    // Fallback cascade for Unix systems
    const fallbacks = ["/bin/bash", "/bin/zsh", "/bin/sh"]
    for (const fallback of fallbacks) {
        if (fs.existsSync(fallback)) {
            logger.info("[Pty] Using fallback shell:", JSON.stringify({ shell: fallback }))
            return fallback
        }
    }

    // Last resort - will likely fail but at least log it
    logger.warn("[Pty] No shell found, defaulting to /bin/sh")
    return "/bin/sh"
}

function scheduleCleanup(ptyId: string): void {
    const p = activePtys.get(ptyId)
    if (!p) return

    if (p.cleanupTimeoutId) {
        clearTimeout(p.cleanupTimeoutId)
    }

    p.cleanupTimeoutId = setTimeout(() => {
        logger.info("[Pty] Auto-cleanup triggered", JSON.stringify({ ptyId }))
        activePtys.delete(ptyId)
    }, CLEANUP_DELAY_MS)
}

function sendOutput(ptyId: string, data: string): void {
    const p = activePtys.get(ptyId)
    if (!p) return

    const chunk: PtyOutputEvent = {
        data: Buffer.from(data).toString("base64"),
        timestamp: Date.now(),
    }

    const chunkSize = Buffer.byteLength(data, "utf8")
    if (p.bufferSizeBytes + chunkSize <= MAX_BUFFER_SIZE_BYTES) {
        p.outputBuffer.push(chunk)
        p.bufferSizeBytes += chunkSize
    } else {
        while (p.outputBuffer.length > 0 && p.bufferSizeBytes + chunkSize > MAX_BUFFER_SIZE_BYTES) {
            const removed = p.outputBuffer.shift()
            if (removed) {
                p.bufferSizeBytes -= Buffer.byteLength(Buffer.from(removed.data, "base64").toString("utf8"), "utf8")
            }
        }
        p.outputBuffer.push(chunk)
        p.bufferSizeBytes += chunkSize
    }

    if (p.webContents && !p.webContents.isDestroyed()) {
        p.webContents.send(`pty:output:${ptyId}`, chunk)
    }
}

function sendExit(ptyId: string, exitCode: number): void {
    const p = activePtys.get(ptyId)
    if (!p) return

    p.exited = true
    p.exitCode = exitCode

    if (p.webContents && !p.webContents.isDestroyed()) {
        p.webContents.send(`pty:exit:${ptyId}`, { exitCode })
    }

    scheduleCleanup(ptyId)
}

async function handleSpawn(params: SpawnParams, webContents: WebContents): Promise<SpawnResponse> {
    logger.info("[Pty:spawn] Starting", JSON.stringify({ ptyId: params.ptyId, cwd: params.cwd, cols: params.cols, rows: params.rows }))

    try {
        validateCwd(params.cwd)

        if (activePtys.size >= MAX_ACTIVE_PTYS) {
            throw new Error(`Maximum active PTYs (${MAX_ACTIVE_PTYS}) reached`)
        }

        // If PTY already exists, just reconnect
        if (activePtys.has(params.ptyId)) {
            const existing = activePtys.get(params.ptyId)!
            existing.webContents = webContents
            return { ok: true }
        }

        const shell = getDefaultShell()
        const ptyProcess = pty.spawn(shell, [], {
            name: "xterm-256color",
            cols: params.cols,
            rows: params.rows,
            cwd: params.cwd,
            env: { ...(process.env as Record<string, string>), ...params.env },
        })

        activePtys.set(params.ptyId, {
            pty: ptyProcess,
            outputBuffer: [],
            bufferSizeBytes: 0,
            webContents,
            exited: false,
            exitCode: null,
        })

        ptyProcess.onData((data) => {
            sendOutput(params.ptyId, data)
        })

        ptyProcess.onExit(({ exitCode }) => {
            logger.info("[Pty] Process exited", JSON.stringify({ ptyId: params.ptyId, exitCode }))
            sendExit(params.ptyId, exitCode)
        })

        logger.info("[Pty:spawn] PTY created", JSON.stringify({ ptyId: params.ptyId, shell, pid: ptyProcess.pid }))
        return { ok: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        logger.error("[Pty:spawn] Error:", JSON.stringify({ error: errorMessage }))
        return { ok: false, error: errorMessage }
    }
}

async function handleWrite(params: WriteParams): Promise<{ ok: boolean }> {
    const p = activePtys.get(params.ptyId)
    if (!p || p.exited) {
        return { ok: false }
    }

    try {
        const data = Buffer.from(params.data, "base64").toString("utf8")
        p.pty.write(data)
        return { ok: true }
    } catch (error) {
        logger.error("[Pty:write] Error:", error)
        return { ok: false }
    }
}

async function handleResize(params: ResizeParams): Promise<{ ok: boolean }> {
    const p = activePtys.get(params.ptyId)
    if (!p || p.exited) {
        return { ok: false }
    }

    try {
        p.pty.resize(params.cols, params.rows)
        return { ok: true }
    } catch (error) {
        logger.error("[Pty:resize] Error:", error)
        return { ok: false }
    }
}

async function handleKill(params: KillParams): Promise<{ ok: boolean }> {
    logger.info("[Pty:kill] Killing PTY", JSON.stringify({ ptyId: params.ptyId }))

    const p = activePtys.get(params.ptyId)
    if (!p) {
        return { ok: false }
    }

    try {
        if (!p.exited) {
            p.pty.kill()
        }

        if (p.cleanupTimeoutId) {
            clearTimeout(p.cleanupTimeoutId)
        }
        activePtys.delete(params.ptyId)

        return { ok: true }
    } catch (error) {
        logger.error("[Pty:kill] Error:", error)
        return { ok: false }
    }
}

async function handleReconnect(params: ReconnectParams, webContents: WebContents): Promise<ReconnectResponse> {
    logger.info("[Pty:reconnect] Reconnecting", JSON.stringify({ ptyId: params.ptyId }))

    const p = activePtys.get(params.ptyId)
    if (!p) {
        return { ok: false, found: false }
    }

    if (p.cleanupTimeoutId) {
        clearTimeout(p.cleanupTimeoutId)
        p.cleanupTimeoutId = undefined
    }

    p.webContents = webContents

    // Replay buffered output
    for (const chunk of p.outputBuffer) {
        webContents.send(`pty:output:${params.ptyId}`, chunk)
    }

    if (p.exited) {
        webContents.send(`pty:exit:${params.ptyId}`, { exitCode: p.exitCode })
        scheduleCleanup(params.ptyId)
        return { ok: true, found: true, exited: true, exitCode: p.exitCode ?? undefined }
    }

    return { ok: true, found: true, exited: false }
}

export const load = () => {
    logger.info("[Pty] Registering IPC handlers")

    ipcMain.handle("pty:spawn", async (event, params: SpawnParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleSpawn(params, event.sender)
    })

    ipcMain.handle("pty:write", async (event, params: WriteParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleWrite(params)
    })

    ipcMain.handle("pty:resize", async (event, params: ResizeParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleResize(params)
    })

    ipcMain.handle("pty:kill", async (event, params: KillParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleKill(params)
    })

    ipcMain.handle("pty:reconnect", async (event, params: ReconnectParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleReconnect(params, event.sender)
    })

    ipcMain.handle("pty:killAll", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        logger.info("[Pty] Killing all PTYs (triggered by frontend)")
        cleanup()
        return { ok: true }
    })

    logger.info("[Pty] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[Pty] Cleanup called, killing all active PTYs")

    for (const [ptyId, p] of activePtys) {
        if (p.cleanupTimeoutId) {
            clearTimeout(p.cleanupTimeoutId)
        }

        if (!p.exited) {
            try {
                p.pty.kill()
            } catch {
                // Ignore errors during cleanup
            }
        }

        activePtys.delete(ptyId)
    }

    logger.info("[Pty] Cleanup complete")
}
