/**
 * EventLog - Container for all events, displays newest at bottom
 */

import { Code, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { useState } from "react"
import type { CodeEvent } from "../types"
import { EventItem, NO_AUTO_EXPAND_TYPES } from "./EventItem"

const INITIAL_RENDERABLE_EVENT_TAIL_COUNT = 80

function latestPlanEventId(events: CodeEvent[]): string | undefined {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]
        if (event.type === "action" && (event.source.type === "plan" || event.source.type === "revise")) return event.id
    }
    return undefined
}

function lastAutoExpandEventIndex(events: CodeEvent[]): number {
    for (let index = events.length - 1; index >= 0; index--) {
        if (!NO_AUTO_EXPAND_TYPES.has(events[index].type)) return index
    }
    return -1
}

export const EventLog = observer(
    ({
        taskId,
        events,
        isLoading,
        onRequestFullHistory,
    }: {
        taskId: string
        events: CodeEvent[]
        isLoading?: boolean
        onRequestFullHistory?: () => void
    }) => {
        const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

        if (events.length === 0) {
            return (
                <div className="h-full flex flex-col items-center justify-center text-muted px-8 py-16">
                    {isLoading ? <Loader2 size="3rem" className="mb-4 animate-spin opacity-40" /> : <Code size="3rem" className="mb-4 opacity-30" />}
                    <div className="text-lg font-medium mb-2">{isLoading ? "Loading activity..." : "No activity yet"}</div>
                    <div className="text-sm text-center">
                        {isLoading ? "Fetching the latest task events." : "Enter a task description below and click Plan or Do to get started."}
                    </div>
                </div>
            )
        }

        // Find the latest plan event ID (plan or revise source types)
        const latestPlanId = latestPlanEventId(events)

        // Find last event index that can auto-expand (excludes noAutoExpand types like snapshot)
        const lastAutoExpandIndex = lastAutoExpandEventIndex(events)
        const showAllEvents = expandedTaskId === taskId
        const tailStartIndex = Math.max(0, events.length - INITIAL_RENDERABLE_EVENT_TAIL_COUNT)
        const firstVisibleIndex = showAllEvents ? 0 : lastAutoExpandIndex >= 0 ? Math.min(tailStartIndex, lastAutoExpandIndex) : tailStartIndex
        const hiddenEventCount = firstVisibleIndex
        const visibleEvents = hiddenEventCount > 0 ? events.slice(firstVisibleIndex) : events

        return (
            <div className="flex flex-col">
                {hiddenEventCount > 0 && (
                    <button
                        type="button"
                        className="btn border-b border-border px-3 py-2 text-left text-xs text-muted hover:bg-base-200 hover:text-base-content"
                        onClick={() => {
                            setExpandedTaskId(taskId)
                        }}
                    >
                        Show {hiddenEventCount.toLocaleString()} earlier events
                    </button>
                )}
                {visibleEvents.map((event, visibleIndex) => {
                    const eventIndex = firstVisibleIndex + visibleIndex
                    const isLast = eventIndex === lastAutoExpandIndex
                    return (
                        <EventItem
                            key={event.id}
                            taskId={taskId}
                            event={event}
                            isLast={isLast}
                            onRequestFullHistory={onRequestFullHistory}
                            isLatestPlan={
                                event.type === "action" && (event.source.type === "plan" || event.source.type === "revise") && event.id === latestPlanId
                            }
                        />
                    )
                })}
            </div>
        )
    }
)
