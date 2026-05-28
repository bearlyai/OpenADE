/**
 * EventLog - Container for all events, displays newest at bottom
 */

import { Code } from "lucide-react"
import { observer } from "mobx-react"
import type { CodeEvent } from "../types"
import { EventItem, NO_AUTO_EXPAND_TYPES } from "./EventItem"

export const EventLog = observer(
    ({
        taskId,
        events,
    }: {
        taskId: string
        events: CodeEvent[]
    }) => {
        if (events.length === 0) {
            return (
                <div className="h-full flex flex-col items-center justify-center text-muted px-8 py-16">
                    <Code size="3rem" className="mb-4 opacity-30" />
                    <div className="text-lg font-medium mb-2">No activity yet</div>
                    <div className="text-sm text-center">Enter a task description below and click Plan or Do to get started.</div>
                </div>
            )
        }

        // Find the latest plan event ID (plan or revise source types)
        const latestPlanId = [...events].reverse().find((e) => e.type === "action" && (e.source.type === "plan" || e.source.type === "revise"))?.id

        // Find last event index that can auto-expand (excludes noAutoExpand types like snapshot)
        const lastAutoExpandIndex =
            events
                .map((e, i) => ({ e, i }))
                .filter(({ e }) => !NO_AUTO_EXPAND_TYPES.has(e.type))
                .pop()?.i ?? -1

        return (
            <div className="flex flex-col">
                {events.map((event, index) => {
                    const isLast = index === lastAutoExpandIndex
                    return (
                        <EventItem
                            key={event.id}
                            taskId={taskId}
                            event={event}
                            isLast={isLast}
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
