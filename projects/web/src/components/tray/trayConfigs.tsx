/**
 * Tray configuration definitions
 *
 * Each tray type declares its button properties, badge renderer, and content renderer.
 * This keeps all tray-specific logic in one place for easy extension.
 */

import type { LucideIcon } from "lucide-react"
import { FolderOpen, GitCommitHorizontal, GitCompare, NotebookPen, Play, Search, TerminalSquare } from "lucide-react"
import type { ReactNode } from "react"
import {
    buildOpenADEProjectFileCapabilities,
    buildOpenADEProjectProcessCapabilities,
    buildOpenADEProjectSearchCapabilities,
    buildOpenADETaskGitCapabilities,
    buildOpenADETaskTerminalCapabilities,
} from "../../shell/capabilities"
import type { RunContext } from "../../electronAPI/procs"
import type { GitInfo } from "../../store/managers/RepoManager"
import type { TrayManager, TrayType } from "../../store/managers/TrayManager"
import { ChangesViewer } from "../ChangesViewer"
import { GitLogTray } from "../GitLogTray"
import { ProcessesTray } from "../ProcessesTray"
import { SearchTray } from "../SearchTray"
import { Terminal } from "../Terminal"
import type { TaskTerminalProductAccess } from "../terminalSession"
import { FilesTrayContent } from "./FilesTrayContent"
import { ScratchpadTrayContent } from "./ScratchpadTrayContent"

export interface TrayConfig {
    id: TrayType
    label: string
    icon: LucideIcon
    shortcut?: { key: string; display: string }
    /** If provided, determines whether this tray tab is shown. Defaults to visible. */
    isVisible?: (tray: TrayManager) => boolean
    /** Called when this tray is opened */
    onOpen?: (tray: TrayManager) => void
    /** Called when this tray is closed (toggle, explicit close, or switched away) */
    onClose?: (tray: TrayManager) => void
    /** Render badge content for the tray button (e.g., process count) */
    renderBadge?: (tray: TrayManager) => ReactNode
    /** Render the tray content panel */
    renderContent: (tray: TrayManager) => ReactNode
}

function NoEnvironment() {
    return <div className="flex items-center justify-center h-full text-muted text-sm">Environment not available</div>
}

function projectPathFromGitInfo(gitInfo: GitInfo): string {
    const repoRoot = gitInfo.repoRoot.replace(/[\\/]+$/, "")
    const relativePath = gitInfo.relativePath.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
    return relativePath ? `${repoRoot}/${relativePath}` : repoRoot
}

function getTaskWorkingDirHint(tray: TrayManager): string | null {
    return tray.taskModel.taskWorkingDirHint
}

function getWorkspaceRepoPath(tray: TrayManager): string | null {
    return tray.store.repos.getRepo(tray.workspaceId)?.path ?? null
}

async function resolveWorkspaceRepoPath(tray: TrayManager): Promise<string | null> {
    const repoPath = getWorkspaceRepoPath(tray)
    if (repoPath) return repoPath
    if (!tray.store.shouldUseRuntimeProductTaskRoute()) return null
    const gitInfo = await tray.store.repos.getGitInfo(tray.workspaceId)
    return gitInfo ? projectPathFromGitInfo(gitInfo) : null
}

function getProcessContext(tray: TrayManager): RunContext | null {
    const taskWorkingDir = getTaskWorkingDirHint(tray)
    if (!taskWorkingDir) return null
    const task = tray.store.tasks.getTask(tray.taskId)
    const isWorktree = task?.isolationStrategy?.type === "worktree"
    return isWorktree ? { type: "worktree", root: taskWorkingDir } : { type: "repo", root: taskWorkingDir }
}

function isGitBackedTrayVisible(tray: TrayManager): boolean {
    const env = tray.taskModel.environment
    if (env) return env.hasGit
    return !tray.taskModel.needsEnvironmentSetup
}

function canUseRuntimeProjectScope(tray: TrayManager): boolean {
    return !tray.taskModel.usesRuntimeProductAPI || Boolean(tray.taskModel.repoId)
}

function canOpenFilesTray(tray: TrayManager): boolean {
    if (!tray.taskModel.usesRuntimeProductAPI) return true
    if (!tray.taskModel.repoId) return false
    const capabilities = buildOpenADEProjectFileCapabilities({ has: (method) => tray.store.canUseProductMethod(method) })
    return capabilities.canList && capabilities.canRead && capabilities.canSearch
}

function canOpenSearchTray(tray: TrayManager): boolean {
    if (!tray.taskModel.usesRuntimeProductAPI) return true
    if (!tray.taskModel.repoId) return false
    const runtimeCapabilities = { has: (method: Parameters<typeof tray.store.canUseProductMethod>[0]) => tray.store.canUseProductMethod(method) }
    const searchCapabilities = buildOpenADEProjectSearchCapabilities(runtimeCapabilities)
    const fileCapabilities = buildOpenADEProjectFileCapabilities(runtimeCapabilities)
    return searchCapabilities.canSearch && fileCapabilities.canRead
}

function canOpenChangesTray(tray: TrayManager): boolean {
    if (!isGitBackedTrayVisible(tray)) return false
    if (!tray.taskModel.usesRuntimeProductAPI) return true
    if (!tray.taskModel.repoId) return false
    const capabilities = buildOpenADETaskGitCapabilities({ has: (method) => tray.store.canUseProductMethod(method) })
    return capabilities.canReadSummary && capabilities.canReadChanges && capabilities.canReadDiff && capabilities.canReadFilePair
}

function canOpenGitLogTray(tray: TrayManager): boolean {
    if (!isGitBackedTrayVisible(tray)) return false
    if (!tray.taskModel.usesRuntimeProductAPI) return true
    if (!tray.taskModel.repoId) return false
    const capabilities = buildOpenADETaskGitCapabilities({ has: (method) => tray.store.canUseProductMethod(method) })
    return (
        capabilities.canReadScopes &&
        capabilities.canReadLog &&
        capabilities.canReadCommitFiles &&
        capabilities.canReadCommitFilePatch &&
        capabilities.canReadFileAtTreeish
    )
}

function canOpenTaskTerminal(tray: TrayManager): boolean {
    if (!tray.taskModel.usesRuntimeProductAPI) return true
    if (!tray.taskModel.repoId) return false
    const capabilities = buildOpenADETaskTerminalCapabilities({ has: (method) => tray.store.canUseProductMethod(method) })
    return capabilities.canStart || capabilities.canReconnect
}

function getTaskTerminalProductAccess(tray: TrayManager): TaskTerminalProductAccess | null {
    if (!tray.taskModel.usesRuntimeProductAPI || !tray.taskModel.repoId) return null
    const repoId = tray.taskModel.repoId
    const taskId = tray.taskId
    const currentCapabilities = () => buildOpenADETaskTerminalCapabilities({ has: (method) => tray.store.canUseProductMethod(method) })
    return {
        repoId,
        taskId,
        get capabilities() {
            return currentCapabilities()
        },
        startTaskTerminal: (args) => {
            const capabilities = currentCapabilities()
            return capabilities.canStart
                ? tray.store.startProductTaskTerminal({ repoId, taskId, ...args })
                : Promise.resolve({ repoId, taskId, terminalId: "", ok: false, error: "terminal start is not permitted" })
        },
        reconnectTaskTerminal: (args) => {
            const capabilities = currentCapabilities()
            return capabilities.canReconnect
                ? tray.store.reconnectProductTaskTerminal({ repoId, taskId, ...args })
                : Promise.resolve({ repoId, taskId, terminalId: args.terminalId ?? "", found: false, output: [], outputCount: 0 })
        },
        writeTaskTerminal: (args) => {
            const capabilities = currentCapabilities()
            return capabilities.canWrite
                ? tray.store.writeProductTaskTerminal({ repoId, taskId, ...args })
                : Promise.resolve({ repoId, taskId, terminalId: args.terminalId, ok: false })
        },
        resizeTaskTerminal: (args) => {
            const capabilities = currentCapabilities()
            return capabilities.canResize
                ? tray.store.resizeProductTaskTerminal({ repoId, taskId, ...args })
                : Promise.resolve({ repoId, taskId, terminalId: args.terminalId, ok: false })
        },
        stopTaskTerminal: (args) => {
            const capabilities = currentCapabilities()
            return capabilities.canStop
                ? tray.store.stopProductTaskTerminal({ repoId, taskId, ...args })
                : Promise.resolve({ repoId, taskId, terminalId: args.terminalId, ok: false })
        },
    }
}

function getProjectProcessProductScope(tray: TrayManager): { repoId: string; taskId: string } | null {
    if (!tray.taskModel.usesRuntimeProductAPI || !tray.taskModel.repoId) return null
    return { repoId: tray.taskModel.repoId, taskId: tray.taskId }
}

function canOpenProjectProcesses(tray: TrayManager): boolean {
    if (!canUseRuntimeProjectScope(tray)) return false
    if (!tray.taskModel.usesRuntimeProductAPI) return true
    const capabilities = buildOpenADEProjectProcessCapabilities({ has: (method) => tray.store.canUseProductMethod(method) })
    return capabilities.canRead
}

function isExpectedTrayStillOpen(tray: TrayManager, trayType: TrayType): boolean {
    return tray.visibleOpenTray === trayType
}

function withTaskWorkingDir(tray: TrayManager, trayType: TrayType, onResolved: (taskWorkingDir: string) => void): void {
    const taskWorkingDir = getTaskWorkingDirHint(tray)
    if (taskWorkingDir) {
        onResolved(taskWorkingDir)
        return
    }
    void tray.taskModel.ensureTaskWorkingDirHint().then((resolvedDir) => {
        if (resolvedDir && isExpectedTrayStillOpen(tray, trayType)) onResolved(resolvedDir)
    })
}

function ensureTaskWorkingDir(tray: TrayManager, trayType: TrayType): void {
    withTaskWorkingDir(tray, trayType, () => undefined)
}

function openFileBrowser(tray: TrayManager): void {
    withTaskWorkingDir(tray, "files", (taskWorkingDir) => openFileBrowserAtDir(tray, taskWorkingDir))
}

function openFileBrowserAtDir(tray: TrayManager, taskWorkingDir: string): void {
    const fileBrowser = tray.taskModel.fileBrowser
    if (fileBrowser.workingDir === taskWorkingDir) {
        fileBrowser.refreshTree()
    } else {
        fileBrowser.setWorkingDir(taskWorkingDir)
    }
}

function openContentSearch(tray: TrayManager): void {
    withTaskWorkingDir(tray, "search", (taskWorkingDir) => tray.taskModel.contentSearch.setWorkingDir(taskWorkingDir))
}

function refreshGitStateAfterTerminalClose(tray: TrayManager): void {
    if (tray.taskModel.usesRuntimeProductAPI) return
    tray.taskModel.refreshGitState()
}

export const TRAY_CONFIGS: TrayConfig[] = [
    {
        id: "changes",
        label: "Changes",
        icon: GitCompare,
        shortcut: { key: "mod+shift+g", display: "⌘⇧G" },
        isVisible: canOpenChangesTray,
        onOpen: (tray) => {
            tray.taskModel.refreshGitState()
            tray.taskModel.changes.initializeForTray()
        },
        renderBadge: (tray) => {
            const status = tray.taskModel.gitStatus
            if (!status?.hasChanges) return null
            const count = status.staged.files.length + status.unstaged.files.length + status.untracked.length
            return count > 0 ? count : null
        },
        renderContent: (tray) => {
            const env = tray.taskModel.environment
            if (!env?.taskWorkingDir && !tray.taskModel.usesRuntimeProductAPI) {
                return <NoEnvironment />
            }
            const task = tray.store.tasks.getTask(tray.taskId)
            const isWorktree = task?.isolationStrategy?.type === "worktree"
            return <ChangesViewer changesManager={tray.taskModel.changes} isWorktree={isWorktree} className="h-full" taskId={tray.taskId} />
        },
    },
    {
        id: "files",
        label: "Files",
        icon: FolderOpen,
        shortcut: { key: "mod+p", display: "⌘P" },
        isVisible: canOpenFilesTray,
        onOpen: openFileBrowser,
        renderContent: (tray) => <FilesTrayContent fileBrowser={tray.taskModel.fileBrowser} taskId={tray.taskId} onClose={() => tray.close()} />,
    },
    {
        id: "gitlog",
        label: "Git Log",
        icon: GitCommitHorizontal,
        shortcut: { key: "mod+shift+l", display: "⌘⇧L" },
        isVisible: canOpenGitLogTray,
        onOpen: (tray) => ensureTaskWorkingDir(tray, "gitlog"),
        renderContent: (tray) => {
            const taskWorkingDir = getTaskWorkingDirHint(tray)
            if (!taskWorkingDir) {
                return <NoEnvironment />
            }
            return <GitLogTray taskId={tray.taskId} workDir={taskWorkingDir} currentBranch={tray.taskModel.gitStatus?.branch ?? null} className="h-full" />
        },
    },
    {
        id: "search",
        label: "Search",
        icon: Search,
        shortcut: { key: "mod+shift+f", display: "⌘⇧F" },
        isVisible: canOpenSearchTray,
        onOpen: openContentSearch,
        renderContent: (tray) => <SearchTray contentSearch={tray.taskModel.contentSearch} taskId={tray.taskId} onEscapeClose={() => tray.close()} />,
    },
    {
        id: "terminal",
        label: "Terminal",
        icon: TerminalSquare,
        shortcut: { key: "mod+t", display: "⌘T" },
        isVisible: canOpenTaskTerminal,
        onOpen: (tray) => ensureTaskWorkingDir(tray, "terminal"),
        onClose: refreshGitStateAfterTerminalClose,
        renderContent: (tray) => {
            const taskWorkingDir = getTaskWorkingDirHint(tray)
            if (!taskWorkingDir) {
                return <NoEnvironment />
            }
            return (
                <Terminal
                    ptyId={tray.taskId}
                    cwd={taskWorkingDir}
                    productAccess={getTaskTerminalProductAccess(tray)}
                    className="h-full"
                    onClose={() => tray.close()}
                />
            )
        },
    },
    {
        id: "scratchpad",
        label: "Scratch Pad",
        icon: NotebookPen,
        shortcut: { key: "mod+shift+s", display: "⌘⇧S" },
        renderContent: (tray) => {
            return (
                <ScratchpadTrayContent
                    workspaceId={tray.workspaceId}
                    repoPath={getWorkspaceRepoPath(tray)}
                    resolveRepoPath={() => resolveWorkspaceRepoPath(tray)}
                />
            )
        },
    },
    {
        id: "processes",
        label: "Processes",
        icon: Play,
        shortcut: { key: "mod+shift+p", display: "⌘⇧P" },
        isVisible: canOpenProjectProcesses,
        onOpen: (tray) => ensureTaskWorkingDir(tray, "processes"),
        renderBadge: (tray) => {
            const context = getProcessContext(tray)
            if (!context) return null
            const count = tray.store.repoProcesses.runningCountForContext(context)
            return count > 0 ? count : null
        },
        renderContent: (tray) => {
            const context = getProcessContext(tray)
            if (!context) {
                return <NoEnvironment />
            }
            return (
                <ProcessesTray
                    searchPath={context.root}
                    context={context}
                    workspaceId={tray.workspaceId}
                    isOpen={tray.openTray === "processes"}
                    productScope={getProjectProcessProductScope(tray)}
                />
            )
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
