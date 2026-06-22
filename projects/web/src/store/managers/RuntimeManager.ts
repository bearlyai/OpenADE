import { makeAutoObservable, runInAction } from "mobx"
import type { OpenADETaskRuntimeState } from "../../../../openade-module/src"
import { RuntimeRecordCache } from "../../../../runtime-client/src"
import type { RuntimeListParams, RuntimeNotification, RuntimeRecord, RuntimeStatus } from "../../../../runtime-protocol/src"
import { localRuntimeClient } from "../../runtime/localRuntimeClient"

const ACTIVE_RUNTIME_STATUSES: ReadonlySet<RuntimeStatus> = new Set(["starting", "running"])
const ACTIVE_RUNTIME_STATUS_FILTERS: readonly RuntimeStatus[] = ["starting", "running"]
const TERMINAL_RUNTIME_METHODS = new Set(["runtime/completed", "runtime/failed", "runtime/stopped"])

export interface RuntimeListSource {
    listRuntimes(params: RuntimeListParams): Promise<RuntimeRecord[]>
}

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
    private readonly taskRuntimeStateHints = new Map<string, Set<string>>()

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
        const ids = taskIdsFor(this.runtimesById.values(), isRuntimeActive)
        for (const taskId of this.taskRuntimeStateHints.keys()) ids.add(taskId)
        return ids
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

    async hydrateOpenADETasks(source?: RuntimeListSource | null): Promise<string[]> {
        const runtimeSource = source === undefined ? this.legacyRuntimeListSource() : source
        if (!runtimeSource) return []

        const before = this.runningTaskIds
        const runtimes = await runtimeSource.listRuntimes({
            ownerType: "openade-task",
            statuses: [...ACTIVE_RUNTIME_STATUS_FILTERS],
        })
        runInAction(() => {
            this.cache.replace(runtimes, {
                ownerType: "openade-task",
                statuses: ACTIVE_RUNTIME_STATUS_FILTERS,
            })
            this.taskRuntimeStateHints.clear()
            this.syncFromCache()
            this.hydrated = true
        })
        return removedIds(before, this.runningTaskIds)
    }

    applyOpenADETaskRuntimeState(taskId: string, state: OpenADETaskRuntimeState | undefined): void {
        if (state === undefined) return
        const trimmedTaskId = taskId.trim()
        if (!trimmedTaskId) return

        runInAction(() => {
            if (!state.isRunning) {
                this.taskRuntimeStateHints.delete(trimmedTaskId)
                return
            }
            const runtimeIds = (state.runtimeIds ?? []).map((runtimeId) => runtimeId.trim()).filter((runtimeId) => runtimeId.length > 0)
            this.taskRuntimeStateHints.set(trimmedTaskId, new Set(runtimeIds.length > 0 ? runtimeIds : [`task-read:${trimmedTaskId}`]))
        })
    }

    private legacyRuntimeListSource(): RuntimeListSource | null {
        if (typeof window === "undefined" || !window.openadeAPI?.runtime) return null
        return {
            listRuntimes: (params) => localRuntimeClient.request<RuntimeRecord[]>("runtime/list", params),
        }
    }

    applyNotification(notification: RuntimeNotification): string[] {
        const before = this.runningTaskIds
        const runtime = this.cache.applyNotification(notification)
        if (!runtime) return []
        const taskId = taskIdForRuntime(runtime)
        runInAction(() => {
            this.syncFromCache()
            this.runtimesById.set(runtime.runtimeId, runtime)
            if (TERMINAL_RUNTIME_METHODS.has(notification.method) && taskId) {
                this.removeTaskRuntimeHint(taskId, runtime.runtimeId)
            }
        })

        if (!TERMINAL_RUNTIME_METHODS.has(notification.method)) return []
        return removedIds(before, this.runningTaskIds)
    }

    removeTask(taskId: string): void {
        runInAction(() => {
            this.cache.deleteWhere((runtime) => taskIdForRuntime(runtime) === taskId)
            this.taskRuntimeStateHints.delete(taskId)
            this.syncFromCache()
        })
    }

    clear(): void {
        runInAction(() => {
            this.cache.clear()
            this.taskRuntimeStateHints.clear()
            this.syncFromCache()
            this.hydrated = false
        })
    }

    private removeTaskRuntimeHint(taskId: string, runtimeId: string): void {
        const runtimeIds = this.taskRuntimeStateHints.get(taskId)
        if (!runtimeIds) return
        runtimeIds.delete(runtimeId)
        if (runtimeIds.size === 0) this.taskRuntimeStateHints.delete(taskId)
    }
}
