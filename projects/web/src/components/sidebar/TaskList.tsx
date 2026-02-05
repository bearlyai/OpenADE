import type { TaskPreview, TaskPreviewLastEvent } from "@/persistence/repoStore"
import cx from "classnames"
import { CheckCircle, ListTodo, Loader2, MoreHorizontal, Plus, RotateCcw, Square, Trash2, X } from "lucide-react"
import { observer } from "mobx-react"
import { useState } from "react"
import { useCodeNavigate } from "../../routing"
import { useCodeStore } from "../../store/context"
import type { TaskCreation } from "../../store/managers/TaskCreationManager"
import type { CodeEvent } from "../../types"
import { Menu, type MenuItem } from "../ui"
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

const TaskMenuButton = ({ preview, onDelete, onToggleClosed }: { preview: TaskPreview; onDelete: () => void; onToggleClosed: () => void }) => {
    const [open, setOpen] = useState(false)
    const isTouchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches

    const menuItems: MenuItem[] = [
        {
            id: "close",
            label: (
                <div className="flex items-center gap-2">
                    {preview.closed ? <RotateCcw className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                    <span>{preview.closed ? "Reopen" : "Close"}</span>
                </div>
            ),
            onSelect: () => {
                setOpen(false)
                onToggleClosed()
            },
        },
        {
            id: "delete",
            label: (
                <div className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                </div>
            ),
            onSelect: () => {
                setOpen(false)
                onDelete()
            },
        },
    ]

    return (
        <div
            className={cx("flex ml-auto flex-shrink-0", !isTouchDevice && !open && "opacity-0 group-hover:opacity-100 transition-opacity")}
            onClick={(e) => e.stopPropagation()}
        >
            <Menu
                open={open}
                onOpenChange={setOpen}
                trigger={
                    <div className="flex flex-shrink-0 p-1 px-0.5">
                        <MoreHorizontal className="w-4 h-4 text-muted" />
                    </div>
                }
                sections={[{ items: menuItems }]}
                side="right"
                align="start"
                sideOffset={18}
                className={{
                    trigger: "!h-auto !p-0 !border-0 !bg-transparent hover:!bg-transparent active:!bg-transparent data-[popup-open]:!bg-transparent",
                }}
            />
        </div>
    )
}

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

const StatusPill = ({ lastEvent }: { lastEvent: TaskPreviewLastEvent }) => {
    const isPlan = isPlanType(lastEvent)

    const pillColor = (() => {
        if (lastEvent.status === "error") return "bg-error/10 text-error"
        if (isPlan) return "bg-primary/10 text-primary"
        return "bg-success/10 text-success"
    })()

    const statusIcon = (() => {
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
    })()

    return (
        <div className={cx("flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium flex-shrink-0", pillColor)}>
            {statusIcon}
            <span>{lastEvent.sourceLabel}</span>
        </div>
    )
}

const ClosedLabel = () => {
    return <div className="text-muted text-[11px]">Closed</div>
}

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
    // Prefer in-progress event from loaded task store over synced lastEvent
    const displayEvent = inProgressEvent ?? preview.lastEvent
    return (
        <div
            role="button"
            tabIndex={0}
            className={cx(
                "group btn flex flex-col gap-1 font-normal py-2 pl-3 pr-2 hover:bg-base-200 w-full cursor-pointer",
                isClosed ? "text-muted" : "border border-border text-base-content",
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
        >
            <div className="flex items-center gap-2 w-full">
                <span className="truncate min-w-0 flex-1 select-none text-sm">{preview.title}</span>
                <TaskMenuButton preview={preview} onDelete={onDelete} onToggleClosed={onToggleClosed} />
            </div>
            <div className="flex items-center justify-end">{isClosed ? <ClosedLabel /> : displayEvent && <StatusPill lastEvent={displayEvent} />}</div>
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
                <div className="flex flex-col gap-1 px-1.5">
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
                            {sortedPreviews.map((preview) => {
                                const taskModel = codeStore.tasks.getTaskModel(preview.id)
                                return (
                                    <TaskItem
                                        key={preview.id}
                                        preview={preview}
                                        isActive={taskId === preview.id}
                                        isUnread={taskModel?.isUnread ?? false}
                                        inProgressEvent={getInProgressEventForTask(codeStore, preview.id)}
                                        onSelect={() => handleSelectTask(preview.id)}
                                        onDelete={() => handleDeleteTask(preview.id)}
                                        onToggleClosed={() => handleToggleClosed(preview.id, preview.closed ?? false)}
                                    />
                                )
                            })}
                        </>
                    )}
                    <div className="h-[50vh] flex-shrink-0" />
                </div>
            </ScrollArea>
        </div>
    )
})
