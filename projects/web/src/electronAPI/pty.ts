// IMPORTANT: Keep in sync with projects/electron/src/modules/code/pty.ts

export interface SpawnParams {
    ptyId: string
    cwd: string
    env?: Record<string, string>
    cols: number
    rows: number
}

export interface PtyOutputEvent {
    data: string // base64 encoded
    timestamp: number
}

export interface PtyExitEvent {
    exitCode: number
}

interface SpawnResponse {
    ok: boolean
    error?: string
}

interface ReconnectResponse {
    ok: boolean
    found: boolean
    exited?: boolean
    exitCode?: number
}

import { isCodeModuleAvailable } from "./capabilities"

type EventHandler = (...args: unknown[]) => void

export class PtyHandle {
    private _ptyId: string
    private _exited = false
    private _exitCode: number | null = null
    private listeners: Map<string, EventHandler[]> = new Map()
    private unsubscribers: Array<() => void> = []

    private constructor(ptyId: string) {
        this._ptyId = ptyId
    }

    get ptyId(): string {
        return this._ptyId
    }

    get exited(): boolean {
        return this._exited
    }

    get exitCode(): number | null {
        return this._exitCode
    }

    static async spawn(params: SpawnParams): Promise<PtyHandle | null> {
        if (!window.openadeAPI) {
            console.warn("[PtyHandle] Not running in Electron, returning null")
            return null
        }

        console.debug("[PtyHandle] Spawning PTY:", params.ptyId, params.cwd)

        const response = (await window.openadeAPI.pty.spawn(params)) as SpawnResponse
        if (!response.ok) {
            console.error("[PtyHandle] Spawn failed:", response.error)
            return null
        }

        const handle = new PtyHandle(params.ptyId)
        handle.setupListeners()

        console.debug("[PtyHandle] PTY spawned:", params.ptyId)
        return handle
    }

    static async reconnect(ptyId: string): Promise<{ handle: PtyHandle | null; found: boolean }> {
        if (!window.openadeAPI) {
            console.warn("[PtyHandle] Not running in Electron, returning null")
            return { handle: null, found: false }
        }

        console.debug("[PtyHandle] Reconnecting to PTY:", ptyId)

        const handle = new PtyHandle(ptyId)
        handle.setupListeners()

        const result = (await window.openadeAPI.pty.reconnect({ ptyId })) as ReconnectResponse

        if (!result.found) {
            console.debug("[PtyHandle] PTY not found")
            handle.cleanup()
            return { handle: null, found: false }
        }

        console.debug("[PtyHandle] Reconnected to PTY")

        if (result.exited) {
            handle._exited = true
            handle._exitCode = result.exitCode ?? null
        }

        return { handle, found: true }
    }

    private setupListeners() {
        if (!window.openadeAPI) return

        // Subscribe to output events
        const unsubOutput = window.openadeAPI.pty.onOutput(this._ptyId, (chunk) => {
            this.emit("output", chunk as PtyOutputEvent)
        })
        this.unsubscribers.push(unsubOutput)

        // Subscribe to exit events
        const unsubExit = window.openadeAPI.pty.onExit(this._ptyId, (data) => {
            const exit = data as PtyExitEvent
            console.debug("[PtyHandle] PTY exited:", exit)
            this._exited = true
            this._exitCode = exit.exitCode
            this.emit("exit", exit)
        })
        this.unsubscribers.push(unsubExit)
    }

    private emit(event: string, ...args: unknown[]) {
        const handlers = this.listeners.get(event) || []
        handlers.forEach((h) => h(...args))
    }

    on(event: "output" | "exit", handler: EventHandler): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, [])
        }
        this.listeners.get(event)!.push(handler)
    }

    off(event: string, handler: EventHandler): void {
        const handlers = this.listeners.get(event)
        if (handlers) {
            const idx = handlers.indexOf(handler)
            if (idx >= 0) handlers.splice(idx, 1)
        }
    }

    async write(data: string): Promise<void> {
        if (!window.openadeAPI || this._exited) return

        const base64Data = btoa(data)
        await window.openadeAPI.pty.write({ ptyId: this._ptyId, data: base64Data })
    }

    async resize(cols: number, rows: number): Promise<void> {
        if (!window.openadeAPI || this._exited) return

        await window.openadeAPI.pty.resize({ ptyId: this._ptyId, cols, rows })
    }

    async kill(): Promise<void> {
        if (!window.openadeAPI) return

        await window.openadeAPI.pty.kill({ ptyId: this._ptyId })
        this._exited = true
        this.cleanup()
    }

    cleanup(): void {
        // Call all unsubscribe functions
        for (const unsub of this.unsubscribers) {
            unsub()
        }
        this.unsubscribers = []
    }
}

function isPtyApiAvailable(): boolean {
    return isCodeModuleAvailable()
}

/** Derives the ptyId for a task's terminal. Currently 1:1 with taskId. */
export function getTaskPtyId(taskId: string): string {
    return taskId
}

async function killPty(ptyId: string): Promise<void> {
    if (!window.openadeAPI) return
    await window.openadeAPI.pty.kill({ ptyId })
}

async function killAllPtys(): Promise<boolean> {
    if (!window.openadeAPI) return false
    const resp = (await window.openadeAPI.pty.killAll()) as { ok: boolean }
    return resp.ok
}

export const ptyApi = {
    spawn: PtyHandle.spawn,
    reconnect: PtyHandle.reconnect,
    isAvailable: isPtyApiAvailable,
    kill: killPty,
    killAll: killAllPtys,
}
