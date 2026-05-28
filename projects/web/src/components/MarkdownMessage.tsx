import type { AnnotationSide } from "@pierre/diffs"
import cx from "classnames"
import { MessageSquarePlus } from "lucide-react"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useMemo } from "react"
import type { CommentSelectedText } from "../types"
import { useCommentAnnotations } from "./comments/hooks/useCommentAnnotations"
import { extractSelectedText } from "./comments/utils"
import type { CommentHandlers } from "./FilesAndDiffs"

export type MarkdownBlock =
    | { type: "heading"; level: number; text: string; startLine: number; endLine: number }
    | { type: "paragraph"; text: string; startLine: number; endLine: number }
    | { type: "list"; items: string[]; startLine: number; endLine: number }
    | { type: "code"; language?: string; text: string; startLine: number; endLine: number }

function flushParagraph(blocks: MarkdownBlock[], lines: string[], startLine: number): void {
    if (lines.length === 0) return
    blocks.push({
        type: "paragraph",
        text: lines.join("\n"),
        startLine,
        endLine: startLine + lines.length - 1,
    })
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
            const codeLines = block.text.split("\n")
            return (
                <pre className="my-2 overflow-x-auto border border-border bg-base-200 p-3 font-mono text-[13px] leading-5">
                    <code>
                        {codeLines.map((line, index) => (
                            <span key={index} {...lineProps(block.startLine + index, selectedRange)} className={cx(lineProps(block.startLine + index, selectedRange).className, "block min-h-4")}>
                                {line || " "}
                            </span>
                        ))}
                    </code>
                </pre>
            )
        case "paragraph": {
            const lines = block.text.split("\n")
            return (
                <p className="my-2 whitespace-pre-wrap leading-5">
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
        <div className="border border-border bg-base-100 px-3 py-2 text-[13px] leading-5">
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
        <div className="group/markdown-message border border-border bg-base-100 px-3 py-2 text-[13px] leading-5" onMouseUp={handleSelection}>
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
