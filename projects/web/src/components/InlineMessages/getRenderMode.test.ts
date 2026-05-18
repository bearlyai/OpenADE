import { describe, expect, it } from "vitest"
import type { DisplayContext, FileChangeGroup, ThinkingGroup } from "../events/messageGroups"
import { getRenderMode } from "./getRenderMode"

function thinkingGroup(text = "some thinking"): ThinkingGroup {
    return { type: "thinking", text, messageIndex: 0 }
}

function fileChangeGroup(overrides: Partial<FileChangeGroup> = {}): FileChangeGroup {
    return {
        type: "fileChange",
        toolUseId: "item-1",
        filePath: "src/example.ts",
        kind: "add",
        status: "completed",
        isError: false,
        isPending: false,
        messageIndex: 0,
        changeIndex: 0,
        ...overrides,
    }
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

    describe("file change groups", () => {
        it("renders as pill for run-plan executions", () => {
            expect(getRenderMode(fileChangeGroup(), ctx("run_plan"))).toBe("pill")
        })

        it("renders as pill for direct executions", () => {
            expect(getRenderMode(fileChangeGroup(), ctx("do"))).toBe("pill")
        })
    })
})
