import { describe, expect, it } from "vitest"
import { hasMarkdown } from "./MarkdownPreview"

describe("hasMarkdown detection", () => {
    it("detects ATX headings", () => {
        expect(hasMarkdown("# Overview\n\nbody")).toBe(true)
        expect(hasMarkdown("###### deep heading")).toBe(true)
    })

    it("detects fenced code blocks", () => {
        expect(hasMarkdown("here is code\n```ts\nconst x = 1\n```")).toBe(true)
    })

    it("detects bold spans", () => {
        expect(hasMarkdown("this is **bold** text")).toBe(true)
    })

    it("detects unordered lists", () => {
        expect(hasMarkdown("- first\n- second")).toBe(true)
        expect(hasMarkdown("* star list")).toBe(true)
    })

    it("detects ordered lists", () => {
        expect(hasMarkdown("1. first\n2. second")).toBe(true)
    })

    it("detects tables", () => {
        expect(hasMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true)
    })

    it("detects blockquotes", () => {
        expect(hasMarkdown("> quoted line")).toBe(true)
    })

    it("rejects plain prose without markers", () => {
        expect(hasMarkdown("Just a single sentence response.")).toBe(false)
        expect(hasMarkdown("Two lines of\nplain prose with no special chars.")).toBe(false)
    })

    it("does not confuse hyphenated words for list items", () => {
        expect(hasMarkdown("Use the worker-thread to offload work.")).toBe(false)
    })
})
