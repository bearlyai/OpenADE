import { AlertCircle, FilePlus, FileText, FolderOpen, GitBranch, Pencil, Search, Terminal } from "lucide-react"
import { useCallback, useMemo } from "react"
import type { Comment, CommentSource } from "../../../types"
import { type AnnotationSide, type CommentHandlers, FileViewer } from "../../FilesAndDiffs"
import type { BashGroup, CommentContext, GroupRenderer } from "../../events/messageGroups"
import { type BashSemanticType, classifyBashCommand } from "./classifyBashCommand"

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

function getSemanticIcon(semanticType: BashSemanticType) {
    switch (semanticType) {
        case "search":
            return <Search size="0.85em" className="text-muted flex-shrink-0" />
        case "read":
            return <FileText size="0.85em" className="text-muted flex-shrink-0" />
        case "list":
            return <FolderOpen size="0.85em" className="text-muted flex-shrink-0" />
        case "edit":
            return <Pencil size="0.85em" className="text-muted flex-shrink-0" />
        case "write":
            return <FilePlus size="0.85em" className="text-muted flex-shrink-0" />
        case "git":
            return <GitBranch size="0.85em" className="text-muted flex-shrink-0" />
        default:
            return <Terminal size="0.85em" className="text-muted flex-shrink-0" />
    }
}

export const bashRenderer: GroupRenderer<BashGroup> = {
    getLabel: (group) => {
        if (group.description) {
            return group.description.length > 40 ? `${group.description.slice(0, 40)}...` : group.description
        }
        return classifyBashCommand(group.command).label
    },
    getIcon: (group) => getSemanticIcon(classifyBashCommand(group.command).semanticType),
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <BashContent group={group} ctx={ctx} />,
}
