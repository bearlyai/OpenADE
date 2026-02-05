/**
 * EventLog - Container for all events, displays newest at bottom
 */

import { Code } from "lucide-react"
import { observer } from "mobx-react"
import type { CodeEvent, SetupEnvironmentEvent } from "../types"
import { getDeviceId } from "../utils/deviceId"
import { EventItem, NO_AUTO_EXPAND_TYPES } from "./EventItem"

export const EventLog = observer(
    ({
        taskId,
        events,
    }: {
        taskId: string
        events: CodeEvent[]
    }) => {
        // Filter out setup_environment events from other devices
        const currentDeviceId = getDeviceId()
        const filteredEvents = events.filter((event) => {
            if (event.type === "setup_environment") {
                const setupEvent = event as SetupEnvironmentEvent
                return setupEvent.deviceId === currentDeviceId
            }
            return true
        })

        if (filteredEvents.length === 0) {
            return (
                <div className="h-full flex flex-col items-center justify-center text-muted px-8 py-16">
                    <Code size="3rem" className="mb-4 opacity-30" />
                    <div className="text-lg font-medium mb-2">No activity yet</div>
                    <div className="text-sm text-center">Enter a task description below and click Plan or Do to get started.</div>
                </div>
            )
        }

        // Find the latest plan event ID (plan or revise source types)
        const latestPlanId = [...filteredEvents].reverse().find((e) => e.type === "action" && (e.source.type === "plan" || e.source.type === "revise"))?.id

        // Find last event index that can auto-expand (excludes noAutoExpand types like snapshot)
        const lastAutoExpandIndex =
            filteredEvents
                .map((e, i) => ({ e, i }))
                .filter(({ e }) => !NO_AUTO_EXPAND_TYPES.has(e.type))
                .pop()?.i ?? -1

        return (
            <div className="flex flex-col">
                {filteredEvents.map((event, index) => {
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
