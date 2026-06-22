import { describe, expect, it } from "vitest"
import type { RuntimeMessage, RuntimeRecord, RuntimeStatus } from "../../runtime-protocol/src"
import { RuntimeHandlerError, RuntimeServer, type RuntimeConnection, type RuntimeNotificationBurstEvent, type RuntimeSlowRequestEvent } from "./server"

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
            {
                id: rawRequestId,
                method: "test/slow",
                params: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    path: "src/secret/file.ts",
                    query: "secret query",
                },
            },
            connection(),
            { queuedAtMs: Date.now() }
        )

        expect(response).toEqual({ id: rawRequestId, result: { ok: true } })
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
            service: "test-runtime",
            method: "test/slow",
            connectionId: "connection-1",
            failed: false,
            dominantPhase: "handler",
            scope: {
                repoId: "repo-1",
                taskId: "task-1",
                pathDepth: 3,
                queryLength: 12,
            },
        })
        expect(events[0].durationMs).toBeGreaterThanOrEqual(events[0].handlerMs)
        expect(events[0].queueWaitMs).toBeGreaterThanOrEqual(0)
        expect(events[0].handlerMs).toBeGreaterThan(0)
        expect(events[0].requestId).toContain("slow?request-")
        expect(events[0].requestId.length).toBeLessThanOrEqual(83)
        expect(events[0].requestId).not.toContain("\n")
        expect(events[0].requestId).not.toContain("x".repeat(100))
        expect(JSON.stringify(events[0].scope)).not.toContain("secret")
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

    it("records queue wait for early runtime error responses", async () => {
        const events: RuntimeSlowRequestEvent[] = []
        const server = new RuntimeServer({
            serverName: "test-runtime",
            slowRequestThresholdMs: 0,
            onSlowRequest: (event) => events.push(event),
        })
        server.register("test/allowed", () => ({ ok: true }))

        const queuedAtMs = Date.now() - 25
        const notInitialized = await server.handleRequest({ id: "not-init", method: "test/allowed" }, connection(), {
            requireInitialized: true,
            queuedAtMs,
        })
        const methodNotFound = await server.handleRequest({ id: "missing", method: "test/missing" }, connection(), { queuedAtMs })
        const permissionDenied = await server.handleRequest(
            { id: "denied", method: "test/allowed" },
            { ...connection(), permissions: ["initialize"] },
            { queuedAtMs }
        )

        expect(notInitialized).toMatchObject({ id: "not-init", error: { code: "not_initialized" } })
        expect(methodNotFound).toMatchObject({ id: "missing", error: { code: "method_not_found" } })
        expect(permissionDenied).toMatchObject({ id: "denied", error: { code: "permission_denied" } })
        expect(events).toEqual([
            expect.objectContaining({
                method: "test/allowed",
                requestId: "not-init",
                failed: true,
                errorCode: "not_initialized",
            }),
            expect.objectContaining({
                method: "test/missing",
                requestId: "missing",
                failed: true,
                errorCode: "method_not_found",
            }),
            expect.objectContaining({
                method: "test/allowed",
                requestId: "denied",
                failed: true,
                errorCode: "permission_denied",
            }),
        ])
        for (const event of events) {
            expect(event.service).toBe("test-runtime")
            expect(event.connectionId).toBe("connection-1")
            expect(event.queueWaitMs).toBeGreaterThan(0)
            expect(event.handlerMs).toBeGreaterThanOrEqual(0)
            expect(event.durationMs).toBeGreaterThanOrEqual(event.queueWaitMs)
            expect(event.dominantPhase).toBe("queue_wait")
        }
    })

    it("records protocol decode failures without logging raw payloads", async () => {
        const events: RuntimeSlowRequestEvent[] = []
        const sent: RuntimeMessage[] = []
        const server = new RuntimeServer({
            serverName: "test-runtime",
            slowRequestThresholdMs: 0,
            onSlowRequest: (event) => events.push(event),
        })
        const runtimeConnection: RuntimeConnection = {
            ...connection(),
            send: (message) => sent.push(message),
        }

        await server.handleMessage(runtimeConnection, "{")
        await server.handleMessage(runtimeConnection, JSON.stringify({ id: "bad\nid", params: { prompt: "secret" } }))

        expect(sent).toEqual([
            expect.objectContaining({ id: "parse-error", error: expect.objectContaining({ code: "parse_error" }) }),
            expect.objectContaining({ id: "bad\nid", error: expect.objectContaining({ code: "invalid_message" }) }),
        ])
        expect(events).toEqual([
            expect.objectContaining({
                service: "test-runtime",
                method: "protocol/decode",
                requestId: "parse-error",
                connectionId: "connection-1",
                failed: true,
                errorCode: "parse_error",
            }),
            expect.objectContaining({
                service: "test-runtime",
                method: "protocol/decode",
                requestId: "bad?id",
                connectionId: "connection-1",
                failed: true,
                errorCode: "invalid_message",
            }),
        ])
        for (const event of events) {
            expect(event.durationMs).toBeGreaterThanOrEqual(event.handlerMs)
            expect(event.requestId).not.toContain("\n")
            expect(JSON.stringify(event)).not.toContain("secret")
        }
    })
})

describe("RuntimeServer notification burst observer", () => {
    it("reports notification bursts through the real fanout path without payload data", () => {
        const events: RuntimeNotificationBurstEvent[] = []
        const sent: unknown[] = []
        const server = new RuntimeServer({
            serverName: "test-runtime",
            notificationBurstCount: 3,
            notificationBurstWindowMs: 1_000,
            onNotificationBurst: (event) => events.push(event),
        })
        server.registerNotification("openade/task/updated")
        server.connect({
            id: "connection-1",
            send: (message) => sent.push(message),
        })

        for (let index = 0; index < 3; index++) {
            server.notify("openade/task/updated", {
                repoId: "repo-secret",
                taskId: `task-${index}`,
                prompt: "do not log this prompt",
            })
        }

        expect(sent).toHaveLength(3)
        expect(events).toEqual([
            {
                service: "test-runtime",
                method: "openade/task/updated",
                count: 3,
                windowMs: expect.any(Number),
            },
        ])
        expect(JSON.stringify(events)).not.toContain("repo-secret")
        expect(JSON.stringify(events)).not.toContain("do not log this prompt")
    })
})

describe("RuntimeServer handler context runner", () => {
    it("wraps real handler execution with sanitized request context", async () => {
        let observed: unknown
        const server = new RuntimeServer({
            serverName: "test-runtime",
            runHandlerWithContext: (event, run) => {
                observed = event
                return run()
            },
        })
        server.register("test/context", () => ({ ok: true }))

        const response = await server.handleRequest({ id: "context\nrequest", method: "test/context" }, connection())

        expect(response).toEqual({ id: "context\nrequest", result: { ok: true } })
        expect(observed).toEqual({
            service: "test-runtime",
            method: "test/context",
            requestId: "context?request",
            connectionId: "connection-1",
        })
    })
})

describe("RuntimeServer runtime records", () => {
    it("filters runtime/list by runtime status", async () => {
        const server = new RuntimeServer({ serverName: "test-runtime" })
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
