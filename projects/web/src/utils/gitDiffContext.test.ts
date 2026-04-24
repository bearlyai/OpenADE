import { describe, expect, it } from "vitest"
import {
    DEFAULT_DIFF_CONTEXT,
    DIFF_CONTEXT_OPTIONS,
    getChangesLoadMode,
    getPatchContextLines,
    isWholeFileDiffContext,
    shouldUsePatchDiff,
} from "./gitDiffContext"

describe("gitDiffContext", () => {
    it("defines the expected selector options", () => {
        expect(DIFF_CONTEXT_OPTIONS.map((option) => option.id)).toEqual([0, 3, 10, 25, "full"])
        expect(DEFAULT_DIFF_CONTEXT).toBe(3)
    })

    it("distinguishes whole-file mode from numeric context modes", () => {
        expect(isWholeFileDiffContext("full")).toBe(true)
        expect(isWholeFileDiffContext(3)).toBe(false)
        expect(isWholeFileDiffContext(25)).toBe(false)
    })

    it("maps whole-file mode to the default numeric patch context", () => {
        expect(getPatchContextLines("full")).toBe(3)
        expect(getPatchContextLines(0)).toBe(0)
        expect(getPatchContextLines(25)).toBe(25)
    })

    it("uses patch diffs only for split and unified numeric contexts", () => {
        expect(shouldUsePatchDiff("current", 3)).toBe(false)
        expect(shouldUsePatchDiff("split", 3)).toBe(true)
        expect(shouldUsePatchDiff("unified", 10)).toBe(true)
        expect(shouldUsePatchDiff("split", "full")).toBe(false)
    })

    it("loads whole-file views through the file-pair path", () => {
        expect(getChangesLoadMode("current", 3)).toBe("current")
        expect(getChangesLoadMode("split", "full")).toBe("current")
        expect(getChangesLoadMode("unified", "full")).toBe("current")
        expect(getChangesLoadMode("split", 3)).toBe("unified")
    })
})
