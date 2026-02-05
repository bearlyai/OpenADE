/**
 * Tray configuration definitions
 *
 * Each tray type declares its button properties, badge renderer, and content renderer.
 * This keeps all tray-specific logic in one place for easy extension.
 */

import type { LucideIcon } from "lucide-react"
import { FolderOpen, GitCompare, Play, Search, TerminalSquare } from "lucide-react"
import type { ReactNode } from "react"
import { getTaskPtyId } from "../../electronAPI/pty"
import type { TrayManager, TrayType } from "../../store/managers/TrayManager"
import { ChangesViewer } from "../ChangesViewer"
import { ProcessesTray } from "../ProcessesTray"
import { SearchTray } from "../SearchTray"
import { Terminal } from "../Terminal"
import { FilesTrayContent } from "./FilesTrayContent"

export interface TrayConfig {
    id: TrayType
    label: string
    icon: LucideIcon
    shortcut?: { key: string; display: string }
    /** If provided, determines whether this tray tab is shown. Defaults to visible. */
    isVisible?: (tray: TrayManager) => boolean
    /** Called when this tray is opened */
    onOpen?: (tray: TrayManager) => void
    /** Render badge content for the tray button (e.g., process count) */
    renderBadge?: (tray: TrayManager) => ReactNode
    /** Render the tray content panel */
    renderContent: (tray: TrayManager) => ReactNode
}

function NoEnvironment() {
    return <div className="flex items-center justify-center h-full text-muted text-sm">Environment not available</div>
}

export const TRAY_CONFIGS: TrayConfig[] = [
    {
        id: "changes",
        label: "Changes",
        icon: GitCompare,
        shortcut: { key: "mod+shift+g", display: "⌘⇧G" },
        isVisible: (tray) => tray.taskModel.environment?.hasGit ?? false,
        onOpen: (tray) => tray.taskModel.refreshGitState(),
        renderBadge: (tray) => {
            const status = tray.taskModel.gitStatus
            if (!status?.hasChanges) return null
            const count = status.staged.files.length + status.unstaged.files.length + status.untracked.length
            return count > 0 ? count : null
        },
        renderContent: (tray) => {
            const env = tray.taskModel.environment
            if (!env?.taskWorkingDir) {
                return <NoEnvironment />
            }
            const task = tray.store.tasks.getTask(tray.taskId)
            const isWorktree = task?.isolationStrategy?.type === "worktree"
            return (
                <ChangesViewer
                    workDir={env.taskWorkingDir}
                    gitStatus={tray.taskModel.gitStatus}
                    isWorktree={isWorktree}
                    mergeBaseCommit={env.mergeBaseCommit}
                    className="h-full"
                    taskId={tray.taskId}
                    onRefresh={() => tray.taskModel.refreshGitState()}
                />
            )
        },
    },
    {
        id: "files",
        label: "Files",
        icon: FolderOpen,
        shortcut: { key: "mod+p", display: "⌘P" },
        onOpen: (tray) => tray.store.fileBrowser.refreshTree(),
        renderContent: (tray) => <FilesTrayContent taskId={tray.taskId} onClose={() => tray.close()} />,
    },
    {
        id: "search",
        label: "Search",
        icon: Search,
        shortcut: { key: "mod+shift+f", display: "⌘⇧F" },
        renderContent: (tray) => <SearchTray taskId={tray.taskId} onEscapeClose={() => tray.close()} />,
    },
    {
        id: "terminal",
        label: "Terminal",
        icon: TerminalSquare,
        shortcut: { key: "mod+t", display: "⌘T" },
        renderContent: (tray) => {
            const env = tray.taskModel.environment
            if (!env?.taskWorkingDir) {
                return <NoEnvironment />
            }
            return <Terminal ptyId={getTaskPtyId(tray.taskId)} cwd={env.taskWorkingDir} className="h-full" onClose={() => tray.close()} />
        },
    },
    {
        id: "processes",
        label: "Processes",
        icon: Play,
        renderBadge: (tray) => {
            const count = tray.store.repoProcesses.runningCount
            return count > 0 ? count : null
        },
        renderContent: (tray) => {
            const env = tray.taskModel.environment
            if (!env?.taskWorkingDir) {
                return <NoEnvironment />
            }
            const task = tray.store.tasks.getTask(tray.taskId)
            const isWorktree = task?.isolationStrategy?.type === "worktree"
            const context = isWorktree ? { type: "worktree" as const, root: env.taskWorkingDir } : { type: "repo" as const }
            return <ProcessesTray searchPath={env.taskWorkingDir} context={context} workspaceId={tray.workspaceId} isOpen={tray.openTray === "processes"} />
        },
    },
]

/** Get tray config by ID */
export function getTrayConfig(id: TrayType): TrayConfig | undefined {
    return TRAY_CONFIGS.find((c) => c.id === id)
}

/** Combined shortcut string for react-hotkeys-hook */
export const TRAY_SHORTCUTS = TRAY_CONFIGS.filter((c) => c.shortcut)
    .map((c) => c.shortcut!.key)
    .join(",")

/** Map from shortcut key to tray type for dispatch */
const SHORTCUT_TO_TRAY: Record<string, TrayType> = {}
for (const config of TRAY_CONFIGS) {
    if (config.shortcut) {
        SHORTCUT_TO_TRAY[config.shortcut.key] = config.id
    }
}

/**
 * Match a keyboard event against our shortcut definitions.
 * Returns the tray type if matched, null otherwise.
 */
export function matchShortcutToTray(event: KeyboardEvent): TrayType | null {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
    const modKey = isMac ? event.metaKey : event.ctrlKey

    if (!modKey) return null

    const key = event.key.toLowerCase()

    // Check each shortcut
    for (const config of TRAY_CONFIGS) {
        if (!config.shortcut) continue

        const parts = config.shortcut.key.toLowerCase().split("+")
        const shortcutKey = parts[parts.length - 1]
        const needsShift = parts.includes("shift")

        if (key === shortcutKey && event.shiftKey === needsShift) {
            return config.id
        }
    }

    return null
}
