import type { AnnotationSide } from "@pierre/diffs"
import type { ParsedPatch } from "@pierre/diffs/react"
import type { CommentSelectedText } from "../../types"

/** Number of context lines to include before/after selection */
const CONTEXT_LINES = 5

/**
 * Check if a line number is visible within the diff hunks.
 * This prevents errors when comments reference lines outside the diff's visible range.
 */
export function isLineInDiffHunks(fileDiff: ParsedPatch["files"][number], lineNumber: number, side: AnnotationSide): boolean {
    for (const hunk of fileDiff.hunks) {
        if (side === "additions") {
            // Check if line is within addition range (new file)
            const start = hunk.additionStart
            const end = hunk.additionStart + hunk.additionCount - 1
            if (lineNumber >= start && lineNumber <= end) {
                return true
            }
        } else {
            // Check if line is within deletion range (old file)
            const start = hunk.deletionStart
            const end = hunk.deletionStart + hunk.deletionCount - 1
            if (lineNumber >= start && lineNumber <= end) {
                return true
            }
        }
    }
    return false
}

/**
 * Extract selected text with surrounding context from file contents.
 * Line numbers are 1-based.
 */
export function extractSelectedText(contents: string, lineStart: number, lineEnd: number): CommentSelectedText {
    const lines = contents.split("\n")

    // Convert to 0-based indices
    const startIdx = Math.max(0, lineStart - 1)
    const endIdx = Math.min(lines.length - 1, lineEnd - 1)

    // Extract selected text
    const text = lines.slice(startIdx, endIdx + 1).join("\n")

    // Extract context before
    const beforeStartIdx = Math.max(0, startIdx - CONTEXT_LINES)
    const linesBefore = lines.slice(beforeStartIdx, startIdx).join("\n")

    // Extract context after
    const afterEndIdx = Math.min(lines.length, endIdx + 1 + CONTEXT_LINES)
    const linesAfter = lines.slice(endIdx + 1, afterEndIdx).join("\n")

    return { text, linesBefore, linesAfter }
}

/**
 * Extract selected text from a diff.
 * For diffs, we extract from the appropriate side (additions = new file, deletions = old file).
 * Line numbers reference the original/new file line numbers within the diff.
 */
export function extractSelectedTextFromDiff(
    fileDiff: ParsedPatch["files"][number],
    lineStart: number,
    lineEnd: number,
    side: AnnotationSide
): CommentSelectedText {
    // Collect all lines from the appropriate side
    const lines: Array<{ lineNumber: number; content: string }> = []

    for (const hunk of fileDiff.hunks) {
        let additionLineNum = hunk.additionStart
        let deletionLineNum = hunk.deletionStart

        for (const content of hunk.hunkContent) {
            if (content.type === "context") {
                // Context lines exist on both sides
                for (const line of content.lines) {
                    if (side === "additions") {
                        lines.push({ lineNumber: additionLineNum, content: line })
                        additionLineNum++
                    } else {
                        lines.push({ lineNumber: deletionLineNum, content: line })
                        deletionLineNum++
                    }
                }
                // Context advances both counters
                if (side === "additions") {
                    deletionLineNum += content.lines.length
                } else {
                    additionLineNum += content.lines.length
                }
            } else if (content.type === "change") {
                // Deletions only appear on old side
                if (side === "deletions") {
                    for (const line of content.deletions) {
                        lines.push({ lineNumber: deletionLineNum, content: line })
                        deletionLineNum++
                    }
                }
                // Additions only appear on new side
                if (side === "additions") {
                    for (const line of content.additions) {
                        lines.push({ lineNumber: additionLineNum, content: line })
                        additionLineNum++
                    }
                }
                // Advance the counters for the side we didn't process
                if (side === "additions") {
                    deletionLineNum += content.deletions.length
                } else {
                    additionLineNum += content.additions.length
                }
            }
        }
    }

    // Sort by line number (should already be sorted, but just in case)
    lines.sort((a, b) => a.lineNumber - b.lineNumber)

    // Find selected lines
    const selectedLines = lines.filter((l) => l.lineNumber >= lineStart && l.lineNumber <= lineEnd)
    const text = selectedLines.map((l) => l.content).join("\n")

    // Find context before (lines with lineNumber < lineStart, take last CONTEXT_LINES)
    const beforeLines = lines.filter((l) => l.lineNumber < lineStart).slice(-CONTEXT_LINES)
    const linesBefore = beforeLines.map((l) => l.content).join("\n")

    // Find context after (lines with lineNumber > lineEnd, take first CONTEXT_LINES)
    const afterLines = lines.filter((l) => l.lineNumber > lineEnd).slice(0, CONTEXT_LINES)
    const linesAfter = afterLines.map((l) => l.content).join("\n")

    return { text, linesBefore, linesAfter }
}
