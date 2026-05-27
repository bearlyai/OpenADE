import { describe, expect, it } from "vitest"
import { isRemoteRealtimeOnline, statusCopy } from "./status"

describe("remote realtime status", () => {
    it("maps online, offline, reconnecting, and lagged states to concise UI copy", () => {
        expect(statusCopy("connected")).toEqual({ label: "Online", tone: "ok" })
        expect(statusCopy("connecting")).toEqual({ label: "Connecting", tone: "muted" })
        expect(statusCopy("reconnecting")).toEqual({ label: "Reconnecting", tone: "warn" })
        expect(statusCopy("lagged")).toEqual({ label: "Lagged", tone: "warn" })
        expect(statusCopy("disconnected")).toEqual({ label: "Offline", tone: "bad" })
    })

    it("keeps lagged sessions interactive while warning about stale realtime state", () => {
        expect(isRemoteRealtimeOnline("connected")).toBe(true)
        expect(isRemoteRealtimeOnline("lagged")).toBe(true)
        expect(isRemoteRealtimeOnline("connecting")).toBe(false)
        expect(isRemoteRealtimeOnline("reconnecting")).toBe(false)
        expect(isRemoteRealtimeOnline("disconnected")).toBe(false)
    })
})
