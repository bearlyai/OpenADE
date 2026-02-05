import { createPatch } from "diff"
import { AlertCircle, Pencil } from "lucide-react"
import { useCallback, useMemo } from "react"
import type { Comment, CommentSource } from "../../../types"
import { type AnnotationSide, type CommentHandlers, FileDiffViewer, parsePatchFiles } from "../../FilesAndDiffs"
import type { CommentContext, EditGroup, GroupRenderer } from "../../events/messageGroups"
import { getFileName } from "../../utils/paths"

function computeDiffStats(oldStr: string, newStr: string): { additions: number; deletions: number } {
    const oldLines = oldStr.split("\n")
    const newLines = newStr.split("\n")
    const oldSet = new Set(oldLines)
    const newSet = new Set(newLines)

    let deletions = 0
    let additions = 0
    for (const line of oldLines) if (!newSet.has(line)) deletions++
    for (const line of newLines) if (!oldSet.has(line)) additions++

    return { additions, deletions }
}

function EditContent({ group, ctx }: { group: EditGroup; ctx: CommentContext }) {
    const parsedDiff = useMemo(() => {
        if (group.isPending) return null
        const patch = createPatch(group.filePath, group.oldString, group.newString, "", "")
        const parsed = parsePatchFiles(patch)
        if (parsed.length === 0 || parsed[0].files.length === 0) return null
        return parsed[0].files[0]
    }, [group.filePath, group.oldString, group.newString, group.isPending])

    const sourceMatch = useCallback(
        (c: Comment) => {
            const src = c.source
            return src.type === "edit_diff" && src.actionEventId === ctx.actionEventId && src.toolUseId === group.toolUseId && src.filePath === group.filePath
        },
        [ctx.actionEventId, group.toolUseId, group.filePath]
    )

    const createSource = useCallback(
        (lineStart: number, lineEnd: number, side: AnnotationSide): CommentSource => ({
            type: "edit_diff",
            actionEventId: ctx.actionEventId,
            toolUseId: group.toolUseId,
            filePath: group.filePath,
            side,
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

export const editRenderer: GroupRenderer<EditGroup> = {
    getLabel: (group) => getFileName(group.filePath),
    getIcon: () => <Pencil size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: (group) => {
        if (group.isPending || group.isError) return null
        const stats = computeDiffStats(group.oldString, group.newString)
        if (stats.additions === 0 && stats.deletions === 0) {
            return <span className="text-muted text-xs">no changes</span>
        }
        return (
            <span className="text-muted text-xs">
                {stats.additions > 0 && <span className="text-success">+{stats.additions}</span>}
                {stats.additions > 0 && stats.deletions > 0 && " "}
                {stats.deletions > 0 && <span className="text-error">-{stats.deletions}</span>}
            </span>
        )
    },
    renderContent: (group, ctx) => <EditContent group={group} ctx={ctx} />,
}
