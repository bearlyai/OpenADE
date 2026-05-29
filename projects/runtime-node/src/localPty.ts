import { randomUUID } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import type {
    RuntimeNodePtyAdapter,
    RuntimeNodePtyKillParams,
    RuntimeNodePtyLifecycleEvent,
    RuntimeNodePtyReconnectParams,
    RuntimeNodePtyResizeParams,
    RuntimeNodePtySpawnParams,
    RuntimeNodePtyWriteParams,
} from "./pty"

interface ActivePty {
    process: ChildProcess
    output: string[]
    completed: boolean
    exitCode: number | null
    cwd: string
}

interface LocalPtyState {
    active: Map<string, ActivePty>
    listeners: Set<(event: RuntimeNodePtyLifecycleEvent) => void>
}

const MAX_BUFFERED_CHUNKS = 2_000

function emit(state: LocalPtyState, event: RuntimeNodePtyLifecycleEvent): void {
    for (const listener of state.listeners) listener(event)
}

async function assertDirectory(cwd: string): Promise<void> {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`)
}

function shellCommand(): string {
    if (process.platform === "win32") return "powershell.exe"
    return process.env.SHELL || "/bin/bash"
}

function bufferOutput(state: ActivePty, data: string): void {
    state.output.push(data)
    while (state.output.length > MAX_BUFFERED_CHUNKS) state.output.shift()
}

export function createRuntimeNodeLocalPtyAdapter(): RuntimeNodePtyAdapter {
    const local: LocalPtyState = {
        active: new Map(),
        listeners: new Set(),
    }

    return {
        addLifecycleListener(listener) {
            local.listeners.add(listener)
            return () => local.listeners.delete(listener)
        },
        async spawn(params: RuntimeNodePtySpawnParams) {
            await assertDirectory(params.cwd)
            const ptyId = params.ptyId || `pty-${randomUUID()}`
            if (local.active.has(ptyId)) return { ok: true }

            const shell = shellCommand()
            const child = spawn(shell, [], {
                cwd: params.cwd,
                env: { ...process.env, ...params.env, TERM: process.env.TERM || "xterm-256color" },
                detached: process.platform !== "win32",
                windowsHide: true,
            })
            const state: ActivePty = {
                process: child,
                output: [],
                completed: false,
                exitCode: null,
                cwd: params.cwd,
            }
            local.active.set(ptyId, state)

            child.stdout?.on("data", (data: Buffer) => {
                const text = data.toString("utf8")
                bufferOutput(state, text)
                emit(local, { type: "output", ptyId, chunk: text })
            })
            child.stderr?.on("data", (data: Buffer) => {
                const text = data.toString("utf8")
                bufferOutput(state, text)
                emit(local, { type: "output", ptyId, chunk: text })
            })
            child.once("exit", (exitCode) => {
                if (state.completed) return
                state.completed = true
                state.exitCode = exitCode ?? 0
                emit(local, { type: "exit", ptyId, exitCode: state.exitCode })
            })
            child.once("error", (error) => {
                if (state.completed) return
                state.completed = true
                state.exitCode = 1
                emit(local, { type: "output", ptyId, chunk: error.message })
                emit(local, { type: "exit", ptyId, exitCode: 1 })
            })

            emit(local, {
                type: "started",
                ptyId,
                pid: child.pid ?? -1,
                pgid: process.platform === "win32" ? undefined : child.pid,
                cwd: params.cwd,
                shell,
                processStartedAt: new Date().toISOString(),
            })
            return { ok: true }
        },
        async write(params: RuntimeNodePtyWriteParams) {
            const state = local.active.get(params.ptyId)
            if (!state || !state.process.stdin || state.completed) return { ok: false }
            state.process.stdin.write(params.data)
            return { ok: true }
        },
        async resize(_params: RuntimeNodePtyResizeParams) {
            return { ok: true }
        },
        async reconnect(params: RuntimeNodePtyReconnectParams) {
            const state = local.active.get(params.ptyId)
            if (!state) return { ok: true, found: false }
            return { ok: true, found: true, completed: state.completed, exitCode: state.exitCode, output: [...state.output], outputCount: state.output.length }
        },
        async kill(params: RuntimeNodePtyKillParams) {
            const state = local.active.get(params.ptyId)
            if (!state) return { ok: false }
            if (!state.completed) {
                state.completed = true
                state.exitCode = null
                try {
                    if (process.platform !== "win32" && state.process.pid) process.kill(-state.process.pid, "SIGTERM")
                    else state.process.kill("SIGTERM")
                } catch {
                    try {
                        state.process.kill("SIGTERM")
                    } catch {
                        // The PTY process may already be gone; the runtime still needs a stopped lifecycle event.
                    }
                }
            }
            local.active.delete(params.ptyId)
            emit(local, { type: "killed", ptyId: params.ptyId })
            return { ok: true }
        },
        async killAll() {
            for (const ptyId of [...local.active.keys()]) {
                await this.kill({ ptyId })
            }
            return { ok: true }
        },
    }
}
