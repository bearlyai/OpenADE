import type { TaskPreview, TaskPreviewLastEvent } from "@/persistence/repoStore"
import { ContextMenu } from "@base-ui-components/react/context-menu"
import { useModal } from "@ebay/nice-modal-react"
import cx from "classnames"
import { CheckCircle, CheckSquare, Copy, ListTodo, Loader2, Pencil, Pin, Plus, RotateCcw, Square, Trash2, X } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePortalContainer } from "../../hooks/usePortalContainer"
import { useCodeNavigate } from "../../routing"
import { useCodeStore } from "../../store/context"
import type { TaskCreation } from "../../store/managers/TaskCreationManager"
import type { CodeEvent } from "../../types"
import { ScrollArea } from "../ui"
import { TaskDeleteConfirm } from "./TaskDeleteConfirm"
import { resolveTaskCopyPath } from "./sidebarPathUtils"

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
    isPinned,
    inProgressEvent,
    selectionMode,
    isSelected,
    onSelect,
    onToggleSelect,
    onEnterSelect,
    onDelete,
    onToggleClosed,
    onTogglePinned,
    onCopyPath,
    onRename,
}: {
    preview: TaskPreview
    isActive: boolean
    isUnread: boolean
    isPinned: boolean
    inProgressEvent: TaskPreviewLastEvent | null
    selectionMode: boolean
    isSelected: boolean
    onSelect: () => void
    onToggleSelect: () => void
    onEnterSelect: () => void
    onDelete: () => void
    onToggleClosed: () => void
    onTogglePinned: () => void
    onCopyPath: () => void
    onRename: (newTitle: string) => void
}) => {
    const isClosed = preview.closed ?? false
    const displayEvent = inProgressEvent ?? preview.lastEvent
    const portalContainer = usePortalContainer()
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const handleCommit = () => {
        const value = inputRef.current?.value.trim()
        if (value && value !== preview.title) {
            onRename(value)
        }
        setIsEditing(false)
    }

    const handleClick = selectionMode ? onToggleSelect : onSelect
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault()
            handleClick()
        }
    }

    const rowContent = (
        <>
            {/* Selection checkbox OR pin indicator */}
            {selectionMode ? (
                <input
                    type="checkbox"
                    className="flex-shrink-0 accent-primary"
                    checked={isSelected}
                    onChange={onToggleSelect}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                isPinned && <Pin className="w-3 h-3 flex-shrink-0 text-primary" fill="currentColor" />
            )}

            {/* Title */}
            {isEditing ? (
                <input
                    ref={inputRef}
                    className="truncate min-w-0 flex-1 text-sm bg-transparent text-inherit border border-base-300 px-1 py-0 outline-none"
                    defaultValue={preview.title}
                    autoFocus
                    onBlur={handleCommit}
                    onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === "Enter") handleCommit()
                        if (e.key === "Escape") setIsEditing(false)
                    }}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <span
                    className="truncate min-w-0 flex-1 select-none"
                    onDoubleClick={(e) => {
                        if (selectionMode) return
                        e.stopPropagation()
                        setIsEditing(true)
                    }}
                >
                    {preview.title}
                </span>
            )}

            {/* Status suffix */}
            {!isClosed && displayEvent && (
                <span className={cx("flex items-center gap-1 text-xs flex-shrink-0", getStatusColor(displayEvent))}>
                    {getStatusIcon(displayEvent)}
                    <span>{displayEvent.sourceLabel}</span>
                </span>
            )}

            {isClosed && <span className="text-[11px] text-muted flex-shrink-0">Closed</span>}
        </>
    )

    const rowClassName = cx(
        "group btn flex items-center gap-2 font-normal py-1.5 pl-3 pr-2 hover:bg-base-200 w-full cursor-pointer text-sm",
        isClosed ? "text-muted" : "text-base-content",
        isActive && !selectionMode && "bg-base-300",
        selectionMode && isSelected && "bg-primary/10",
        !isClosed && isUnread && !selectionMode && "border-l-2 border-l-primary"
    )

    if (selectionMode) {
        return (
            <div role="button" tabIndex={0} className={rowClassName} onClick={handleClick} onKeyDown={handleKeyDown} title={preview.title}>
                {rowContent}
            </div>
        )
    }

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                className="flex w-full"
                render={<div role="button" tabIndex={0} className={rowClassName} onClick={handleClick} onKeyDown={handleKeyDown} title={preview.title} />}
            >
                {rowContent}
            </ContextMenu.Trigger>
            <ContextMenu.Portal container={portalContainer}>
                <ContextMenu.Positioner className="outline-none z-50" sideOffset={4}>
                    <ContextMenu.Popup className={contextPopupClassName}>
                        <ContextMenu.Item className={contextItemClassName} onClick={onTogglePinned}>
                            <Pin className="w-4 h-4" fill={isPinned ? "currentColor" : "none"} />
                            <span>{isPinned ? "Unpin" : "Pin"}</span>
                        </ContextMenu.Item>
                        <ContextMenu.Item className={contextItemClassName} onClick={onCopyPath}>
                            <Copy className="w-4 h-4" />
                            <span>Copy path</span>
                        </ContextMenu.Item>
                        <ContextMenu.Item className={contextItemClassName} onClick={() => setTimeout(() => setIsEditing(true), 0)}>
                            <Pencil className="w-4 h-4" />
                            <span>Rename</span>
                        </ContextMenu.Item>
                        <ContextMenu.Item className={contextItemClassName} onClick={onToggleClosed}>
                            {isClosed ? <RotateCcw className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                            <span>{isClosed ? "Reopen" : "Close"}</span>
                        </ContextMenu.Item>
                        <ContextMenu.Item className={contextItemClassName} onClick={onEnterSelect}>
                            <CheckSquare className="w-4 h-4" />
                            <span>Select</span>
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
    const deleteConfirmModal = useModal(TaskDeleteConfirm)

    // ── Selection mode ──
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    const enterSelectionMode = useCallback((initialId: string) => {
        setSelectionMode(true)
        setSelectedIds(new Set([initialId]))
    }, [])

    const exitSelectionMode = useCallback(() => {
        setSelectionMode(false)
        setSelectedIds(new Set())
    }, [])

    const toggleSelection = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }, [])

    // ── Task previews + sorting ──
    const repo = codeStore.repoStore?.repos.get(workspaceId)
    const previews = repo?.tasks ?? []
    const zeroTime = new Date(0).toISOString()
    const sortByRecent = (a: TaskPreview, b: TaskPreview) => {
        const aTime = a.lastEvent?.at ?? a?.createdAt ?? zeroTime
        const bTime = b.lastEvent?.at ?? b?.createdAt ?? zeroTime
        return bTime.localeCompare(aTime)
    }
    const pinnedSet = new Set(codeStore.personalSettingsStore?.settings.current.pinnedTaskIds ?? [])
    const withRunningFirst = (arr: TaskPreview[]) => {
        const running = arr.filter((t) => codeStore.workingTaskIds.has(t.id))
        const idle = arr.filter((t) => !codeStore.workingTaskIds.has(t.id))
        return [...running, ...idle]
    }

    const openPreviews = previews.filter((t) => !t.closed).sort(sortByRecent)
    const pinnedOpen = withRunningFirst(openPreviews.filter((t) => pinnedSet.has(t.id)))
    const unpinnedOpen = withRunningFirst(openPreviews.filter((t) => !pinnedSet.has(t.id)))
    const closedPreviews = previews.filter((t) => t.closed).sort(sortByRecent)
    const pinnedClosed = closedPreviews.filter((t) => pinnedSet.has(t.id))
    const unpinnedClosed = closedPreviews.filter((t) => !pinnedSet.has(t.id))
    const sortedPreviews = [...pinnedOpen, ...unpinnedOpen, ...pinnedClosed, ...unpinnedClosed]
    const creations = codeStore.creation.getCreationsForRepo(workspaceId)

    // ── Keyboard shortcuts for selection mode ──
    const sortedPreviewsRef = useRef(sortedPreviews)
    sortedPreviewsRef.current = sortedPreviews
    const handleBulkDeleteRef = useRef<() => void>(() => {})

    useEffect(() => {
        if (!selectionMode) return
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
            if (e.key === "Escape") {
                exitSelectionMode()
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "a") {
                e.preventDefault()
                setSelectedIds(new Set(sortedPreviewsRef.current.map((p) => p.id)))
            }
            if (e.key === "Delete" || e.key === "Backspace") {
                handleBulkDeleteRef.current()
            }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [selectionMode])

    // ── Handlers ──
    const handleAddTask = () => {
        navigate.go("CodeWorkspaceTaskCreate", { workspaceId })
    }

    const handleSelectTask = (selectedTaskId: string) => {
        navigate.go("CodeWorkspaceTask", { workspaceId, taskId: selectedTaskId })
    }

    const handleSelectCreation = (selectedCreationId: string) => {
        navigate.go("CodeWorkspaceTaskCreating", { workspaceId, creationId: selectedCreationId })
    }

    const showDeleteConfirm = async (ids: string[], onDone?: () => void) => {
        const inventory = await codeStore.tasks.getResourceInventory(ids)
        deleteConfirmModal.show({
            tasks: inventory,
            onConfirm: async (options) => {
                await codeStore.tasks.deepRemoveTasks(ids, options)
                onDone?.()
                if (taskId && ids.includes(taskId)) {
                    navigate.go("CodeWorkspace", { workspaceId })
                }
            },
        })
    }

    const handleDeleteTask = async (deletedTaskId: string) => {
        await showDeleteConfirm([deletedTaskId])
    }

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return
        const ids = [...selectedIds]
        await showDeleteConfirm(ids, exitSelectionMode)
    }
    handleBulkDeleteRef.current = handleBulkDelete

    const handleCancelCreation = async (cancelledCreationId: string) => {
        await codeStore.creation.cancelCreation(cancelledCreationId)
        if (creationId === cancelledCreationId) {
            navigate.go("CodeWorkspaceTaskCreate", { workspaceId })
        }
    }

    const handleToggleClosed = async (toggledTaskId: string, currentClosed: boolean) => {
        await codeStore.tasks.setTaskClosed(toggledTaskId, !currentClosed)
    }

    const handleTogglePinned = (toggledTaskId: string) => {
        codeStore.tasks.toggleTaskPinned(toggledTaskId)
    }

    const handleRenameTask = (renamedTaskId: string, newTitle: string) => {
        codeStore.tasks.setTaskTitle(renamedTaskId, newTitle)
    }

    const handleCopyTaskPath = async (selectedTaskId: string) => {
        const repo = codeStore.repos.getRepo(workspaceId)
        if (!repo) return

        try {
            await codeStore.getTaskStore(workspaceId, selectedTaskId)
            const task = codeStore.tasks.getTask(selectedTaskId)
            const taskModel = codeStore.tasks.getTaskModel(selectedTaskId)
            const environment = taskModel?.environment ?? (await taskModel?.loadEnvironment())
            const copyPath = resolveTaskCopyPath({
                repoPath: repo.path,
                isolationStrategy: task?.isolationStrategy,
                environmentPath: environment?.taskWorkingDir ?? null,
                events: task?.events ?? [],
            })

            if (!copyPath) return
            await navigator.clipboard.writeText(copyPath)
        } catch (err) {
            console.error("[TaskList] Failed to copy task path:", err)
        }
    }

    const selectAll = () => setSelectedIds(new Set(sortedPreviews.map((p) => p.id)))

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

            {/* Selection mode header bar */}
            {selectionMode && (
                <div className="flex items-center justify-between px-3 py-1.5 mx-1.5 mb-1 bg-base-200 text-base-content text-xs">
                    <span className="font-medium">{selectedIds.size} selected</span>
                    <div className="flex items-center gap-1.5">
                        <button type="button" className="btn px-2 py-1 text-xs hover:bg-base-300 transition-colors" onClick={selectAll}>
                            All
                        </button>
                        <button
                            type="button"
                            className="btn flex items-center gap-1 px-2 py-1 text-xs text-error hover:bg-error/10 transition-colors"
                            onClick={handleBulkDelete}
                            disabled={selectedIds.size === 0}
                        >
                            <Trash2 className="w-3 h-3" />
                            Delete
                        </button>
                        <button type="button" className="btn px-1 py-1 text-xs hover:bg-base-300 transition-colors" onClick={exitSelectionMode}>
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            )}

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
                                    isPinned={pinnedSet.has(preview.id)}
                                    inProgressEvent={getInProgressEventForTask(codeStore, preview.id)}
                                    selectionMode={selectionMode}
                                    isSelected={selectedIds.has(preview.id)}
                                    onSelect={() => handleSelectTask(preview.id)}
                                    onToggleSelect={() => toggleSelection(preview.id)}
                                    onEnterSelect={() => enterSelectionMode(preview.id)}
                                    onDelete={() => handleDeleteTask(preview.id)}
                                    onToggleClosed={() => handleToggleClosed(preview.id, preview.closed ?? false)}
                                    onTogglePinned={() => handleTogglePinned(preview.id)}
                                    onCopyPath={() => {
                                        void handleCopyTaskPath(preview.id)
                                    }}
                                    onRename={(newTitle) => handleRenameTask(preview.id, newTitle)}
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
