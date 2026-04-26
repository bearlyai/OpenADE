import { describe, expect, it } from "vitest"
import { DEFAULT_DIFF_CONTEXT, DIFF_CONTEXT_OPTIONS, getChangesLoadMode, getPatchContextLines, shouldUsePatchDiff } from "./gitDiffContext"

describe("gitDiffContext", () => {
    it("defines the expected selector options", () => {
        expect(DIFF_CONTEXT_OPTIONS.map((option) => option.id)).toEqual([1, 3, 10, 25, 100])
        expect(DEFAULT_DIFF_CONTEXT).toBe(3)
    })

    it("maps selector values directly to patch context lines", () => {
        expect(getPatchContextLines(1)).toBe(1)
        expect(getPatchContextLines(25)).toBe(25)
        expect(getPatchContextLines(100)).toBe(100)
    })

    it("uses patch diffs for split and unified views", () => {
        expect(shouldUsePatchDiff("current", 3)).toBe(false)
        expect(shouldUsePatchDiff("split", 3)).toBe(true)
        expect(shouldUsePatchDiff("unified", 10)).toBe(true)
        expect(shouldUsePatchDiff("split", 100)).toBe(true)
    })

    it("loads only current-file views through the file-pair path", () => {
        expect(getChangesLoadMode("current", 3)).toBe("current")
        expect(getChangesLoadMode("split", 3)).toBe("unified")
        expect(getChangesLoadMode("unified", 100)).toBe("unified")
    })
})
