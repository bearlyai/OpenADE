import type { AnnotationSide } from "@pierre/diffs"
import type { ParsedPatch } from "@pierre/diffs/react"
import type { CommentSelectedText } from "../../types"

/** Number of context lines to include before/after selection */
const CONTEXT_LINES = 5

type FileDiff = ParsedPatch["files"][number]
type HunkContent = FileDiff["hunks"][number]["hunkContent"][number]
type DiffLine = { lineNumber: number; content: string }
type LegacyContextContent = { type: "context"; lines: string[] }
type LegacyChangeContent = { type: "change"; deletions: string[]; additions: string[] }

function stripTrailingLineEnding(line: string): string {
    return line.replace(/\r?\n$/, "")
}

function isLegacyContextContent(content: HunkContent): content is HunkContent & LegacyContextContent {
    return content.type === "context" && Array.isArray((content as { lines?: unknown }).lines)
}

function isLegacyChangeContent(content: HunkContent): content is HunkContent & LegacyChangeContent {
    return (
        content.type === "change" &&
        Array.isArray((content as { additions?: unknown }).additions) &&
        Array.isArray((content as { deletions?: unknown }).deletions)
    )
}

function getSideLines(fileDiff: FileDiff, side: AnnotationSide): string[] {
    const diff = fileDiff as FileDiff & {
        additionLines?: string[]
        deletionLines?: string[]
        newLines?: string[]
        oldLines?: string[]
    }
    const lines = side === "additions" ? (diff.additionLines ?? diff.newLines) : (diff.deletionLines ?? diff.oldLines)
    return Array.isArray(lines) ? lines : []
}

function pushDiffLine(lines: DiffLine[], lineNumber: number, content: string | undefined) {
    lines.push({ lineNumber, content: stripTrailingLineEnding(content ?? "") })
}

export function getFileDiffCopyContent(fileDiff: FileDiff): string {
    return getSideLines(fileDiff, "additions").join("")
}

export function normalizeFileDiffForRender(fileDiff: FileDiff): FileDiff {
    const diff = fileDiff as FileDiff & {
        additionLines?: string[]
        deletionLines?: string[]
    }
    let changed = false

    const normalizeLines = (lines: string[] | undefined) => {
        if (!Array.isArray(lines)) return lines

        let normalized: string[] | undefined
        for (let index = 0; index < lines.length; index++) {
            if (lines[index] !== "") continue
            normalized ??= lines.slice()
            normalized[index] = "\n"
        }

        if (normalized) {
            changed = true
            return normalized
        }

        return lines
    }

    const additionLines = normalizeLines(diff.additionLines)
    const deletionLines = normalizeLines(diff.deletionLines)

    if (!changed) return fileDiff
    return {
        ...fileDiff,
        additionLines,
        deletionLines,
    } as FileDiff
}

/**
 * Check if a line number is visible within the diff hunks.
 * This prevents errors when comments reference lines outside the diff's visible range.
 */
export function isLineInDiffHunks(fileDiff: FileDiff, lineNumber: number, side: AnnotationSide): boolean {
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
export function extractSelectedTextFromDiff(fileDiff: FileDiff, lineStart: number, lineEnd: number, side: AnnotationSide): CommentSelectedText {
    // Collect all lines from the appropriate side
    const lines: DiffLine[] = []
    const additionLines = getSideLines(fileDiff, "additions")
    const deletionLines = getSideLines(fileDiff, "deletions")

    for (const hunk of fileDiff.hunks) {
        let additionLineNum = hunk.additionStart
        let deletionLineNum = hunk.deletionStart

        for (const content of hunk.hunkContent) {
            if (content.type === "context") {
                if (isLegacyContextContent(content)) {
                    // Context lines exist on both sides
                    for (const line of content.lines) {
                        if (side === "additions") {
                            pushDiffLine(lines, additionLineNum, line)
                            additionLineNum++
                        } else {
                            pushDiffLine(lines, deletionLineNum, line)
                            deletionLineNum++
                        }
                    }
                    // Context advances both counters
                    if (side === "additions") {
                        deletionLineNum += content.lines.length
                    } else {
                        additionLineNum += content.lines.length
                    }
                } else {
                    const lineCount = content.lines
                    const sourceLines = side === "additions" ? additionLines : deletionLines
                    const sourceIndex = side === "additions" ? content.additionLineIndex : content.deletionLineIndex

                    for (let index = 0; index < lineCount; index++) {
                        if (side === "additions") {
                            pushDiffLine(lines, additionLineNum, sourceLines[sourceIndex + index])
                            additionLineNum++
                        } else {
                            pushDiffLine(lines, deletionLineNum, sourceLines[sourceIndex + index])
                            deletionLineNum++
                        }
                    }

                    if (side === "additions") {
                        deletionLineNum += lineCount
                    } else {
                        additionLineNum += lineCount
                    }
                }
            } else if (content.type === "change") {
                if (isLegacyChangeContent(content)) {
                    // Deletions only appear on old side
                    if (side === "deletions") {
                        for (const line of content.deletions) {
                            pushDiffLine(lines, deletionLineNum, line)
                            deletionLineNum++
                        }
                    }
                    // Additions only appear on new side
                    if (side === "additions") {
                        for (const line of content.additions) {
                            pushDiffLine(lines, additionLineNum, line)
                            additionLineNum++
                        }
                    }

                    // Advance the counters for the side we didn't process
                    if (side === "additions") {
                        deletionLineNum += content.deletions.length
                    } else {
                        additionLineNum += content.additions.length
                    }
                } else {
                    const sourceLines = side === "additions" ? additionLines : deletionLines
                    const lineCount = side === "additions" ? content.additions : content.deletions
                    const sourceIndex = side === "additions" ? content.additionLineIndex : content.deletionLineIndex

                    for (let index = 0; index < lineCount; index++) {
                        if (side === "additions") {
                            pushDiffLine(lines, additionLineNum, sourceLines[sourceIndex + index])
                            additionLineNum++
                        } else {
                            pushDiffLine(lines, deletionLineNum, sourceLines[sourceIndex + index])
                            deletionLineNum++
                        }
                    }

                    if (side === "additions") {
                        deletionLineNum += content.deletions
                    } else {
                        additionLineNum += content.additions
                    }
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
