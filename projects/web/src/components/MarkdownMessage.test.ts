import { describe, expect, it } from "vitest"
import {
    annotationBelongsToMarkdownBlock,
    getMarkdownSelectionRange,
    parseMarkdownBlocks,
    renderInlineMarkdownHtml,
    renderMarkdownHtml,
} from "./MarkdownMessage"

describe("MarkdownMessage", () => {
    it("uses markdown-it blocks for common markdown instead of a custom marker parser", () => {
        const blocks = parseMarkdownBlocks("# Title\n\n1. Step one\n2. Step two\n\n- [x] Completed task\n- [ ] Pending task\n\n> A blockquote.\n\n---")

        expect(blocks).toHaveLength(5)
        expect(blocks[0]).toMatchObject({ type: "rendered", startLine: 1, endLine: 1 })
        expect(blocks[0]?.type === "rendered" ? blocks[0].html : "").toContain("<h1>")
        expect(blocks[1]?.type === "rendered" ? blocks[1].html : "").toContain("<ol>")
        expect(blocks[2]?.type === "rendered" ? blocks[2].html : "").toContain('type="checkbox"')
        expect(blocks[3]?.type === "rendered" ? blocks[3].html : "").toContain("<blockquote>")
        expect(blocks[4]?.type === "rendered" ? blocks[4].html : "").toContain("<hr")
    })

    it("keeps fenced code as commentable blocks for syntax highlighting and copy", () => {
        expect(parseMarkdownBlocks("```ts\nconst x = 1\n```")).toEqual([
            { type: "code", language: "ts", text: "const x = 1\n", startLine: 1, endLine: 3, diagram: false },
        ])
    })

    it("routes diagram fences through the diagram renderer", () => {
        expect(parseMarkdownBlocks("```mermaid\nsequenceDiagram\nA->>B: hello\n```")).toEqual([
            { type: "code", language: "mermaid", text: "sequenceDiagram\nA->>B: hello\n", startLine: 1, endLine: 4, diagram: true },
        ])
    })

    it("renders links as external anchors and sanitizes raw html", () => {
        const inline = renderInlineMarkdownHtml("[OpenADE](https://openade.ai) and ~~done~~")
        const block = renderMarkdownHtml('<a href="javascript:alert(1)">bad</a><script>alert(1)</script>')

        expect(inline).toContain('href="https://openade.ai"')
        expect(inline).toContain('target="_blank"')
        expect(inline).toContain('rel="noopener noreferrer"')
        expect(inline).toContain("<s>done</s>")
        expect(block).not.toContain("javascript:")
        expect(block).not.toContain("<script")
    })

    it("auto-links plain local file references with optional line numbers", () => {
        const html = renderInlineMarkdownHtml(
            "Changed /Users/me/repo/projects/web/src/components/MarkdownMessage.tsx:42, README.md, featureFlags.ts, projects/web/src/remote, and openade.ai"
        )

        expect(html).toContain('data-openade-file-link="true"')
        expect(html).toContain('data-openade-file-path="/Users/me/repo/projects/web/src/components/MarkdownMessage.tsx"')
        expect(html).toContain('data-openade-file-line="42"')
        expect(html).toContain(".../web/src/components/MarkdownMessage.tsx:42")
        expect(html).toContain('data-openade-file-path="README.md"')
        expect(html).toContain('data-openade-file-path="featureFlags.ts"')
        expect(html).not.toContain('data-openade-file-path="projects/web/src/remote"')
        expect(html).not.toContain('href="http://featureFlags.ts"')
        expect(html).not.toContain('data-openade-file-path="openade.ai"')
        expect(html).toContain('href="http://openade.ai"')
    })

    it("does not auto-link slash-separated prose as directory references", () => {
        const html = renderInlineMarkdownHtml("Use expand/select, browser/new-window, and Unsupported/internal as prose.")

        expect(html).not.toContain('data-openade-file-link="true"')
        expect(html).not.toContain('href="#"')
    })

    it("keeps non-website markdown links internal so Electron does not open a popup", () => {
        const html = renderInlineMarkdownHtml("[RemoteApp](RemoteApp), [remote dir](projects/web/src/remote), and [OpenADE](https://openade.ai)")

        expect(html).toContain('data-openade-internal-link="true"')
        expect(html).toContain('data-openade-link-target="RemoteApp"')
        expect(html).toContain('data-openade-link-target="projects/web/src/remote"')
        expect(html).toContain('href="#"')
        expect(html).toContain('data-openade-external-link="true"')
        expect(html).toContain('href="https://openade.ai"')
    })

    it("links inline-code file paths but does not rewrite markdown link labels or directories", () => {
        const html = renderMarkdownHtml("`src/foo.ts:1`, `projects/web/src/remote`, `not a path`, and [src/bar.ts:2](https://openade.ai)")

        expect(html).toContain('data-openade-file-path="src/foo.ts"')
        expect(html).toContain('data-openade-file-line="1"')
        expect(html).not.toContain('data-openade-file-path="projects/web/src/remote"')
        expect(html).not.toContain('data-openade-file-path="src/bar.ts"')
        expect(html).toContain("<code>src/foo.ts:1</code>")
        expect(html).toContain("<code>projects/web/src/remote</code>")
        expect(html).toContain("<code>not a path</code>")
        expect(html).toContain('href="https://openade.ai"')
    })

    it("renders math formulas through KaTeX", () => {
        const html = renderMarkdownHtml("Inline $x^2$ and block:\n\n$$\ny = mx + b\n$$")

        expect(html).toContain("katex")
        expect(html).toContain("x")
        expect(html).toContain("y")
    })

    it("renders markdown tables as fixed layout html tables", () => {
        const blocks = parseMarkdownBlocks("| Name | Role |\n| --- | --- |\n| Ada | Engineer |")

        expect(blocks[0]?.type).toBe("rendered")
        expect(blocks[0]?.type === "rendered" ? blocks[0].html : "").toContain("<table>")
    })

    it("renders a multi-line markdown comment form only on the block containing the annotation line", () => {
        const firstBlock = { type: "rendered" as const, html: "first", startLine: 1, endLine: 2 }
        const secondBlock = { type: "rendered" as const, html: "second", startLine: 3, endLine: 4 }
        const selectionAnnotation = { lineNumber: 4, metadata: { startLine: 1, endLine: 4 } }

        expect(annotationBelongsToMarkdownBlock(selectionAnnotation, firstBlock)).toBe(false)
        expect(annotationBelongsToMarkdownBlock(selectionAnnotation, secondBlock)).toBe(true)
    })

    it("resolves a browser text selection to a multi-line markdown source range", () => {
        const container = document.createElement("div")
        container.innerHTML = `
            <span data-markdown-start="2" data-markdown-end="3">first block</span>
            <span data-markdown-start="4" data-markdown-end="6">second block</span>
        `
        document.body.appendChild(container)
        const range = document.createRange()
        const first = container.querySelector('[data-markdown-start="2"]')?.firstChild
        const second = container.querySelector('[data-markdown-start="4"]')?.firstChild
        if (!first || !second) throw new Error("Missing test blocks")
        range.setStart(first, 2)
        range.setEnd(second, 5)

        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)

        expect(getMarkdownSelectionRange(container, selection)).toEqual({
            start: 2,
            end: 6,
            side: "additions",
        })

        selection?.removeAllRanges()
        container.remove()
    })
})
