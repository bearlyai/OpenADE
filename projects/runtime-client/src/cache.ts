import { validateRuntimeRecord, type RuntimeNotification, type RuntimeRecord, type RuntimeStatus } from "../../runtime-protocol/src"

export interface RuntimeRecordCacheFilter {
    ownerType?: string
    ownerId?: string
    status?: RuntimeStatus
}

const RUNTIME_RECORD_NOTIFICATION_METHODS = new Set(["runtime/created", "runtime/updated", "runtime/completed", "runtime/failed", "runtime/stopped"])

function matchesFilter(runtime: RuntimeRecord, filter: RuntimeRecordCacheFilter = {}): boolean {
    if (filter.ownerType !== undefined && runtime.scope.ownerType !== filter.ownerType) return false
    if (filter.ownerId !== undefined && runtime.scope.ownerId !== filter.ownerId) return false
    if (filter.status !== undefined && runtime.status !== filter.status) return false
    return true
}

function sortByUpdatedAtDesc(a: RuntimeRecord, b: RuntimeRecord): number {
    return b.updatedAt.localeCompare(a.updatedAt)
}

export class RuntimeRecordCache {
    private readonly records = new Map<string, RuntimeRecord>()

    get size(): number {
        return this.records.size
    }

    get(runtimeId: string): RuntimeRecord | undefined {
        return this.records.get(runtimeId)
    }

    list(filter: RuntimeRecordCacheFilter = {}): RuntimeRecord[] {
        return [...this.records.values()].filter((runtime) => matchesFilter(runtime, filter)).sort(sortByUpdatedAtDesc)
    }

    entries(): Array<[string, RuntimeRecord]> {
        return [...this.records.entries()]
    }

    upsert(value: unknown): RuntimeRecord | null {
        const runtime = validateRuntimeRecord(value)
        if (!runtime.ok) return null
        this.records.set(runtime.value.runtimeId, runtime.value)
        return runtime.value
    }

    replace(records: Iterable<unknown>, filter: RuntimeRecordCacheFilter = {}): RuntimeRecord[] {
        if (Object.keys(filter).length > 0) {
            for (const runtime of this.list(filter)) {
                this.records.delete(runtime.runtimeId)
            }
        } else {
            this.records.clear()
        }

        const accepted: RuntimeRecord[] = []
        for (const record of records) {
            const runtime = this.upsert(record)
            if (runtime) accepted.push(runtime)
        }
        return accepted.sort(sortByUpdatedAtDesc)
    }

    applyNotification(notification: RuntimeNotification): RuntimeRecord | null {
        if (!RUNTIME_RECORD_NOTIFICATION_METHODS.has(notification.method)) return null
        return this.upsert(notification.params)
    }

    delete(runtimeId: string): boolean {
        return this.records.delete(runtimeId)
    }

    deleteWhere(predicate: (runtime: RuntimeRecord) => boolean): string[] {
        const deleted: string[] = []
        for (const [runtimeId, runtime] of this.records) {
            if (!predicate(runtime)) continue
            this.records.delete(runtimeId)
            deleted.push(runtimeId)
        }
        return deleted
    }

    clear(): void {
        this.records.clear()
    }
}
