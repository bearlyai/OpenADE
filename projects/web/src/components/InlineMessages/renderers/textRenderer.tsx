import { MessageSquare } from "lucide-react"
import { useCallback, useMemo } from "react"
import type { Comment, CommentSource } from "../../../types"
import { type AnnotationSide, type CommentHandlers, FileViewer } from "../../FilesAndDiffs"
import type { CommentContext, GroupRenderer, TextGroup } from "../../events/messageGroups"

function TextContent({ group, ctx }: { group: TextGroup; ctx: CommentContext }) {
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

    return <FileViewer file={{ name: "message.md", contents: group.text, lang: "markdown" }} disableFileHeader commentHandlers={commentHandlers} />
}

export const textRenderer: GroupRenderer<TextGroup> = {
    getLabel: () => "Response",
    getIcon: () => <MessageSquare size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: () => null,
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <TextContent group={group} ctx={ctx} />,
}
