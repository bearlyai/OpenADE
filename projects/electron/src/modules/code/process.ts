/**
 * Process Management Module for Electron
 *
 * Provides process spawning with real-time stdout/stderr streaming via IPC.
 * Supports reconnection after renderer refresh through output buffering.
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { spawn, type ChildProcess } from "child_process"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import logger from "electron-log"
import { isDev } from "../../config"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/process.ts
// ============================================================================

interface RunCmdParams {
    cmd: string
    args?: string[]
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number // Default: 10 minutes (600000ms)
}

interface RunScriptParams {
    script: string
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number // Default: 10 minutes (600000ms)
}

interface RunProcessResponse {
    processId: string
}

interface ProcessOutputChunk {
    type: "stdout" | "stderr"
    data: string
    timestamp: number
}

interface ActiveProcess {
    process: ChildProcess
    outputBuffer: ProcessOutputChunk[]
    bufferSizeBytes: number
    webContents: WebContents | null
    exitCode: number | null
    signal: string | null
    completed: boolean
    completedAt?: number
    cleanupTimeoutId?: NodeJS.Timeout
    error?: string
    tempScriptPath?: string // For cleanup
}

interface ReconnectResponse {
    ok: boolean
    found: boolean
    completed?: boolean
    exitCode?: number | null
    signal?: string | null
    error?: string
    outputCount?: number
}

interface KillResponse {
    ok: boolean
    error?: string
}

interface ListResponse {
    processes: {
        processId: string
        completed: boolean
        exitCode: number | null
        signal: string | null
        error?: string
    }[]
}

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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if caller is allowed
 */
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
        logger.error("[Process:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

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

    // Send to renderer if connected
    if (proc.webContents && !proc.webContents.isDestroyed()) {
        proc.webContents.send(`process:output:${processId}`, chunk)
    }
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

    if (proc.webContents && !proc.webContents.isDestroyed()) {
        proc.webContents.send(`process:exit:${processId}`, { exitCode, signal })
    }

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

    if (proc.webContents && !proc.webContents.isDestroyed()) {
        proc.webContents.send(`process:error:${processId}`, error)
    }

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
 * Run a command
 */
async function handleRunCmd(params: RunCmdParams, webContents: WebContents): Promise<RunProcessResponse> {
    const startTime = Date.now()
    logger.info("[Process:runCmd] Starting command", JSON.stringify({
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
            webContents,
            exitCode: null,
            signal: null,
            completed: false,
        })

        // Setup handlers
        setupProcessHandlers(processId, childProcess, timeoutMs)

        logger.info("[Process:runCmd] Command started", JSON.stringify({ processId, pid: childProcess.pid, duration: Date.now() - startTime }))
        return { processId }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        logger.error("[Process:runCmd] Error:", JSON.stringify({ error: errorMessage, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Run a script
 */
async function handleRunScript(params: RunScriptParams, webContents: WebContents): Promise<RunProcessResponse> {
    const startTime = Date.now()
    logger.info("[Process:runScript] Starting script", JSON.stringify({
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
            webContents,
            exitCode: null,
            signal: null,
            completed: false,
            tempScriptPath,
        })

        // Setup handlers
        setupProcessHandlers(processId, childProcess, timeoutMs)

        logger.info("[Process:runScript] Script started", JSON.stringify({ processId, pid: childProcess.pid, duration: Date.now() - startTime }))
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
        logger.error("[Process:runScript] Error:", JSON.stringify({ error: errorMessage, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Reconnect to a running or completed process
 */
async function handleReconnect(processId: string, webContents: WebContents): Promise<ReconnectResponse> {
    logger.info("[Process:reconnect] Reconnecting", JSON.stringify({ processId }))

    const proc = activeProcesses.get(processId)
    if (!proc) {
        return { ok: false, found: false }
    }

    // Cancel cleanup timeout since client is reconnecting
    if (proc.cleanupTimeoutId) {
        clearTimeout(proc.cleanupTimeoutId)
        proc.cleanupTimeoutId = undefined
    }

    // Update webContents reference
    proc.webContents = webContents

    // Replay buffered output
    for (const chunk of proc.outputBuffer) {
        webContents.send(`process:output:${processId}`, chunk)
    }

    // If completed, send exit or error
    if (proc.completed) {
        if (proc.error) {
            webContents.send(`process:error:${processId}`, proc.error)
        } else {
            webContents.send(`process:exit:${processId}`, {
                exitCode: proc.exitCode,
                signal: proc.signal,
            })
        }

        // Re-schedule cleanup
        scheduleCleanup(processId)

        return {
            ok: true,
            found: true,
            completed: true,
            exitCode: proc.exitCode,
            signal: proc.signal,
            error: proc.error,
            outputCount: proc.outputBuffer.length,
        }
    }

    return {
        ok: true,
        found: true,
        completed: false,
        outputCount: proc.outputBuffer.length,
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
    }))

    return { processes }
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[Process] Registering IPC handlers")

    ipcMain.handle("process:runCmd", async (event, params: RunCmdParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleRunCmd(params, event.sender)
    })

    ipcMain.handle("process:runScript", async (event, params: RunScriptParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleRunScript(params, event.sender)
    })

    ipcMain.handle("process:reconnect", async (event, args: { processId: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleReconnect(args.processId, event.sender)
    })

    ipcMain.handle("process:kill", async (event, args: { processId: string }) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleKill(args.processId)
    })

    ipcMain.handle("process:list", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleList()
    })

    ipcMain.handle("process:killAll", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        logger.info("[Process] Killing all processes (triggered by frontend)")
        cleanup()
        return { ok: true }
    })

    logger.info("[Process] IPC handlers registered successfully")
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
