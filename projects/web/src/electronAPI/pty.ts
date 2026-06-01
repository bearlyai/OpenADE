import type {
    RuntimeNodePtyExitEvent,
    RuntimeNodePtyOutputEvent,
    RuntimeNodePtyReconnectResult,
    RuntimeNodePtySpawnParams,
    RuntimeNodePtySpawnResponse,
} from "../../../runtime-node/src/pty"

export type SpawnParams = RuntimeNodePtySpawnParams

export type PtyOutputEvent = RuntimeNodePtyOutputEvent

export type PtyExitEvent = RuntimeNodePtyExitEvent

type SpawnResponse = RuntimeNodePtySpawnResponse

type ReconnectResponse = RuntimeNodePtyReconnectResult

import { isCodeModuleAvailable } from "./capabilities"
import { localRuntimeClient } from "../runtime/localRuntimeClient"

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

        const response = await localRuntimeClient.request<SpawnResponse>("pty/spawn", params)
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

        const result = await localRuntimeClient.request<ReconnectResponse>("pty/reconnect", { ptyId })

        if (!result.found) {
            console.debug("[PtyHandle] PTY not found")
            handle.cleanup()
            return { handle: null, found: false }
        }

        console.debug("[PtyHandle] Reconnected to PTY")
        for (const chunk of result.output) {
            handle.emit("output", chunk)
        }

        if (result.exited) {
            handle._exited = true
            handle._exitCode = result.exitCode ?? null
            handle.emit("exit", { exitCode: handle._exitCode })
        }

        return { handle, found: true }
    }

    private setupListeners() {
        if (!window.openadeAPI) return

        const unsubscribe = localRuntimeClient.subscribe((notification) => {
            const params = notification.params as Record<string, unknown> | undefined
            if (!params || params.ptyId !== this._ptyId) return

            if (notification.method === "pty/output") {
                this.emit("output", params.chunk as PtyOutputEvent)
                return
            }

            if (notification.method === "pty/exit" || notification.method === "pty/killed") {
                const exit = { exitCode: typeof params.exitCode === "number" ? params.exitCode : 0 }
                console.debug("[PtyHandle] PTY exited:", exit)
                this._exited = true
                this._exitCode = exit.exitCode
                this.emit("exit", exit)
            }
        })
        this.unsubscribers.push(unsubscribe)
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
        await localRuntimeClient.request("pty/write", { ptyId: this._ptyId, data: base64Data })
    }

    async resize(cols: number, rows: number): Promise<void> {
        if (!window.openadeAPI || this._exited) return

        await localRuntimeClient.request("pty/resize", { ptyId: this._ptyId, cols, rows })
    }

    async kill(): Promise<void> {
        if (!window.openadeAPI) return

        await localRuntimeClient.request("pty/kill", { ptyId: this._ptyId })
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
    await localRuntimeClient.request("pty/kill", { ptyId })
}

async function killAllPtys(): Promise<boolean> {
    if (!window.openadeAPI) return false
    const resp = await localRuntimeClient.request<{ ok: boolean }>("pty/killAll")
    return resp.ok
}

export const ptyApi = {
    spawn: PtyHandle.spawn,
    reconnect: PtyHandle.reconnect,
    isAvailable: isPtyApiAvailable,
    kill: killPty,
    killAll: killAllPtys,
}
