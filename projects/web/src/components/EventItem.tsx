/**
 * EventItem - Dispatches to the appropriate event renderer based on type
 */

import { CircleHelp } from "lucide-react"
import { observer } from "mobx-react"
import { useCodeStore } from "../store/context"
import type { ActionEvent, CodeEvent } from "../types"
import { FileViewer } from "./FilesAndDiffs"
import { ActionEventItem, type DisplayMode } from "./events/ActionEventItem"
import { SetupEventItem } from "./events/SetupEventItem"
import { SnapshotEventItem } from "./events/SnapshotEventItem"
import { HyperPlanEventItem } from "./hyperplan/HyperPlanEventItem"

/** Event types that should never auto-expand (loading, isLast, etc.) - only manual toggle */
export const NO_AUTO_EXPAND_TYPES: Set<CodeEvent["type"]> = new Set(["snapshot"])

/** Check if an ActionEvent is a plan, revise, or hyperplan type */
function isPlanOrRevise(event: ActionEvent): boolean {
    return event.source.type === "plan" || event.source.type === "revise" || event.source.type === "hyperplan"
}

export type EventRenderKind = "action" | "hyperplan" | "setup_environment" | "snapshot" | "unknown"

export function getEventRenderKind(event: { type?: unknown; source?: unknown }): EventRenderKind {
    if (event.type === "action") {
        const source = typeof event.source === "object" && event.source !== null ? (event.source as { type?: unknown }) : {}
        return source.type === "hyperplan" ? "hyperplan" : "action"
    }
    if (event.type === "setup_environment") return "setup_environment"
    if (event.type === "snapshot") return "snapshot"
    return "unknown"
}

function stringifyRaw(value: unknown): string {
    try {
        const json = JSON.stringify(value, null, 2)
        return json ?? String(value)
    } catch {
        return String(value)
    }
}

function UnknownEventItem({
    event,
    expanded,
    onToggle,
}: {
    event: unknown
    expanded: boolean
    onToggle: () => void
}) {
    const record = typeof event === "object" && event !== null && !Array.isArray(event) ? (event as Record<string, unknown>) : {}
    const type = typeof record.type === "string" && record.type.length > 0 ? record.type : "event"
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : undefined
    const contents = stringifyRaw(event)

    return (
        <div className="border-b border-border bg-base-100">
            <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-base-200" onClick={onToggle}>
                <CircleHelp size="1em" className="flex-shrink-0 text-warning" />
                <span className="font-medium text-sm">Unknown event</span>
                <span className="text-sm text-muted truncate flex-1">{type}</span>
                {createdAt && <span className="text-xs text-muted flex-shrink-0">{createdAt}</span>}
            </button>
            {expanded && (
                <div className="px-3 pb-3">
                    <FileViewer
                        file={{ name: "unknown-task-event.json", contents, lang: "json" }}
                        copyContent={contents}
                        disableFileHeader
                        commentHandlers={null}
                    />
                </div>
            )}
        </div>
    )
}

export const EventItem = observer(
    ({
        taskId,
        event,
        isLast,
        isLatestPlan,
        onRequestFullHistory,
    }: {
        taskId: string
        event: CodeEvent
        isLast: boolean
        isLatestPlan: boolean
        onRequestFullHistory?: () => void
    }) => {
        const codeStore = useCodeStore()
        const taskUIState = codeStore.tasks.getTaskUIState(taskId)
        const isInProgress = event.status === "in_progress"
        const isExplicitlyExpanded = taskUIState.isEventExpanded(event.id)
        const hasExplicitState = taskUIState.hasExplicitState
        const isNoAutoExpand = NO_AUTO_EXPAND_TYPES.has(event.type)
        // For noAutoExpand types, only expand if explicitly toggled by user
        const expanded = isExplicitlyExpanded || (!isNoAutoExpand && (isInProgress || (isLast && !hasExplicitState)))

        const handleToggle = () => {
            taskUIState.toggleEventExpanded(event.id)
        }

        const baseProps = {
            expanded,
            onToggle: handleToggle,
        }

        switch (getEventRenderKind(event)) {
            case "hyperplan":
                return <HyperPlanEventItem {...baseProps} event={event as ActionEvent} taskId={taskId} onRequestFullHistory={onRequestFullHistory} />
            case "action": {
                const actionEvent = event as ActionEvent
                const isPlan = isPlanOrRevise(actionEvent)
                // Determine display mode based on source type
                // plan/revise -> full, do/ask/run_plan -> compact
                const displayMode: DisplayMode = isPlan ? "full" : "compact"

                return (
                    <ActionEventItem
                        {...baseProps}
                        event={actionEvent}
                        displayMode={displayMode}
                        taskId={taskId}
                        readOnlyComments={isPlan && !isLatestPlan}
                        onRequestFullHistory={onRequestFullHistory}
                    />
                )
            }
            case "setup_environment":
                return <SetupEventItem {...baseProps} event={event as Extract<CodeEvent, { type: "setup_environment" }>} />
            case "snapshot":
                return <SnapshotEventItem {...baseProps} event={event as Extract<CodeEvent, { type: "snapshot" }>} taskId={taskId} />
            case "unknown":
                return <UnknownEventItem {...baseProps} event={event} />
            default:
                return null
        }
    }
)
