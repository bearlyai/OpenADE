import cx from "classnames"
import { AlertCircle, Wrench } from "lucide-react"
import type { CommentContext, GroupRenderer, ToolGroup } from "../../events/messageGroups"
import { getFileName } from "../../utils/paths"

function getToolLabel(group: ToolGroup): string {
    const input = group.input as Record<string, unknown> | undefined
    if (input) {
        // Tools with file_path: Read, Glob, etc.
        if (typeof input.file_path === "string") {
            return `${group.toolName}: ${getFileName(input.file_path)}`
        }
        // Grep: show search pattern
        if (group.toolName === "Grep" && typeof input.pattern === "string") {
            const pattern = input.pattern.length > 30 ? `${input.pattern.slice(0, 30)}…` : input.pattern
            return `${group.toolName}: ${pattern}`
        }
        // Glob: show glob pattern
        if (group.toolName === "Glob" && typeof input.pattern === "string") {
            const pattern = input.pattern.length > 30 ? `${input.pattern.slice(0, 30)}…` : input.pattern
            return `${group.toolName}: ${pattern}`
        }
    }
    return group.toolName
}

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
    getLabel: getToolLabel,
    getIcon: () => <Wrench size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <ToolContent group={group} ctx={ctx} />,
}
