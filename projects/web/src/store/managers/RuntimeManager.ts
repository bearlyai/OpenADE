import { makeAutoObservable, runInAction } from "mobx"
import { RuntimeRecordCache } from "../../../../runtime-client/src"
import type { RuntimeNotification, RuntimeRecord, RuntimeStatus } from "../../../../runtime-protocol/src"
import { localRuntimeClient } from "../../runtime/localRuntimeClient"

const ACTIVE_RUNTIME_STATUSES: ReadonlySet<RuntimeStatus> = new Set(["starting", "running"])
const TERMINAL_RUNTIME_METHODS = new Set(["runtime/completed", "runtime/failed", "runtime/stopped"])

function taskIdForRuntime(runtime: RuntimeRecord): string | null {
    if (runtime.scope.ownerType !== "openade-task") return null
    return runtime.scope.ownerId?.trim() || null
}

function isRuntimeActive(runtime: RuntimeRecord): boolean {
    return ACTIVE_RUNTIME_STATUSES.has(runtime.status)
}

function taskIdsFor(runtimes: Iterable<RuntimeRecord>, predicate: (runtime: RuntimeRecord) => boolean): Set<string> {
    const ids = new Set<string>()
    for (const runtime of runtimes) {
        if (!predicate(runtime)) continue
        const taskId = taskIdForRuntime(runtime)
        if (taskId) ids.add(taskId)
    }
    return ids
}

function removedIds(before: Set<string>, after: Set<string>): string[] {
    return [...before].filter((taskId) => !after.has(taskId))
}

export class RuntimeManager {
    runtimesById: Map<string, RuntimeRecord> = new Map()
    hydrated = false
    private readonly cache = new RuntimeRecordCache()

    constructor() {
        makeAutoObservable(this, {
            runtimesById: true,
        })
    }

    private syncFromCache(): void {
        this.runtimesById.clear()
        for (const [runtimeId, runtime] of this.cache.entries()) {
            this.runtimesById.set(runtimeId, runtime)
        }
    }

    get runningTaskIds(): Set<string> {
        return taskIdsFor(this.runtimesById.values(), isRuntimeActive)
    }

    get hasRunningTasks(): boolean {
        return this.runningTaskIds.size > 0
    }

    isTaskRunning(taskId: string): boolean {
        return this.runningTaskIds.has(taskId)
    }

    isTaskOrphaned(taskId: string): boolean {
        return taskIdsFor(this.runtimesById.values(), (runtime) => runtime.status === "orphaned").has(taskId)
    }

    runtimeForTask(taskId: string): RuntimeRecord | null {
        return (
            [...this.runtimesById.values()]
                .filter((runtime) => taskIdForRuntime(runtime) === taskId)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
        )
    }

    async hydrateOpenADETasks(): Promise<string[]> {
        if (typeof window === "undefined" || !window.openadeAPI?.runtime) return []

        const before = this.runningTaskIds
        const runtimes = await localRuntimeClient.request<unknown[]>("runtime/list", { ownerType: "openade-task" })
        runInAction(() => {
            this.cache.replace(runtimes, { ownerType: "openade-task" })
            this.syncFromCache()
            this.hydrated = true
        })
        return removedIds(before, this.runningTaskIds)
    }

    applyNotification(notification: RuntimeNotification): string[] {
        const before = this.runningTaskIds
        const runtime = this.cache.applyNotification(notification)
        if (!runtime) return []
        runInAction(() => {
            this.syncFromCache()
            this.runtimesById.set(runtime.runtimeId, runtime)
        })

        if (!TERMINAL_RUNTIME_METHODS.has(notification.method)) return []
        return removedIds(before, this.runningTaskIds)
    }

    removeTask(taskId: string): void {
        runInAction(() => {
            this.cache.deleteWhere((runtime) => taskIdForRuntime(runtime) === taskId)
            this.syncFromCache()
        })
    }

    clear(): void {
        runInAction(() => {
            this.cache.clear()
            this.syncFromCache()
            this.hydrated = false
        })
    }
}
