import { AlertCircle, Archive, CheckCircle2, ChevronDown, FileText, GitBranch, Loader2, MessageSquarePlus, RefreshCw, RotateCcw, X } from "lucide-react"
import { useEffect, type ReactNode } from "react"
import type { OpenADEIsolationStrategy, OpenADEProject, OpenADEProjectGitBranchesReadResult } from "../../../../openade-module/src"
import { ShortcutBadge } from "../../components/ui/ShortcutBadge"
import { Switch } from "../../components/ui/Switch"
import type { AgentCouplet } from "../../hyperplan/types"
import { useMetaKeyPressed } from "../../hooks/useMetaKeyPressed"
import { getMetaDigitShortcutIndex, isMetaShortcut } from "../../utils/keyboardShortcuts"
import { TaskComposer, type TaskComposerAgentControls, type TaskComposerImageAttachment } from "./TaskComposer"
import { buildTaskHyperPlanStrategy, TaskHyperPlanPicker, type TaskHyperPlanPresetId } from "./TaskHyperPlanPicker"
import { isolationStrategyForBranchCapability } from "./isolationStrategy"
import { TASK_NEW_TASK_COMMANDS, type TaskCommandType } from "./taskCommands"

const NEW_TASK_COMMAND_SHORTCUTS: Record<number, TaskCommandType> = {
    1: "do",
    2: "plan",
    3: "ask",
    4: "hyperplan",
}

const NEW_TASK_COMMAND_SHORTCUT_LABELS: Partial<Record<TaskCommandType, string>> = {
    do: "1",
    plan: "2",
    ask: "3",
    hyperplan: "4",
}

export interface NewTaskDraftView {
    id: string
    createdAtLabel: string
    preview: string
    imageCount?: number
}

export interface NewTaskPendingCreationView {
    id: string
    preview: string
    phaseLabel: string
    sourceBranch?: string
    error: string | null
    isComplete?: boolean
    canOpen?: boolean
    canCancel?: boolean
}

const emptyNewTaskDrafts: NewTaskDraftView[] = []
const emptyNewTaskPendingCreations: NewTaskPendingCreationView[] = []

function localBranches(branches: OpenADEProjectGitBranchesReadResult | null): OpenADEProjectGitBranchesReadResult["branches"] {
    return branches?.branches.filter((branch) => !branch.isRemote) ?? []
}

function defaultSourceBranch(branches: OpenADEProjectGitBranchesReadResult | null, preferredSourceBranch?: string | null): string {
    const visibleBranches = localBranches(branches)
    if (preferredSourceBranch && visibleBranches.some((branch) => branch.name === preferredSourceBranch)) return preferredSourceBranch
    return (
        visibleBranches.find((branch) => branch.name === branches?.defaultBranch)?.name ??
        visibleBranches.find((branch) => branch.isDefault)?.name ??
        visibleBranches[0]?.name ??
        ""
    )
}

export function NewTaskScreen({
    repos,
    repoId,
    mode,
    title,
    prompt,
    isolationStrategy = { type: "head" },
    branchOptions = null,
    branchesLoading = false,
    preferredSourceBranch = null,
    isLoading,
    isSubmitting,
    isOnline,
    agentControls,
    imageAttachments,
    imageAttachLoading,
    editor,
    onFocusInputShortcut,
    drafts = emptyNewTaskDrafts,
    pendingCreations = emptyNewTaskPendingCreations,
    canStashDraft = false,
    canRestoreDraft = true,
    createMore = false,
    hyperplanPresetId = "ensemble",
    onRepoChange,
    onModeChange,
    onTitleChange,
    onPromptChange,
    onIsolationStrategyChange,
    onRefreshBranches,
    onHyperplanPresetChange,
    onStashDraft,
    onRestoreDraft,
    onDeleteDraft,
    onRetryPendingCreation,
    onOpenPendingCreation,
    onCancelPendingCreation,
    onDismissPendingCreation,
    onCreateMoreChange,
    onAttachImage,
    onRemoveImage,
    onCreateTask,
    onCreateAndRun,
}: {
    repos: OpenADEProject[]
    repoId: string | null
    mode: TaskCommandType
    title: string
    prompt: string
    isolationStrategy?: OpenADEIsolationStrategy
    branchOptions?: OpenADEProjectGitBranchesReadResult | null
    branchesLoading?: boolean
    preferredSourceBranch?: string | null
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    agentControls?: TaskComposerAgentControls
    imageAttachments?: TaskComposerImageAttachment[]
    imageAttachLoading?: boolean
    editor?: ReactNode
    onFocusInputShortcut?: () => void
    drafts?: NewTaskDraftView[]
    pendingCreations?: NewTaskPendingCreationView[]
    canStashDraft?: boolean
    canRestoreDraft?: boolean
    createMore?: boolean
    hyperplanPresetId?: TaskHyperPlanPresetId
    onRepoChange: (repoId: string) => void
    onModeChange: (mode: TaskCommandType) => void
    onTitleChange: (title: string) => void
    onPromptChange: (prompt: string) => void
    onIsolationStrategyChange?: (strategy: OpenADEIsolationStrategy) => void
    onRefreshBranches?: () => void
    onHyperplanPresetChange?: (value: TaskHyperPlanPresetId) => void
    onStashDraft?: () => void
    onRestoreDraft?: (draftId: string) => void
    onDeleteDraft?: (draftId: string) => void
    onRetryPendingCreation?: (creationId: string) => void
    onOpenPendingCreation?: (creationId: string) => void
    onCancelPendingCreation?: (creationId: string) => void
    onDismissPendingCreation?: (creationId: string) => void
    onCreateMoreChange?: (value: boolean) => void
    onAttachImage?: (file: File) => void
    onRemoveImage?: (imageId: string) => void
    onCreateTask?: () => void
    onCreateAndRun?: (mode?: TaskCommandType) => void
}) {
    const shortcutHintsVisible = useMetaKeyPressed()
    const selectedRepo = repos.find((repo) => repo.id === repoId) ?? null
    const canStartTurn = Boolean(onCreateAndRun)
    const canCreateTask = Boolean(onCreateTask || onCreateAndRun)
    const canReadBranches = Boolean(onRefreshBranches && onIsolationStrategyChange)
    const canChangeHyperplanPreset = Boolean(onHyperplanPresetChange)
    const canStashCurrentDraft = canStashDraft && Boolean(onStashDraft)
    const canRestoreExistingDraft = canRestoreDraft && Boolean(onRestoreDraft)
    const canDeleteDraft = Boolean(onDeleteDraft)
    const canChangeCreateMore = Boolean(onCreateMoreChange)
    const composerAgentControls = canStartTurn ? agentControls : agentControls?.mcpControl ? { mcpControl: agentControls.mcpControl } : undefined
    const hyperplanPrimaryAgent: AgentCouplet | undefined =
        agentControls?.harnessId && agentControls.selectedModel ? { harnessId: agentControls.harnessId, modelId: agentControls.selectedModel } : undefined
    const canBuildHyperPlanStrategy = !canStartTurn || mode !== "hyperplan" || buildTaskHyperPlanStrategy(hyperplanPresetId, hyperplanPrimaryAgent) !== null
    const branches = localBranches(branchOptions)
    const visibleIsolationStrategy = isolationStrategyForBranchCapability(isolationStrategy, canReadBranches)
    const visibleIsolationType = visibleIsolationStrategy.type
    const preferredBranchExists = Boolean(preferredSourceBranch && branches.some((branch) => branch.name === preferredSourceBranch))
    const fallbackSourceBranch = defaultSourceBranch(branchOptions, preferredSourceBranch)
    const selectedSourceBranch =
        visibleIsolationType === "worktree" && branches.some((branch) => branch.name === visibleIsolationStrategy.sourceBranch)
            ? visibleIsolationStrategy.sourceBranch
            : fallbackSourceBranch
    const canCreateWithIsolation = visibleIsolationType === "head" || selectedSourceBranch.length > 0
    const canSubmitWithCreationContext = Boolean(repoId) && canCreateTask && canCreateWithIsolation && canBuildHyperPlanStrategy
    const canSubmitBase = canSubmitWithCreationContext && prompt.trim().length > 0 && !isLoading && !isSubmitting && isOnline
    const canAttachTaskImages = Boolean(onAttachImage)
    const showDraftControls = canStashCurrentDraft || drafts.length > 0
    const pendingErrorCount = pendingCreations.filter((creation) => creation.error !== null).length
    const pendingReadyCount = pendingCreations.filter((creation) => creation.isComplete === true).length
    const pendingActiveCount = pendingCreations.length - pendingErrorCount - pendingReadyCount
    const pendingSummaryLabel =
        pendingCreations.length === 1 && pendingReadyCount === 1
            ? "1 ready"
            : pendingCreations.length === 1 && pendingActiveCount === 1
              ? "1 pending"
              : pendingCreations.length === 1
                ? "1 issue"
                : pendingReadyCount > 0 && pendingActiveCount === 0 && pendingErrorCount === 0
                  ? `${pendingReadyCount} ready`
                  : `${pendingCreations.length} pending`

    useEffect(() => {
        const handleShortcut = (event: KeyboardEvent) => {
            const shortcutIndex = getMetaDigitShortcutIndex(event)
            if (shortcutIndex !== null) {
                const shortcutNumber = shortcutIndex + 1
                const shortcutMode = NEW_TASK_COMMAND_SHORTCUTS[shortcutNumber]
                if (!shortcutMode) return
                if (!canStartTurn && shortcutMode !== "do") return

                event.preventDefault()
                onModeChange(shortcutMode)
                if (shortcutMode === "hyperplan" || !canSubmitBase) return
                if (canStartTurn) {
                    onCreateAndRun?.(shortcutMode)
                } else {
                    onCreateTask?.()
                }
                return
            }

            if (!isMetaShortcut(event, "KeyM", { alt: true })) return
            if (!onCreateMoreChange) return
            event.preventDefault()
            onCreateMoreChange(!createMore)
        }

        window.addEventListener("keydown", handleShortcut, true)
        return () => window.removeEventListener("keydown", handleShortcut, true)
    }, [canStartTurn, canSubmitBase, createMore, onCreateAndRun, onCreateMoreChange, onCreateTask, onModeChange])

    useEffect(() => {
        const handleWorktreeShortcut = (event: KeyboardEvent) => {
            if (!isMetaShortcut(event, "KeyW", { alt: true })) return
            if (!canReadBranches || branchesLoading || isSubmitting || !repoId) return

            event.preventDefault()
            if (!branchOptions) {
                onRefreshBranches?.()
                return
            }
            if (visibleIsolationType === "worktree") {
                onIsolationStrategyChange?.({ type: "head" })
                return
            }
            const nextBranch = selectedSourceBranch || defaultSourceBranch(branchOptions, preferredSourceBranch)
            if (nextBranch) onIsolationStrategyChange?.({ type: "worktree", sourceBranch: nextBranch })
        }

        window.addEventListener("keydown", handleWorktreeShortcut, true)
        return () => window.removeEventListener("keydown", handleWorktreeShortcut, true)
    }, [
        branchOptions,
        branchesLoading,
        canReadBranches,
        isSubmitting,
        onIsolationStrategyChange,
        onRefreshBranches,
        preferredSourceBranch,
        repoId,
        selectedSourceBranch,
        visibleIsolationType,
    ])

    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3 pb-20" data-openade-surface="shared-new-task">
            <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
                <div className="overflow-hidden border border-border bg-base-200/25">
                    <div className="flex min-w-0 items-center gap-3 border-b border-border bg-base-200/60 p-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-primary/20 bg-primary/10 text-primary">
                            <MessageSquarePlus size={18} />
                        </span>
                        <div className="min-w-0">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">New task</div>
                            <div className="truncate text-base font-semibold">{selectedRepo?.name ?? "Choose a project"}</div>
                            <div className="truncate text-xs text-muted">{selectedRepo?.path ?? "Pick where this should run"}</div>
                        </div>
                    </div>
                    <div className="p-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-muted">Project</span>
                            <select
                                value={repoId ?? ""}
                                onChange={(event) => onRepoChange(event.target.value)}
                                disabled={isSubmitting}
                                className="input h-11 w-full max-w-full border border-border bg-base-100 px-3 text-sm"
                            >
                                {repos.map((repo) => (
                                    <option key={repo.id} value={repo.id}>
                                        {repo.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>

                <section className="border border-border bg-base-200/20 p-3">
                    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted">Task</div>
                        {(pendingCreations.length > 0 || showDraftControls) && (
                            <div className="flex shrink-0 items-center gap-1">
                                {pendingCreations.length > 0 && (
                                    <details className="relative">
                                        <summary className="btn flex h-8 cursor-pointer list-none items-center gap-1 bg-base-200 px-2 text-xs text-base-content">
                                            {pendingErrorCount > 0 ? (
                                                <AlertCircle size={13} className="text-error" />
                                            ) : pendingReadyCount > 0 && pendingActiveCount === 0 ? (
                                                <CheckCircle2 size={13} className="text-success" />
                                            ) : (
                                                <Loader2 size={13} className="animate-spin text-primary" />
                                            )}
                                            {pendingSummaryLabel}
                                            <ChevronDown size={12} />
                                        </summary>
                                        <div className="absolute right-0 z-20 mt-1 w-80 border border-border bg-base-100 shadow-lg">
                                            <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                                                Pending tasks
                                            </div>
                                            <div className="max-h-80 overflow-y-auto">
                                                {pendingCreations.map((creation) => {
                                                    const hasError = creation.error !== null
                                                    const isComplete = creation.isComplete === true
                                                    const showOpen = creation.canOpen === true && Boolean(onOpenPendingCreation)
                                                    const showRetry = hasError && Boolean(onRetryPendingCreation)
                                                    const showCancel = creation.canCancel === true && Boolean(onCancelPendingCreation)
                                                    const showDismiss = !showCancel && Boolean(onDismissPendingCreation)
                                                    return (
                                                        <div key={creation.id} className={hasError ? "border-b border-border bg-error/5 p-3" : "border-b border-border p-3"}>
                                                            <div className="flex min-w-0 items-start gap-2">
                                                                {hasError ? (
                                                                    <AlertCircle size={14} className="mt-0.5 shrink-0 text-error" />
                                                                ) : isComplete ? (
                                                                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
                                                                ) : (
                                                                    <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-primary" />
                                                                )}
                                                                <div className="min-w-0 flex-1">
                                                                    <div className={hasError ? "truncate text-sm text-error" : "truncate text-sm text-base-content"}>
                                                                        {creation.preview}
                                                                    </div>
                                                                    <div className={hasError ? "text-xs text-error/80" : "text-xs text-muted"}>
                                                                        {hasError ? creation.error : creation.phaseLabel}
                                                                    </div>
                                                                    {creation.sourceBranch && (
                                                                        <div className="mt-1 flex items-center gap-1 text-xs text-muted">
                                                                            <GitBranch size={11} />
                                                                            {creation.sourceBranch}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                {showOpen && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onOpenPendingCreation?.(creation.id)}
                                                                        className="btn flex items-center gap-1 bg-primary px-2 py-1 text-xs text-primary-content"
                                                                    >
                                                                        <FileText size={12} />
                                                                        Open
                                                                    </button>
                                                                )}
                                                                {showRetry && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onRetryPendingCreation?.(creation.id)}
                                                                        className="btn flex items-center gap-1 bg-base-200 px-2 py-1 text-xs"
                                                                    >
                                                                        <RotateCcw size={12} />
                                                                        Retry
                                                                    </button>
                                                                )}
                                                                {showCancel && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onCancelPendingCreation?.(creation.id)}
                                                                        className="btn flex items-center gap-1 px-2 py-1 text-xs text-muted hover:bg-base-200 hover:text-base-content"
                                                                    >
                                                                        <X size={12} />
                                                                        Cancel
                                                                    </button>
                                                                )}
                                                                {showDismiss && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onDismissPendingCreation?.(creation.id)}
                                                                        className="btn flex items-center gap-1 px-2 py-1 text-xs text-muted hover:bg-base-200 hover:text-base-content"
                                                                    >
                                                                        <X size={12} />
                                                                        Dismiss
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    </details>
                                )}
                                {showDraftControls && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={onStashDraft}
                                            disabled={!canStashCurrentDraft || isSubmitting}
                                            className="btn flex h-8 items-center gap-1 bg-base-200 px-2 text-xs text-base-content disabled:opacity-50"
                                        >
                                            <Archive size={13} />
                                            Stash
                                        </button>
                                        <details className="relative">
                                            <summary className="btn flex h-8 cursor-pointer list-none items-center gap-1 bg-base-200 px-2 text-xs text-base-content">
                                                <FileText size={13} />
                                                Drafts
                                                {drafts.length > 0 && <span className="min-w-4 bg-base-300 px-1 text-[10px]">{drafts.length}</span>}
                                                <ChevronDown size={12} />
                                            </summary>
                                            <div className="absolute right-0 z-20 mt-1 w-72 border border-border bg-base-100 shadow-lg">
                                                {drafts.length === 0 ? (
                                                    <div className="p-3 text-sm text-muted">No drafts.</div>
                                                ) : (
                                                    <div className="max-h-80 overflow-y-auto p-2">
                                                        {drafts.map((draft) => (
                                                            <div key={draft.id} className="border-b border-border p-2 last:border-b-0">
                                                                <div className="flex min-w-0 items-start gap-2">
                                                                    <FileText size={13} className="mt-0.5 shrink-0 text-muted" />
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="truncate text-sm text-base-content">{draft.preview}</div>
                                                                        <div className="text-xs text-muted">
                                                                            {draft.createdAtLabel}
                                                                            {draft.imageCount && draft.imageCount > 0
                                                                                ? ` - ${draft.imageCount} ${draft.imageCount === 1 ? "image" : "images"}`
                                                                                : ""}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-2 flex items-center gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onRestoreDraft?.(draft.id)}
                                                                        disabled={!canRestoreExistingDraft || isSubmitting}
                                                                        className="btn flex items-center gap-1 bg-base-200 px-2 py-1 text-xs disabled:opacity-50"
                                                                    >
                                                                        <RotateCcw size={12} />
                                                                        Pop
                                                                    </button>
                                                                    {canDeleteDraft && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => onDeleteDraft?.(draft.id)}
                                                                            className="btn flex items-center gap-1 px-2 py-1 text-xs text-muted hover:bg-base-200 hover:text-base-content"
                                                                        >
                                                                            <X size={12} />
                                                                            Delete
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </details>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                    <input
                        value={title}
                        aria-label="Task title"
                        onChange={(event) => onTitleChange(event.target.value)}
                        disabled={isSubmitting}
                        placeholder="Optional title"
                        className="input mb-2 h-11 w-full max-w-full border border-border bg-base-100 px-3 text-base"
                    />
                    {canReadBranches && (
                        <section className="mb-2 border border-border bg-base-100">
                            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                                <div className="flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                                    <GitBranch size={13} />
                                    <span>Isolation</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={onRefreshBranches}
                                    disabled={branchesLoading || isSubmitting || !repoId}
                                    className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                                >
                                    {branchesLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                    {branchOptions ? "Refresh" : "Load Branches"}
                                </button>
                            </div>
                            {branchOptions && branches.length > 0 && (
                                <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <span className="relative inline-flex">
                                            <input
                                                type="checkbox"
                                                aria-label="Use worktree"
                                                checked={visibleIsolationType === "worktree"}
                                                disabled={isSubmitting}
                                                onChange={(event) => {
                                                    if (!event.target.checked) {
                                                        onIsolationStrategyChange?.({ type: "head" })
                                                        return
                                                    }
                                                    const nextBranch = selectedSourceBranch || defaultSourceBranch(branchOptions)
                                                    if (nextBranch) onIsolationStrategyChange?.({ type: "worktree", sourceBranch: nextBranch })
                                                }}
                                            />
                                            <ShortcutBadge label="⌥W" visible={shortcutHintsVisible} variant="corner" />
                                        </span>
                                        <span>Worktree</span>
                                    </label>
                                    {visibleIsolationType === "worktree" && (
                                        <select
                                            aria-label="Source branch"
                                            value={selectedSourceBranch}
                                            onChange={(event) => onIsolationStrategyChange?.({ type: "worktree", sourceBranch: event.target.value })}
                                            disabled={isSubmitting}
                                            className="input h-9 min-w-0 max-w-full border border-border bg-base-200 px-2 text-sm"
                                        >
                                            {branches.map((branch) => (
                                                <option key={branch.name} value={branch.name}>
                                                    {branch.name}
                                                    {branch.name === branchOptions.defaultBranch ? " (default)" : ""}
                                                    {preferredBranchExists && branch.name === preferredSourceBranch && branch.name !== branchOptions.defaultBranch
                                                        ? " (last)"
                                                        : ""}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )}
                            {branchOptions && branches.length === 0 && <div className="px-3 py-2 text-sm text-muted">No local branches.</div>}
                        </section>
                    )}
                    <TaskComposer
                        input={prompt}
                        commandType={mode}
                        commands={canStartTurn ? TASK_NEW_TASK_COMMANDS : []}
                        isLoading={isLoading}
                        isSubmitting={isSubmitting}
                        isOnline={isOnline}
                        isRunning={false}
                        agentControls={composerAgentControls}
                        commandShortcutLabels={canStartTurn ? NEW_TASK_COMMAND_SHORTCUT_LABELS : undefined}
                        shortcutHintsVisible={shortcutHintsVisible}
                        imageAttachments={canAttachTaskImages ? imageAttachments : undefined}
                        imageAttachLoading={canAttachTaskImages ? imageAttachLoading : false}
                        editor={editor}
                        onFocusInputShortcut={onFocusInputShortcut}
                        hyperplanControl={
                            canStartTurn ? (
                                <TaskHyperPlanPicker
                                    value={hyperplanPresetId}
                                    primaryAgent={hyperplanPrimaryAgent}
                                    disabled={isSubmitting || !canChangeHyperplanPreset}
                                    onChange={onHyperplanPresetChange}
                                />
                            ) : undefined
                        }
                        placeholder="What should OpenADE do?"
                        sendLabel={canStartTurn ? "Create & Run" : "Create Task"}
                        onInputChange={onPromptChange}
                        onCommandTypeChange={onModeChange}
                        onAttachImage={canAttachTaskImages ? onAttachImage : undefined}
                        onRemoveImage={onRemoveImage}
                        onSend={
                            canSubmitWithCreationContext
                                ? () => {
                                      if (canStartTurn) {
                                          onCreateAndRun?.()
                                      } else {
                                          onCreateTask?.()
                                      }
                                  }
                                : undefined
                        }
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                        <span className="min-w-0">
                            <span className="block font-medium text-base-content">Create More</span>
                            <span className="block text-xs text-muted">Stay here after creating this task.</span>
                        </span>
                        <span className="relative inline-flex">
                            <Switch
                                checked={createMore}
                                onCheckedChange={onCreateMoreChange}
                                disabled={isSubmitting || !canChangeCreateMore}
                                aria-label="Create more tasks"
                            />
                            <ShortcutBadge label="⌥M" visible={shortcutHintsVisible} variant="corner" />
                        </span>
                    </div>
                </section>
            </div>
        </div>
    )
}
