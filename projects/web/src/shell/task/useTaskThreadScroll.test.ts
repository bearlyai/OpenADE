import { describe, expect, it } from "vitest"
import { shouldFollowTaskThread } from "./useTaskThreadScroll"

describe("shouldFollowTaskThread", () => {
    it("keeps following when the viewport is near the bottom", () => {
        expect(shouldFollowTaskThread(1000, 930, 10)).toBe(true)
        expect(shouldFollowTaskThread(1000, 850, 100)).toBe(true)
    })

    it("stops following when the user has scrolled away from the bottom", () => {
        expect(shouldFollowTaskThread(1000, 700, 100)).toBe(false)
    })
})
