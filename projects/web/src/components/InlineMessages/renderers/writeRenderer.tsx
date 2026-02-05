import { createPatch } from "diff"
import { AlertCircle, FilePlus } from "lucide-react"
import { useCallback, useMemo } from "react"
import type { Comment, CommentSource } from "../../../types"
import { type AnnotationSide, type CommentHandlers, FileDiffViewer, parsePatchFiles } from "../../FilesAndDiffs"
import type { CommentContext, GroupRenderer, WriteGroup } from "../../events/messageGroups"
import { getFileName } from "../../utils/paths"

function WriteContent({ group, ctx }: { group: WriteGroup; ctx: CommentContext }) {
    const parsedDiff = useMemo(() => {
        if (group.isPending) return null
        const patch = createPatch(group.filePath, "", group.content, "", "")
        const parsed = parsePatchFiles(patch)
        if (parsed.length === 0 || parsed[0].files.length === 0) return null
        return parsed[0].files[0]
    }, [group.filePath, group.content, group.isPending])

    const sourceMatch = useCallback(
        (c: Comment) => {
            const src = c.source
            return src.type === "write_diff" && src.actionEventId === ctx.actionEventId && src.toolUseId === group.toolUseId && src.filePath === group.filePath
        },
        [ctx.actionEventId, group.toolUseId, group.filePath]
    )

    const createSource = useCallback(
        (lineStart: number, lineEnd: number, _side: AnnotationSide): CommentSource => ({
            type: "write_diff",
            actionEventId: ctx.actionEventId,
            toolUseId: group.toolUseId,
            filePath: group.filePath,
            lineStart,
            lineEnd,
        }),
        [ctx.actionEventId, group.toolUseId, group.filePath]
    )

    const commentHandlers: CommentHandlers = useMemo(() => ({ taskId: ctx.taskId, sourceMatch, createSource }), [ctx.taskId, sourceMatch, createSource])

    if (group.isError && group.errorMessage) {
        return <pre className="px-3 py-2 text-xs text-error bg-error/5 border-t border-error/20 whitespace-pre-wrap">{group.errorMessage}</pre>
    }

    if (!parsedDiff) return null

    return <FileDiffViewer fileDiff={parsedDiff} diffStyle="unified" commentHandlers={commentHandlers} />
}

export const writeRenderer: GroupRenderer<WriteGroup> = {
    getLabel: (group) => getFileName(group.filePath),
    getIcon: () => <FilePlus size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: (group) => {
        if (group.isPending || group.isError) return null
        const lineCount = group.content.split("\n").length
        return (
            <span className="text-muted text-xs">
                <span className="text-success">+{lineCount}</span>
            </span>
        )
    },
    renderContent: (group, ctx) => <WriteContent group={group} ctx={ctx} />,
}
