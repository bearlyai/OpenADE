import { afterEach, describe, expect, it, vi } from "vitest"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import { getHarnessStatuses, normalizeHarnessStatuses } from "./harnessStatus"

type TestWindow = {
    openadeAPI?: Window["openadeAPI"]
}

const testGlobal = globalThis as unknown as {
    window?: TestWindow
}
if (!testGlobal.window) {
    testGlobal.window = {}
}
const testWindow = testGlobal.window
const originalOpenadeApi = testWindow.openadeAPI

afterEach(async () => {
    await localRuntimeClient.close()
    testWindow.openadeAPI = originalOpenadeApi
    vi.restoreAllMocks()
})

describe("normalizeHarnessStatuses", () => {
    it("keeps valid harness statuses and drops malformed entries", () => {
        const result = normalizeHarnessStatuses({
            "claude-code": {
                installed: true,
                version: "1.2.3",
                authType: "account",
                authenticated: true,
            },
            codex: {
                installed: true,
                authType: "account",
                authenticated: false,
                authInstructions: "Run `codex login`",
            },
            brokenString: "invalid",
            brokenShape: {
                installed: "yes",
                authType: "account",
                authenticated: true,
            },
        })

        expect(result).toEqual({
            "claude-code": {
                installed: true,
                version: "1.2.3",
                authType: "account",
                authenticated: true,
            },
            codex: {
                installed: true,
                authType: "account",
                authenticated: false,
                authInstructions: "Run `codex login`",
            },
        })
    })
})

describe("getHarnessStatuses", () => {
    it("returns a friendly error when Electron API is unavailable", async () => {
        testWindow.openadeAPI = undefined

        const result = await getHarnessStatuses()

        expect(result.statuses).toEqual({})
        expect(result.error).toBe("Harness status is only available in Electron.")
    })

    it("loads and normalizes harness status payloads", async () => {
        const request = vi.fn().mockResolvedValue({
            id: 1,
            result: {
                "claude-code": {
                    installed: true,
                    version: "1.0.0",
                    authType: "account",
                    authenticated: true,
                },
                invalid: 123,
            },
        })

        testWindow.openadeAPI = {
            runtime: {
                connect: vi.fn().mockResolvedValue({ ok: true }),
                disconnect: vi.fn().mockResolvedValue({ ok: true }),
                request,
                onMessage: vi.fn(() => () => {}),
            },
        } as unknown as NonNullable<Window["openadeAPI"]>

        const result = await getHarnessStatuses()

        expect(request).toHaveBeenCalledTimes(1)
        expect(request.mock.calls[0]?.[0]).toMatchObject({ method: "agent/provider/status" })
        expect(result.error).toBeNull()
        expect(result.statuses).toEqual({
            "claude-code": {
                installed: true,
                version: "1.0.0",
                authType: "account",
                authenticated: true,
            },
        })
    })

    it("surfaces invalid response payload errors", async () => {
        const request = vi.fn().mockResolvedValue({ id: 1, result: "invalid-response" })

        testWindow.openadeAPI = {
            runtime: {
                connect: vi.fn().mockResolvedValue({ ok: true }),
                disconnect: vi.fn().mockResolvedValue({ ok: true }),
                request,
                onMessage: vi.fn(() => () => {}),
            },
        } as unknown as NonNullable<Window["openadeAPI"]>

        const result = await getHarnessStatuses()

        expect(result.statuses).toEqual({})
        expect(result.error).toBe("Received an invalid harness status response.")
    })
})
