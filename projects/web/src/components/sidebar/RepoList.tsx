import cx from "classnames"
import { FolderOpen, FolderPlus, Loader2, MoreHorizontal, Settings, Trash2 } from "lucide-react"
import { observer } from "mobx-react"
import { useState } from "react"
import { getWorkspaceLastViewed } from "../../constants"
import { useCodeNavigate } from "../../routing"
import { useCodeStore } from "../../store/context"
import type { Repo } from "../../types"
import { Menu, type MenuItem } from "../ui"

const RepoMenuButton = ({ onSettings, onDelete }: { repo: Repo; onSettings: () => void; onDelete: () => void }) => {
    const [open, setOpen] = useState(false)
    const isTouchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches

    const menuItems: MenuItem[] = [
        {
            id: "settings",
            label: (
                <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    <span>Settings</span>
                </div>
            ),
            onSelect: () => {
                setOpen(false)
                onSettings()
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

const RepoItem = ({
    repo,
    isActive,
    unreadCount,
    isRunning,
    onSelect,
    onSettings,
    onDelete,
}: {
    repo: Repo
    isActive: boolean
    unreadCount: number
    isRunning: boolean
    onSelect: () => void
    onSettings: () => void
    onDelete: () => void
}) => {
    return (
        <div
            role="button"
            tabIndex={0}
            className={cx(
                "group btn flex items-center font-normal gap-2 p-1 px-3 hover:bg-base-200 w-full cursor-pointer text-muted",
                isActive && "font-medium bg-base-300 text-base-content",
                unreadCount > 0 && "border-l-2 border-l-primary"
            )}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault()
                    onSelect()
                }
            }}
            title={repo.path}
        >
            {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-muted" />
            ) : (
                <FolderOpen className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="truncate min-w-0 flex-1 select-none">{repo.name}</span>
            <RepoMenuButton repo={repo} onSettings={onSettings} onDelete={onDelete} />
        </div>
    )
}

interface ReposSidebarContentProps {
    workspaceId: string | undefined
}

export const ReposSidebarContent = observer(({ workspaceId }: ReposSidebarContentProps) => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()

    const getUnreadCount = (repoId: string): number => {
        const repo = codeStore.repoStore?.repos.get(repoId)
        if (!repo) return 0
        return repo.tasks.filter((t) => {
            if (t.closed) return false
            if (!t.lastEventAt) return false
            if (!t.lastViewedAt) return true
            return t.lastEventAt > t.lastViewedAt
        }).length
    }

    const getIsRunning = (repoId: string): boolean => {
        const repo = codeStore.repoStore?.repos.get(repoId)
        if (!repo) return false
        return repo.tasks.some((t) => codeStore.workingTaskIds.has(t.id))
    }

    const handleAddRepo = () => {
        // Navigate to workspace create page
        navigate.go("CodeWorkspaceCreate")
    }

    const handleSelectRepo = (repoId: string) => {
        // Restore last viewed page for this workspace, or fall back to task create
        const lastViewed = getWorkspaceLastViewed(repoId)
        if (lastViewed?.taskId) {
            const repo = codeStore.repoStore?.repos.get(repoId)
            const taskExists = repo?.tasks.some((t) => t.id === lastViewed.taskId)
            if (taskExists) {
                navigate.go("CodeWorkspaceTask", { workspaceId: repoId, taskId: lastViewed.taskId })
                return
            }
        }
        navigate.go("CodeWorkspaceTaskCreate", { workspaceId: repoId })
    }

    const handleSettingsRepo = (repoId: string) => {
        // Navigate to workspace settings page
        navigate.go("CodeWorkspaceSettings", { workspaceId: repoId })
    }

    const handleDeleteRepo = async (repoId: string) => {
        await codeStore.repos.removeRepo(repoId)
        // If we deleted the currently selected repo, navigate to base code page
        if (workspaceId === repoId) {
            navigate.go("Code")
        }
    }

    return (
        <div className="flex flex-col gap-1 mt-2">
            {codeStore.repos.repos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted">
                    <FolderOpen size="1.5rem" className="mb-2 opacity-50" />
                    <div className="text-xs">No workspaces yet</div>
                </div>
            ) : (
                <div className="flex flex-col gap-1 px-1.5">
                    {codeStore.repos.repos.map((repo) => (
                        <RepoItem
                            key={repo.id}
                            repo={repo}
                            isActive={workspaceId === repo.id}
                            unreadCount={getUnreadCount(repo.id)}
                            isRunning={getIsRunning(repo.id)}
                            onSelect={() => handleSelectRepo(repo.id)}
                            onSettings={() => handleSettingsRepo(repo.id)}
                            onDelete={() => handleDeleteRepo(repo.id)}
                        />
                    ))}
                </div>
            )}
            <button
                type="button"
                className="btn flex items-center gap-2 mx-1.5 px-3 py-1.5 text-xs text-muted hover:text-base-content hover:bg-base-200 transition-colors cursor-pointer"
                onClick={handleAddRepo}
            >
                <FolderPlus className="w-4 h-4" />
                <span>Add workspace</span>
            </button>
        </div>
    )
})
