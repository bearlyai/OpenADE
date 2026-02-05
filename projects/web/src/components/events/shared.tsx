import cx from "classnames"
import dayjs from "dayjs"
import { Loader } from "lucide-react"
import type { ReactNode } from "react"
import type { CodeEvent } from "../../types"

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
            {isError && <span className="text-xs text-error flex-shrink-0">Error</span>}
            {isStopped && <span className="text-xs text-muted flex-shrink-0">Stopped</span>}
            {event.status === "completed" && !isInProgress && <span className="text-xs text-success flex-shrink-0">Completed</span>}
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
