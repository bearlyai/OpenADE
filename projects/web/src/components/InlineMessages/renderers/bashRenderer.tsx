import { AlertCircle, Terminal } from "lucide-react"
import { useCallback, useMemo } from "react"
import type { Comment, CommentSource } from "../../../types"
import { type AnnotationSide, type CommentHandlers, FileViewer } from "../../FilesAndDiffs"
import type { BashGroup, CommentContext, GroupRenderer } from "../../events/messageGroups"

function BashContent({ group, ctx }: { group: BashGroup; ctx: CommentContext }) {
    const bashContent = useMemo(() => {
        const lines: string[] = [`$ ${group.command}`]
        if (group.result !== undefined) lines.push(group.result)
        return lines.join("\n")
    }, [group.command, group.result])

    const sourceMatch = useCallback(
        (c: Comment) => {
            const src = c.source
            return src.type === "bash_output" && src.actionEventId === ctx.actionEventId && src.toolUseId === group.toolUseId
        },
        [ctx.actionEventId, group.toolUseId]
    )

    const createSource = useCallback(
        (lineStart: number, lineEnd: number, _side: AnnotationSide): CommentSource => ({
            type: "bash_output",
            actionEventId: ctx.actionEventId,
            toolUseId: group.toolUseId,
            lineStart,
            lineEnd,
        }),
        [ctx.actionEventId, group.toolUseId]
    )

    const commentHandlers: CommentHandlers = useMemo(() => ({ taskId: ctx.taskId, sourceMatch, createSource }), [ctx.taskId, sourceMatch, createSource])

    return <FileViewer file={{ name: "terminal", contents: bashContent, lang: "bash" }} disableFileHeader commentHandlers={commentHandlers} />
}

export const bashRenderer: GroupRenderer<BashGroup> = {
    getLabel: (group) => {
        const description = group.description || group.command
        return description.length > 40 ? `${description.slice(0, 40)}...` : description
    },
    getIcon: () => <Terminal size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <BashContent group={group} ctx={ctx} />,
}
