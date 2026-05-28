import { describe, expect, it } from "vitest"
import { getEventRenderKind } from "./EventItem"

describe("getEventRenderKind", () => {
    it("routes unknown top-level task events to the unknown renderer", () => {
        expect(getEventRenderKind({ type: "future_event" })).toBe("unknown")
    })
})
