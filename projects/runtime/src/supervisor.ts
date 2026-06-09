import type { RuntimeRecord, RuntimeScope, RuntimeStatus } from "../../runtime-protocol/src"

export type RuntimeDeleteReason = "timer" | "clear_buffer" | "shutdown" | "manual"

export type RuntimeReconcileResult =
    | { state: "running"; runtime: RuntimeRecord }
    | { state: "completed"; runtime: RuntimeRecord }
    | { state: "failed"; runtime: RuntimeRecord }
    | { state: "stopped"; runtime: RuntimeRecord }
    | { state: "orphaned"; runtime: RuntimeRecord }
    | { state: "missing"; runtimeId: string }

export interface RuntimeListFilter {
    ownerType?: string
    ownerId?: string
    status?: RuntimeStatus
    statuses?: RuntimeStatus[]
}

export interface RuntimeCheckpointStore {
    load(): unknown[]
    save(records: RuntimeRecord[]): void
}

export type RuntimeLivenessProbeResult = {
    state: "alive" | "dead" | "unknown"
    reason?: string
    verified?: boolean
    adoptable?: boolean
}

export interface RuntimeLivenessProbe {
    probe(runtime: RuntimeRecord): RuntimeLivenessProbeResult
}

function now(): string {
    return new Date().toISOString()
}

function isActive(status: RuntimeStatus): boolean {
    return status === "starting" || status === "running"
}

function isTerminal(status: RuntimeStatus): boolean {
    return status === "completed" || status === "failed" || status === "stopped"
}

function normalizeScope(record: RuntimeRecord | (RuntimeRecord & Record<string, unknown>)): RuntimeScope {
    const legacy = record as unknown as Record<string, unknown>
    const scope = typeof record.scope === "object" && record.scope !== null && !Array.isArray(record.scope) ? (record.scope as RuntimeScope) : {}
    return {
        ...scope,
        ownerType: scope.ownerType ?? (typeof legacy.ownerType === "string" ? legacy.ownerType : undefined),
        ownerId: scope.ownerId ?? (typeof legacy.ownerId === "string" ? legacy.ownerId : undefined),
        rootPath: scope.rootPath ?? (typeof legacy.rootPath === "string" ? legacy.rootPath : undefined),
        repoPath: scope.repoPath ?? (typeof legacy.repoPath === "string" ? legacy.repoPath : undefined),
    }
}

function normalizeRuntimeRecord(record: unknown): RuntimeRecord | null {
    if (typeof record !== "object" || record === null || Array.isArray(record)) return null
    const value = record as RuntimeRecord & Record<string, unknown>
    if (typeof value.runtimeId !== "string" || typeof value.kind !== "string" || typeof value.status !== "string") return null
    return {
        ...value,
        scope: normalizeScope(value),
    } as RuntimeRecord
}

function reconcileState(status: RuntimeStatus): Exclude<RuntimeReconcileResult["state"], "missing"> {
    switch (status) {
        case "starting":
        case "running":
            return "running"
        case "completed":
            return "completed"
        case "failed":
            return "failed"
        case "stopped":
            return "stopped"
        case "orphaned":
            return "orphaned"
    }
}

export class RuntimeSupervisor {
    private readonly runtimes = new Map<string, RuntimeRecord>()
    private readonly checkpointStore?: RuntimeCheckpointStore
    private readonly livenessProbe?: RuntimeLivenessProbe

    constructor(options: { checkpointStore?: RuntimeCheckpointStore; livenessProbe?: RuntimeLivenessProbe } = {}) {
        this.checkpointStore = options.checkpointStore
        this.livenessProbe = options.livenessProbe
        for (const record of this.checkpointStore?.load() ?? []) {
            const normalized = normalizeRuntimeRecord(record)
            if (!normalized) continue
            this.runtimes.set(normalized.runtimeId, this.hydrateCheckpointRecord(normalized))
        }
        this.persist()
    }

    register(record: RuntimeRecord): RuntimeRecord {
        const normalized = normalizeRuntimeRecord(record)
        if (!normalized) throw new Error("Invalid runtime record")
        this.runtimes.set(normalized.runtimeId, normalized)
        this.persist()
        return normalized
    }

    create(record: Omit<RuntimeRecord, "startedAt" | "updatedAt" | "lastActivityAt" | "scope"> & Partial<Pick<RuntimeRecord, "startedAt" | "updatedAt" | "lastActivityAt" | "scope">>): RuntimeRecord {
        const timestamp = now()
        return this.register({
            ...record,
            scope: record.scope ?? {},
            startedAt: record.startedAt ?? timestamp,
            updatedAt: record.updatedAt ?? timestamp,
            lastActivityAt: record.lastActivityAt ?? timestamp,
        })
    }

    update(runtimeId: string, patch: Partial<RuntimeRecord>): RuntimeRecord | undefined {
        const current = this.runtimes.get(runtimeId)
        if (!current) return undefined
        const next = {
            ...current,
            ...patch,
            runtimeId,
            updatedAt: patch.updatedAt ?? now(),
            lastActivityAt: patch.lastActivityAt ?? patch.updatedAt ?? current.lastActivityAt,
        }
        this.runtimes.set(runtimeId, next)
        this.persist()
        return next
    }

    touchByOwner(ownerType: string, ownerId: string): void {
        for (const runtime of this.runtimes.values()) {
            if (runtime.scope.ownerType === ownerType && runtime.scope.ownerId === ownerId) {
                this.update(runtime.runtimeId, { lastActivityAt: now() })
            }
        }
    }

    get(runtimeId: string): RuntimeRecord | undefined {
        return this.runtimes.get(runtimeId)
    }

    list(filter: RuntimeListFilter = {}): RuntimeRecord[] {
        return [...this.runtimes.values()].filter((runtime) => {
            if (filter.ownerType && runtime.scope.ownerType !== filter.ownerType) return false
            if (filter.ownerId && runtime.scope.ownerId !== filter.ownerId) return false
            if (filter.status && runtime.status !== filter.status) return false
            if (filter.statuses && !filter.statuses.includes(runtime.status)) return false
            return true
        })
    }

    stop(runtimeId: string, reason?: string): RuntimeRecord | undefined {
        return this.update(runtimeId, { status: "stopped", error: reason, exitedAt: now(), signal: "stopped" })
    }

    deleteTerminal(runtimeId: string, _reason: RuntimeDeleteReason): boolean {
        const runtime = this.runtimes.get(runtimeId)
        if (!runtime) return false
        if (!isTerminal(runtime.status)) return false
        const deleted = this.runtimes.delete(runtimeId)
        this.persist()
        return deleted
    }

    reconcileRuntime(runtimeId: string): RuntimeReconcileResult {
        const runtime = this.runtimes.get(runtimeId)
        if (!runtime) return { state: "missing", runtimeId }

        if (this.livenessProbe && (isActive(runtime.status) || runtime.status === "orphaned")) {
            const probed = this.livenessProbe.probe(runtime)
            if (probed.state === "dead") {
                const failed = this.update(runtimeId, {
                    status: "failed",
                    error: probed.reason ?? "Runtime process is no longer alive",
                })
                if (failed) return { state: "failed", runtime: failed }
            }
            if (probed.state === "alive" && (runtime.status === "orphaned" ? probed.adoptable : isActive(runtime.status)) && runtime.status !== "running") {
                const running = this.update(runtimeId, { status: "running" })
                if (running) return { state: "running", runtime: running }
            }
        }

        return { state: reconcileState(runtime.status), runtime } as RuntimeReconcileResult
    }

    checkpoint(): RuntimeRecord[] {
        return [...this.runtimes.values()]
    }

    private persist(): void {
        this.checkpointStore?.save(this.checkpoint())
    }

    private hydrateCheckpointRecord(record: RuntimeRecord): RuntimeRecord {
        if (!isActive(record.status)) return record

        const timestamp = now()
        if (this.livenessProbe) {
            const probed = this.livenessProbe.probe(record)
            if (probed.state === "dead") {
                return {
                    ...record,
                    status: "failed",
                    updatedAt: timestamp,
                    error: probed.reason ?? "Runtime process is no longer alive",
                }
            }
            if (probed.state === "alive" && probed.adoptable) {
                return {
                    ...record,
                    status: "running",
                    updatedAt: timestamp,
                }
            }
        }

        return {
            ...record,
            status: "orphaned",
            updatedAt: timestamp,
        }
    }
}
