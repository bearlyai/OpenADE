import { AlertTriangle, ArrowUpFromLine, FileText, GitCommit, HelpCircle, Play, RefreshCw } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useMemo, useState } from "react"
import { openUrlInNativeBrowser } from "../../electronAPI/shell"
import { useCodeStore } from "../../store/context"
import type { ActionEvent } from "../../types"
import { InlineMessages, type SessionInfo, UserInputMessage } from "../InlineMessages"
import { CommentsSection } from "./CommentsSection"
import { ImageAttachments } from "./ImageAttachments"
import { type BaseEventItemProps, CollapsibleEvent } from "./shared"

export type DisplayMode = "full" | "compact"

interface ActionEventItemProps extends BaseEventItemProps {
    event: ActionEvent
    displayMode: DisplayMode
    taskId: string
    readOnlyComments?: boolean
}

function getEventIcon(sourceType: ActionEvent["source"]["type"], userLabel?: string) {
    switch (sourceType) {
        case "plan":
            return { icon: <FileText size="1em" className="flex-shrink-0 text-primary" />, label: "Plan" }
        case "revise":
            return { icon: <RefreshCw size="1em" className="flex-shrink-0 text-primary" />, label: "Revise" }
        case "ask":
            return { icon: <HelpCircle size="1em" className="flex-shrink-0 text-info" />, label: "Ask" }
        default:
            if (userLabel === "Commit") return { icon: <GitCommit size="1em" className="flex-shrink-0 text-muted" />, label: "Commit" }
            if (userLabel === "Push") return { icon: <ArrowUpFromLine size="1em" className="flex-shrink-0 text-muted" />, label: "Push" }
            return { icon: <Play size="1em" className="flex-shrink-0 text-success" />, label: "Do" }
    }
}

function isPlanOrRevise(event: ActionEvent): boolean {
    return event.source.type === "plan" || event.source.type === "revise"
}

export const ActionEventItem = observer(({ event, expanded, onToggle, taskId }: ActionEventItemProps) => {
    const codeStore = useCodeStore()
    const isPlan = isPlanOrRevise(event)
    const { icon, label } = getEventIcon(event.source.type, event.source.userLabel)

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

    const isPushEvent = event.source.userLabel === "Push"
    const cachedHasGhCli = codeStore.tasks.getTaskModel(taskId)?.hasGhCli ?? true
    const [recheckedGhCli, setRecheckedGhCli] = useState<boolean | null>(null)

    // Re-check gh CLI when a completed Push event shows the banner due to stale cache
    useEffect(() => {
        if (!isPushEvent || event.status !== "completed" || cachedHasGhCli) return
        const repoId = codeStore.tasks.getTaskModel(taskId)?.repoId
        if (!repoId) return

        let cancelled = false
        codeStore.repos.refreshGhCliStatus(repoId).then((result) => {
            if (!cancelled) {
                setRecheckedGhCli(result)
            }
        })
        return () => {
            cancelled = true
        }
    }, [isPushEvent, event.status, cachedHasGhCli, taskId])

    const hasGhCli = recheckedGhCli ?? cachedHasGhCli
    const showGhCliBanner = isPushEvent && !hasGhCli && event.status === "completed"

    return (
        <CollapsibleEvent icon={icon} label={useLabel} query={event.userInput} event={event} expanded={expanded} onToggle={onToggle}>
            {event.images && event.images.length > 0 && (
                <div className="px-3">
                    <ImageAttachments images={event.images} />
                </div>
            )}
            {event.userInput && <UserInputMessage text={event.userInput} />}
            {includedComments.length > 0 && <CommentsSection comments={includedComments} variant="submitted" />}

            {event.execution.events.length > 0 && (
                <div className="ml-3 border-l-2 border-primary/20">
                    <InlineMessages
                        events={event.execution.events}
                        sourceType={event.source.type}
                        sessionInfo={sessionInfo}
                        taskId={taskId}
                        actionEventId={event.id}
                    />
                </div>
            )}

            {hasDefunctSessionError && (
                <div className="px-3 py-2 bg-warning/10 border-t border-warning/20 text-sm text-warning">
                    Session expired. Your next action will automatically resume from an earlier point.
                </div>
            )}

            {showGhCliBanner && (
                <div className="px-3 py-2 bg-warning/10 border-t border-warning/20 text-sm text-warning flex items-center gap-2">
                    <AlertTriangle size={14} className="flex-shrink-0" />
                    <span>
                        Improve and automate your PR creation process by{" "}
                        <button type="button" className="btn underline hover:opacity-80" onClick={() => openUrlInNativeBrowser("https://cli.github.com/")}>
                            installing the GitHub CLI
                        </button>
                        .
                    </span>
                </div>
            )}
        </CollapsibleEvent>
    )
})
