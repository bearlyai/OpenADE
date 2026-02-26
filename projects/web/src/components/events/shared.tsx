import cx from "classnames"
import dayjs from "dayjs"
import { Loader } from "lucide-react"
import type { ReactNode } from "react"
import type { CodeEvent } from "../../types"

/**
 * Extract a human-readable error reason from a CodeEvent's stream events.
 * Returns undefined if the event has no actionable error information.
 */
export function getEventErrorReason(event: CodeEvent): string | undefined {
    if (event.type !== "action") return undefined

    // 1. Harness-level error events (process_crashed, rate_limited, ipc_error, etc.)
    const errorEvents = event.execution.events.filter((e) => e.direction === "execution" && e.type === "error")
    if (errorEvents.length > 0) {
        const last = errorEvents[errorEvents.length - 1] as { error: string; code?: string }
        return last.code ? `${last.error} (${last.code})` : last.error
    }

    // 2. Result messages with errors array
    for (const e of event.execution.events) {
        if (e.direction === "execution" && (e.type === "raw_message" || (e.type as string) === "sdk_message")) {
            const msg = (e as Record<string, unknown>).message as { type?: string; errors?: string[] } | undefined
            if (msg?.type === "result" && msg.errors?.length) {
                return msg.errors.join("; ")
            }
        }
    }

    // 3. Stderr fallback — use the last non-empty line
    const stderrLines = event.execution.events
        .filter((e) => e.direction === "execution" && e.type === "stderr")
        .map((e) => (e as { data: string }).data)
        .join("\n")
        .trim()
    if (stderrLines) {
        const lastLine = stderrLines.split("\n").filter(Boolean).pop()
        if (lastLine) {
            return lastLine.length > 200 ? `${lastLine.slice(0, 200)}...` : lastLine
        }
    }

    return undefined
}

export interface BaseEventItemProps {
    expanded: boolean
    onToggle: () => void
}

interface EventHeaderProps {
    icon: ReactNode
    label: string
    query?: string
    event: CodeEvent
    onToggle: () => void
}

function EventHeader({ icon, label, query, event, onToggle }: EventHeaderProps) {
    const isInProgress = event.status === "in_progress"
    const isError = event.status === "error"
    const isStopped = event.status === "stopped"
    const isFailed = event.status === "completed" && event.type === "action" && event.result?.success === false

    const errorReason = isError || isFailed ? getEventErrorReason(event) : undefined
    const truncatedQuery = query && query.length > 60 ? `${query.slice(0, 60)}...` : query

    return (
        <div className={cx("flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200", isInProgress && "bg-warning/10")} onClick={onToggle}>
            {isInProgress && <Loader size="1em" className="flex-shrink-0 animate-spin text-warning" />}
            {icon}
            <span className="font-medium text-sm">{label}</span>
            {truncatedQuery && (
                <span className="text-sm text-muted truncate flex-1" title={query}>
                    {truncatedQuery}
                </span>
            )}
            {!truncatedQuery && <div className="flex-1" />}
            <span className="text-xs text-muted flex-shrink-0">{dayjs(event.createdAt).format("MMM D, h:mm A")}</span>
            {isInProgress && <span className="text-xs text-warning flex-shrink-0">In progress...</span>}
            {isError && (
                <span className="text-xs text-error flex-shrink-0" title={errorReason} aria-label={errorReason ? `Error: ${errorReason}` : "Error"}>
                    Error
                </span>
            )}
            {isFailed && (
                <span className="text-xs text-error flex-shrink-0" title={errorReason} aria-label={errorReason ? `Failed: ${errorReason}` : "Failed"}>
                    Failed
                </span>
            )}
            {isStopped && <span className="text-xs text-muted flex-shrink-0">Stopped</span>}
            {event.status === "completed" && !isFailed && !isInProgress && <span className="text-xs text-success flex-shrink-0">Completed</span>}
        </div>
    )
}

export interface CollapsibleEventProps extends BaseEventItemProps {
    icon: ReactNode
    label: string
    query?: string
    event: CodeEvent
    children?: ReactNode
}

export function CollapsibleEvent({ icon, label, query, event, expanded, onToggle, children }: CollapsibleEventProps) {
    return (
        <div className="border-b border-border bg-base-100">
            <EventHeader icon={icon} label={label} query={query} event={event} onToggle={onToggle} />
            {expanded && children}
        </div>
    )
}
