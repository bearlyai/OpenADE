import { useMemo, useState } from "react"
import type { HarnessId, HarnessStreamEvent } from "../../electronAPI/harnessEventTypes"
import { useCodeStore } from "../../store/context"
import type { ActionEventSource } from "../../types"
import { FileViewer } from "../FilesAndDiffs"
import { type CommentContext, type DisplayContext, type GroupWithMeta, type MergedGroup, groupStreamEvents } from "../events/messageGroups"
import { MarkdownMessage } from "../MarkdownMessage"
import { getRenderMode } from "./getRenderMode"
import { groupByRenderMode } from "./groupByRenderMode"
import { getRenderer } from "./renderers"
import { InlineWrapper } from "./wrappers/InlineWrapper"
import { PillGroup } from "./wrappers/PillGroup"
import { RowWrapper } from "./wrappers/RowWrapper"

const INITIAL_STREAM_EVENT_TAIL_COUNT = 120

export interface SessionInfo {
    sessionId?: string
    parentSessionId?: string
}

export interface InlineMessagesProps {
    events: HarnessStreamEvent[]
    omittedEventCount?: number
    harnessId: HarnessId
    sourceType: ActionEventSource["type"]
    sessionInfo?: SessionInfo
    taskId: string
    actionEventId: string
    onRequestFullHistory?: () => void
}

function getGroupId(group: MergedGroup, index: number): string {
    switch (group.type) {
        case "tool":
        case "edit":
        case "write":
        case "bash":
        case "todoWrite":
            return `${group.type}-${group.toolUseId}`
        case "fileChange":
            return `${group.type}-${group.toolUseId}-${group.changeIndex}-${group.filePath}`
        case "text":
        case "thinking":
        case "system":
        case "result":
            return `${group.type}-${group.messageIndex}`
        case "stderr":
            return `stderr-${group.eventId}`
        case "unknown":
            return `${group.type}-${group.harnessId}-${group.messageIndex}-${group.originalType ?? index}`
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

export function InlineMessages({
    events,
    omittedEventCount = 0,
    harnessId,
    sourceType,
    sessionInfo: _sessionInfo,
    taskId,
    actionEventId,
    onRequestFullHistory,
}: InlineMessagesProps) {
    const [showAllRenderables, setShowAllRenderables] = useState(false)
    const [fullHistoryRequested, setFullHistoryRequested] = useState(false)
    const localHiddenStreamEventCount = showAllRenderables ? 0 : Math.max(0, events.length - INITIAL_STREAM_EVENT_TAIL_COUNT)
    const canRequestFullHistory = onRequestFullHistory !== undefined
    const hiddenStreamEventCount = (canRequestFullHistory ? omittedEventCount : 0) + localHiddenStreamEventCount
    const eventsForGrouping = useMemo(
        () => (localHiddenStreamEventCount > 0 ? events.slice(localHiddenStreamEventCount) : events),
        [events, localHiddenStreamEventCount]
    )

    // 1. Group raw events (no tool merging - groupByRenderMode handles pill grouping)
    const groups = useMemo(() => groupStreamEvents(eventsForGrouping, harnessId), [eventsForGrouping, harnessId])

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

    if (renderables.length === 0 && hiddenStreamEventCount === 0) return null

    const handleShowEarlier = () => {
        setShowAllRenderables(true)
        if (canRequestFullHistory) {
            setFullHistoryRequested(true)
            onRequestFullHistory()
        }
    }

    // 6. Render
    return (
        <div className="flex flex-col">
            {hiddenStreamEventCount > 0 && (
                <button
                    type="button"
                    className="btn border-t border-border px-3 py-2 text-left text-xs text-muted hover:bg-base-200 hover:text-base-content"
                    onClick={handleShowEarlier}
                    disabled={canRequestFullHistory && fullHistoryRequested && omittedEventCount > 0}
                >
                    {canRequestFullHistory && fullHistoryRequested && omittedEventCount > 0
                        ? `Loading ${omittedEventCount.toLocaleString()} earlier stream events...`
                        : `Show ${hiddenStreamEventCount.toLocaleString()} earlier stream events`}
                </button>
            )}
            {renderables.map((item) => {
                if (item.mode === "inline") {
                    const renderer = getRenderer(item.item.group)
                    return <InlineWrapper key={item.item.id}>{renderer.renderContent(item.item.group, commentCtx)}</InlineWrapper>
                }

                if (item.mode === "row") {
                    const { group, id } = item.item
                    const renderer = getRenderer(group)
                    const isPending = "isPending" in group && group.isPending
                    const isError = "isError" in group && group.isError
                    const expanded = expandedIds.has(id)

                    return (
                        <RowWrapper
                            key={id}
                            icon={renderer.getIcon(group)}
                            label={renderer.getLabel(group)}
                            statusIcon={renderer.getStatusIcon?.(group)}
                            headerInfo={renderer.getHeaderInfo?.(group)}
                            isError={isError}
                            isPending={isPending}
                            expanded={expanded}
                            onToggle={() => toggle(id)}
                        >
                            {expanded ? renderer.renderContent(group, commentCtx) : null}
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
                            renderContent: () => renderer.renderContent(group, commentCtx),
                        }
                    })

                    const expandedPillId = item.items.find((g) => expandedIds.has(g.id))?.id ?? null
                    const firstId = item.items[0]?.id ?? "empty"
                    const lastId = item.items[item.items.length - 1]?.id ?? firstId

                    return (
                        <PillGroup
                            key={`pills-${firstId}-${lastId}`}
                            items={pillItems}
                            expandedId={expandedPillId}
                            onToggle={(id) => togglePill(id, groupIds)}
                        />
                    )
                }

                return null
            })}
        </div>
    )
}

/** Renders user input as a quoted File component with left accent border, collapsed by default */
export function UserInputMessage({ text, taskId }: { text: string; taskId?: string }) {
    const codeStore = useCodeStore()
    const renderMarkdown = codeStore.personalSettingsStore?.settings.current.renderMarkdownMessages ?? true
    const [expanded, setExpanded] = useState(false)
    const lines = text.split("\n")
    const isLong = lines.length > 7
    const displayText = expanded || !isLong ? text : lines.slice(0, 7).join("\n")

    return (
        <div className="border-t border-border">
            <div className="border-l-2 border-primary bg-primary/5 mx-5 my-2 overflow-hidden">
                {renderMarkdown ? (
                    <MarkdownMessage text={displayText} commentHandlers={null} taskId={taskId} />
                ) : (
                    <FileViewer
                        file={{ name: "input.md", contents: displayText, lang: "markdown" }}
                        copyContent={text}
                        disableFileHeader
                        disableLineNumbers
                        commentHandlers={null}
                    />
                )}
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
