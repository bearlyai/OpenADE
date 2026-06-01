import { randomUUID } from "node:crypto"
import { RuntimeHandlerError, type RuntimeServer } from "../../runtime/src"
import {
    optionalPositiveInteger,
    optionalString,
    optionalStringRecord as optionalStringRecordParam,
    requiredPositiveInteger,
    requiredString as requiredStringParam,
    validateParams,
} from "./validation"

export interface RuntimeNodePtySpawnParams {
    ptyId: string
    cwd: string
    env?: Record<string, string>
    cols: number
    rows: number
}

export interface RuntimeNodePtyWriteParams {
    ptyId: string
    data: string
}

export interface RuntimeNodePtyResizeParams {
    ptyId: string
    cols: number
    rows: number
}

export interface RuntimeNodePtyReconnectParams {
    ptyId: string
}

export interface RuntimeNodePtyKillParams {
    ptyId: string
}

export interface RuntimeNodePtySpawnResult {
    ok: boolean
    error?: string
}

export interface RuntimeNodePtySpawnResponse extends RuntimeNodePtySpawnResult {
    ptyId: string
    runtimeId: string
}

export interface RuntimeNodePtyMutationResult {
    ok: boolean
}

export interface RuntimeNodePtyOutputEvent {
    data: string
    timestamp: number
}

export interface RuntimeNodePtyExitEvent {
    exitCode: number
}

export interface RuntimeNodePtyReconnectResult {
    ok: boolean
    found: boolean
    exited?: boolean
    exitCode?: number | null
    outputCount?: number
    output: RuntimeNodePtyOutputEvent[]
}

export type RuntimeNodePtyLifecycleEvent =
    | { type: "started"; ptyId: string; pid: number; pgid?: number; cwd: string; shell: string; processStartedAt?: string }
    | { type: "output"; ptyId: string; chunk: RuntimeNodePtyOutputEvent }
    | { type: "exit"; ptyId: string; exitCode: number }
    | { type: "killed"; ptyId: string }

export interface RuntimeNodePtyAdapter {
    addLifecycleListener(listener: (event: RuntimeNodePtyLifecycleEvent) => void): () => void
    spawn(params: RuntimeNodePtySpawnParams): Promise<RuntimeNodePtySpawnResult>
    write(params: RuntimeNodePtyWriteParams): Promise<RuntimeNodePtyMutationResult>
    resize(params: RuntimeNodePtyResizeParams): Promise<RuntimeNodePtyMutationResult>
    reconnect(params: RuntimeNodePtyReconnectParams): Promise<RuntimeNodePtyReconnectResult>
    kill(params: RuntimeNodePtyKillParams): Promise<RuntimeNodePtyMutationResult>
    killAll(): Promise<RuntimeNodePtyMutationResult>
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function requiredString(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string" || value.length < 1) throw new Error(`${key} is required`)
    return value
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

function ptyRuntimeId(ptyId: string): string {
    return `pty:${ptyId}`
}

function now(): string {
    return new Date().toISOString()
}

function ptySpawnParams(params: unknown): RuntimeNodePtySpawnParams {
    const record = asRecord(params)
    return {
        ptyId: typeof record.ptyId === "string" && record.ptyId.length > 0 ? record.ptyId : `pty-${randomUUID()}`,
        cwd: requiredString(record, "cwd"),
        env: optionalStringRecord(record.env),
        cols: optionalNumber(record.cols) ?? 100,
        rows: optionalNumber(record.rows) ?? 30,
    }
}

export function registerRuntimeNodePtyModule(server: RuntimeServer, adapter: RuntimeNodePtyAdapter): () => void {
    server.registerNotification("pty/started")
    server.registerNotification("pty/output")
    server.registerNotification("pty/exit")
    server.registerNotification("pty/killed")

    const removeLifecycleListener = adapter.addLifecycleListener((event) => {
        if (event.type === "started") {
            const runtime = server.supervisor.create({
                runtimeId: ptyRuntimeId(event.ptyId),
                kind: "pty",
                status: "running",
                scope: {
                    ownerType: "pty",
                    ownerId: event.ptyId,
                    rootPath: event.cwd,
                },
                nativeId: event.ptyId,
                pid: event.pid,
                pgid: event.pgid,
                processLabel: event.shell,
                processStartedAt: event.processStartedAt ?? now(),
            })
            server.notify("runtime/created", runtime)
            server.notify("pty/started", { ...event, runtimeId: runtime.runtimeId })
            return
        }

        if (event.type === "output") {
            server.supervisor.touchByOwner("pty", event.ptyId)
            server.notify("pty/output", event)
            return
        }

        const status = event.type === "killed" ? "stopped" : event.exitCode === 0 ? "completed" : "failed"
        const runtime = server.supervisor.update(ptyRuntimeId(event.ptyId), {
            status,
            exitedAt: now(),
            exitCode: event.type === "killed" ? null : event.exitCode,
            signal: event.type === "killed" ? "killed" : null,
        })
        server.notify(status === "completed" ? "runtime/completed" : status === "stopped" ? "runtime/stopped" : "runtime/failed", runtime)
        server.notify(event.type === "killed" ? "pty/killed" : "pty/exit", event)
    })

    server.register(
        "pty/spawn",
        async (params) => {
            const parsed = ptySpawnParams(params)
            const result = await adapter.spawn(parsed)
            return { ...result, ptyId: parsed.ptyId, runtimeId: ptyRuntimeId(parsed.ptyId) }
        },
        {
            validateParams: validateParams(
                requiredStringParam("cwd"),
                optionalString("ptyId"),
                optionalStringRecordParam("env"),
                optionalPositiveInteger("cols"),
                optionalPositiveInteger("rows")
            ),
        }
    )
    server.register("pty/write", (params) => adapter.write(params as RuntimeNodePtyWriteParams), {
        validateParams: validateParams(requiredStringParam("ptyId"), requiredStringParam("data", { allowEmpty: true })),
    })
    server.register("pty/resize", (params) => adapter.resize(params as RuntimeNodePtyResizeParams), {
        validateParams: validateParams(requiredStringParam("ptyId"), requiredPositiveInteger("cols"), requiredPositiveInteger("rows")),
    })
    server.register("pty/reconnect", (params) => adapter.reconnect(params as RuntimeNodePtyReconnectParams), {
        validateParams: validateParams(requiredStringParam("ptyId")),
    })
    server.register("pty/kill", async (params) => {
        const ptyId = requiredString(asRecord(params), "ptyId")
        return adapter.kill({ ptyId })
    }, {
        validateParams: validateParams(requiredStringParam("ptyId")),
    })
    server.register("pty/killAll", () => adapter.killAll())
    const unregisterStopHandler = server.registerRuntimeStopHandler(async (runtime) => {
        if (runtime.kind !== "pty") return false
        const ptyId = runtime.nativeId ?? runtime.scope.ownerId
        if (!ptyId) return false
        const result = await adapter.kill({ ptyId })
        if (!result.ok) throw new RuntimeHandlerError("stop_failed", "Failed to stop PTY runtime", { runtimeId: runtime.runtimeId })
        return true
    })

    return () => {
        unregisterStopHandler()
        removeLifecycleListener()
    }
}
