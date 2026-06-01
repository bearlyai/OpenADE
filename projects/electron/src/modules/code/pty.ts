import * as pty from "node-pty"
import * as os from "node:os"
import * as fs from "node:fs"
import logger from "electron-log"
import type {
    RuntimeNodePtyKillParams,
    RuntimeNodePtyLifecycleEvent,
    RuntimeNodePtyMutationResult,
    RuntimeNodePtyOutputEvent,
    RuntimeNodePtyReconnectParams,
    RuntimeNodePtyReconnectResult,
    RuntimeNodePtyResizeParams,
    RuntimeNodePtySpawnParams,
    RuntimeNodePtySpawnResult,
    RuntimeNodePtyWriteParams,
} from "../../../../runtime-node/src/pty"

export type SpawnParams = RuntimeNodePtySpawnParams
export type SpawnResponse = RuntimeNodePtySpawnResult
export type WriteParams = RuntimeNodePtyWriteParams
export type ResizeParams = RuntimeNodePtyResizeParams
export type KillParams = RuntimeNodePtyKillParams
export type ReconnectParams = RuntimeNodePtyReconnectParams
export type ReconnectResponse = Omit<RuntimeNodePtyReconnectResult, "output">
export type RuntimeReconnectResponse = RuntimeNodePtyReconnectResult
export type PtyOutputEvent = RuntimeNodePtyOutputEvent
export type PtyLifecycleEvent = RuntimeNodePtyLifecycleEvent


interface ActivePty {
    pty: pty.IPty
    outputBuffer: PtyOutputEvent[]
    bufferSizeBytes: number
    exited: boolean
    exitCode: number | null
    cleanupTimeoutId?: NodeJS.Timeout
}

const MAX_BUFFER_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_ACTIVE_PTYS = 50
const CLEANUP_DELAY_MS = 30 * 60 * 1000 // 30 minutes

const activePtys = new Map<string, ActivePty>()
const lifecycleListeners = new Set<(event: PtyLifecycleEvent) => void>()

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

function emitLifecycle(event: PtyLifecycleEvent): void {
    for (const listener of lifecycleListeners) {
        try {
            listener(event)
        } catch (error) {
            logger.warn("[Pty] Lifecycle listener failed", error)
        }
    }
}

export function addPtyLifecycleListener(listener: (event: PtyLifecycleEvent) => void): () => void {
    lifecycleListeners.add(listener)
    return () => lifecycleListeners.delete(listener)
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

    emitLifecycle({ type: "output", ptyId, chunk })
}

function sendExit(ptyId: string, exitCode: number): void {
    const p = activePtys.get(ptyId)
    if (!p) return

    p.exited = true
    p.exitCode = exitCode

    emitLifecycle({ type: "exit", ptyId, exitCode })

    scheduleCleanup(ptyId)
}

async function handleSpawn(params: SpawnParams): Promise<SpawnResponse> {
    logger.info("[Pty:spawn] Starting", JSON.stringify({ ptyId: params.ptyId, cwd: params.cwd, cols: params.cols, rows: params.rows }))

    try {
        validateCwd(params.cwd)

        if (activePtys.size >= MAX_ACTIVE_PTYS) {
            throw new Error(`Maximum active PTYs (${MAX_ACTIVE_PTYS}) reached`)
        }

        // If PTY already exists, just reconnect
        if (activePtys.has(params.ptyId)) {
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

        emitLifecycle({
            type: "started",
            ptyId: params.ptyId,
            pid: ptyProcess.pid,
            cwd: params.cwd,
            shell,
        })

        logger.info("[Pty:spawn] PTY created", JSON.stringify({ ptyId: params.ptyId, shell, pid: ptyProcess.pid }))
        return { ok: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        logger.error("[Pty:spawn] Error:", JSON.stringify({ error: errorMessage }))
        return { ok: false, error: errorMessage }
    }
}

async function handleWrite(params: WriteParams): Promise<RuntimeNodePtyMutationResult> {
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

async function handleResize(params: ResizeParams): Promise<RuntimeNodePtyMutationResult> {
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

async function handleKill(params: KillParams): Promise<RuntimeNodePtyMutationResult> {
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
        emitLifecycle({ type: "killed", ptyId: params.ptyId })

        return { ok: true }
    } catch (error) {
        logger.error("[Pty:kill] Error:", error)
        return { ok: false }
    }
}

export async function spawnRuntimePty(params: SpawnParams): Promise<SpawnResponse> {
    return handleSpawn(params)
}

export async function writeRuntimePty(params: WriteParams): Promise<RuntimeNodePtyMutationResult> {
    return handleWrite(params)
}

export async function resizeRuntimePty(params: ResizeParams): Promise<RuntimeNodePtyMutationResult> {
    return handleResize(params)
}

export async function killRuntimePty(params: KillParams): Promise<RuntimeNodePtyMutationResult> {
    return handleKill(params)
}

export async function reconnectRuntimePty(params: ReconnectParams): Promise<RuntimeReconnectResponse> {
    const p = activePtys.get(params.ptyId)
    if (!p) {
        return { ok: false, found: false, output: [] }
    }

    if (p.cleanupTimeoutId) {
        clearTimeout(p.cleanupTimeoutId)
        p.cleanupTimeoutId = undefined
    }

    if (p.exited) {
        scheduleCleanup(params.ptyId)
    }

    return {
        ok: true,
        found: true,
        exited: p.exited,
        exitCode: p.exitCode ?? undefined,
        output: [...p.outputBuffer],
    }
}

export async function killAllRuntimePtys(): Promise<{ ok: true }> {
    cleanup()
    return { ok: true }
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
            emitLifecycle({ type: "killed", ptyId })
        }

        activePtys.delete(ptyId)
    }

    logger.info("[Pty] Cleanup complete")
}
