import { randomUUID } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
    RuntimeNodeCommandStartParams,
    RuntimeNodeProcessAdapter,
    RuntimeNodeProcessLifecycleEvent,
    RuntimeNodeProcessStartResult,
    RuntimeNodeScriptStartParams,
} from "./process"

type ProcessOutputChunk = { type: "stdout" | "stderr"; data: string; timestamp: number }

interface ActiveProcess {
    process: ChildProcess
    output: ProcessOutputChunk[]
    completed: boolean
    exitCode: number | null
    signal: string | null
    error?: string
    timeout?: ReturnType<typeof setTimeout>
    cleanup?: ReturnType<typeof setTimeout>
    tempScriptPath?: string
}

interface LocalProcessState {
    active: Map<string, ActiveProcess>
    listeners: Set<(event: RuntimeNodeProcessLifecycleEvent) => void>
}

const MAX_BUFFERED_CHUNKS = 2_000
const CLEANUP_DELAY_MS = 30 * 60 * 1000

function emit(state: LocalProcessState, event: RuntimeNodeProcessLifecycleEvent): void {
    for (const listener of state.listeners) listener(event)
}

function processId(): string {
    return `proc-${Date.now().toString(36)}-${randomUUID()}`
}

async function assertDirectory(cwd: string): Promise<void> {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`)
}

function bufferOutput(state: ActiveProcess, chunk: ProcessOutputChunk): void {
    state.output.push(chunk)
    while (state.output.length > MAX_BUFFERED_CHUNKS) state.output.shift()
}

function scheduleCleanup(local: LocalProcessState, id: string, processState: ActiveProcess): void {
    if (processState.cleanup) clearTimeout(processState.cleanup)
    processState.cleanup = setTimeout(() => {
        local.active.delete(id)
        if (processState.tempScriptPath) fs.rm(processState.tempScriptPath, { force: true }).catch(() => undefined)
    }, CLEANUP_DELAY_MS)
    processState.cleanup.unref?.()
}

async function startChild(local: LocalProcessState, params: {
    command: string
    args: string[]
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number
    label: string
    tempScriptPath?: string
}): Promise<RuntimeNodeProcessStartResult> {
    await assertDirectory(params.cwd)
    const id = processId()
    const child = spawn(params.command, params.args, {
        cwd: params.cwd,
        env: { ...process.env, ...params.env },
        detached: process.platform !== "win32",
        windowsHide: true,
    })
    const state: ActiveProcess = {
        process: child,
        output: [],
        completed: false,
        exitCode: null,
        signal: null,
        tempScriptPath: params.tempScriptPath,
    }
    local.active.set(id, state)

    child.stdout?.on("data", (data: Buffer) => {
        const chunk = { type: "stdout" as const, data: data.toString("utf8"), timestamp: Date.now() }
        bufferOutput(state, chunk)
        emit(local, { type: "output", processId: id, chunk })
    })
    child.stderr?.on("data", (data: Buffer) => {
        const chunk = { type: "stderr" as const, data: data.toString("utf8"), timestamp: Date.now() }
        bufferOutput(state, chunk)
        emit(local, { type: "output", processId: id, chunk })
    })
    child.once("error", (error) => {
        if (state.completed) return
        state.completed = true
        state.error = error.message
        if (state.timeout) clearTimeout(state.timeout)
        emit(local, { type: "error", processId: id, error: error.message })
        scheduleCleanup(local, id, state)
    })
    child.once("exit", (exitCode, signal) => {
        if (state.completed) return
        state.completed = true
        state.exitCode = exitCode
        state.signal = signal
        if (state.timeout) clearTimeout(state.timeout)
        emit(local, { type: "exit", processId: id, exitCode, signal })
        scheduleCleanup(local, id, state)
    })

    if (params.timeoutMs && params.timeoutMs > 0) {
        state.timeout = setTimeout(() => {
            child.kill("SIGTERM")
        }, params.timeoutMs)
        state.timeout.unref?.()
    }

    emit(local, {
        type: "started",
        processId: id,
        pid: child.pid,
        pgid: process.platform === "win32" ? undefined : child.pid,
        cwd: params.cwd,
        label: params.label,
        processStartedAt: new Date().toISOString(),
    })
    return { processId: id }
}

async function scriptFile(script: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-node-script-"))
    const filePath = path.join(dir, process.platform === "win32" ? "script.ps1" : "script.sh")
    await fs.writeFile(filePath, script, "utf8")
    await fs.chmod(filePath, 0o700).catch(() => undefined)
    return filePath
}

function scriptCommand(filePath: string): { command: string; args: string[] } {
    if (process.platform === "win32") return { command: "powershell.exe", args: ["-ExecutionPolicy", "Bypass", "-File", filePath] }
    return { command: process.env.SHELL || "/bin/bash", args: [filePath] }
}

export function createRuntimeNodeLocalProcessAdapter(): RuntimeNodeProcessAdapter {
    const local: LocalProcessState = {
        active: new Map(),
        listeners: new Set(),
    }

    return {
        addLifecycleListener(listener) {
            local.listeners.add(listener)
            return () => local.listeners.delete(listener)
        },
        startCommand(params: RuntimeNodeCommandStartParams) {
            return startChild(local, {
                command: params.cmd,
                args: params.args ?? [],
                cwd: params.cwd,
                env: params.env,
                timeoutMs: params.timeoutMs,
                label: [params.cmd, ...(params.args ?? [])].join(" "),
            })
        },
        async startScript(params: RuntimeNodeScriptStartParams) {
            const filePath = await scriptFile(params.script)
            const command = scriptCommand(filePath)
            return startChild(local, {
                ...command,
                cwd: params.cwd,
                env: params.env,
                timeoutMs: params.timeoutMs,
                label: filePath,
                tempScriptPath: filePath,
            })
        },
        async list() {
            return {
                processes: [...local.active.entries()].map(([id, state]) => ({
                    processId: id,
                    completed: state.completed,
                    exitCode: state.exitCode,
                    signal: state.signal,
                    error: state.error,
                    pid: state.process.pid,
                })),
            }
        },
        async reconnect(id: string) {
            const state = local.active.get(id)
            if (!state) return { ok: true, found: false }
            return {
                ok: true,
                found: true,
                completed: state.completed,
                exitCode: state.exitCode,
                signal: state.signal,
                error: state.error,
                outputCount: state.output.length,
                output: [...state.output],
            }
        },
        async kill(id: string) {
            const state = local.active.get(id)
            if (!state) return { ok: false, error: "process not found" }
            if (state.completed) return { ok: true }
            state.process.kill("SIGTERM")
            return { ok: true }
        },
        async killAll() {
            for (const [id, state] of local.active) {
                if (state.timeout) clearTimeout(state.timeout)
                if (state.cleanup) clearTimeout(state.cleanup)

                if (!state.completed) {
                    state.completed = true
                    state.exitCode = null
                    state.signal = "SIGKILL"
                    try {
                        if (process.platform !== "win32" && state.process.pid) process.kill(-state.process.pid, "SIGKILL")
                        else state.process.kill("SIGKILL")
                    } catch {
                        try {
                            state.process.kill("SIGKILL")
                        } catch {
                            // The process may already be gone; the runtime still needs a terminal lifecycle event.
                        }
                    }
                    emit(local, { type: "exit", processId: id, exitCode: null, signal: "SIGKILL" })
                }

                if (state.tempScriptPath) await fs.rm(state.tempScriptPath, { force: true }).catch(() => undefined)
                local.active.delete(id)
            }
            return { ok: true }
        },
    }
}
