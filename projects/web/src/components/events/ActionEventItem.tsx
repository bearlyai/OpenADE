import { FileText, HelpCircle, Play, RefreshCw } from "lucide-react"
import { observer } from "mobx-react"
import { useMemo } from "react"
import { useCodeStore } from "../../store/context"
import type { ActionEvent } from "../../types"
import { InlineMessages, type SessionInfo, UserInputMessage } from "../InlineMessages"
import { CommentsSection } from "./CommentsSection"
import { type BaseEventItemProps, CollapsibleEvent } from "./shared"

export type DisplayMode = "full" | "compact"

interface ActionEventItemProps extends BaseEventItemProps {
    event: ActionEvent
    displayMode: DisplayMode
    taskId: string
    readOnlyComments?: boolean
}

function getEventIcon(sourceType: ActionEvent["source"]["type"]) {
    switch (sourceType) {
        case "plan":
            return { icon: <FileText size="1em" className="flex-shrink-0 text-primary" />, label: "Plan" }
        case "revise":
            return { icon: <RefreshCw size="1em" className="flex-shrink-0 text-primary" />, label: "Revise" }
        case "ask":
            return { icon: <HelpCircle size="1em" className="flex-shrink-0 text-info" />, label: "Ask" }
        default:
            return { icon: <Play size="1em" className="flex-shrink-0 text-success" />, label: "Do" }
    }
}

function isPlanOrRevise(event: ActionEvent): boolean {
    return event.source.type === "plan" || event.source.type === "revise"
}

export const ActionEventItem = observer(({ event, expanded, onToggle, taskId }: ActionEventItemProps) => {
    const codeStore = useCodeStore()
    const isPlan = isPlanOrRevise(event)
    const { icon, label } = getEventIcon(event.source.type)

    const hasCustomLabel = event.source.type !== "do"

    const sessionInfo: SessionInfo | undefined = useMemo(() => {
        if (!event.execution.sessionId) return undefined
        return {
            sessionId: event.execution.sessionId,
            parentSessionId: event.execution.parentSessionId,
        }
    }, [event.execution.sessionId, event.execution.parentSessionId])

    const includedComments = useMemo(() => {
        if (event.includesCommentIds.length === 0) return []
        const task = codeStore.tasks.getTask(taskId)
        if (!task) return []
        const includedIds = new Set(event.includesCommentIds)
        return task.comments.filter((c) => includedIds.has(c.id))
    }, [taskId, event.includesCommentIds])

    const useLabel = isPlan ? label : event.source.userLabel

    const hasDefunctSessionError = codeStore.events.hasDefunctSessionError(event)

    return (
        <CollapsibleEvent
            icon={icon}
            label={useLabel}
            query={isPlan ? event.userInput : hasCustomLabel ? undefined : event.userInput}
            event={event}
            expanded={expanded}
            onToggle={onToggle}
        >
            {event.userInput && <UserInputMessage text={event.userInput} />}
            {includedComments.length > 0 && <CommentsSection comments={includedComments} variant="submitted" />}

            {event.execution.events.length > 0 && (
                <InlineMessages
                    events={event.execution.events}
                    sourceType={event.source.type}
                    sessionInfo={sessionInfo}
                    taskId={taskId}
                    actionEventId={event.id}
                />
            )}

            {hasDefunctSessionError && (
                <div className="px-3 py-2 bg-warning/10 border-t border-warning/20 text-sm text-warning">
                    Session expired. Your next action will automatically resume from an earlier point.
                </div>
            )}
        </CollapsibleEvent>
    )
})
