import { Popover } from "@base-ui-components/react/popover"
import cx from "classnames"
import { exhaustive } from "exhaustive"
import {
    AlertCircle,
    AlertTriangle,
    ChevronDown,
    Code,
    FileText,
    GitBranch,
    ImagePlus,
    Loader2,
    MessageCircle,
    RotateCcw,
    Settings,
    Star,
    X,
} from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useRef, useState } from "react"
import { ModelPicker } from "../components/ModelPicker"
import { SmartEditor, type SmartEditorRef } from "../components/SmartEditor"
import { TaskMcpSelector } from "../components/mcp/TaskMcpSelector"
import { Select, Switch } from "../components/ui"
import type { BranchInfo, GitStatusResponse } from "../electronAPI/git"
import { usePortalContainer } from "../hooks/usePortalContainer"
import { useCodeNavigate } from "../routing"
import { useCodeStore } from "../store/context"
import type { CreationPhase, TaskCreation } from "../store/managers/TaskCreationManager"
import type { Repo } from "../types"
import { processImageBlob } from "../utils/imageAttachment"

interface TaskCreatePageProps {
    workspaceId: string
    repo: Repo
}

const getLastBranchKey = (workspaceId: string) => `code:lastBranch:${workspaceId}`
const getCreateMoreKey = (workspaceId: string) => `code:createMore:${workspaceId}`

const phaseLabels: Record<CreationPhase | "pending" | "completing", string> = {
    pending: "Starting...",
    workspace: "Creating workspace",
    completing: "Finalizing",
}

function PendingTaskItem({
    creation,
    onClick,
    onRetry,
    onDismiss,
}: { creation: TaskCreation; onClick: () => void; onRetry: () => void; onDismiss: () => void }) {
    const hasError = creation.error !== null
    const sourceBranch = exhaustive.tag(creation.isolationStrategy, "type", {
        worktree: (s) => s.sourceBranch,
        head: () => null,
    })

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onClick()
                }
            }}
            className={cx("p-3 border-b border-border cursor-pointer transition-colors", hasError ? "bg-error/5 hover:bg-error/10" : "hover:bg-base-200")}
        >
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                    {hasError ? <AlertCircle size="1rem" className="text-error" /> : <Loader2 size="1rem" className="animate-spin text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                    <p className={cx("text-sm truncate", hasError ? "text-error" : "text-base-content")}>
                        {creation.description.length > 60 ? `${creation.description.slice(0, 60)}...` : creation.description}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                        <span className={cx("text-xs", hasError ? "text-error/70" : "text-muted")}>{hasError ? "Failed" : phaseLabels[creation.phase]}</span>
                        {sourceBranch && (
                            <span className="text-xs text-muted flex items-center gap-1">
                                <GitBranch size="0.75rem" />
                                {sourceBranch}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    {hasError && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation()
                                onRetry()
                            }}
                            className="btn p-1.5 text-muted hover:text-base-content hover:bg-base-300 transition-colors"
                            title="Retry"
                        >
                            <RotateCcw size="0.875rem" />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onDismiss()
                        }}
                        className="btn p-1.5 text-muted hover:text-base-content hover:bg-base-300 transition-colors"
                        title="Dismiss"
                    >
                        <X size="0.875rem" />
                    </button>
                </div>
            </div>
        </div>
    )
}

function truncateMiddle(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str
    const ellipsis = "…"
    const charsToShow = maxLen - ellipsis.length
    const frontChars = Math.ceil(charsToShow / 2)
    const backChars = Math.floor(charsToShow / 2)
    return str.slice(0, frontChars) + ellipsis + str.slice(-backChars)
}

export const TaskCreatePage = observer(({ workspaceId, repo }: TaskCreatePageProps) => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()
    const portalContainer = usePortalContainer()
    const [branches, setBranches] = useState<BranchInfo[]>([])
    const [selectedBranch, setSelectedBranch] = useState<string>("")
    const [defaultBranch, setDefaultBranch] = useState<string>("")
    const [lastUsedBranch, setLastUsedBranch] = useState<string | null>(null)
    const [branchesLoading, setBranchesLoading] = useState(false)
    const [uncommittedChanges, setUncommittedChanges] = useState<GitStatusResponse | null>(null)
    const [useWorktree, setUseWorktree] = useState(false)
    const [createMore, setCreateMore] = useState(() => localStorage.getItem(getCreateMoreKey(workspaceId)) === "true")
    const [pendingNavigationCreationId, setPendingNavigationCreationId] = useState<string | null>(null)
    const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<string[]>([])
    const editorRef = useRef<SmartEditorRef>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Get SmartEditorManager for task creation
    const editorManager = codeStore.smartEditors.getManager("task-create", workspaceId)

    // Track if git info has been loaded
    const [gitInfoLoaded, setGitInfoLoaded] = useState(false)

    // Load git info and branches on mount
    useEffect(() => {
        const loadGitInfo = async () => {
            setBranchesLoading(true)
            try {
                // Fetch git info (async, from cache or Electron)
                const gitInfo = await codeStore.repos.getGitInfo(workspaceId)
                setGitInfoLoaded(true)

                if (!gitInfo) {
                    setBranchesLoading(false)
                    return
                }

                // Load branches using RepoManager
                const result = await codeStore.repos.listBranches(workspaceId)
                setBranches(result.branches)
                setDefaultBranch(result.defaultBranch)

                const storedLastBranch = localStorage.getItem(getLastBranchKey(workspaceId))
                const branchExists = result.branches.some((b) => b.name === storedLastBranch)

                if (storedLastBranch && branchExists) {
                    setLastUsedBranch(storedLastBranch)
                    setSelectedBranch(storedLastBranch)
                } else {
                    setSelectedBranch(result.defaultBranch)
                }
            } catch (err) {
                console.error("[TaskCreatePage] Failed to load git info/branches:", err)
            } finally {
                setBranchesLoading(false)
            }
        }

        loadGitInfo()
    }, [workspaceId, codeStore.repos])

    // Check for uncommitted changes when git info is loaded
    useEffect(() => {
        if (!gitInfoLoaded) return

        const checkUncommitted = async () => {
            try {
                const result = await codeStore.repos.getGitStatus(workspaceId)
                setUncommittedChanges(result)
            } catch (err) {
                console.error("[TaskCreatePage] Failed to check uncommitted changes:", err)
            }
        }

        checkUncommitted()
    }, [gitInfoLoaded, workspaceId, codeStore.repos])

    useEffect(() => {
        localStorage.setItem(getCreateMoreKey(workspaceId), String(createMore))
    }, [createMore, workspaceId])

    const handleBranchSelect = (branchName: string) => {
        setSelectedBranch(branchName)
        localStorage.setItem(getLastBranchKey(workspaceId), branchName)
        setLastUsedBranch(branchName)
    }

    useEffect(() => {
        editorRef.current?.focus()
    }, [repo?.path, editorManager])

    const handleCreate = (mode: "plan" | "do" | "ask") => {
        if (!editorManager.value.trim() || !workspaceId) return

        const description = editorManager.value.trim()

        console.log("[TaskCreatePage] Creating task with MCP servers", {
            selectedMcpServerIds,
            enabledServersCount: codeStore.mcpServers.enabledServers.length,
        })

        const creationId = codeStore.creation.newTask({
            repoId: workspaceId,
            description,
            mode,
            isolationStrategy: useWorktree && selectedBranch ? { type: "worktree", sourceBranch: selectedBranch } : { type: "head" },
            enabledMcpServerIds: selectedMcpServerIds.length > 0 ? selectedMcpServerIds : undefined,
        })

        editorManager.clear()
        if (mode === "do" || mode === "ask") {
            navigate.go("CodeWorkspaceTaskCreating", { workspaceId, creationId })
        } else if (createMore) {
            editorRef.current?.focus()
        } else {
            setPendingNavigationCreationId(creationId)
        }
    }

    const isDisabled = !editorManager.value.trim()
    const showBranchSelector = gitInfoLoaded && branches.length > 0

    const creations = codeStore.creation.getCreationsForRepo(workspaceId)
    const pendingCreations = creations.filter((c) => c.completedTaskId === null)

    const pendingCreation = pendingNavigationCreationId ? codeStore.creation.getCreation(pendingNavigationCreationId) : null
    useEffect(() => {
        if (pendingCreation?.completedTaskId) {
            setPendingNavigationCreationId(null)
            navigate.go("CodeWorkspaceTask", { workspaceId, taskId: pendingCreation.completedTaskId })
        }
    }, [pendingCreation?.completedTaskId, workspaceId, navigate])

    const handleRetryCreation = (creationId: string) => {
        codeStore.creation.retryCreation(creationId)
    }

    const handleDismissCreation = (creationId: string) => {
        codeStore.creation.dismissCreation(creationId)
    }

    // Check for uncommitted changes warning condition
    const showUncommittedWarning = uncommittedChanges?.hasChanges && useWorktree

    const handleEditorAreaClick = () => {
        editorRef.current?.focus()
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Editor area - takes remaining space with scroll */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: clicking anywhere focuses editor */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 cursor-text" onClick={handleEditorAreaClick}>
                <SmartEditor
                    ref={editorRef}
                    manager={editorManager}
                    fileMentionsDir={repo?.path ?? null}
                    slashCommandsDir={repo?.path ?? null}
                    placeholder="Describe your task... Use @ to reference files, / for commands"
                    className="h-full text-base border-0 bg-transparent [&>div]:h-full [&>div]:border-0 [&>div]:border-l-2 [&>div]:border-l-transparent [&>div:focus-within]:border-l-primary [&>div]:transition-colors"
                    editorClassName="h-full"
                />
            </div>

            {/* Favorites bar - outside bottom bar, same bg as editor */}
            {editorManager.favorites.length > 0 && (
                <div className="flex-shrink-0 flex items-center gap-2 px-6 py-2">
                    <Star size={12} className="text-muted" />
                    {editorManager.favorites.map((file) => (
                        <button
                            key={file.path}
                            type="button"
                            onClick={() => editorManager.insertFile(file.path)}
                            title={file.path}
                            className="btn text-xs px-2 py-1 bg-base-200 text-base-content hover:bg-base-300 transition-colors cursor-pointer flex items-center gap-1"
                        >
                            <FileText size={12} className="flex-shrink-0 text-muted" />
                            {file.parentDir && <span className="text-muted">{file.parentDir}/</span>}
                            {file.fileName}
                        </button>
                    ))}
                </div>
            )}

            {/* Bottom bar */}
            <div className="flex-shrink-0 border-t border-border bg-base-100">
                {/* Image preview strip */}
                {editorManager.pendingImages.length > 0 && (
                    <div className="flex gap-2 px-4 py-2 border-b border-border overflow-x-auto">
                        {editorManager.pendingImages.map((img) => (
                            <div key={img.id} className="relative shrink-0 group">
                                <img
                                    src={editorManager.pendingImageDataUrls.get(img.id)}
                                    alt=""
                                    className="h-20 object-cover"
                                    style={{ aspectRatio: `${img.resizedWidth}/${img.resizedHeight}` }}
                                />
                                <button
                                    type="button"
                                    className="btn absolute -top-1.5 -right-1.5 bg-base-300 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => editorManager.removeImage(img.id)}
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Uncommitted changes warning */}
                {showUncommittedWarning && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/20">
                        <AlertTriangle size={14} className="text-warning flex-shrink-0" />
                        <span className="text-xs text-warning">
                            Uncommitted changes won't be included in worktree
                            {uncommittedChanges.staged.files.length > 0 && (
                                <span className="ml-1.5 text-warning/80">({uncommittedChanges.staged.files.length} staged)</span>
                            )}
                            {uncommittedChanges.unstaged.files.length > 0 && (
                                <span className="ml-1.5 text-warning/80">({uncommittedChanges.unstaged.files.length} unstaged)</span>
                            )}
                        </span>
                    </div>
                )}

                {/* Main toolbar row */}
                <div className="flex items-center gap-4 px-4 py-3">
                    {/* Left section: Connectors - scrollable */}
                    <div className="flex-1 min-w-0 overflow-x-auto">
                        <div className="flex items-center gap-2">
                            <TaskMcpSelector selectedServerIds={selectedMcpServerIds} onSelectionChange={setSelectedMcpServerIds} compact iconOnly />
                        </div>
                    </div>

                    {/* Image attach + Model picker */}
                    <div className="flex items-center gap-1">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) {
                                    processImageBlob(file).then(({ attachment, dataUrl }) => {
                                        editorManager.addImage(attachment, dataUrl)
                                    })
                                    e.target.value = ""
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="btn p-2 text-muted hover:text-base-content hover:bg-base-200 transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                            title="Attach image"
                        >
                            <ImagePlus size={16} />
                        </button>
                        <ModelPicker value={codeStore.defaultModel} onChange={(m) => codeStore.setDefaultModel(m)} />
                    </div>

                    {/* Center section: Worktree toggle + branch selector */}
                    {showBranchSelector && (
                        <div className="flex items-center gap-3 border-l border-border pl-4">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted">Worktree</span>
                                <Switch checked={useWorktree} onCheckedChange={setUseWorktree} aria-label="Use worktree" />
                            </div>

                            {useWorktree && (
                                <div className="flex items-center gap-2">
                                    <GitBranch size={14} className="text-muted" />
                                    <Select
                                        selectedId={selectedBranch}
                                        entries={branches.map((branch) => ({
                                            id: branch.name,
                                            content: (
                                                <span className="flex items-center gap-2">
                                                    <span className="truncate">{truncateMiddle(branch.name, 20)}</span>
                                                    {branch.isDefault && <span className="text-xs text-muted">default</span>}
                                                    {!branch.isDefault && lastUsedBranch === branch.name && <span className="text-xs text-primary">last</span>}
                                                </span>
                                            ),
                                        }))}
                                        onSelect={(entry) => handleBranchSelect(entry.id)}
                                        disabled={branchesLoading}
                                        className={{
                                            trigger: "h-8 min-w-0 w-auto max-w-48 text-sm px-2",
                                        }}
                                    />
                                    {selectedBranch && defaultBranch && selectedBranch !== defaultBranch && (
                                        <span title={`Branching from ${selectedBranch}, not ${defaultBranch}`}>
                                            <AlertCircle size={14} className="text-muted flex-shrink-0" />
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Right section: Settings + Pending + Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Pending tasks indicator */}
                        {pendingCreations.length > 0 && (
                            <Popover.Root>
                                <Popover.Trigger className="btn flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted hover:text-base-content hover:bg-base-200 transition-colors">
                                    <Loader2 size={12} className="animate-spin" />
                                    <span>{pendingCreations.length} pending</span>
                                    <ChevronDown size={12} />
                                </Popover.Trigger>
                                <Popover.Portal container={portalContainer}>
                                    <Popover.Positioner sideOffset={8} side="top" align="end">
                                        <Popover.Popup className="z-50 w-80 bg-base-100 border border-border shadow-lg outline-none">
                                            <div className="px-3 py-2 border-b border-border">
                                                <span className="text-xs font-medium text-muted">Pending Tasks</span>
                                            </div>
                                            <div className="max-h-64 overflow-y-auto">
                                                {pendingCreations.map((creation) => (
                                                    <PendingTaskItem
                                                        key={creation.id}
                                                        creation={creation}
                                                        onClick={() => navigate.go("CodeWorkspaceTaskCreating", { workspaceId, creationId: creation.id })}
                                                        onRetry={() => handleRetryCreation(creation.id)}
                                                        onDismiss={() => handleDismissCreation(creation.id)}
                                                    />
                                                ))}
                                            </div>
                                        </Popover.Popup>
                                    </Popover.Positioner>
                                </Popover.Portal>
                            </Popover.Root>
                        )}

                        {/* Settings popover */}
                        <Popover.Root>
                            <Popover.Trigger className="btn p-2 text-muted hover:text-base-content hover:bg-base-200 transition-colors">
                                <Settings size={16} />
                            </Popover.Trigger>
                            <Popover.Portal container={portalContainer}>
                                <Popover.Positioner sideOffset={8} side="top" align="end">
                                    <Popover.Popup className="z-50 w-56 bg-base-100 border border-border shadow-lg p-3 outline-none">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-sm text-base-content">Create More</div>
                                                <div className="text-xs text-muted">Stay on page after creating</div>
                                            </div>
                                            <Switch checked={createMore} onCheckedChange={setCreateMore} aria-label="Create more tasks" />
                                        </div>
                                    </Popover.Popup>
                                </Popover.Positioner>
                            </Popover.Portal>
                        </Popover.Root>

                        {/* Action buttons */}
                        <button
                            type="button"
                            onClick={() => handleCreate("do")}
                            disabled={isDisabled}
                            className={cx(
                                "btn flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all",
                                isDisabled
                                    ? "bg-success/40 text-success-content/50 cursor-not-allowed"
                                    : "bg-success text-success-content hover:bg-success/90 cursor-pointer"
                            )}
                        >
                            <Code size={14} />
                            Do
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCreate("plan")}
                            disabled={isDisabled}
                            className={cx(
                                "btn flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all",
                                isDisabled
                                    ? "bg-primary/40 text-primary-content/50 cursor-not-allowed"
                                    : "bg-primary text-primary-content hover:bg-primary/90 cursor-pointer"
                            )}
                        >
                            <FileText size={14} />
                            Plan
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCreate("ask")}
                            disabled={isDisabled}
                            className={cx(
                                "btn flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all",
                                isDisabled
                                    ? "bg-base-200/40 text-base-content/50 cursor-not-allowed"
                                    : "bg-base-200 text-base-content hover:bg-base-300 active:bg-base-300 active:scale-95 cursor-pointer"
                            )}
                        >
                            <MessageCircle size={14} />
                            Ask
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
})
