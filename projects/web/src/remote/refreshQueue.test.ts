import { describe, expect, it } from "vitest"
import { nextRemoteRefreshDelay } from "./refreshQueue"

describe("nextRemoteRefreshDelay", () => {
    it("uses the requested delay before the first refresh", () => {
        expect(nextRemoteRefreshDelay({ now: 1_000, lastRefreshAt: 0, requestedDelayMs: 150, minIntervalMs: 900 })).toBe(150)
    })

    it("spaces repeated refreshes by the minimum interval", () => {
        expect(nextRemoteRefreshDelay({ now: 1_200, lastRefreshAt: 1_000, requestedDelayMs: 150, minIntervalMs: 900 })).toBe(700)
    })

    it("does not delay once the minimum interval has elapsed", () => {
        expect(nextRemoteRefreshDelay({ now: 2_000, lastRefreshAt: 1_000, requestedDelayMs: 150, minIntervalMs: 900 })).toBe(150)
    })
})
