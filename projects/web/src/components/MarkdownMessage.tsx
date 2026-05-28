import type { AnnotationSide } from "@pierre/diffs"
import cx from "classnames"
import { MessageSquarePlus } from "lucide-react"
import { observer } from "mobx-react"
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { codeToTokens } from "shiki/bundle/web"
import type { BundledLanguage, SpecialLanguage } from "shiki/bundle/web"
import type { CommentSelectedText } from "../types"
import { useCommentAnnotations } from "./comments/hooks/useCommentAnnotations"
import { extractSelectedText } from "./comments/utils"
import type { CommentHandlers } from "./FilesAndDiffs"
import { formatMarkdownTables } from "./utils/markdownTableFormatter"

export type MarkdownBlock =
    | { type: "heading"; level: number; text: string; startLine: number; endLine: number }
    | { type: "paragraph"; text: string; startLine: number; endLine: number }
    | { type: "list"; items: string[]; startLine: number; endLine: number }
    | { type: "table"; text: string; startLine: number; endLine: number }
    | { type: "code"; language?: string; text: string; startLine: number; endLine: number }

type HighlightedCodeLine = {
    content: string
    color?: string
    fontStyle?: number
}[]

const highlightedCodeCache = new Map<string, Promise<HighlightedCodeLine[]>>()

function flushParagraph(blocks: MarkdownBlock[], lines: string[], startLine: number): void {
    if (lines.length === 0) return
    blocks.push({
        type: "paragraph",
        text: lines.join("\n"),
        startLine,
        endLine: startLine + lines.length - 1,
    })
}

function isMarkdownTableRow(line: string): boolean {
    return line.trim().includes("|")
}

function isMarkdownTableSeparator(line: string): boolean {
    const trimmed = line.trim()
    return trimmed.includes("|") && trimmed.includes("-") && /^[\s|:\-]+$/.test(trimmed)
}

function normalizeCodeLanguage(language?: string): string {
    switch (language?.toLowerCase()) {
        case "js":
            return "javascript"
        case "jsx":
            return "jsx"
        case "ts":
            return "typescript"
        case "tsx":
            return "tsx"
        case "py":
            return "python"
        case "sh":
        case "zsh":
        case "shell":
            return "bash"
        case "yml":
            return "yaml"
        case "md":
            return "markdown"
        default:
            return language || "text"
    }
}

function normalizeShikiTheme(theme: string): string {
    switch (theme) {
        case "light-plus":
            return "light-plus"
        case "tokyo-night":
            return "tokyo-night"
        case "dracula":
            return "dracula"
        case "pierre-light":
        case "atom-one-light":
            return "github-light"
        case "pierre-dark":
        default:
            return "dark-plus"
    }
}

function getHighlightedCodeLines(code: string, language: string | undefined, theme: string): Promise<HighlightedCodeLine[]> {
    const normalizedLanguage = normalizeCodeLanguage(language) as BundledLanguage | SpecialLanguage
    const normalizedTheme = normalizeShikiTheme(theme)
    const cacheKey = `${normalizedTheme}\0${normalizedLanguage}\0${code}`
    const cached = highlightedCodeCache.get(cacheKey)
    if (cached) return cached

    const highlighted = codeToTokens(code, {
        lang: normalizedLanguage,
        theme: normalizedTheme,
    })
        .then((result) => result.tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color, fontStyle: token.fontStyle }))))
        .catch(async () => {
            const result = await codeToTokens(code, {
                lang: "text",
                theme: normalizedTheme,
            })
            return result.tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color, fontStyle: token.fontStyle })))
        })

    highlightedCodeCache.set(cacheKey, highlighted)
    return highlighted
}

function tokenStyle(token: HighlightedCodeLine[number]): CSSProperties {
    return {
        color: token.color,
        fontStyle: token.fontStyle && (token.fontStyle & 1) !== 0 ? "italic" : undefined,
        fontWeight: token.fontStyle && (token.fontStyle & 2) !== 0 ? 600 : undefined,
        textDecoration: token.fontStyle && (token.fontStyle & 4) !== 0 ? "underline" : undefined,
    }
}

function useShikiTheme(ref: React.RefObject<HTMLElement | null>): string {
    const [theme, setTheme] = useState("pierre-dark")

    useEffect(() => {
        const el = ref.current
        if (!el) return

        const updateTheme = () => {
            const computed = getComputedStyle(el).getPropertyValue("--editor-theme").trim()
            setTheme(computed || "pierre-dark")
        }

        updateTheme()

        const themeAncestor = el.closest(".code-theme")
        if (!themeAncestor) return

        const observer = new MutationObserver(updateTheme)
        observer.observe(themeAncestor, {
            attributes: true,
            attributeFilter: ["class"],
        })

        return () => observer.disconnect()
    }, [ref])

    return theme
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
    const sourceLines = markdown.split("\n")
    const blocks: MarkdownBlock[] = []
    let paragraphLines: string[] = []
    let paragraphStartLine = 1
    let index = 0

    while (index < sourceLines.length) {
        const line = sourceLines[index]
        const lineNumber = index + 1
        const fence = line.match(/^```(\S*)\s*$/)

        if (fence) {
            flushParagraph(blocks, paragraphLines, paragraphStartLine)
            paragraphLines = []
            const codeLines: string[] = []
            const codeStartLine = lineNumber + 1
            index++
            while (index < sourceLines.length && !sourceLines[index].startsWith("```")) {
                codeLines.push(sourceLines[index])
                index++
            }
            blocks.push({
                type: "code",
                language: fence[1] || undefined,
                text: codeLines.join("\n"),
                startLine: codeStartLine,
                endLine: Math.max(codeStartLine, codeStartLine + codeLines.length - 1),
            })
            index++
            continue
        }

        if (!line.trim()) {
            flushParagraph(blocks, paragraphLines, paragraphStartLine)
            paragraphLines = []
            index++
            continue
        }

        if (isMarkdownTableRow(line) && isMarkdownTableSeparator(sourceLines[index + 1] ?? "")) {
            flushParagraph(blocks, paragraphLines, paragraphStartLine)
            paragraphLines = []
            const tableLines = [line, sourceLines[index + 1]]
            const startLine = lineNumber
            index += 2
            while (index < sourceLines.length && isMarkdownTableRow(sourceLines[index]) && !isMarkdownTableSeparator(sourceLines[index])) {
                tableLines.push(sourceLines[index])
                index++
            }
            blocks.push({
                type: "table",
                text: formatMarkdownTables(tableLines.join("\n")),
                startLine,
                endLine: startLine + tableLines.length - 1,
            })
            continue
        }

        const heading = line.match(/^(#{1,6})\s+(.+)$/)
        if (heading) {
            flushParagraph(blocks, paragraphLines, paragraphStartLine)
            paragraphLines = []
            blocks.push({ type: "heading", level: heading[1].length, text: heading[2], startLine: lineNumber, endLine: lineNumber })
            index++
            continue
        }

        if (/^\s*[-*]\s+/.test(line)) {
            flushParagraph(blocks, paragraphLines, paragraphStartLine)
            paragraphLines = []
            const items: string[] = []
            const startLine = lineNumber
            while (index < sourceLines.length && /^\s*[-*]\s+/.test(sourceLines[index])) {
                items.push(sourceLines[index].replace(/^\s*[-*]\s+/, ""))
                index++
            }
            blocks.push({ type: "list", items, startLine, endLine: index })
            continue
        }

        if (paragraphLines.length === 0) paragraphStartLine = lineNumber
        paragraphLines.push(line)
        index++
    }

    flushParagraph(blocks, paragraphLines, paragraphStartLine)
    return blocks
}

function renderInline(text: string): ReactNode[] {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    return parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
            return (
                <code key={index} className="rounded-sm bg-base-200 px-1 py-0.5 font-mono text-[0.9em]">
                    {part.slice(1, -1)}
                </code>
            )
        }
        if (part.startsWith("**") && part.endsWith("**")) {
            return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        return part
    })
}

function lineClass(lineNumber: number, selectedRange: { start: number; end: number } | null): string {
    const selectedStart = selectedRange ? Math.min(selectedRange.start, selectedRange.end) : null
    const selectedEnd = selectedRange ? Math.max(selectedRange.start, selectedRange.end) : null
    return cx(
        "rounded-sm px-0.5",
        selectedStart !== null && selectedEnd !== null && lineNumber >= selectedStart && lineNumber <= selectedEnd && "bg-primary/10"
    )
}

function lineProps(lineNumber: number, selectedRange: { start: number; end: number } | null) {
    return {
        "data-markdown-line": lineNumber,
        className: lineClass(lineNumber, selectedRange),
    }
}

function HighlightedCodeBlock({ block, selectedRange }: { block: Extract<MarkdownBlock, { type: "code" }>; selectedRange: { start: number; end: number } | null }) {
    const ref = useRef<HTMLPreElement | null>(null)
    const theme = useShikiTheme(ref)
    const codeLines = useMemo(() => block.text.split("\n"), [block.text])
    const [highlightedLines, setHighlightedLines] = useState<HighlightedCodeLine[] | null>(null)

    useEffect(() => {
        let cancelled = false
        setHighlightedLines(null)
        getHighlightedCodeLines(block.text, block.language, theme).then((lines) => {
            if (!cancelled) setHighlightedLines(lines)
        })
        return () => {
            cancelled = true
        }
    }, [block.language, block.text, theme])

    const lines = highlightedLines ?? codeLines.map((line) => [{ content: line || " " }])

    return (
        <pre ref={ref} className="my-2 overflow-x-auto border border-border bg-base-200 p-3 font-mono text-sm leading-6">
            <code>
                {lines.map((line, index) => {
                    const props = lineProps(block.startLine + index, selectedRange)
                    return (
                        <span key={index} {...props} className={cx(props.className, "block min-h-4 whitespace-pre")}>
                            {line.length === 0
                                ? " "
                                : line.map((token, tokenIndex) => (
                                      <span key={tokenIndex} style={tokenStyle(token)}>
                                          {token.content}
                                      </span>
                                  ))}
                        </span>
                    )
                })}
            </code>
        </pre>
    )
}

function MarkdownTableBlock({ block, selectedRange }: { block: Extract<MarkdownBlock, { type: "table" }>; selectedRange: { start: number; end: number } | null }) {
    const tableLines = block.text.split("\n")
    return (
        <pre className="my-2 overflow-x-auto border border-border bg-base-200 p-3 font-mono text-sm leading-6">
            <code>
                {tableLines.map((line, index) => {
                    const props = lineProps(block.startLine + index, selectedRange)
                    return (
                        <span key={index} {...props} className={cx(props.className, "block min-h-4 whitespace-pre")}>
                            {line || " "}
                        </span>
                    )
                })}
            </code>
        </pre>
    )
}

function MarkdownBlockView({ block, selectedRange = null }: { block: MarkdownBlock; selectedRange?: { start: number; end: number } | null }) {
    switch (block.type) {
        case "heading": {
            const Tag = `h${Math.min(block.level + 1, 6)}` as keyof JSX.IntrinsicElements
            return (
                <Tag className="mt-2 mb-1 font-semibold text-base-content">
                    <span {...lineProps(block.startLine, selectedRange)}>{renderInline(block.text)}</span>
                </Tag>
            )
        }
        case "list":
            return (
                <ul className="my-2 list-disc pl-5">
                    {block.items.map((item, index) => (
                        <li key={index}>
                            <span {...lineProps(block.startLine + index, selectedRange)}>{renderInline(item)}</span>
                        </li>
                    ))}
                </ul>
            )
        case "code":
            return <HighlightedCodeBlock block={block} selectedRange={selectedRange} />
        case "table":
            return <MarkdownTableBlock block={block} selectedRange={selectedRange} />
        case "paragraph": {
            const lines = block.text.split("\n")
            return (
                <p className="my-2 whitespace-pre-wrap leading-6">
                    {lines.map((line, index) => (
                        <span key={index} {...lineProps(block.startLine + index, selectedRange)}>
                            {renderInline(line)}
                            {index < lines.length - 1 ? "\n" : null}
                        </span>
                    ))}
                </p>
            )
        }
    }
}

function getLineNumber(element: Element): number | null {
    const value = element.getAttribute("data-markdown-line")
    if (!value) return null
    const line = Number(value)
    return Number.isInteger(line) ? line : null
}

export function getMarkdownSelectionRange(container: Element, selection: Selection | null): { start: number; end: number; side: AnnotationSide } | null {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    if (!range.intersectsNode(container)) return null

    const lines = Array.from(container.querySelectorAll<HTMLElement>("[data-markdown-line]"))
        .filter((line) => range.intersectsNode(line))
        .map(getLineNumber)
        .filter((line): line is number => line !== null)

    if (lines.length === 0) return null
    return {
        start: Math.min(...lines),
        end: Math.max(...lines),
        side: "additions",
    }
}

export function annotationBelongsToMarkdownBlock(annotation: { lineNumber: number }, block: MarkdownBlock): boolean {
    return annotation.lineNumber >= block.startLine && annotation.lineNumber <= block.endLine
}

function MarkdownMessageStatic({ text }: { text: string }) {
    const blocks = useMemo(() => parseMarkdownBlocks(text), [text])
    return (
        <div className="border border-border bg-base-100 px-3 py-2 font-sans text-sm leading-6">
            {blocks.map((block, index) => (
                <MarkdownBlockView key={`${block.startLine}-${index}`} block={block} />
            ))}
        </div>
    )
}

const CommentableMarkdownMessage = observer(function CommentableMarkdownMessage({
    text,
    commentHandlers,
}: {
    text: string
    commentHandlers: CommentHandlers
}) {
    const blocks = useMemo(() => parseMarkdownBlocks(text), [text])
    const contentDeps = useMemo(() => [text], [text])

    const getSelectedText = useCallback(
        (lineStart: number, lineEnd: number, _side: AnnotationSide): CommentSelectedText => extractSelectedText(text, lineStart, lineEnd),
        [text]
    )

    const annotations = useCommentAnnotations({
        taskId: commentHandlers.taskId,
        sourceMatch: commentHandlers.sourceMatch,
        createSource: commentHandlers.createSource,
        getSelectedText,
        contentDeps,
        isDiffView: false,
        defaultSide: "additions",
        readOnly: commentHandlers.readOnly,
    })

    const selectBlock = (block: MarkdownBlock) => {
        if (commentHandlers.readOnly) return
        annotations.handleLineSelectionEnd({ start: block.startLine, end: block.endLine, side: "additions" })
    }

    const handleSelection = (event: React.MouseEvent<HTMLDivElement>) => {
        if (commentHandlers.readOnly || annotations.hasOpenForm) return
        const range = getMarkdownSelectionRange(event.currentTarget, window.getSelection())
        if (!range) return
        annotations.handleLineSelectionEnd(range)
        window.getSelection()?.removeAllRanges()
    }

    return (
        <div className="group/markdown-message border border-border bg-base-100 px-3 py-2 font-sans text-sm leading-6" onMouseUp={handleSelection}>
            {blocks.map((block, index) => {
                const blockAnnotations = annotations.lineAnnotations.filter((annotation) => annotationBelongsToMarkdownBlock(annotation, block))
                return (
                    <div key={`${block.startLine}-${index}`} className="group/markdown-block relative -ml-6 pl-6">
                        <div onDoubleClick={() => selectBlock(block)}>
                            <MarkdownBlockView block={block} selectedRange={annotations.selectedRange} />
                        </div>
                        {!commentHandlers.readOnly && (
                            <button
                                type="button"
                                className="group/comment-button absolute left-0 inset-y-0 z-10 flex w-6 -translate-x-1/2 items-start justify-center bg-transparent pt-1.5 pointer-events-auto text-muted focus:outline-none"
                                aria-label={`Comment lines ${block.startLine}-${block.endLine}`}
                                onClick={() => selectBlock(block)}
                            >
                                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-base-100/95 opacity-0 shadow-sm transition-opacity group-hover/markdown-block:opacity-100 group-hover/comment-button:opacity-100 group-focus-within/markdown-block:opacity-100 group-focus-visible/comment-button:opacity-100 group-hover/comment-button:bg-primary group-hover/comment-button:text-primary-content group-focus-visible/comment-button:bg-primary group-focus-visible/comment-button:text-primary-content">
                                    <MessageSquarePlus size={12} />
                                </span>
                            </button>
                        )}
                        {blockAnnotations?.map((annotation) => (
                            <div key={annotation.metadata.id ?? "new"} className="my-2">
                                {annotations.renderAnnotation(annotation)}
                            </div>
                        ))}
                    </div>
                )
            })}
        </div>
    )
})

export const MarkdownMessage = observer(function MarkdownMessage({
    text,
    commentHandlers,
}: {
    text: string
    commentHandlers: CommentHandlers | null
}) {
    if (!commentHandlers) return <MarkdownMessageStatic text={text} />
    return <CommentableMarkdownMessage text={text} commentHandlers={commentHandlers} />
})
