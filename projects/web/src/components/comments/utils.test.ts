import { parsePatchFiles } from "@pierre/diffs"
import { describe, expect, it } from "vitest"
import { extractSelectedTextFromDiff, getFileDiffCopyContent, isLineInDiffHunks, normalizeFileDiffForRender } from "./utils"

function parseSingleFile(patch: string) {
    const fileDiff = parsePatchFiles(patch)[0]?.files[0]
    if (!fileDiff) {
        throw new Error("Expected patch to include one file")
    }
    return fileDiff
}

describe("diff comment utilities", () => {
    it("extracts selected text and context from Pierre 1.1 parsed hunks", () => {
        const fileDiff = parseSingleFile(`diff --git a/a.txt b/a.txt
index 0000000..1111111 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 one
-old
+new
 three
`)

        expect(extractSelectedTextFromDiff(fileDiff, 2, 2, "additions")).toEqual({
            text: "new",
            linesBefore: "one",
            linesAfter: "three",
        })
        expect(extractSelectedTextFromDiff(fileDiff, 2, 2, "deletions")).toEqual({
            text: "old",
            linesBefore: "one",
            linesAfter: "three",
        })
    })

    it("handles a blank changed EOF line with no trailing newline metadata", () => {
        const fileDiff = parseSingleFile(`diff --git a/a.txt b/a.txt
index 0000000..1111111 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,2 @@
 first
-
\\ No newline at end of file
+
\\ No newline at end of file
`)

        expect(isLineInDiffHunks(fileDiff, 2, "additions")).toBe(true)
        expect(isLineInDiffHunks(fileDiff, 2, "deletions")).toBe(true)
        expect(extractSelectedTextFromDiff(fileDiff, 2, 2, "additions")).toEqual({
            text: "",
            linesBefore: "first",
            linesAfter: "",
        })
        expect(extractSelectedTextFromDiff(fileDiff, 2, 2, "deletions")).toEqual({
            text: "",
            linesBefore: "first",
            linesAfter: "",
        })
        expect(getFileDiffCopyContent(fileDiff)).toBe("first\n")

        const renderFileDiff = normalizeFileDiffForRender(fileDiff)
        expect(renderFileDiff).not.toBe(fileDiff)
        expect(renderFileDiff.additionLines[1]).toBe("\n")
        expect(renderFileDiff.deletionLines[1]).toBe("\n")
        expect(fileDiff.additionLines[1]).toBe("")
        expect(fileDiff.deletionLines[1]).toBe("")
    })
})
