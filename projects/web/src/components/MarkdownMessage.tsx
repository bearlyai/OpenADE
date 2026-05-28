import type { AnnotationSide } from "@pierre/diffs"
import cx from "classnames"
import DOMPurify from "dompurify"
import katex from "katex"
import "katex/dist/katex.min.css"
import { Check, Copy, MessageSquarePlus } from "lucide-react"
import MarkdownIt from "markdown-it"
import taskLists from "markdown-it-task-lists"
import texmath from "markdown-it-texmath"
import mermaid from "mermaid"
import { observer } from "mobx-react"
import { type CSSProperties, type MouseEvent, type MouseEventHandler, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { codeToTokens } from "shiki/bundle/web"
import type { BundledLanguage, SpecialLanguage } from "shiki/bundle/web"
import { openUrlInNativeBrowser } from "../electronAPI/shell"
import type { CommentSelectedText } from "../types"
import { useCommentAnnotations } from "./comments/hooks/useCommentAnnotations"
import { extractSelectedText } from "./comments/utils"
import type { CommentHandlers } from "./FilesAndDiffs"
import { getExternalUrlToOpen } from "../utils/externalLinks"

type HighlightedCodeLine = {
    content: string
    color?: string
    fontStyle?: number
}[]

export type MarkdownBlock =
    | { type: "rendered"; html: string; startLine: number; endLine: number }
    | { type: "code"; language?: string; text: string; startLine: number; endLine: number; diagram: boolean }

type MarkdownToken = ReturnType<MarkdownIt["parse"]>[number]

const highlightedCodeCache = new Map<string, Promise<HighlightedCodeLine[]>>()
let mermaidDiagramId = 0

const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
})
    .use(taskLists, { enabled: false, label: true })
    .use(texmath, {
        engine: katex,
        delimiters: "dollars",
        katexOptions: {
            throwOnError: false,
        },
    })

const defaultLinkOpenRule = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index]
    token.attrSet("target", "_blank")
    token.attrSet("rel", "noopener noreferrer")
    token.attrSet("data-openade-external-link", "true")
    token.attrJoin("class", "text-primary underline underline-offset-2 hover:opacity-80")
    return defaultLinkOpenRule ? defaultLinkOpenRule(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
}

function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        ADD_ATTR: ["target", "data-openade-external-link", "class"],
    })
}

export function renderMarkdownHtml(text: string): string {
    return sanitizeHtml(markdown.render(text))
}

export function renderInlineMarkdownHtml(text: string): string {
    return sanitizeHtml(markdown.renderInline(text))
}

function normalizeCodeLanguage(language?: string): string {
    switch (language?.toLowerCase()) {
        case "js":
            return "javascript"
        case "ts":
            return "typescript"
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

function useEditorTheme(ref: React.RefObject<HTMLElement | null>): string {
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

function markdownLineRange(block: MarkdownBlock): { start: number; end: number } {
    return { start: block.startLine, end: block.endLine }
}

function rangeClass(startLine: number, endLine: number, selectedRange: { start: number; end: number } | null): string {
    const selectedStart = selectedRange ? Math.min(selectedRange.start, selectedRange.end) : null
    const selectedEnd = selectedRange ? Math.max(selectedRange.start, selectedRange.end) : null
    return cx(
        "rounded-sm px-0.5",
        selectedStart !== null && selectedEnd !== null && endLine >= selectedStart && startLine <= selectedEnd && "bg-primary/10"
    )
}

function rangeProps(startLine: number, endLine: number, selectedRange: { start: number; end: number } | null) {
    return {
        "data-markdown-start": startLine,
        "data-markdown-end": endLine,
        "data-markdown-line": startLine,
        className: rangeClass(startLine, endLine, selectedRange),
    }
}

function tokenLineRange(tokens: MarkdownToken[]): { startLine: number; endLine: number } {
    const ranges = tokens.map((token) => token.map).filter((map): map is [number, number] => Array.isArray(map))
    if (ranges.length === 0) return { startLine: 1, endLine: 1 }
    return {
        startLine: Math.min(...ranges.map((range) => range[0])) + 1,
        endLine: Math.max(...ranges.map((range) => range[1])),
    }
}

function renderTokens(tokens: MarkdownToken[]): string {
    return sanitizeHtml(markdown.renderer.render(tokens, markdown.options, {}))
}

function isDiagramLanguage(language: string | undefined, text: string): boolean {
    const normalized = language?.toLowerCase()
    return (
        normalized === "mermaid" ||
        normalized === "sequence" ||
        normalized === "sequencediagram" ||
        /^\s*(sequenceDiagram|flowchart|graph|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b/.test(text)
    )
}

function collectTopLevelBlock(tokens: MarkdownToken[], startIndex: number): { tokens: MarkdownToken[]; nextIndex: number } {
    const first = tokens[startIndex]
    if (!first || first.nesting !== 1) return { tokens: [first], nextIndex: startIndex + 1 }

    let depth = 1
    let endIndex = startIndex + 1
    while (endIndex < tokens.length && depth > 0) {
        depth += tokens[endIndex].nesting
        endIndex++
    }

    return { tokens: tokens.slice(startIndex, endIndex), nextIndex: endIndex }
}

export function parseMarkdownBlocks(markdownText: string): MarkdownBlock[] {
    const tokens = markdown.parse(markdownText, {})
    const blocks: MarkdownBlock[] = []
    let index = 0

    while (index < tokens.length) {
        const token = tokens[index]
        if (!token) break

        if (token.type === "fence" || token.type === "code_block") {
            const language = token.info.trim().split(/\s+/)[0] || undefined
            const range = token.map ? { startLine: token.map[0] + 1, endLine: token.map[1] } : { startLine: 1, endLine: 1 }
            blocks.push({
                type: "code",
                language,
                text: token.content,
                ...range,
                diagram: isDiagramLanguage(language, token.content),
            })
            index++
            continue
        }

        const block = collectTopLevelBlock(tokens, index)
        const range = tokenLineRange(block.tokens)
        const html = renderTokens(block.tokens)
        if (html.trim()) {
            blocks.push({ type: "rendered", html, ...range })
        }
        index = block.nextIndex
    }

    return blocks
}

function CopyButton({ content, label = "Copy", className }: { content: string; label?: string; className?: string }) {
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        await navigator.clipboard.writeText(content)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
    }

    return (
        <button
            type="button"
            className={cx("btn flex h-7 w-7 items-center justify-center border border-border bg-base-100/90 p-0 text-muted shadow-sm hover:bg-base-200 hover:text-base-content", className)}
            onClick={copy}
            aria-label={label}
            title={label}
        >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
    )
}

function HighlightedCodeBlock({ block, selectedRange }: { block: Extract<MarkdownBlock, { type: "code" }>; selectedRange: { start: number; end: number } | null }) {
    const ref = useRef<HTMLPreElement | null>(null)
    const theme = useEditorTheme(ref)
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
        <div className="group/code relative">
            <CopyButton content={block.text} label="Copy code" className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover/code:opacity-100 group-focus-within/code:opacity-100" />
            <pre ref={ref} className="my-2 overflow-x-auto border border-border bg-base-200 p-3 pr-24 font-mono text-sm leading-6">
                <code>
                    {lines.map((line, index) => {
                        const lineNumber = block.startLine + index
                        const props = rangeProps(lineNumber, lineNumber, selectedRange)
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
        </div>
    )
}

function MermaidBlock({ block, selectedRange }: { block: Extract<MarkdownBlock, { type: "code" }>; selectedRange: { start: number; end: number } | null }) {
    const ref = useRef<HTMLDivElement | null>(null)
    const theme = useEditorTheme(ref)
    const [svg, setSvg] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        const id = `openade-mermaid-${++mermaidDiagramId}`
        setSvg(null)
        setError(null)

        mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: normalizeShikiTheme(theme) === "github-light" || normalizeShikiTheme(theme) === "light-plus" ? "default" : "dark",
        })

        mermaid
            .render(id, block.text)
            .then((result) => {
                if (!cancelled) setSvg(sanitizeHtml(result.svg))
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : "Unable to render diagram")
            })

        return () => {
            cancelled = true
        }
    }, [block.text, theme])

    const props = rangeProps(block.startLine, block.endLine, selectedRange)

    return (
        <div ref={ref} {...props} className={cx(props.className, "group/diagram relative my-2 border border-border bg-base-200 p-3")}>
            <CopyButton content={block.text} label="Copy diagram" className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover/diagram:opacity-100 group-focus-within/diagram:opacity-100" />
            {svg ? <div className="overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : error ? <HighlightedCodeBlock block={block} selectedRange={selectedRange} /> : <div className="text-sm text-muted">Rendering diagram…</div>}
        </div>
    )
}

const renderedMarkdownClass = cx(
    "markdown-rendered min-w-0 text-sm leading-6",
    "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
    "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:bg-base-200/40 [&_blockquote]:py-1 [&_blockquote]:pl-4 [&_blockquote]:text-muted",
    "[&_code]:rounded-sm [&_code]:bg-base-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
    "[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:leading-tight",
    "[&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:leading-tight",
    "[&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:leading-snug",
    "[&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:text-base [&_h4]:font-semibold",
    "[&_hr]:my-4 [&_hr]:border-border",
    "[&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
    "[&_table]:my-3 [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_table]:font-mono [&_table]:text-sm",
    "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-base-200 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left"
)

function RenderedMarkdownBlock({ block, selectedRange }: { block: Extract<MarkdownBlock, { type: "rendered" }>; selectedRange: { start: number; end: number } | null }) {
    const props = rangeProps(block.startLine, block.endLine, selectedRange)
    return <div {...props} className={cx(props.className, renderedMarkdownClass)} dangerouslySetInnerHTML={{ __html: block.html }} />
}

function MarkdownBlockView({ block, selectedRange = null }: { block: MarkdownBlock; selectedRange?: { start: number; end: number } | null }) {
    if (block.type === "code") {
        return block.diagram ? <MermaidBlock block={block} selectedRange={selectedRange} /> : <HighlightedCodeBlock block={block} selectedRange={selectedRange} />
    }
    return <RenderedMarkdownBlock block={block} selectedRange={selectedRange} />
}

function getLineRange(element: Element): { start: number; end: number } | null {
    const start = Number(element.getAttribute("data-markdown-start") ?? element.getAttribute("data-markdown-line"))
    const end = Number(element.getAttribute("data-markdown-end") ?? element.getAttribute("data-markdown-line"))
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    return { start, end }
}

export function getMarkdownSelectionRange(container: Element, selection: Selection | null): { start: number; end: number; side: AnnotationSide } | null {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    if (!range.intersectsNode(container)) return null

    const ranges = Array.from(container.querySelectorAll<HTMLElement>("[data-markdown-start], [data-markdown-line]"))
        .filter((line) => range.intersectsNode(line))
        .map(getLineRange)
        .filter((line): line is { start: number; end: number } => line !== null)

    if (ranges.length === 0) return null
    return {
        start: Math.min(...ranges.map((line) => line.start)),
        end: Math.max(...ranges.map((line) => line.end)),
        side: "additions",
    }
}

export function annotationBelongsToMarkdownBlock(annotation: { lineNumber: number }, block: MarkdownBlock): boolean {
    const range = markdownLineRange(block)
    return annotation.lineNumber >= range.start && annotation.lineNumber <= range.end
}

function MarkdownMessageFrame({ text, children, onMouseUp }: { text: string; children: ReactNode; onMouseUp?: MouseEventHandler<HTMLDivElement> }) {
    const openExternalLink = useCallback((event: MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null
        const anchor = target?.closest<HTMLAnchorElement>("a[href]")
        if (!anchor || !event.currentTarget.contains(anchor)) return

        const url = getExternalUrlToOpen(anchor.getAttribute("href"))
        if (!url) return

        event.preventDefault()
        event.stopPropagation()
        openUrlInNativeBrowser(url)
    }, [])

    return (
        <div className="group/markdown-message relative border border-border bg-base-100 px-3 py-2 font-sans text-sm leading-6" onClickCapture={openExternalLink} onMouseUp={onMouseUp}>
            <CopyButton content={text} label="Copy markdown" className="absolute top-2 right-2 z-20 opacity-0 transition-opacity group-hover/markdown-message:opacity-100 group-focus-within/markdown-message:opacity-100" />
            <div className="pr-0">{children}</div>
        </div>
    )
}

function MarkdownMessageStatic({ text }: { text: string }) {
    const blocks = useMemo(() => parseMarkdownBlocks(text), [text])
    return (
        <MarkdownMessageFrame text={text}>
            {blocks.map((block, index) => (
                <MarkdownBlockView key={`${block.startLine}-${index}`} block={block} />
            ))}
        </MarkdownMessageFrame>
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
        const range = markdownLineRange(block)
        annotations.handleLineSelectionEnd({ start: range.start, end: range.end, side: "additions" })
    }

    const handleSelection = (event: React.MouseEvent<HTMLDivElement>) => {
        if (commentHandlers.readOnly || annotations.hasOpenForm) return
        const range = getMarkdownSelectionRange(event.currentTarget, window.getSelection())
        if (!range) return
        annotations.handleLineSelectionEnd(range)
        window.getSelection()?.removeAllRanges()
    }

    return (
        <MarkdownMessageFrame text={text} onMouseUp={handleSelection}>
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
        </MarkdownMessageFrame>
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
