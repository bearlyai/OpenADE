import NiceModal from "@ebay/nice-modal-react"
import cx from "classnames"
import { Clock, Loader2, Pause, Play, Plus, RotateCw } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useState } from "react"
import { getCronCreationPrompt } from "../../prompts/procsSpec"
import { useCodeNavigate } from "../../routing"
import { useCodeStore } from "../../store/context"
import type { CronViewModel } from "../../store/managers/CronManager"
import { CronEditModal } from "./CronEditModal"

function formatNextRun(date: Date | null): string {
    if (!date) return "—"
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    if (diffMs < 0) return "overdue"
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 60) return `${diffMin}m`
    const diffHrs = Math.floor(diffMin / 60)
    if (diffHrs < 24) return `${diffHrs}h`
    const diffDays = Math.floor(diffHrs / 24)
    return `${diffDays}d`
}

// ============================================================================
// CronItem
// ============================================================================

const CronItem = observer(({ cron, onEditConfig }: { cron: CronViewModel; onEditConfig: (filePath: string) => void }) => {
    const codeStore = useCodeStore()
    const isActive = cron.installed && cron.enabled

    const handlePlayPause = useCallback(async () => {
        if (isActive) {
            await codeStore.crons.toggleCron(cron.repoId, cron.def.id, false)
        } else if (cron.installed) {
            await codeStore.crons.toggleCron(cron.repoId, cron.def.id, true)
        } else {
            await codeStore.crons.installCron(cron.repoId, cron.def.id)
        }
    }, [codeStore.crons, cron.repoId, cron.def.id, cron.installed, isActive])

    const handleRunNow = useCallback(async () => {
        await codeStore.crons.runNow(cron.repoId, cron.def.id)
    }, [codeStore.crons, cron.repoId, cron.def.id])

    return (
        <div className="group flex items-center gap-2 py-1.5 pl-3 pr-2 hover:bg-base-200 cursor-pointer" onClick={() => onEditConfig(cron.configFilePath)}>
            {/* Status indicator */}
            <div
                className={cx("w-2 h-2 rounded-full flex-shrink-0", {
                    "bg-success/70 animate-pulse": cron.running,
                    "bg-primary/60": isActive && !cron.running,
                    "bg-muted/40": !isActive,
                })}
            />

            {/* Name */}
            <span className={cx("text-xs truncate flex-1 min-w-0 select-none", isActive ? "text-base-content" : "text-muted")}>{cron.def.name}</span>

            {/* Running indicator */}
            {cron.running && <Loader2 className="w-3 h-3 animate-spin text-success flex-shrink-0" />}

            {/* Actions (visible on hover) */}
            <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                {/* Next run time */}
                {isActive && !cron.running && (
                    <span className="text-[10px] text-muted flex-shrink-0 font-mono mr-0.5" title={cron.nextRunAt?.toLocaleString() ?? "unknown"}>
                        {formatNextRun(cron.nextRunAt)}
                    </span>
                )}
                {!cron.running && (
                    <button type="button" onClick={handleRunNow} className="btn p-1 text-muted hover:text-primary transition-colors" title="Run now">
                        <RotateCw size={11} />
                    </button>
                )}
                <button
                    type="button"
                    onClick={handlePlayPause}
                    className={cx("btn p-1 transition-colors", isActive ? "text-muted hover:text-warning" : "text-muted hover:text-success")}
                    title={isActive ? "Pause cron" : "Enable cron"}
                >
                    {isActive ? <Pause size={12} /> : <Play size={12} />}
                </button>
            </div>
        </div>
    )
})

// ============================================================================
// NewCronForm — inline form for describing a new cron job
// ============================================================================

function NewCronForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()
    const [description, setDescription] = useState("")

    const handleCreate = useCallback(() => {
        const desc = description.trim()
        if (!desc) return

        const prompt = getCronCreationPrompt(desc)
        const creationId = codeStore.creation.newTask({
            repoId: workspaceId,
            description: prompt,
            mode: "plan",
            isolationStrategy: { type: "head" },
        })
        navigate.go("CodeWorkspaceTaskCreating", { workspaceId, creationId })
        onDone()
    }, [description, workspaceId, codeStore.creation, navigate, onDone])

    return (
        <div className="px-2.5 pb-2">
            <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Every Monday morning review our dependencies and make sure there are no security issues or perform any upgrades we can"
                className="w-full px-2.5 py-2 text-xs bg-input text-base-content border border-border focus:outline-none focus:border-primary transition-all placeholder:text-muted/40 resize-none"
                rows={3}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleCreate()
                    } else if (e.key === "Escape") {
                        onDone()
                    }
                }}
                autoFocus
            />
            <div className="flex items-center gap-2 mt-1.5">
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!description.trim()}
                    className={cx(
                        "btn flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs transition-colors",
                        description.trim() ? "bg-primary text-primary-content hover:bg-primary/90" : "bg-primary/50 text-primary-content/50 cursor-not-allowed"
                    )}
                >
                    <Plus size={12} />
                    Create
                </button>
                <button type="button" onClick={onDone} className="btn px-2.5 py-1 text-xs text-muted hover:text-base-content transition-colors">
                    Cancel
                </button>
            </div>
        </div>
    )
}

// ============================================================================
// CronsSidebarContent
// ============================================================================

interface CronsSidebarContentProps {
    workspaceId: string
}

export const CronsSidebarContent = observer(({ workspaceId }: CronsSidebarContentProps) => {
    const codeStore = useCodeStore()
    const crons = codeStore.crons.getCronsForRepo(workspaceId)
    const [showForm, setShowForm] = useState(false)

    const handleEditConfig = useCallback((filePath: string) => {
        NiceModal.show(CronEditModal, { filePath })
    }, [])

    if (crons.length === 0 && !showForm) {
        return (
            <button
                type="button"
                className="btn flex items-center gap-1.5 px-3 py-1 mt-2 text-[11px] text-muted hover:text-base-content transition-colors cursor-pointer w-full"
                onClick={() => setShowForm(true)}
            >
                <Plus className="w-3 h-3" />
                <span>Add a cron job</span>
            </button>
        )
    }

    return (
        <div className="flex flex-col mt-4">
            <div className="flex items-center justify-between pl-2 pr-1.5 mb-2">
                <h2 className="text-muted text-sm font-medium select-none flex items-center gap-1.5">
                    <Clock size={13} />
                    Crons
                </h2>
                <button
                    type="button"
                    className="btn p-1 text-muted hover:text-base-content transition-colors cursor-pointer"
                    onClick={() => setShowForm(true)}
                    title="New cron"
                >
                    <Plus className="w-3 h-3" />
                </button>
            </div>
            {crons.length > 0 && (
                <div className="flex flex-col gap-0.5 px-1.5">
                    {crons.map((cron) => (
                        <CronItem key={cron.def.id} cron={cron} onEditConfig={handleEditConfig} />
                    ))}
                </div>
            )}
            {showForm && <NewCronForm workspaceId={workspaceId} onDone={() => setShowForm(false)} />}
        </div>
    )
})
