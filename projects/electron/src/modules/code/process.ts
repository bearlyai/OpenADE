/**
 * Process Management Module for Electron
 *
 * Provides process spawning with real-time stdout/stderr streaming for runtime host adapters.
 * Supports reconnection after renderer refresh through output buffering.
 */

import { spawn, type ChildProcess } from "child_process"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import logger from "electron-log"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/process.ts
// ============================================================================

export interface StartCommandParams {
    cmd: string
    args?: string[]
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number // Default: 10 minutes (600000ms)
}

export interface StartScriptParams {
    script: string
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number // Default: 10 minutes (600000ms)
}

export interface StartProcessResponse {
    processId: string
}

export interface ProcessOutputChunk {
    type: "stdout" | "stderr"
    data: string
    timestamp: number
}

interface ActiveProcess {
    process: ChildProcess
    outputBuffer: ProcessOutputChunk[]
    bufferSizeBytes: number
    exitCode: number | null
    signal: string | null
    completed: boolean
    completedAt?: number
    cleanupTimeoutId?: NodeJS.Timeout
    error?: string
    tempScriptPath?: string // For cleanup
}

export interface ReconnectResponse {
    ok: boolean
    found: boolean
    completed?: boolean
    exitCode?: number | null
    signal?: string | null
    error?: string
    outputCount?: number
}

export interface RuntimeReconnectResponse extends ReconnectResponse {
    output: ProcessOutputChunk[]
}

export interface KillResponse {
    ok: boolean
    error?: string
}

export interface ListResponse {
    processes: {
        processId: string
        completed: boolean
        exitCode: number | null
        signal: string | null
        error?: string
        pid?: number
    }[]
}

export type ProcessLifecycleEvent =
    | { type: "started"; processId: string; pid?: number; cwd: string; label: string }
    | { type: "output"; processId: string; chunk: ProcessOutputChunk }
    | { type: "exit"; processId: string; exitCode: number | null; signal: string | null }
    | { type: "error"; processId: string; error: string }

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const MAX_BUFFER_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_ACTIVE_PROCESSES = 100
const CLEANUP_DELAY_MS = 30 * 60 * 1000 // 30 minutes

// Script preamble for safe execution (bash only)
const BASH_SCRIPT_PREAMBLE = `#!/bin/bash
set -eu
set -o pipefail

`

/**
 * Get the shell to use for script execution.
 * On Windows, tries to find Git Bash first, then falls back to PowerShell.
 * On Unix, uses SHELL env var or defaults to /bin/bash.
 */
function getScriptShell(): { shell: string; args: (scriptPath: string) => string[]; extension: string; usePreamble: boolean } {
    if (process.platform === "win32") {
        // Try Git Bash first (best compatibility with bash scripts)
        const gitBashPaths = [
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        ]
        for (const bashPath of gitBashPaths) {
            if (fs.existsSync(bashPath)) {
                return {
                    shell: bashPath,
                    args: (scriptPath) => [scriptPath],
                    extension: ".sh",
                    usePreamble: true,
                }
            }
        }
        // Fall back to PowerShell (scripts may need adaptation)
        logger.warn("[Process] Git Bash not found, falling back to PowerShell. Bash scripts may not work correctly.")
        return {
            shell: "powershell.exe",
            args: (scriptPath) => ["-ExecutionPolicy", "Bypass", "-File", scriptPath],
            extension: ".ps1",
            usePreamble: false,
        }
    }
    // Unix: use SHELL env or default to /bin/bash
    const shell = process.env.SHELL || "/bin/bash"
    return {
        shell,
        args: (scriptPath) => [scriptPath],
        extension: ".sh",
        usePreamble: true,
    }
}

// ============================================================================
// State
// ============================================================================

const activeProcesses = new Map<string, ActiveProcess>()
const lifecycleListeners = new Set<(event: ProcessLifecycleEvent) => void>()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate working directory
 */
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

/**
 * Generate unique process ID
 */
function generateProcessId(): string {
    return `proc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function emitLifecycle(event: ProcessLifecycleEvent): void {
    for (const listener of lifecycleListeners) {
        try {
            listener(event)
        } catch (error) {
            logger.warn("[Process] Lifecycle listener failed", error)
        }
    }
}

export function addProcessLifecycleListener(listener: (event: ProcessLifecycleEvent) => void): () => void {
    lifecycleListeners.add(listener)
    return () => lifecycleListeners.delete(listener)
}

/**
 * Get temp directory for scripts
 */
function getTempDir(): string {
    return path.join(os.tmpdir(), "bearly-process")
}

/**
 * Schedule cleanup of completed process buffer after 30 minutes
 */
function scheduleCleanup(processId: string): void {
    const proc = activeProcesses.get(processId)
    if (!proc) return

    // Clear any existing cleanup timeout
    if (proc.cleanupTimeoutId) {
        clearTimeout(proc.cleanupTimeoutId)
    }

    proc.cleanupTimeoutId = setTimeout(() => {
        logger.info("[Process] Auto-cleanup triggered for process", JSON.stringify({ processId }))
        const p = activeProcesses.get(processId)
        if (p) {
            // Clean up temp script if exists
            if (p.tempScriptPath && fs.existsSync(p.tempScriptPath)) {
                try {
                    fs.unlinkSync(p.tempScriptPath)
                } catch (e) {
                    logger.warn("[Process] Failed to clean up temp script", JSON.stringify({ path: p.tempScriptPath, error: e }))
                }
            }
            activeProcesses.delete(processId)
        }
    }, CLEANUP_DELAY_MS)
}

/**
 * Send output chunk to renderer
 */
function sendOutput(processId: string, type: "stdout" | "stderr", data: string): void {
    const proc = activeProcesses.get(processId)
    if (!proc) return

    const chunk: ProcessOutputChunk = {
        type,
        data,
        timestamp: Date.now(),
    }

    // Buffer the output (with size limit)
    const chunkSize = Buffer.byteLength(data, "utf8")
    if (proc.bufferSizeBytes + chunkSize <= MAX_BUFFER_SIZE_BYTES) {
        proc.outputBuffer.push(chunk)
        proc.bufferSizeBytes += chunkSize
    } else {
        // Buffer full - shift old entries to make room
        while (proc.outputBuffer.length > 0 && proc.bufferSizeBytes + chunkSize > MAX_BUFFER_SIZE_BYTES) {
            const removed = proc.outputBuffer.shift()
            if (removed) {
                proc.bufferSizeBytes -= Buffer.byteLength(removed.data, "utf8")
            }
        }
        proc.outputBuffer.push(chunk)
        proc.bufferSizeBytes += chunkSize
    }

    emitLifecycle({ type: "output", processId, chunk })
}

/**
 * Send exit event to renderer
 */
function sendExit(processId: string, exitCode: number | null, signal: string | null): void {
    const proc = activeProcesses.get(processId)
    if (!proc) return

    proc.completed = true
    proc.completedAt = Date.now()
    proc.exitCode = exitCode
    proc.signal = signal

    emitLifecycle({ type: "exit", processId, exitCode, signal })

    // Schedule cleanup
    scheduleCleanup(processId)
}

/**
 * Send error event to renderer
 */
function sendError(processId: string, error: string): void {
    const proc = activeProcesses.get(processId)
    if (!proc) return

    proc.completed = true
    proc.completedAt = Date.now()
    proc.error = error

    emitLifecycle({ type: "error", processId, error })

    // Schedule cleanup
    scheduleCleanup(processId)
}

/**
 * Setup process event handlers
 */
function setupProcessHandlers(processId: string, childProcess: ChildProcess, timeoutMs: number): void {
    // Timeout handler
    const timeoutId = setTimeout(() => {
        logger.warn("[Process] Process timed out", JSON.stringify({ processId, timeoutMs }))
        // Kill the entire process group (negative PID)
        if (childProcess.pid) {
            try {
                process.kill(-childProcess.pid, "SIGTERM")
            } catch (err) {
                logger.debug('[Process] Error killing process group, falling back to direct kill:', err)
                childProcess.kill("SIGTERM")
            }
        }
        // Force kill after 5 seconds if still running
        setTimeout(() => {
            if (!childProcess.killed && childProcess.pid) {
                try {
                    process.kill(-childProcess.pid, "SIGKILL")
                } catch (err) {
                    logger.debug('[Process] Error force killing process group, falling back to direct kill:', err)
                    childProcess.kill("SIGKILL")
                }
            }
        }, 5000)
        sendError(processId, `Process timed out after ${timeoutMs}ms`)
    }, timeoutMs)

    // stdout handler
    childProcess.stdout?.on("data", (data: Buffer) => {
        sendOutput(processId, "stdout", data.toString("utf8"))
    })

    // stderr handler
    childProcess.stderr?.on("data", (data: Buffer) => {
        sendOutput(processId, "stderr", data.toString("utf8"))
    })

    // Exit handler
    childProcess.on("exit", (code, signal) => {
        clearTimeout(timeoutId)
        logger.info("[Process] Process exited", JSON.stringify({ processId, code, signal }))
        sendExit(processId, code, signal?.toString() || null)
    })

    // Error handler (spawn errors)
    childProcess.on("error", (err) => {
        clearTimeout(timeoutId)
        logger.error("[Process] Process error", JSON.stringify({ processId, error: err.message }))
        sendError(processId, err.message)
    })
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Start a command process
 */
async function handleStartCommand(params: StartCommandParams): Promise<StartProcessResponse> {
    const startTime = Date.now()
    logger.info("[Process:startCommand] Starting command", JSON.stringify({
        cmd: params.cmd,
        args: params.args,
        cwd: params.cwd,
        hasEnv: !!params.env,
        timeoutMs: params.timeoutMs,
    }))

    try {
        validateCwd(params.cwd)

        // Check process limit
        if (activeProcesses.size >= MAX_ACTIVE_PROCESSES) {
            throw new Error(`Maximum active processes (${MAX_ACTIVE_PROCESSES}) reached`)
        }

        const processId = generateProcessId()
        const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS

        // Spawn the process in a new process group so we can kill the entire tree
        const childProcess = spawn(params.cmd, params.args || [], {
            cwd: params.cwd,
            env: { ...process.env, ...params.env },
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
        })

        // Store in active processes
        activeProcesses.set(processId, {
            process: childProcess,
            outputBuffer: [],
            bufferSizeBytes: 0,
            exitCode: null,
            signal: null,
            completed: false,
        })

        // Setup handlers
        setupProcessHandlers(processId, childProcess, timeoutMs)
        emitLifecycle({
            type: "started",
            processId,
            pid: childProcess.pid,
            cwd: params.cwd,
            label: [params.cmd, ...(params.args || [])].join(" "),
        })

        logger.info("[Process:startCommand] Command started", JSON.stringify({ processId, pid: childProcess.pid, duration: Date.now() - startTime }))
        return { processId }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        logger.error("[Process:startCommand] Error:", JSON.stringify({ error: errorMessage, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Start a script process
 */
async function handleStartScript(params: StartScriptParams): Promise<StartProcessResponse> {
    const startTime = Date.now()
    logger.info("[Process:startScript] Starting script", JSON.stringify({
        scriptLength: params.script.length,
        cwd: params.cwd,
        hasEnv: !!params.env,
        timeoutMs: params.timeoutMs,
    }))

    let tempScriptPath: string | undefined

    try {
        validateCwd(params.cwd)

        // Check process limit
        if (activeProcesses.size >= MAX_ACTIVE_PROCESSES) {
            throw new Error(`Maximum active processes (${MAX_ACTIVE_PROCESSES}) reached`)
        }

        const processId = generateProcessId()
        const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS

        // Ensure temp directory exists
        const tempDir = getTempDir()
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 })
        }

        // Get platform-appropriate shell
        const shellConfig = getScriptShell()

        // Write script to temp file
        tempScriptPath = path.join(tempDir, `script-${processId}${shellConfig.extension}`)
        let fullScript = params.script
        // Add preamble for bash scripts that don't have a shebang
        if (shellConfig.usePreamble && !params.script.startsWith("#!")) {
            fullScript = BASH_SCRIPT_PREAMBLE + params.script
        }
        fs.writeFileSync(tempScriptPath, fullScript, { mode: 0o700 })

        // Spawn the script in a new process group so we can kill the entire tree
        const childProcess = spawn(shellConfig.shell, shellConfig.args(tempScriptPath), {
            cwd: params.cwd,
            env: { ...process.env, ...params.env },
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32", // detached doesn't work the same on Windows
        })

        // Store in active processes
        activeProcesses.set(processId, {
            process: childProcess,
            outputBuffer: [],
            bufferSizeBytes: 0,
            exitCode: null,
            signal: null,
            completed: false,
            tempScriptPath,
        })

        // Setup handlers
        setupProcessHandlers(processId, childProcess, timeoutMs)
        emitLifecycle({
            type: "started",
            processId,
            pid: childProcess.pid,
            cwd: params.cwd,
            label: "script",
        })

        logger.info("[Process:startScript] Script started", JSON.stringify({ processId, pid: childProcess.pid, duration: Date.now() - startTime }))
        return { processId }
    } catch (error: unknown) {
        // Clean up temp script on error
        if (tempScriptPath && fs.existsSync(tempScriptPath)) {
            try {
                fs.unlinkSync(tempScriptPath)
            } catch (err) {
                logger.debug('[Process] Error cleaning up temp script:', err)
            }
        }

        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        logger.error("[Process:startScript] Error:", JSON.stringify({ error: errorMessage, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Kill a process
 */
async function handleKill(processId: string): Promise<KillResponse> {
    logger.info("[Process:kill] Killing process", JSON.stringify({ processId }))

    const proc = activeProcesses.get(processId)
    if (!proc) {
        return { ok: false, error: "Process not found" }
    }

    try {
        if (!proc.completed && proc.process && proc.process.pid) {
            // Kill the entire process group (negative PID) since we spawn with detached: true
            try {
                process.kill(-proc.process.pid, "SIGTERM")
            } catch (err) {
                // Fallback to killing just the process if group kill fails
                logger.debug('[Process] Error killing process group, falling back to direct kill:', err)
                proc.process.kill("SIGTERM")
            }
            // Force kill after 5 seconds
            setTimeout(() => {
                if (!proc.process.killed && proc.process.pid) {
                    try {
                        process.kill(-proc.process.pid, "SIGKILL")
                    } catch (err) {
                        logger.debug('[Process] Error force killing process group, falling back to direct kill:', err)
                        proc.process.kill("SIGKILL")
                    }
                }
            }, 5000)
        }

        // Clean up immediately
        if (proc.cleanupTimeoutId) {
            clearTimeout(proc.cleanupTimeoutId)
        }
        if (proc.tempScriptPath && fs.existsSync(proc.tempScriptPath)) {
            try {
                fs.unlinkSync(proc.tempScriptPath)
            } catch (err) {
                logger.debug('[Process] Error cleaning up temp script on kill:', err)
            }
        }
        activeProcesses.delete(processId)

        return { ok: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        return { ok: false, error: errorMessage }
    }
}

/**
 * List active processes
 */
async function handleList(): Promise<ListResponse> {
    const processes = Array.from(activeProcesses.entries()).map(([processId, proc]) => ({
        processId,
        completed: proc.completed,
        exitCode: proc.exitCode,
        signal: proc.signal,
        error: proc.error,
        pid: proc.process.pid,
    }))

    return { processes }
}

export async function startRuntimeCommand(params: StartCommandParams): Promise<StartProcessResponse> {
    return handleStartCommand(params)
}

export async function startRuntimeScript(params: StartScriptParams): Promise<StartProcessResponse> {
    return handleStartScript(params)
}

export async function killRuntimeProcess(processId: string): Promise<KillResponse> {
    return handleKill(processId)
}

export async function listRuntimeProcesses(): Promise<ListResponse> {
    return handleList()
}

export async function reconnectRuntimeProcess(processId: string): Promise<RuntimeReconnectResponse> {
    const proc = activeProcesses.get(processId)
    if (!proc) {
        return { ok: false, found: false, output: [] }
    }

    if (proc.cleanupTimeoutId) {
        clearTimeout(proc.cleanupTimeoutId)
        proc.cleanupTimeoutId = undefined
    }

    if (proc.completed) {
        scheduleCleanup(processId)
    }

    return {
        ok: true,
        found: true,
        completed: proc.completed,
        exitCode: proc.exitCode,
        signal: proc.signal,
        error: proc.error,
        outputCount: proc.outputBuffer.length,
        output: [...proc.outputBuffer],
    }
}

export async function killAllRuntimeProcesses(): Promise<{ ok: true }> {
    cleanup()
    return { ok: true }
}

export const cleanup = () => {
    logger.info("[Process] Cleanup called, killing all active processes")

    for (const [processId, proc] of activeProcesses) {
        // Cancel cleanup timeouts
        if (proc.cleanupTimeoutId) {
            clearTimeout(proc.cleanupTimeoutId)
        }

        // Kill process group if still running (negative PID kills entire group)
        if (!proc.completed && proc.process && proc.process.pid) {
            try {
                process.kill(-proc.process.pid, "SIGKILL")
            } catch (err) {
                // Fallback to killing just the process
                logger.debug('[Process] Error killing process group during cleanup, falling back to direct kill:', err)
                try {
                    proc.process.kill("SIGKILL")
                } catch (err2) {
                    logger.debug('[Process] Error killing process during cleanup:', err2)
                }
            }
            emitLifecycle({ type: "exit", processId, exitCode: null, signal: "SIGKILL" })
        }

        // Clean up temp script
        if (proc.tempScriptPath && fs.existsSync(proc.tempScriptPath)) {
            try {
                fs.unlinkSync(proc.tempScriptPath)
            } catch (err) {
                logger.debug('[Process] Error cleaning up temp script during cleanup:', err)
            }
        }

        activeProcesses.delete(processId)
    }

    logger.info("[Process] Cleanup complete")
}
