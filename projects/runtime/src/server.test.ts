import { describe, expect, it } from "vitest"
import { RuntimeHandlerError, RuntimeServer, type RuntimeConnection, type RuntimeSlowRequestEvent } from "./server"

function connection(): RuntimeConnection {
    return {
        id: "connection-1",
        send: () => undefined,
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
