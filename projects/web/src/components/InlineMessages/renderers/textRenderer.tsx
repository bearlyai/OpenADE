import { MessageSquare } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useMemo, useState } from "react"
import type { Comment, CommentSource } from "../../../types"
import { useCodeStore } from "../../../store/context"
import { type AnnotationSide, type CommentHandlers, FileViewer } from "../../FilesAndDiffs"
import type { CommentContext, GroupRenderer, TextGroup } from "../../events/messageGroups"
import { MarkdownPreview, hasMarkdown } from "../MarkdownPreview"

const TextContent = observer(function TextContent({ group, ctx }: { group: TextGroup; ctx: CommentContext }) {
    const codeStore = useCodeStore()
    const personalSettings = codeStore.personalSettingsStore
    const renderMarkdownDefault = personalSettings?.settings.current.renderAssistantMarkdown ?? false
    const showToggle = hasMarkdown(group.text)
    const [mode, setMode] = useState<"source" | "preview">(renderMarkdownDefault && showToggle ? "preview" : "source")

    const sourceMatch = useCallback(
        (c: Comment) => {
            const src = c.source
            return src.type === "assistant_text" && src.actionEventId === ctx.actionEventId && src.messageIndex === group.messageIndex
        },
        [ctx.actionEventId, group.messageIndex]
    )

    const createSource = useCallback(
        (lineStart: number, lineEnd: number, _side: AnnotationSide): CommentSource => ({
            type: "assistant_text",
            actionEventId: ctx.actionEventId,
            messageIndex: group.messageIndex,
            lineStart,
            lineEnd,
        }),
        [ctx.actionEventId, group.messageIndex]
    )

    const commentHandlers: CommentHandlers = useMemo(() => ({ taskId: ctx.taskId, sourceMatch, createSource }), [ctx.taskId, sourceMatch, createSource])

    const toggleMode = useCallback(() => {
        const next = mode === "source" ? "preview" : "source"
        setMode(next)
        personalSettings?.settings.set({ renderAssistantMarkdown: next === "preview" })
    }, [mode, personalSettings])

    return (
        <div className="relative">
            {showToggle && (
                <button
                    type="button"
                    className="btn absolute top-1 right-1 z-10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted hover:text-base-content bg-base-100/80 border border-border"
                    onClick={toggleMode}
                    aria-label={mode === "source" ? "Render markdown preview" : "Show markdown source"}
                >
                    {mode === "source" ? "Preview" : "Source"}
                </button>
            )}
            {mode === "preview" ? (
                <MarkdownPreview text={group.text} />
            ) : (
                <FileViewer file={{ name: "message.md", contents: group.text, lang: "markdown" }} disableFileHeader commentHandlers={commentHandlers} />
            )}
        </div>
    )
})

export const textRenderer: GroupRenderer<TextGroup> = {
    getLabel: () => "Response",
    getIcon: () => <MessageSquare size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: () => null,
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <TextContent group={group} ctx={ctx} />,
}
