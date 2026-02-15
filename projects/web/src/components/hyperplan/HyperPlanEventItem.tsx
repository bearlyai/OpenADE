/**
 * HyperPlanEventItem - Renders a HyperPlan action event
 *
 * Sub-plan panes are always displayed side-by-side horizontally.
 * Below them, the terminal step (reconciliation) streams its output.
 */

import { Loader, Zap } from "lucide-react"
import { observer } from "mobx-react"
import { useMemo } from "react"
import type { HyperPlanSubExecution } from "../../hyperplan/types"
import type { ActionEvent } from "../../types"
import { InlineMessages, type SessionInfo } from "../InlineMessages"
import { type BaseEventItemProps, CollapsibleEvent } from "../events/shared"
import { getHarnessDisplayName } from "../settings/harnessStatusUtils"

interface HyperPlanEventItemProps extends BaseEventItemProps {
    event: ActionEvent
    taskId: string
}

function SubPlanStatusBadge({ status }: { status: HyperPlanSubExecution["status"] }) {
    switch (status) {
        case "in_progress":
            return <Loader size={12} className="animate-spin text-warning" />
        case "completed":
            return <span className="w-2 h-2 rounded-full bg-success" />
        case "error":
            return <span className="w-2 h-2 rounded-full bg-error" />
        default:
            return <span className="w-2 h-2 rounded-full bg-base-300" />
    }
}

/** Streaming pane for a sub-plan */
function SubPlanPane({
    sub,
    taskId,
    actionEventId,
}: {
    sub: HyperPlanSubExecution
    taskId: string
    actionEventId: string
}) {
    const harnessLabel = getHarnessDisplayName(sub.harnessId)

    return (
        <div className="flex-1 min-w-0 border border-border rounded overflow-hidden">
            {/* Pane header */}
            <div className="flex items-center gap-2 px-2 py-1.5 bg-base-200 border-b border-border text-xs">
                <SubPlanStatusBadge status={sub.status} />
                <span className="font-medium">{harnessLabel}</span>
                <span className="text-muted">{sub.modelId}</span>
                {sub.primitive === "review" && <span className="text-info">(Review)</span>}
            </div>
            {/* Pane content */}
            <div className="max-h-[300px] overflow-y-auto">
                {sub.events.length > 0 ? (
                    <InlineMessages
                        events={sub.events}
                        harnessId={sub.harnessId}
                        sourceType="plan"
                        taskId={taskId}
                        actionEventId={actionEventId}
                    />
                ) : (
                    <div className="px-3 py-4 text-center text-xs text-muted">Waiting...</div>
                )}
            </div>
            {/* Error display */}
            {sub.status === "error" && sub.error && (
                <div className="px-2 py-1.5 bg-error/10 text-error text-xs border-t border-border">{sub.error}</div>
            )}
        </div>
    )
}

export const HyperPlanEventItem = observer(function HyperPlanEventItem({
    event,
    expanded,
    onToggle,
    taskId,
}: HyperPlanEventItemProps) {
    const subExecutions = event.hyperplanSubExecutions ?? []
    const terminalEvents = event.execution.events

    // Determine phase
    const allSubsComplete = subExecutions.length > 0 && subExecutions.every((s) => s.status === "completed" || s.status === "error")
    const isReconciling = allSubsComplete && event.status === "in_progress"
    const isComplete = event.status === "completed"
    const isPlanning = !allSubsComplete && event.status === "in_progress"

    const sessionInfo: SessionInfo | undefined = useMemo(() => {
        if (!event.execution.sessionId) return undefined
        return {
            sessionId: event.execution.sessionId,
            parentSessionId: event.execution.parentSessionId,
        }
    }, [event.execution.sessionId, event.execution.parentSessionId])

    const strategyId = event.source.type === "hyperplan" ? event.source.strategyId : "unknown"

    const phaseLabel = isPlanning ? "Planning..." : isReconciling ? "Reconciling..." : isComplete ? "Completed" : "Error"

    return (
        <CollapsibleEvent
            icon={<Zap size="1em" className="flex-shrink-0 text-primary" />}
            label="HyperPlan"
            query={event.userInput}
            event={event}
            expanded={expanded}
            onToggle={onToggle}
        >
            <div className="px-3 py-2">
                {/* Status bar */}
                <div className="flex items-center gap-2 text-xs text-muted mb-2">
                    <span className="font-medium capitalize">{strategyId}</span>
                    <span>&middot;</span>
                    <span>{phaseLabel}</span>
                    {isPlanning && <Loader size={10} className="animate-spin" />}
                </div>

                {/* Sub-plans: always displayed side-by-side horizontally */}
                {subExecutions.length > 0 && (
                    <div className="flex gap-2 mb-3">
                        {subExecutions.map((sub) => (
                            <SubPlanPane key={sub.stepId} sub={sub} taskId={taskId} actionEventId={event.id} />
                        ))}
                    </div>
                )}

                {/* Terminal step (reconciliation or single plan) output */}
                {terminalEvents.length > 0 && (
                    <div>
                        {isReconciling && (
                            <div className="flex items-center gap-2 text-xs text-muted mb-1">
                                <Loader size={10} className="animate-spin" />
                                <span>Reconciling \u00b7 {getHarnessDisplayName(event.execution.harnessId)}</span>
                            </div>
                        )}
                        <InlineMessages
                            events={terminalEvents}
                            harnessId={event.execution.harnessId}
                            sourceType="hyperplan"
                            sessionInfo={sessionInfo}
                            taskId={taskId}
                            actionEventId={event.id}
                        />
                    </div>
                )}
            </div>
        </CollapsibleEvent>
    )
})
