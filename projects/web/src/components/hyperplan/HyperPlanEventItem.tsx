/**
 * HyperPlanEventItem - Renders a HyperPlan action event
 *
 * Sub-plan panes are always displayed side-by-side horizontally.
 * Below them, the terminal step (reconciliation) streams its output.
 */

import { Loader, Zap } from "lucide-react"
import { observer } from "mobx-react"
import { useMemo } from "react"
import type { HarnessId } from "../../electronAPI/harnessEventTypes"
import type { HyperPlanSubExecution } from "../../hyperplan/types"
import type { ActionEvent } from "../../types"
import { InlineMessages, type SessionInfo, UserInputMessage } from "../InlineMessages"
import { type BaseEventItemProps, CollapsibleEvent } from "../events/shared"
import { getHarnessDisplayName } from "../settings/harnessStatusUtils"

interface HyperPlanEventItemProps extends BaseEventItemProps {
    event: ActionEvent
    taskId: string
}

const HARNESS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    "claude-code": { bg: "bg-[#da9f6e]/15", text: "text-[#c47b3b]", border: "border-[#da9f6e]/30" },
    codex: { bg: "bg-[#5b9bd5]/15", text: "text-[#3d7ab8]", border: "border-[#5b9bd5]/30" },
}
const DEFAULT_HARNESS_COLOR = { bg: "bg-base-300", text: "text-muted", border: "border-border" }

function HarnessIcon({ harnessId }: { harnessId: HarnessId }) {
    if (harnessId === "codex") {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="w-3 h-3">
                <path
                    d="M19.7978 10.3242C20.2171 9.0657 20.0727 7.68705 19.4022 6.54232C18.3937 4.78653 16.3665 3.88321 14.3866 4.3083C13.5058 3.31605 12.2404 2.75177 10.9137 2.75985C8.88991 2.75523 7.09426 4.05822 6.47165 5.98382C5.17155 6.25007 4.04934 7.06386 3.39265 8.21726C2.37672 9.96843 2.60832 12.1759 3.9656 13.6776C3.54628 14.9361 3.69067 16.3147 4.36123 17.4594C5.36965 19.2152 7.39691 20.1186 9.3768 19.6935C10.257 20.6857 11.523 21.25 12.8497 21.2413C14.8746 21.2465 16.6709 19.9424 17.2935 18.0151C18.5936 17.7488 19.7158 16.935 20.3725 15.7816C21.3873 14.0304 21.1551 11.8247 19.7984 10.3231L19.7978 10.3242ZM12.8508 20.0337C12.0405 20.0348 11.2556 19.7512 10.6336 19.232C10.6619 19.217 10.711 19.1898 10.7427 19.1702L14.423 17.0448C14.6113 16.9379 14.7268 16.7375 14.7256 16.5209V11.3326L16.281 12.2308C16.2978 12.2388 16.3087 12.255 16.311 12.2735V16.57C16.3087 18.4806 14.7614 20.0296 12.8508 20.0337ZM5.40951 16.8553C5.00348 16.1542 4.85735 15.3323 4.99655 14.5347C5.02369 14.5508 5.07163 14.5803 5.10571 14.5999L8.78595 16.7254C8.9725 16.8345 9.20353 16.8345 9.39066 16.7254L13.8835 14.1309V15.9272C13.8847 15.9456 13.876 15.9636 13.8616 15.9751L10.1415 18.1231C8.48446 19.0772 6.36826 18.51 5.41008 16.8553H5.40951ZM4.44093 8.82197C4.84523 8.11965 5.48343 7.58252 6.24351 7.30355C6.24351 7.33532 6.24178 7.39134 6.24178 7.43062V11.6821C6.24062 11.8981 6.35613 12.0985 6.54384 12.2053L11.0367 14.7992L9.48134 15.6973C9.46574 15.7077 9.4461 15.7094 9.42878 15.7019L5.70811 13.5522C4.05454 12.5946 3.48737 10.479 4.44035 8.82255L4.44093 8.82197ZM17.2201 11.7958L12.7272 9.20143L14.2826 8.30389C14.2982 8.2935 14.3179 8.29176 14.3352 8.29927L18.0559 10.4472C19.7123 11.4043 20.2801 13.5233 19.323 15.1798C18.9182 15.881 18.2805 16.4181 17.521 16.6976V12.3191C17.5228 12.1031 17.4078 11.9033 17.2207 11.7958H17.2201ZM18.768 9.46595C18.7409 9.4492 18.6929 9.42033 18.6588 9.40069L14.9786 7.27525C14.792 7.16609 14.561 7.16609 14.3739 7.27525L9.88101 9.86967V8.07345C9.87986 8.05496 9.88852 8.03706 9.90296 8.02551L13.6231 5.87928C15.2801 4.92341 17.3986 5.49231 18.3539 7.14992C18.7576 7.84993 18.9037 8.66949 18.7668 9.46595H18.768ZM9.03546 12.6674L7.4795 11.7693C7.46275 11.7612 7.45177 11.745 7.44946 11.7265V7.43004C7.45062 5.51714 9.00254 3.96696 10.9154 3.96812C11.7246 3.96812 12.5078 4.25228 13.1298 4.76978C13.1015 4.78479 13.053 4.81194 13.0207 4.83158L9.34041 6.95701C9.15212 7.06386 9.03661 7.2637 9.03777 7.48029L9.03546 12.6662V12.6674ZM9.88043 10.8458L11.8817 9.69005L13.883 10.8452V13.156L11.8817 14.3111L9.88043 13.156V10.8458Z"
                    fill="currentColor"
                />
            </svg>
        )
    }
    if (harnessId === "claude-code") {
        return (
            <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 fill-current">
                <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
            </svg>
        )
    }
    return null
}

function HarnessLabelPill({ harnessId, label, modelId, primitive }: { harnessId: HarnessId; label: string; modelId: string; primitive: string }) {
    const colors = HARNESS_COLORS[harnessId] ?? DEFAULT_HARNESS_COLOR
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border text-xs font-mono ${colors.bg} ${colors.text} ${colors.border}`}>
            <HarnessIcon harnessId={harnessId} />
            <span className="font-semibold">
                {primitive === "review" ? "Review" : "Plan"} {label}
            </span>
            <span className="opacity-60">{modelId}</span>
        </span>
    )
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
    reconciliationStarted,
}: {
    sub: HyperPlanSubExecution
    taskId: string
    actionEventId: string
    reconciliationStarted: boolean
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
                {sub.reconcileLabel ? (
                    <HarnessLabelPill harnessId={sub.harnessId} label={sub.reconcileLabel} modelId={sub.modelId} primitive={sub.primitive} />
                ) : reconciliationStarted ? (
                    <span className="text-muted italic">Not in reconciliation</span>
                ) : null}
            </div>
            {/* Pane content */}
            <div className="max-h-[300px] overflow-y-auto">
                {sub.events.length > 0 ? (
                    <InlineMessages events={sub.events} harnessId={sub.harnessId} sourceType="plan" taskId={taskId} actionEventId={actionEventId} />
                ) : (
                    <div className="px-3 py-4 text-center text-xs text-muted">Waiting...</div>
                )}
            </div>
            {/* Error display */}
            {sub.status === "error" && sub.error && <div className="px-2 py-1.5 bg-error/10 text-error text-xs border-t border-border">{sub.error}</div>}
        </div>
    )
}

function ReconcileLegend({ subExecutions }: { subExecutions: HyperPlanSubExecution[] }) {
    const labeled = subExecutions.filter((s) => s.reconcileLabel).sort((a, b) => a.reconcileLabel!.localeCompare(b.reconcileLabel!))
    if (labeled.length === 0) return null

    return (
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs text-muted border border-border rounded bg-base-200/50">
            {labeled.map((s) => (
                <HarnessLabelPill key={s.stepId} harnessId={s.harnessId} label={s.reconcileLabel!} modelId={s.modelId} primitive={s.primitive} />
            ))}
            <span className="italic text-[11px]">Randomized and hidden from agent to reduce bias</span>
        </div>
    )
}

export const HyperPlanEventItem = observer(function HyperPlanEventItem({ event, expanded, onToggle, taskId }: HyperPlanEventItemProps) {
    const subExecutions = event.hyperplanSubExecutions ?? []
    const terminalEvents = event.execution.events

    // Determine phase
    const allSubsComplete = subExecutions.length > 0 && subExecutions.every((s) => s.status === "completed" || s.status === "error")
    const isReconciling = allSubsComplete && event.status === "in_progress"
    const isComplete = event.status === "completed"
    const isPlanning = !allSubsComplete && event.status === "in_progress"
    const reconciliationStarted = subExecutions.some((s) => s.reconcileLabel)

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
            {event.userInput && <UserInputMessage text={event.userInput} />}
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
                            <SubPlanPane key={sub.stepId} sub={sub} taskId={taskId} actionEventId={event.id} reconciliationStarted={reconciliationStarted} />
                        ))}
                    </div>
                )}

                {/* Reconciliation legend — maps anonymous labels back to agents */}
                {reconciliationStarted && (
                    <div className="mb-3">
                        <ReconcileLegend subExecutions={subExecutions} />
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
                        {reconciliationStarted && (
                            <div className="mt-3">
                                <ReconcileLegend subExecutions={subExecutions} />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </CollapsibleEvent>
    )
})
