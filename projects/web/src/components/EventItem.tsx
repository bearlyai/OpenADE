/**
 * EventItem - Dispatches to the appropriate event renderer based on type
 */

import { observer } from "mobx-react"
import { useCodeStore } from "../store/context"
import type { ActionEvent, CodeEvent } from "../types"
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

export const EventItem = observer(
    ({
        taskId,
        event,
        isLast,
        isLatestPlan,
    }: {
        taskId: string
        event: CodeEvent
        isLast: boolean
        isLatestPlan: boolean
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

        switch (event.type) {
            case "action": {
                // HyperPlan events get their own renderer
                if (event.source.type === "hyperplan") {
                    return <HyperPlanEventItem {...baseProps} event={event} taskId={taskId} />
                }

                const isPlan = isPlanOrRevise(event)
                // Determine display mode based on source type
                // plan/revise -> full, do/ask/run_plan -> compact
                const displayMode: DisplayMode = isPlan ? "full" : "compact"

                return <ActionEventItem {...baseProps} event={event} displayMode={displayMode} taskId={taskId} readOnlyComments={isPlan && !isLatestPlan} />
            }
            case "setup_environment":
                return <SetupEventItem {...baseProps} event={event} />
            case "snapshot":
                return <SnapshotEventItem {...baseProps} event={event} taskId={taskId} />
            default:
                return null
        }
    }
)
