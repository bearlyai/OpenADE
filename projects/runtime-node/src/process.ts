import { RuntimeHandlerError, type RuntimeServer } from "../../runtime/src"
import {
    optionalFiniteNumber,
    optionalStringArray as optionalStringArrayParam,
    optionalStringRecord as optionalStringRecordParam,
    requiredString as requiredStringParam,
    validateParams,
} from "./validation"

export interface RuntimeNodeCommandStartParams {
    cmd: string
    args?: string[]
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number
}

export interface RuntimeNodeScriptStartParams {
    script: string
    cwd: string
    env?: Record<string, string>
    timeoutMs?: number
}

export interface RuntimeNodeProcessStartResult {
    processId: string
}

export interface RuntimeNodeProcessKillResult {
    ok: boolean
    error?: string
}

export type RuntimeNodeProcessLifecycleEvent =
    | { type: "started"; processId: string; pid?: number; pgid?: number; cwd: string; label: string; processStartedAt?: string }
    | { type: "output"; processId: string; chunk: unknown }
    | { type: "exit"; processId: string; exitCode: number | null; signal: string | null }
    | { type: "error"; processId: string; error: string }

export interface RuntimeNodeProcessAdapter {
    addLifecycleListener(listener: (event: RuntimeNodeProcessLifecycleEvent) => void): () => void
    startCommand(params: RuntimeNodeCommandStartParams): Promise<RuntimeNodeProcessStartResult>
    startScript(params: RuntimeNodeScriptStartParams): Promise<RuntimeNodeProcessStartResult>
    list(): Promise<unknown>
    reconnect(processId: string): Promise<unknown>
    kill(processId: string): Promise<RuntimeNodeProcessKillResult>
    killAll(): Promise<unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function requiredString(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string" || value.length < 1) throw new Error(`${key} is required`)
    return value
}

function optionalStringArray(value: unknown): string[] | undefined {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) throw new Error("expected an array")
    return value.filter((item): item is string => typeof item === "string")
}

function optionalStringRecord(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined
    const record = asRecord(value)
    const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    return Object.fromEntries(entries)
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function processRuntimeId(processId: string): string {
    return `process:${processId}`
}

function now(): string {
    return new Date().toISOString()
}

function isTerminalStatus(status: string | undefined): boolean {
    return status === "completed" || status === "failed" || status === "stopped"
}

function commandParams(params: unknown): RuntimeNodeCommandStartParams {
    const record = asRecord(params)
    return {
        cmd: requiredString(record, "cmd"),
        args: optionalStringArray(record.args),
        cwd: requiredString(record, "cwd"),
        env: optionalStringRecord(record.env),
        timeoutMs: optionalNumber(record.timeoutMs),
    }
}

function scriptParams(params: unknown): RuntimeNodeScriptStartParams {
    const record = asRecord(params)
    return {
        script: requiredString(record, "script"),
        cwd: requiredString(record, "cwd"),
        env: optionalStringRecord(record.env),
        timeoutMs: optionalNumber(record.timeoutMs),
    }
}

export function registerRuntimeNodeProcessModule(server: RuntimeServer, adapter: RuntimeNodeProcessAdapter): () => void {
    server.registerNotification("process/started")
    server.registerNotification("process/output")
    server.registerNotification("process/exit")
    server.registerNotification("process/error")

    const removeLifecycleListener = adapter.addLifecycleListener((event) => {
        if (event.type === "started") {
            const runtime = server.supervisor.create({
                runtimeId: processRuntimeId(event.processId),
                kind: "process",
                status: "running",
                scope: {
                    ownerType: "process",
                    ownerId: event.processId,
                    rootPath: event.cwd,
                },
                nativeId: event.processId,
                pid: event.pid,
                pgid: event.pgid,
                processLabel: event.label,
                processStartedAt: event.processStartedAt ?? now(),
            })
            server.notify("runtime/created", runtime)
            server.notify("process/started", { ...event, runtimeId: runtime.runtimeId })
            return
        }

        if (event.type === "output") {
            server.supervisor.touchByOwner("process", event.processId)
            server.notify("process/output", event)
            return
        }

        if (event.type === "exit") {
            const status = event.signal ? "stopped" : event.exitCode === 0 ? "completed" : "failed"
            const runtimeId = processRuntimeId(event.processId)
            const current = server.supervisor.get(runtimeId)
            if (!isTerminalStatus(current?.status)) {
                const runtime = server.supervisor.update(runtimeId, {
                    status,
                    exitedAt: now(),
                    exitCode: event.exitCode,
                    signal: event.signal,
                })
                server.notify(status === "completed" ? "runtime/completed" : status === "stopped" ? "runtime/stopped" : "runtime/failed", runtime)
            }
            server.notify("process/exit", event)
            return
        }

        const runtimeId = processRuntimeId(event.processId)
        const current = server.supervisor.get(runtimeId)
        if (!isTerminalStatus(current?.status)) {
            const runtime = server.supervisor.update(runtimeId, {
                status: "failed",
                error: event.error,
            })
            server.notify("runtime/failed", runtime)
        }
        server.notify("process/error", event)
    })

    server.register(
        "process/command/start",
        async (params) => {
            const result = await adapter.startCommand(commandParams(params))
            return { ...result, runtimeId: processRuntimeId(result.processId) }
        },
        {
            validateParams: validateParams(
                requiredStringParam("cmd"),
                requiredStringParam("cwd"),
                optionalStringArrayParam("args"),
                optionalStringRecordParam("env"),
                optionalFiniteNumber("timeoutMs")
            ),
        }
    )
    server.register(
        "process/script/start",
        async (params) => {
            const result = await adapter.startScript(scriptParams(params))
            return { ...result, runtimeId: processRuntimeId(result.processId) }
        },
        {
            validateParams: validateParams(requiredStringParam("script"), requiredStringParam("cwd"), optionalStringRecordParam("env"), optionalFiniteNumber("timeoutMs")),
        }
    )
    server.register("process/list", () => adapter.list())
    server.register("process/reconnect", (params) => adapter.reconnect(requiredString(asRecord(params), "processId")), {
        validateParams: validateParams(requiredStringParam("processId")),
    })
    server.register("process/kill", async (params) => {
        const processId = requiredString(asRecord(params), "processId")
        const result = await adapter.kill(processId)
        if (result.ok) {
            const runtime = server.supervisor.update(processRuntimeId(processId), { status: "stopped" })
            server.notify("runtime/stopped", runtime)
        }
        return result
    }, {
        validateParams: validateParams(requiredStringParam("processId")),
    })
    server.register("process/killAll", () => adapter.killAll())
    const unregisterStopHandler = server.registerRuntimeStopHandler(async (runtime) => {
        if (runtime.kind !== "process") return false
        const processId = runtime.nativeId ?? runtime.scope.ownerId
        if (!processId) return false
        const result = await adapter.kill(processId)
        if (!result.ok) throw new RuntimeHandlerError("stop_failed", result.error ?? "Failed to stop process runtime", { runtimeId: runtime.runtimeId })
        return true
    })

    return () => {
        unregisterStopHandler()
        removeLifecycleListener()
    }
}
