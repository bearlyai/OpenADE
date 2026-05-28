import { describe, expect, it } from "vitest"
import {
    annotationBelongsToMarkdownBlock,
    getMarkdownSelectionRange,
    parseMarkdownBlocks,
} from "./MarkdownMessage"

describe("parseMarkdownBlocks", () => {
    it("parses headings, list items, code fences, and paragraphs with source line ranges", () => {
        expect(parseMarkdownBlocks("# Title\n\n- one\n- two\n\n```ts\nconst x = 1\n```\n\nDone")).toEqual([
            { type: "heading", level: 1, text: "Title", startLine: 1, endLine: 1 },
            { type: "list", items: ["one", "two"], startLine: 3, endLine: 4 },
            { type: "code", language: "ts", text: "const x = 1", startLine: 7, endLine: 7 },
            { type: "paragraph", text: "Done", startLine: 10, endLine: 10 },
        ])
    })

    it("renders a multi-line markdown comment form only on the block containing the annotation line", () => {
        const firstBlock = { type: "paragraph" as const, text: "first", startLine: 1, endLine: 2 }
        const secondBlock = { type: "paragraph" as const, text: "second", startLine: 3, endLine: 4 }
        const selectionAnnotation = { lineNumber: 4, metadata: { startLine: 1, endLine: 4 } }

        expect(annotationBelongsToMarkdownBlock(selectionAnnotation, firstBlock)).toBe(false)
        expect(annotationBelongsToMarkdownBlock(selectionAnnotation, secondBlock)).toBe(true)
    })

    it("resolves a browser text selection to a multi-line markdown source range", () => {
        const container = document.createElement("div")
        container.innerHTML = `
            <span data-markdown-line="2">first line</span>
            <span data-markdown-line="3">second line</span>
            <span data-markdown-line="4">third line</span>
        `
        document.body.appendChild(container)
        const range = document.createRange()
        const first = container.querySelector('[data-markdown-line="2"]')?.firstChild
        const third = container.querySelector('[data-markdown-line="4"]')?.firstChild
        if (!first || !third) throw new Error("Missing test lines")
        range.setStart(first, 2)
        range.setEnd(third, 5)

        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)

        expect(getMarkdownSelectionRange(container, selection)).toEqual({
            start: 2,
            end: 4,
            side: "additions",
        })

        selection?.removeAllRanges()
        container.remove()
    })
})
