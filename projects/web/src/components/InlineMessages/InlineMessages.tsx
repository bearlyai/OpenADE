import { useMemo, useState } from "react"
import type { ClaudeStreamEvent } from "../../electronAPI/claudeEventTypes"
import type { ActionEventSource } from "../../types"
import { FileViewer } from "../FilesAndDiffs"
import { type CommentContext, type DisplayContext, type GroupWithMeta, type MergedGroup, groupStreamEvents } from "../events/messageGroups"
import { getRenderMode } from "./getRenderMode"
import { groupByRenderMode } from "./groupByRenderMode"
import { getRenderer } from "./renderers"
import { InlineWrapper } from "./wrappers/InlineWrapper"
import { PillGroup } from "./wrappers/PillGroup"
import { RowWrapper } from "./wrappers/RowWrapper"

export interface SessionInfo {
    sessionId?: string
    parentSessionId?: string
}

export interface InlineMessagesProps {
    events: ClaudeStreamEvent[]
    sourceType: ActionEventSource["type"]
    sessionInfo?: SessionInfo
    taskId: string
    actionEventId: string
}

function getGroupId(group: MergedGroup, index: number): string {
    switch (group.type) {
        case "tool":
        case "edit":
        case "write":
        case "bash":
        case "todoWrite":
            return `${group.type}-${group.toolUseId}`
        case "text":
        case "thinking":
        case "system":
        case "result":
            return `${group.type}-${group.messageIndex}`
        case "stderr":
            return `stderr-${group.eventId}`
        default:
            return `unknown-${index}`
    }
}

function toggleSet(set: Set<string>, id: string): Set<string> {
    const next = new Set(set)
    if (next.has(id)) {
        next.delete(id)
    } else {
        next.add(id)
    }
    return next
}

export function InlineMessages({ events, sourceType, sessionInfo: _sessionInfo, taskId, actionEventId }: InlineMessagesProps) {
    // 1. Group raw events (no tool merging - groupByRenderMode handles pill grouping)
    const groups = useMemo(() => groupStreamEvents(events), [events])

    // 2. Find last text index for context
    const lastTextIndex = useMemo(() => {
        for (let i = groups.length - 1; i >= 0; i--) {
            if (groups[i].type === "text") return i
        }
        return -1
    }, [groups])

    // 3. Assign render modes + IDs
    const withMeta: GroupWithMeta[] = useMemo(() => {
        return groups.map((group, i) => {
            const ctx: DisplayContext = {
                sourceType,
                isLastTextGroup: group.type === "text" && i === lastTextIndex,
            }
            return {
                group,
                mode: getRenderMode(group, ctx),
                id: getGroupId(group, i),
            }
        })
    }, [groups, sourceType, lastTextIndex])

    // 4. Group consecutive pills
    const renderables = useMemo(() => groupByRenderMode(withMeta), [withMeta])

    // 5. Expansion state
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
    const toggle = (id: string) => setExpandedIds((prev) => toggleSet(prev, id))

    // Radio-button toggle for pills: only one pill expanded per group at a time
    const togglePill = (id: string, groupIds: string[]) => {
        setExpandedIds((prev) => {
            const next = new Set(prev)
            const wasExpanded = prev.has(id)
            // Clear all pills in this group
            for (const gid of groupIds) {
                next.delete(gid)
            }
            // If it wasn't expanded, expand it now
            if (!wasExpanded) {
                next.add(id)
            }
            return next
        })
    }

    const commentCtx: CommentContext = useMemo(() => ({ taskId, actionEventId }), [taskId, actionEventId])

    if (renderables.length === 0) return null

    // 6. Render
    return (
        <div className="flex flex-col">
            {renderables.map((item, i) => {
                if (item.mode === "inline") {
                    const renderer = getRenderer(item.item.group)
                    return <InlineWrapper key={item.item.id}>{renderer.renderContent(item.item.group, commentCtx)}</InlineWrapper>
                }

                if (item.mode === "row") {
                    const { group, id } = item.item
                    const renderer = getRenderer(group)
                    const isPending = "isPending" in group && group.isPending
                    const isError = "isError" in group && group.isError

                    return (
                        <RowWrapper
                            key={id}
                            icon={renderer.getIcon(group)}
                            label={renderer.getLabel(group)}
                            statusIcon={renderer.getStatusIcon?.(group)}
                            headerInfo={renderer.getHeaderInfo?.(group)}
                            isError={isError}
                            isPending={isPending}
                            expanded={expandedIds.has(id)}
                            onToggle={() => toggle(id)}
                        >
                            {renderer.renderContent(group, commentCtx)}
                        </RowWrapper>
                    )
                }

                if (item.mode === "pill") {
                    const groupIds = item.items.map((g) => g.id)
                    const pillItems = item.items.map(({ group, id }) => {
                        const renderer = getRenderer(group)
                        const isError = "isError" in group && group.isError
                        const isComplete = group.type === "result" || group.type === "system" || ("result" in group && group.result !== undefined)

                        return {
                            id,
                            icon: renderer.getIcon(group),
                            label: renderer.getLabel(group),
                            isError,
                            isComplete,
                            content: renderer.renderContent(group, commentCtx),
                        }
                    })

                    const expandedPillId = item.items.find((g) => expandedIds.has(g.id))?.id ?? null

                    return <PillGroup key={`pills-${i}`} items={pillItems} expandedId={expandedPillId} onToggle={(id) => togglePill(id, groupIds)} />
                }

                return null
            })}
        </div>
    )
}

/** Renders user input as a quoted File component with left accent border, collapsed by default */
export function UserInputMessage({ text }: { text: string }) {
    const [expanded, setExpanded] = useState(false)
    const lines = text.split("\n")
    const isLong = lines.length > 7
    const displayText = expanded || !isLong ? text : lines.slice(0, 7).join("\n")

    return (
        <div className="border-t border-border">
            <div className="border-l-2 border-primary bg-primary/5 mx-3 my-2 overflow-hidden">
                <FileViewer file={{ name: "input.md", contents: displayText, lang: "markdown" }} disableFileHeader disableLineNumbers commentHandlers={null} />
                {isLong && (
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className="btn w-full px-3 py-1 text-xs text-primary hover:bg-primary/10 transition-colors text-left"
                    >
                        {expanded ? "Show less" : `Show more (${lines.length - 7} more lines)`}
                    </button>
                )}
            </div>
        </div>
    )
}
