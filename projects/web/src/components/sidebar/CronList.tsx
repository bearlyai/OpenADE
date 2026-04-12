import NiceModal from "@ebay/nice-modal-react"
import cx from "classnames"
import { Clock, Loader2, Pause, Play, Plus, RotateCw } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback } from "react"
import { useCodeStore } from "../../store/context"
import type { CronViewModel } from "../../store/managers/CronManager"
import { ProcsEditorModal } from "../procs/ProcsEditorModal"

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
// CronsSidebarContent
// ============================================================================

interface CronsSidebarContentProps {
    workspaceId: string
}

export const CronsSidebarContent = observer(({ workspaceId }: CronsSidebarContentProps) => {
    const codeStore = useCodeStore()
    const crons = codeStore.crons.getCronsForRepo(workspaceId)
    const repoPath = codeStore.repos.getRepo(workspaceId)?.path ?? "."

    const handleEditConfig = useCallback(
        (filePath?: string) => {
            NiceModal.show(ProcsEditorModal, {
                workspaceId,
                searchPath: repoPath,
                context: { type: "repo", root: repoPath },
                initialTab: "crons",
                initialFilePath: filePath,
            })
        },
        [workspaceId, repoPath]
    )

    if (crons.length === 0) {
        return (
            <button
                type="button"
                className="btn flex items-center gap-1.5 px-3 py-1 mt-2 text-[11px] text-muted hover:text-base-content transition-colors cursor-pointer w-full"
                onClick={() => handleEditConfig()}
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
                    onClick={() => handleEditConfig()}
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
        </div>
    )
})
