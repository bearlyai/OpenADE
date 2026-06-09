import { describe, expect, it } from "vitest"
import type { RuntimeRecord, RuntimeStatus } from "../../runtime-protocol/src"
import { RuntimeHandlerError, RuntimeServer, type RuntimeConnection, type RuntimeSlowRequestEvent } from "./server"

function connection(): RuntimeConnection {
    return {
        id: "connection-1",
        send: () => undefined,
    }
}

const startedAt = "2026-06-09T00:00:00.000Z"

function runtimeRecord(runtimeId: string, status: RuntimeStatus, ownerId: string): RuntimeRecord {
    return {
        runtimeId,
        kind: "agent",
        status,
        scope: {
            ownerType: "openade-task",
            ownerId,
        },
        startedAt,
        updatedAt: startedAt,
        lastActivityAt: startedAt,
    }
}

describe("RuntimeServer slow request observer", () => {
    it("separates queue wait and handler time with sanitized identity fields", async () => {
        const events: RuntimeSlowRequestEvent[] = []
        const server = new RuntimeServer({
            serverName: "test-runtime",
            slowRequestThresholdMs: 0,
            onSlowRequest: (event) => events.push(event),
        })
        server.register("test/slow", async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            return { ok: true }
        })

        const rawRequestId = `slow\nrequest-${"x".repeat(100)}`
        const response = await server.handleRequest(
            { id: rawRequestId, method: "test/slow" },
            connection(),
            { queuedAtMs: Date.now() - 10 }
        )

        expect(response).toEqual({ id: rawRequestId, result: { ok: true } })
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
            service: "test-runtime",
            method: "test/slow",
            connectionId: "connection-1",
            failed: false,
        })
        expect(events[0].durationMs).toBeGreaterThanOrEqual(events[0].handlerMs)
        expect(events[0].queueWaitMs).toBeGreaterThanOrEqual(0)
        expect(events[0].handlerMs).toBeGreaterThan(0)
        expect(events[0].requestId).toContain("slow?request-")
        expect(events[0].requestId.length).toBeLessThanOrEqual(83)
        expect(events[0].requestId).not.toContain("\n")
        expect(events[0].requestId).not.toContain("x".repeat(100))
    })

    it("records sanitized failure state and error code", async () => {
        const events: RuntimeSlowRequestEvent[] = []
        const server = new RuntimeServer({
            serverName: "test-runtime",
            slowRequestThresholdMs: 0,
            onSlowRequest: (event) => events.push(event),
        })
        server.register("test/fails", () => {
            throw new RuntimeHandlerError("test_failed", "Failed for test")
        })

        const response = await server.handleRequest({ id: 1, method: "test/fails" }, connection())

        expect(response).toMatchObject({ id: 1, error: { code: "test_failed", message: "Failed for test" } })
        expect(events).toEqual([
            expect.objectContaining({
                service: "test-runtime",
                method: "test/fails",
                requestId: "1",
                connectionId: "connection-1",
                failed: true,
                errorCode: "test_failed",
            }),
        ])
    })
})

describe("RuntimeServer runtime records", () => {
    it("filters runtime/list by runtime status", async () => {
        const server = new RuntimeServer({})
        server.supervisor.register(runtimeRecord("runtime-running", "running", "task-1"))
        server.supervisor.register(runtimeRecord("runtime-completed", "completed", "task-1"))
        server.supervisor.register(runtimeRecord("runtime-other", "running", "task-2"))
        server.supervisor.register(runtimeRecord("runtime-starting", "starting", "task-1"))

        const response = await server.handleRequest(
            {
                id: 1,
                method: "runtime/list",
                params: {
                    ownerType: "openade-task",
                    ownerId: "task-1",
                    status: "running",
                },
            },
            connection()
        )

        expect(response).toEqual({
            id: 1,
            result: [runtimeRecord("runtime-running", "running", "task-1")],
        })

        const statusesResponse = await server.handleRequest(
            {
                id: 2,
                method: "runtime/list",
                params: {
                    ownerType: "openade-task",
                    ownerId: "task-1",
                    statuses: ["starting", "running"],
                },
            },
            connection()
        )

        expect(statusesResponse).toEqual({
            id: 2,
            result: [
                runtimeRecord("runtime-running", "running", "task-1"),
                runtimeRecord("runtime-starting", "starting", "task-1"),
            ],
        })

        const intersected = await server.handleRequest(
            {
                id: 3,
                method: "runtime/list",
                params: {
                    ownerType: "openade-task",
                    ownerId: "task-1",
                    status: "running",
                    statuses: ["completed"],
                },
            },
            connection()
        )

        expect(intersected).toEqual({ id: 3, result: [] })

        const invalid = await server.handleRequest({ id: 4, method: "runtime/list", params: { status: "active" } }, connection())

        expect(invalid).toMatchObject({
            id: 4,
            error: {
                code: "invalid_params",
            },
        })

        const invalidStatuses = await server.handleRequest(
            { id: 5, method: "runtime/list", params: { statuses: ["active"] } },
            connection()
        )

        expect(invalidStatuses).toMatchObject({
            id: 5,
            error: {
                code: "invalid_params",
            },
        })
    })
})
