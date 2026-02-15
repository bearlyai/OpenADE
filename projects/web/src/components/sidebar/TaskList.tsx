import type { TaskPreview, TaskPreviewLastEvent } from "@/persistence/repoStore"
import { ContextMenu } from "@base-ui-components/react/context-menu"
import cx from "classnames"
import { CheckCircle, ListTodo, Loader2, Plus, RotateCcw, Square, Trash2, X } from "lucide-react"
import { observer } from "mobx-react"
import { useCodeNavigate } from "../../routing"
import { usePortalContainer } from "../../hooks/usePortalContainer"
import { useCodeStore } from "../../store/context"
import type { TaskCreation } from "../../store/managers/TaskCreationManager"
import type { CodeEvent } from "../../types"
import { ScrollArea } from "../ui"

function isPlanType(lastEvent: TaskPreviewLastEvent): boolean {
    return lastEvent.sourceType === "plan" || lastEvent.sourceType === "revise"
}

function codeEventToPreviewEvent(event: CodeEvent): TaskPreviewLastEvent {
    const sourceLabel = (() => {
        if (event.type === "action") return event.source.userLabel
        if (event.type === "setup_environment") return "Setup"
        return "Snapshot"
    })()

    return {
        type: event.type,
        status: event.status,
        sourceType: event.type === "action" ? event.source.type : undefined,
        sourceLabel,
        at: event.createdAt,
    }
}

function getInProgressEventForTask(codeStore: ReturnType<typeof useCodeStore>, taskId: string): TaskPreviewLastEvent | null {
    const task = codeStore.tasks.getTask(taskId)
    if (!task || task.events.length === 0) return null

    const lastEvent = task.events[task.events.length - 1]
    if (lastEvent.status === "in_progress") {
        return codeEventToPreviewEvent(lastEvent)
    }
    return null
}

// ============================================================================
// Status helpers
// ============================================================================

function getStatusColor(lastEvent: TaskPreviewLastEvent): string {
    if (lastEvent.status === "error") return "text-error"
    if (isPlanType(lastEvent)) return "text-primary"
    return "text-success"
}

function getStatusIcon(lastEvent: TaskPreviewLastEvent): React.ReactNode {
    switch (lastEvent.status) {
        case "in_progress":
            return <Loader2 className="w-3 h-3 animate-spin" />
        case "completed":
            return null
        case "error":
            return <X className="w-3 h-3" />
        case "stopped":
            return <Square className="w-3 h-3" />
    }
}

// ============================================================================
// Context menu item styling (matches Menu.tsx patterns)
// ============================================================================

const contextItemClassName =
    "flex cursor-pointer items-center gap-2 py-2 pr-3 pl-3 text-sm leading-4 outline-none select-none data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-white data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-0.5 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:bg-primary"

const contextPopupClassName =
    "origin-[var(--transform-origin)] bg-base-200 py-0.5 text-base-content shadow-lg outline outline-1 outline-border transition-[transform,scale,opacity] data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:scale-90 data-[starting-style]:opacity-0 z-50"

// ============================================================================
// TaskItem — single-line with right-click context menu
// ============================================================================

const TaskItem = ({
    preview,
    isActive,
    isUnread,
    inProgressEvent,
    onSelect,
    onDelete,
    onToggleClosed,
}: {
    preview: TaskPreview
    isActive: boolean
    isUnread: boolean
    inProgressEvent: TaskPreviewLastEvent | null
    onSelect: () => void
    onDelete: () => void
    onToggleClosed: () => void
}) => {
    const isClosed = preview.closed ?? false
    const displayEvent = inProgressEvent ?? preview.lastEvent
    const portalContainer = usePortalContainer()

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                className="flex w-full"
                render={
                    <div
                        role="button"
                        tabIndex={0}
                        className={cx(
                            "group btn flex items-center gap-2 font-normal py-1.5 pl-3 pr-2 hover:bg-base-200 w-full cursor-pointer text-sm",
                            isClosed ? "text-muted" : "text-base-content",
                            isActive && "bg-base-300",
                            !isClosed && isUnread && "border-l-2 border-l-primary"
                        )}
                        onClick={onSelect}
                        onKeyDown={(e) => {
                            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                                e.preventDefault()
                                onSelect()
                            }
                        }}
                        title={preview.title}
                    />
                }
            >
                {/* Title */}
                <span className="truncate min-w-0 flex-1 select-none">{preview.title}</span>

                {/* Status suffix */}
                {!isClosed && displayEvent && (
                    <span className={cx("flex items-center gap-1 text-xs flex-shrink-0", getStatusColor(displayEvent))}>
                        {getStatusIcon(displayEvent)}
                        <span>{displayEvent.sourceLabel}</span>
                    </span>
                )}

                {isClosed && <span className="text-[11px] text-muted flex-shrink-0">Closed</span>}
            </ContextMenu.Trigger>
            <ContextMenu.Portal container={portalContainer}>
                <ContextMenu.Positioner className="outline-none z-50" sideOffset={4}>
                    <ContextMenu.Popup className={contextPopupClassName}>
                        <ContextMenu.Item className={contextItemClassName} onClick={onToggleClosed}>
                            {isClosed ? <RotateCcw className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                            <span>{isClosed ? "Reopen" : "Close"}</span>
                        </ContextMenu.Item>
                        <ContextMenu.Item className={contextItemClassName} onClick={onDelete}>
                            <Trash2 className="w-4 h-4" />
                            <span>Delete</span>
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    )
}

// ============================================================================
// CreatingTaskItem
// ============================================================================

const CreationCancelButton = ({ onCancel }: { onCancel: () => void }) => {
    const isTouchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches

    return (
        <div
            className={cx("flex ml-auto flex-shrink-0", !isTouchDevice && "opacity-0 group-hover:opacity-100 transition-opacity")}
            onClick={(e) => {
                e.stopPropagation()
                onCancel()
            }}
        >
            <div className="flex flex-shrink-0 p-1 px-0.5 cursor-pointer hover:text-error">
                <X className="w-4 h-4 text-muted" />
            </div>
        </div>
    )
}

const CreatingTaskItem = ({
    creation,
    isActive,
    onSelect,
    onCancel,
}: { creation: TaskCreation; isActive: boolean; onSelect: () => void; onCancel: () => void }) => {
    const hasError = creation.error !== null

    return (
        <div
            role="button"
            tabIndex={0}
            className={cx(
                "group btn flex items-center font-normal gap-2 p-1 px-3 hover:bg-base-200 w-full cursor-pointer",
                isActive && "bg-base-300",
                hasError ? "text-error" : "text-muted"
            )}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault()
                    onSelect()
                }
            }}
            title={creation.description}
        >
            <Loader2 className={cx("w-4 h-4 flex-shrink-0", !hasError && "animate-spin")} />
            <span className="truncate min-w-0 flex-1 select-none text-xs italic">{hasError ? "Creation failed..." : "Creating task..."}</span>
            <CreationCancelButton onCancel={onCancel} />
        </div>
    )
}

// ============================================================================
// TasksSidebarContent
// ============================================================================

interface TasksSidebarContentProps {
    workspaceId: string
    taskId: string | undefined
    creationId?: string
}

export const TasksSidebarContent = observer(({ workspaceId, taskId, creationId }: TasksSidebarContentProps) => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()

    // Get task previews directly from RepoStore
    const repo = codeStore.repoStore?.repos.get(workspaceId)
    const previews = repo?.tasks ?? []
    const zeroTime = new Date(0).toISOString()
    // Sort by most recent activity: last event start time, or task creation time
    const sortByRecent = (a: TaskPreview, b: TaskPreview) => {
        const aTime = a.lastEvent?.at ?? a?.createdAt ?? zeroTime
        const bTime = b.lastEvent?.at ?? b?.createdAt ?? zeroTime
        return bTime.localeCompare(aTime)
    }
    const openPreviews = previews.filter((t) => !t.closed).sort(sortByRecent)
    const closedPreviews = previews.filter((t) => t.closed).sort(sortByRecent)
    const sortedPreviews = [...openPreviews, ...closedPreviews]
    const creations = codeStore.creation.getCreationsForRepo(workspaceId)

    const handleAddTask = () => {
        navigate.go("CodeWorkspaceTaskCreate", { workspaceId })
    }

    const handleSelectTask = (selectedTaskId: string) => {
        navigate.go("CodeWorkspaceTask", { workspaceId, taskId: selectedTaskId })
    }

    const handleSelectCreation = (selectedCreationId: string) => {
        navigate.go("CodeWorkspaceTaskCreating", { workspaceId, creationId: selectedCreationId })
    }

    const handleDeleteTask = async (deletedTaskId: string) => {
        await codeStore.tasks.removeTask(deletedTaskId)
        if (taskId === deletedTaskId) {
            navigate.go("CodeWorkspace", { workspaceId })
        }
    }

    const handleCancelCreation = async (cancelledCreationId: string) => {
        await codeStore.creation.cancelCreation(cancelledCreationId)
        if (creationId === cancelledCreationId) {
            navigate.go("CodeWorkspaceTaskCreate", { workspaceId })
        }
    }

    const handleToggleClosed = async (toggledTaskId: string, currentClosed: boolean) => {
        await codeStore.tasks.setTaskClosed(toggledTaskId, !currentClosed)
    }

    const isEmpty = sortedPreviews.length === 0 && creations.length === 0

    return (
        <div className="flex flex-col h-full mt-4">
            <div className="flex items-center justify-between pl-2 pr-1.5 mb-2">
                <h2 className="text-muted text-sm font-medium select-none">Tasks</h2>
                <button
                    type="button"
                    className="btn flex items-center gap-1 px-2 py-1 text-xs font-medium bg-base-200 hover:bg-base-300 text-base-content transition-colors cursor-pointer"
                    onClick={handleAddTask}
                >
                    <Plus className="w-3 h-3" />
                    <span>New task</span>
                </button>
            </div>
            <ScrollArea className="flex-1">
                <div className="flex flex-col gap-0.5 px-1.5">
                    {isEmpty ? (
                        <div className="flex flex-col items-center justify-center py-8 text-muted">
                            <ListTodo size="1.5rem" className="mb-2 opacity-50" />
                            <div className="text-xs">No tasks yet</div>
                        </div>
                    ) : (
                        <>
                            {creations.map((creation) => (
                                <CreatingTaskItem
                                    key={creation.id}
                                    creation={creation}
                                    isActive={creationId === creation.id}
                                    onSelect={() => handleSelectCreation(creation.id)}
                                    onCancel={() => handleCancelCreation(creation.id)}
                                />
                            ))}
                            {sortedPreviews.map((preview) => (
                                <TaskItem
                                    key={preview.id}
                                    preview={preview}
                                    isActive={taskId === preview.id}
                                    isUnread={!preview.closed && !!preview.lastEventAt && (!preview.lastViewedAt || preview.lastEventAt > preview.lastViewedAt)}
                                    inProgressEvent={getInProgressEventForTask(codeStore, preview.id)}
                                    onSelect={() => handleSelectTask(preview.id)}
                                    onDelete={() => handleDeleteTask(preview.id)}
                                    onToggleClosed={() => handleToggleClosed(preview.id, preview.closed ?? false)}
                                />
                            ))}
                        </>
                    )}
                    <div className="h-[50vh] flex-shrink-0" />
                </div>
            </ScrollArea>
        </div>
    )
})
