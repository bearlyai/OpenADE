import { AlertCircle, CircleCheck, Clock, DollarSign, Zap } from "lucide-react"
import type { CommentContext, GroupRenderer, ResultGroup } from "../../events/messageGroups"

const RESULT_DISPLAY_NAMES: Record<ResultGroup["subtype"], string> = {
    success: "Completed",
    error_during_execution: "Error",
    error_max_turns: "Max Turns",
    error_max_budget_usd: "Budget Exceeded",
    error_max_structured_output_retries: "Output Error",
}

function ResultContent({ group }: { group: ResultGroup; ctx: CommentContext }) {
    return (
        <div className="px-3 py-2 bg-base-100 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <span className="text-muted">Input tokens:</span>{" "}
                    <span className="text-base-content font-mono">{group.usage.inputTokens.toLocaleString()}</span>
                </div>
                <div>
                    <span className="text-muted">Output tokens:</span>{" "}
                    <span className="text-base-content font-mono">{group.usage.outputTokens.toLocaleString()}</span>
                </div>
            </div>
            {group.result && (
                <div>
                    <div className="text-xs text-muted font-medium mb-1">Result</div>
                    <pre className="text-xs p-2 bg-base-200 border border-border whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
                        {group.result}
                    </pre>
                </div>
            )}
            {group.errors && group.errors.length > 0 && (
                <div>
                    <div className="text-xs text-error font-medium mb-1">Errors</div>
                    <pre className="text-xs p-2 bg-error/10 border border-error/20 whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto text-error">
                        {group.errors.join("\n")}
                    </pre>
                </div>
            )}
        </div>
    )
}

export const resultRenderer: GroupRenderer<ResultGroup> = {
    getLabel: (group) => {
        const displayName = RESULT_DISPLAY_NAMES[group.subtype]
        const seconds = group.durationMs / 1000
        const duration = seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`
        const cost = group.totalCostUsd < 0.01 ? `$${group.totalCostUsd.toFixed(4)}` : `$${group.totalCostUsd.toFixed(2)}`
        return `${displayName} · ${duration} · ${cost}`
    },
    getIcon: (group) => {
        if (group.isError) return <AlertCircle size="0.85em" className="text-error flex-shrink-0" />
        return <CircleCheck size="0.85em" className="text-success flex-shrink-0" />
    },
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: (group) => {
        const seconds = group.durationMs / 1000
        const duration = seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`
        const cost = group.totalCostUsd < 0.01 ? `$${group.totalCostUsd.toFixed(4)}` : `$${group.totalCostUsd.toFixed(2)}`

        return (
            <div className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1">
                    <Clock size="0.85em" />
                    {duration}
                </span>
                <span className="flex items-center gap-1">
                    <DollarSign size="0.85em" />
                    {cost}
                </span>
                <span className="flex items-center gap-1">
                    <Zap size="0.85em" />
                    {(group.usage.inputTokens + group.usage.outputTokens).toLocaleString()} tokens
                </span>
            </div>
        )
    },
    renderContent: (group, ctx) => <ResultContent group={group} ctx={ctx} />,
}
