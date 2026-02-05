import { AlertTriangle } from "lucide-react"
import type { CommentContext, GroupRenderer, StderrGroup } from "../../events/messageGroups"

function StderrContent({ group }: { group: StderrGroup; ctx: CommentContext }) {
    return (
        <pre className="px-3 py-2 text-xs bg-warning/10 text-warning whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto font-mono">{group.data}</pre>
    )
}

export const stderrRenderer: GroupRenderer<StderrGroup> = {
    getLabel: (group) => {
        const lines = group.data.trim().split("\n")
        const previewLine = lines[0]?.slice(0, 40) || "stderr"
        const hasMore = lines.length > 1 || (lines[0]?.length ?? 0) > 40
        return hasMore ? `${previewLine}...` : previewLine
    },
    getIcon: () => <AlertTriangle size="0.85em" className="text-warning flex-shrink-0" />,
    getStatusIcon: () => <AlertTriangle size="1em" className="text-warning flex-shrink-0" />,
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <StderrContent group={group} ctx={ctx} />,
}
