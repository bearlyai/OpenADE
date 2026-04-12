import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { AlertTriangle, Check } from "lucide-react"
import { useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import type { DeleteOptions, TaskResourceInventory } from "../../store/managers/TaskManager"
import { Modal } from "../ui/Modal"

interface TaskDeleteConfirmProps {
    tasks: TaskResourceInventory[]
    onConfirm: (options: DeleteOptions) => void
}

function aggregate(tasks: TaskResourceInventory[]) {
    let totalSnapshots = 0
    let totalImages = 0
    let totalSessions = 0
    const sessionsByHarness = new Map<string, number>()
    const worktrees: Array<{ taskTitle: string; branchName: string; sourceBranch: string; merged: boolean | null }> = []
    let runningCount = 0

    for (const t of tasks) {
        totalSnapshots += t.snapshotIds.length
        totalImages += t.images.length
        totalSessions += t.sessions.length
        if (t.isRunning) runningCount++

        for (const s of t.sessions) {
            sessionsByHarness.set(s.harnessId, (sessionsByHarness.get(s.harnessId) ?? 0) + 1)
        }

        if (t.worktree) {
            worktrees.push({
                taskTitle: t.taskTitle,
                branchName: t.worktree.branchName,
                sourceBranch: t.worktree.sourceBranch,
                merged: t.worktree.branchMerged,
            })
        }
    }

    const unmergedWorktrees = worktrees.filter((w) => w.merged === false)

    return { totalSnapshots, totalImages, totalSessions, sessionsByHarness, worktrees, unmergedWorktrees, runningCount }
}

const CheckboxRow = ({
    checked,
    onChange,
    disabled,
    label,
    detail,
    warning,
    children,
}: {
    checked: boolean
    onChange?: (v: boolean) => void
    disabled?: boolean
    label: string
    detail: string
    warning?: boolean
    children?: React.ReactNode
}) => (
    <div className="py-2">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="checkbox" className="mt-0.5 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${warning ? "text-warning" : "text-base-content"}`}>{label}</span>
                    <span className="text-xs text-muted ml-auto flex-shrink-0">{detail}</span>
                </div>
                {children}
            </div>
        </label>
    </div>
)

const ModalContent = ({ tasks, onConfirm }: TaskDeleteConfirmProps) => {
    const modal = useModal()
    const stats = aggregate(tasks)

    const [deleteSnapshots, setDeleteSnapshots] = useState(true)
    const [deleteImages, setDeleteImages] = useState(true)
    const [deleteSessions, setDeleteSessions] = useState(true)
    const [deleteWorktrees, setDeleteWorktrees] = useState(true)

    const handleClose = () => modal.remove()

    const handleConfirm = () => {
        onConfirm({ deleteSnapshots, deleteImages, deleteSessions, deleteWorktrees })
        modal.remove()
    }

    useHotkeys(
        "shift+enter",
        (e) => {
            if (modal.visible) {
                e.preventDefault()
                e.stopPropagation()
                handleConfirm()
            }
        },
        { enabled: modal.visible },
        [modal.visible, handleConfirm]
    )

    const taskLabel = tasks.length === 1 ? "1 task" : `${tasks.length} tasks`
    const hasAnyResources = stats.totalSnapshots > 0 || stats.totalImages > 0 || stats.totalSessions > 0 || stats.worktrees.length > 0

    const footer = (
        <div className="flex flex-col sm:flex-row gap-2">
            <button
                type="button"
                autoFocus
                className="btn flex-1 px-4 py-2.5 bg-base-200 hover:bg-base-300 text-base-content font-medium transition-colors border border-border"
                onClick={handleClose}
            >
                Cancel
            </button>
            <button
                type="button"
                className="btn flex-1 px-4 py-2.5 bg-error hover:bg-error/90 text-error-content font-medium transition-colors"
                onClick={handleConfirm}
            >
                Delete permanently
            </button>
        </div>
    )

    return (
        <Modal title={`Delete ${taskLabel}`} onClose={handleClose} footer={footer} hideSeparator>
            <div className="flex flex-col gap-1">
                {/* Always-on: task data */}
                <CheckboxRow checked disabled label="Task data" detail={taskLabel}>
                    <div className="text-xs text-muted mt-0.5">Event history, comments, YJS documents</div>
                </CheckboxRow>

                {hasAnyResources && <div className="text-xs text-muted pt-1 pb-0.5">Select which resources to also clean up:</div>}

                {/* Snapshots */}
                {stats.totalSnapshots > 0 && (
                    <CheckboxRow
                        checked={deleteSnapshots}
                        onChange={setDeleteSnapshots}
                        label="Snapshots"
                        detail={`${stats.totalSnapshots} file${stats.totalSnapshots !== 1 ? "s" : ""}`}
                    >
                        <div className="text-xs text-muted mt-0.5">~/.openade/data/snapshots/</div>
                    </CheckboxRow>
                )}

                {/* Images */}
                {stats.totalImages > 0 && (
                    <CheckboxRow
                        checked={deleteImages}
                        onChange={setDeleteImages}
                        label="Images"
                        detail={`${stats.totalImages} file${stats.totalImages !== 1 ? "s" : ""}`}
                    >
                        <div className="text-xs text-muted mt-0.5">~/.openade/data/images/</div>
                    </CheckboxRow>
                )}

                {/* CLI Sessions */}
                {stats.totalSessions > 0 && (
                    <CheckboxRow
                        checked={deleteSessions}
                        onChange={setDeleteSessions}
                        label="CLI sessions"
                        detail={`${stats.totalSessions} session${stats.totalSessions !== 1 ? "s" : ""}`}
                    >
                        <div className="text-xs text-muted mt-0.5">
                            {[...stats.sessionsByHarness.entries()].map(([id, count]) => `${id} (${count})`).join(" \u00B7 ")}
                        </div>
                    </CheckboxRow>
                )}

                {/* Worktrees & branches */}
                {stats.worktrees.length > 0 && (
                    <CheckboxRow
                        checked={deleteWorktrees}
                        onChange={setDeleteWorktrees}
                        label="Worktrees & branches"
                        detail={`${stats.worktrees.length} worktree${stats.worktrees.length !== 1 ? "s" : ""}`}
                        warning={stats.unmergedWorktrees.length > 0}
                    >
                        <div className="flex flex-col gap-1 mt-1">
                            {stats.worktrees.map((w) => (
                                <div key={w.branchName} className="flex items-start gap-1.5 text-xs">
                                    {w.merged === false ? (
                                        <AlertTriangle className="w-3 h-3 text-warning flex-shrink-0 mt-0.5" />
                                    ) : (
                                        <Check className="w-3 h-3 text-success flex-shrink-0 mt-0.5" />
                                    )}
                                    <div className="min-w-0">
                                        <span className="text-base-content">{w.branchName}</span>
                                        {w.merged === false && <span className="text-warning ml-1">not merged into {w.sourceBranch}</span>}
                                        {w.merged === true && <span className="text-muted ml-1">merged into {w.sourceBranch}</span>}
                                        {w.merged === null && <span className="text-muted ml-1">merge status unknown</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CheckboxRow>
                )}

                {/* Warnings */}
                {stats.runningCount > 0 && (
                    <div className="flex items-center gap-2 mt-2 p-2 bg-warning/10 text-warning text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>
                            {stats.runningCount} task{stats.runningCount !== 1 ? "s are" : " is"} currently running and will be stopped.
                        </span>
                    </div>
                )}

                {stats.unmergedWorktrees.length > 0 && deleteWorktrees && (
                    <div className="flex items-center gap-2 mt-1 p-2 bg-warning/10 text-warning text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>
                            {stats.unmergedWorktrees.length} branch{stats.unmergedWorktrees.length !== 1 ? "es have" : " has"} unmerged work. Deleting cannot be
                            undone.
                        </span>
                    </div>
                )}
            </div>
        </Modal>
    )
}

export const TaskDeleteConfirm = NiceModal.create((props: TaskDeleteConfirmProps) => {
    return <ModalContent {...props} />
})
