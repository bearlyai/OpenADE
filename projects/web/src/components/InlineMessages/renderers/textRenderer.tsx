import { MessageSquare } from "lucide-react"
import { useCallback, useMemo } from "react"
import { useCodeStore } from "../../../store/context"
import type { Comment, CommentSource } from "../../../types"
import { type AnnotationSide, type CommentHandlers, FileViewer } from "../../FilesAndDiffs"
import { MarkdownMessage } from "../../MarkdownMessage"
import type { CommentContext, GroupRenderer, TextGroup } from "../../events/messageGroups"

function TextContent({ group, ctx }: { group: TextGroup; ctx: CommentContext }) {
    const codeStore = useCodeStore()
    const renderMarkdown = codeStore.personalSettingsStore?.settings.current.renderMarkdownMessages ?? true
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

    if (renderMarkdown) return <MarkdownMessage text={group.text} commentHandlers={commentHandlers} />

    return <FileViewer file={{ name: "message.md", contents: group.text, lang: "markdown" }} disableFileHeader commentHandlers={commentHandlers} />
}

export const textRenderer: GroupRenderer<TextGroup> = {
    getLabel: () => "Response",
    getIcon: () => <MessageSquare size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: () => null,
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <TextContent group={group} ctx={ctx} />,
}
