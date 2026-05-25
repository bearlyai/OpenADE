import { describe, expect, it, vi } from "vitest"
import type { ServerResponse } from "node:http"
import { CompanionEventHub } from "./events"

function response() {
    const handlers = new Map<string, () => void>()
    return {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, handler: () => void) => {
            handlers.set(event, handler)
        }),
        close: () => handlers.get("close")?.(),
    }
}

describe("CompanionEventHub", () => {
    it("closes only the revoked device stream", () => {
        const hub = new CompanionEventHub()
        const first = response()
        const second = response()

        hub.addClient("device-a", first as unknown as ServerResponse)
        hub.addClient("device-b", second as unknown as ServerResponse)
        hub.closeDevice("device-a")

        expect(first.end).toHaveBeenCalledTimes(1)
        expect(second.end).not.toHaveBeenCalled()
    })
})
