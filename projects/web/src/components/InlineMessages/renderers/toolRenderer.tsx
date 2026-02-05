import cx from "classnames"
import { AlertCircle, Wrench } from "lucide-react"
import type { CommentContext, GroupRenderer, ToolGroup } from "../../events/messageGroups"

function ToolContent({ group }: { group: ToolGroup; ctx: CommentContext }) {
    return (
        <div>
            <div className="px-3 py-2">
                <div className="text-xs text-muted font-medium mb-1">Input</div>
                <pre className="text-xs overflow-x-auto max-h-48 overflow-y-auto p-2 bg-base-200 border border-border whitespace-pre-wrap">
                    {typeof group.input === "string" ? group.input : JSON.stringify(group.input, null, 2)}
                </pre>
            </div>
            {group.result !== undefined && (
                <div className="px-3 py-2 border-t border-border">
                    <div className={cx("text-xs font-medium mb-1", group.isError ? "text-error" : "text-muted")}>{group.isError ? "Error" : "Result"}</div>
                    <pre
                        className={cx(
                            "text-xs overflow-x-auto max-h-48 overflow-y-auto p-2 border whitespace-pre-wrap",
                            group.isError ? "bg-error/10 border-error/20" : "bg-base-200 border-border"
                        )}
                    >
                        {group.result}
                    </pre>
                </div>
            )}
        </div>
    )
}

export const toolRenderer: GroupRenderer<ToolGroup> = {
    getLabel: (group) => group.toolName,
    getIcon: () => <Wrench size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <ToolContent group={group} ctx={ctx} />,
}
