import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const storeState = vi.hoisted(() => ({
    data: new Map<string, unknown>(),
    setCalls: 0,
}))

vi.mock("electron-store", () => ({
    default: class MockStore {
        get(key: string) {
            return storeState.data.get(key)
        }
        set(key: string, value: unknown) {
            storeState.setCalls += 1
            storeState.data.set(key, value)
        }
    },
}))

describe("companion auth", () => {
    beforeEach(() => {
        storeState.data.clear()
        storeState.setCalls = 0
        vi.resetModules()
        vi.useRealTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("exchanges a pairing token once for a device token", async () => {
        const auth = await import("./auth")
        const pairing = auth.startPairing("http://127.0.0.1:7823")

        const first = auth.pairDevice({ token: pairing.token, deviceName: "Phone", platform: "ios" })
        expect(auth.authenticateDevice(first.deviceToken)?.id).toBe(first.device.id)
        expect(() => auth.pairDevice({ token: pairing.token, deviceName: "Other", platform: "ios" })).toThrow(/invalid or expired/i)
    })

    it("rejects revoked device tokens", async () => {
        const auth = await import("./auth")
        const pairing = auth.startPairing("http://127.0.0.1:7823")
        const paired = auth.pairDevice({ token: pairing.token, deviceName: "Phone", platform: "ios" })

        expect(auth.authenticateDevice(paired.deviceToken)).not.toBeNull()
        auth.revokeDevice(paired.device.id)
        expect(auth.authenticateDevice(paired.deviceToken)).toBeNull()
    })

    it("throttles lastSeenAt persistence and flushes the latest value", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"))

        const auth = await import("./auth")
        const pairing = auth.startPairing("http://127.0.0.1:7823")
        const paired = auth.pairDevice({ token: pairing.token, deviceName: "Phone", platform: "ios" })

        storeState.setCalls = 0
        expect(auth.authenticateDevice(paired.deviceToken)?.lastSeenAt).toBe("2026-05-24T12:00:00.000Z")
        expect(storeState.setCalls).toBe(1)

        vi.setSystemTime(new Date("2026-05-24T12:00:10.000Z"))
        expect(auth.authenticateDevice(paired.deviceToken)?.lastSeenAt).toBe("2026-05-24T12:00:10.000Z")
        expect(storeState.setCalls).toBe(1)

        auth.flushLastSeen()
        expect(storeState.setCalls).toBe(2)
    })
})
