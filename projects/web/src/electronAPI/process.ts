/**
 * Process Management API Bridge
 *
 * Client-side API for process spawning and management.
 * Communicates with Electron main process via openadeAPI.
 * Supports reconnection after renderer refresh.
 */

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/process.ts
// ============================================================================

export interface RunCmdParams {
    cmd: string
    args?: string[]
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number // Default: 10 minutes (600000ms)
}

export interface RunScriptParams {
    script: string
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number // Default: 10 minutes (600000ms)
}

export interface RunProcessResponse {
    processId: string
}

export interface ProcessOutputChunk {
    type: "stdout" | "stderr"
    data: string
    timestamp: number
}

export interface ProcessExitEvent {
    exitCode: number | null
    signal: string | null
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

interface ProcessInfo {
    processId: string
    completed: boolean
    exitCode: number | null
    signal: string | null
    error?: string
}

interface ListResponse {
    processes: ProcessInfo[]
}

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"

type EventHandler = (...args: unknown[]) => void

// ============================================================================
// ProcessHandle Class
// ============================================================================

/**
 * ProcessHandle - wrapper for a spawned process
 *
 * Similar pattern to ClaudeQuery for consistency.
 */
export class ProcessHandle {
    private _processId: string
    private _isComplete = false
    private _exitCode: number | null = null
    private _signal: string | null = null
    private _error?: string
    private listeners: Map<string, EventHandler[]> = new Map()
    private unsubscribers: Array<() => void> = []

    private constructor(processId: string) {
        this._processId = processId
    }

    /** Process ID (for IPC routing and reconnection) */
    get processId(): string {
        return this._processId
    }

    /** Whether the process has completed */
    get isComplete(): boolean {
        return this._isComplete
    }

    /** Exit code (available after process exits) */
    get exitCode(): number | null {
        return this._exitCode
    }

    /** Signal that killed the process (if any) */
    get signal(): string | null {
        return this._signal
    }

    /** Error message (if process failed to spawn) */
    get error(): string | undefined {
        return this._error
    }

    /**
     * Run a command
     */
    static async runCmd(params: RunCmdParams): Promise<ProcessHandle | null> {
        if (!window.openadeAPI) {
            console.warn("[ProcessHandle] Not running in Electron, returning null")
            return null
        }

        console.debug("[ProcessHandle] Starting command:", params.cmd, params.args)

        const response = (await window.openadeAPI.process.runCmd(params)) as RunProcessResponse
        const handle = new ProcessHandle(response.processId)
        handle.setupListeners()

        console.debug("[ProcessHandle] Command started:", response.processId)
        return handle
    }

    /**
     * Run a script
     */
    static async runScript(params: RunScriptParams): Promise<ProcessHandle | null> {
        if (!window.openadeAPI) {
            console.warn("[ProcessHandle] Not running in Electron, returning null")
            return null
        }

        console.debug("[ProcessHandle] Starting script, length:", params.script.length)

        const response = (await window.openadeAPI.process.runScript(params)) as RunProcessResponse
        const handle = new ProcessHandle(response.processId)
        handle.setupListeners()

        console.debug("[ProcessHandle] Script started:", response.processId)
        return handle
    }

    /**
     * Reconnect to an existing process (after renderer refresh)
     */
    static async reconnect(processId: string): Promise<{ handle: ProcessHandle | null; found: boolean }> {
        if (!window.openadeAPI) {
            console.warn("[ProcessHandle] Not running in Electron, returning null")
            return { handle: null, found: false }
        }

        console.debug("[ProcessHandle] Reconnecting to process:", processId)

        // Create handle and setup listeners BEFORE calling reconnect
        const handle = new ProcessHandle(processId)
        handle.setupListeners()

        const result = (await window.openadeAPI.process.reconnect({ processId })) as ReconnectResponse

        if (!result.found) {
            console.debug("[ProcessHandle] Process not found (cleaned up or never existed)")
            handle.cleanup()
            return { handle: null, found: false }
        }

        console.debug("[ProcessHandle] Reconnected, replayed", result.outputCount, "output chunks")

        if (result.completed) {
            handle._isComplete = true
            handle._exitCode = result.exitCode ?? null
            handle._signal = result.signal ?? null
            handle._error = result.error
        }

        return { handle, found: true }
    }

    private setupListeners() {
        if (!window.openadeAPI) return

        // Subscribe to output events
        const unsubOutput = window.openadeAPI.process.onOutput(this._processId, (chunk) => {
            this.emit("output", chunk as ProcessOutputChunk)
        })
        this.unsubscribers.push(unsubOutput)

        // Subscribe to exit events
        const unsubExit = window.openadeAPI.process.onExit(this._processId, (data) => {
            const exit = data as ProcessExitEvent
            console.debug("[ProcessHandle] Process exited:", exit)
            this._isComplete = true
            this._exitCode = exit.exitCode
            this._signal = exit.signal
            this.emit("exit", exit)
        })
        this.unsubscribers.push(unsubExit)

        // Subscribe to error events
        const unsubError = window.openadeAPI.process.onError(this._processId, (error) => {
            console.error("[ProcessHandle] Process error:", error)
            this._isComplete = true
            this._error = error as string
            this.emit("error", error)
        })
        this.unsubscribers.push(unsubError)
    }

    private emit(event: string, ...args: unknown[]) {
        const handlers = this.listeners.get(event) || []
        handlers.forEach((h) => h(...args))
    }

    /**
     * Register event handler
     */
    on(event: "output" | "exit" | "error", handler: EventHandler): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, [])
        }
        this.listeners.get(event)!.push(handler)
    }

    /**
     * Remove event handler
     */
    off(event: string, handler: EventHandler): void {
        const handlers = this.listeners.get(event)
        if (handlers) {
            const idx = handlers.indexOf(handler)
            if (idx >= 0) handlers.splice(idx, 1)
        }
    }

    /**
     * Async generator that yields output chunks as they arrive
     */
    async *stream(): AsyncGenerator<ProcessOutputChunk> {
        const outputQueue: ProcessOutputChunk[] = []
        let resolveNext: (() => void) | null = null
        let isDone = false

        const onOutput = (chunk: ProcessOutputChunk) => {
            outputQueue.push(chunk)
            if (resolveNext) {
                resolveNext()
                resolveNext = null
            }
        }

        const onExit = () => {
            isDone = true
            if (resolveNext) {
                resolveNext()
                resolveNext = null
            }
        }

        const onError = () => {
            isDone = true
            if (resolveNext) {
                resolveNext()
                resolveNext = null
            }
        }

        this.on("output", onOutput as EventHandler)
        this.on("exit", onExit as EventHandler)
        this.on("error", onError as EventHandler)

        try {
            while (!isDone || outputQueue.length > 0) {
                if (outputQueue.length > 0) {
                    yield outputQueue.shift()!
                } else if (!isDone) {
                    await new Promise<void>((r) => {
                        resolveNext = r
                    })
                }
            }
        } finally {
            this.off("output", onOutput as EventHandler)
            this.off("exit", onExit as EventHandler)
            this.off("error", onError as EventHandler)
        }
    }

    /**
     * Kill the process
     */
    async kill(): Promise<void> {
        if (!window.openadeAPI) return

        const result = (await window.openadeAPI.process.kill({ processId: this._processId })) as KillResponse
        if (!result.ok) {
            console.warn("[ProcessHandle] Kill failed:", result.error)
        }

        this._isComplete = true
        this.cleanup()
    }

    /**
     * Cleanup listeners (call when done with the handle)
     */
    cleanup(): void {
        // Call all unsubscribe functions
        for (const unsub of this.unsubscribers) {
            unsub()
        }
        this.unsubscribers = []
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if Process API is available (running in Electron)
 */
function isProcessApiAvailable(): boolean {
    return isCodeModuleAvailable()
}

/**
 * Run a command and get a process handle
 */
async function runCmd(params: RunCmdParams): Promise<ProcessHandle | null> {
    return ProcessHandle.runCmd(params)
}

/**
 * Run a script and get a process handle
 */
async function runScript(params: RunScriptParams): Promise<ProcessHandle | null> {
    return ProcessHandle.runScript(params)
}

/**
 * List all active processes
 */
async function listProcesses(): Promise<ProcessInfo[]> {
    if (!window.openadeAPI) {
        console.warn("[ProcessAPI] Not running in Electron")
        return []
    }

    const result = (await window.openadeAPI.process.list()) as ListResponse
    return result.processes
}

/**
 * Kill all active processes
 */
async function killAll(): Promise<boolean> {
    if (!window.openadeAPI) {
        console.warn("[ProcessAPI] Not running in Electron")
        return false
    }

    const result = (await window.openadeAPI.process.killAll()) as { ok: boolean }
    return result.ok
}

/**
 * Process API namespace for convenient imports
 */
export const processApi = {
    runCmd,
    runScript,
    listProcesses,
    killAll,
    reconnect: ProcessHandle.reconnect,
    isAvailable: isProcessApiAvailable,
}
