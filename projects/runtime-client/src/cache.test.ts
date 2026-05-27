import { describe, expect, it } from "vitest"
import { RuntimeRecordCache } from "./cache"

const timestamp = "2026-05-26T00:00:00.000Z"

function runtime(runtimeId: string, ownerId: string, status: "running" | "completed" = "running") {
    return {
        runtimeId,
        kind: "agent",
        status,
        scope: {
            ownerType: "job",
            ownerId,
        },
        startedAt: timestamp,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
    }
}

describe("RuntimeRecordCache", () => {
    it("stores scoped runtime records and rejects malformed legacy flat records", () => {
        const cache = new RuntimeRecordCache()

        expect(cache.upsert(runtime("runtime-1", "job-1"))).toMatchObject({ runtimeId: "runtime-1" })
        expect(
            cache.upsert({
                runtimeId: "runtime-2",
                kind: "agent",
                status: "running",
                ownerType: "job",
                ownerId: "job-2",
                startedAt: timestamp,
                updatedAt: timestamp,
                lastActivityAt: timestamp,
            })
        ).toBeNull()
        expect(cache.list({ ownerType: "job" }).map((item) => item.runtimeId)).toEqual(["runtime-1"])
    })

    it("replaces filtered records without clearing unrelated runtime state", () => {
        const cache = new RuntimeRecordCache()
        cache.upsert(runtime("runtime-1", "job-1"))
        cache.upsert({
            ...runtime("process-1", "process-owner"),
            kind: "process",
            scope: { ownerType: "process", ownerId: "process-owner" },
        })

        const accepted = cache.replace([runtime("runtime-2", "job-2")], { ownerType: "job" })

        expect(accepted.map((item) => item.runtimeId)).toEqual(["runtime-2"])
        expect(cache.get("runtime-1")).toBeUndefined()
        expect(cache.get("process-1")).toMatchObject({ runtimeId: "process-1" })
    })

    it("applies runtime lifecycle notifications only when the payload validates", () => {
        const cache = new RuntimeRecordCache()

        expect(cache.applyNotification({ method: "runtime/updated", params: runtime("runtime-1", "job-1") })).toMatchObject({
            runtimeId: "runtime-1",
        })
        expect(cache.applyNotification({ method: "domain/itemChanged", params: runtime("runtime-2", "job-2") })).toBeNull()
        expect(cache.applyNotification({ method: "runtime/updated", params: { runtimeId: "runtime-3" } })).toBeNull()
        expect(cache.list().map((item) => item.runtimeId)).toEqual(["runtime-1"])
    })
})
