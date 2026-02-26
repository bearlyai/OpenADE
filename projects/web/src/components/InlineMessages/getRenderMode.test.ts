import { describe, expect, it } from "vitest"
import { getRenderMode } from "./getRenderMode"
import type { DisplayContext, ThinkingGroup } from "../events/messageGroups"

function thinkingGroup(text = "some thinking"): ThinkingGroup {
    return { type: "thinking", text, messageIndex: 0 }
}

function ctx(sourceType: DisplayContext["sourceType"], isLastTextGroup = false): DisplayContext {
    return { sourceType, isLastTextGroup }
}

describe("getRenderMode", () => {
    describe("thinking groups", () => {
        it("renders as pill in plan mode", () => {
            expect(getRenderMode(thinkingGroup(), ctx("plan"))).toBe("pill")
        })

        it("renders as pill in revise mode", () => {
            expect(getRenderMode(thinkingGroup(), ctx("revise"))).toBe("pill")
        })

        it("renders as pill in do mode", () => {
            expect(getRenderMode(thinkingGroup(), ctx("do"))).toBe("pill")
        })

        it("renders as pill in ask mode", () => {
            expect(getRenderMode(thinkingGroup(), ctx("ask"))).toBe("pill")
        })
    })
})
