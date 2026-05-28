import { describe, expect, it } from "vitest"
import { shouldDelayRemoteStatusDisplay } from "./status"

describe("remote status display", () => {
    it("keeps the visible status stable for transient reconnects after an online state", () => {
        expect(shouldDelayRemoteStatusDisplay("connected", "reconnecting")).toBe(true)
        expect(shouldDelayRemoteStatusDisplay("connected", "disconnected")).toBe(true)
        expect(shouldDelayRemoteStatusDisplay("lagged", "reconnecting")).toBe(true)
    })

    it("updates immediately when coming online or starting from an offline state", () => {
        expect(shouldDelayRemoteStatusDisplay("reconnecting", "connected")).toBe(false)
        expect(shouldDelayRemoteStatusDisplay("disconnected", "reconnecting")).toBe(false)
        expect(shouldDelayRemoteStatusDisplay("connecting", "disconnected")).toBe(false)
    })
})
