import { describe, expect, it } from "vitest"
import { shouldFollowRemoteThread } from "./threadScroll"

describe("remote thread scroll behavior", () => {
    it("auto-follows live deltas while the user is near the bottom", () => {
        expect(shouldFollowRemoteThread(1000, 930, 10)).toBe(true)
        expect(shouldFollowRemoteThread(1000, 850, 100)).toBe(true)
    })

    it("does not force-scroll when the user has intentionally scrolled up", () => {
        expect(shouldFollowRemoteThread(1000, 700, 100)).toBe(false)
    })
})
