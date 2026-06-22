import { Loader2, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import type {
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogResult,
    OpenADETaskGitLogEntry,
    OpenADETaskGitScope,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryResult,
} from "../../../../openade-module/src"

function taskChangeStatusLabel(status: OpenADETaskGitChangedFile["status"]): string {
    if (status === "added") return "A"
    if (status === "deleted") return "D"
    if (status === "renamed") return "R"
    return "M"
}

function taskGitChangeCount(summary: OpenADETaskGitSummaryResult): number {
    return summary.staged.files.length + summary.unstaged.files.length + summary.untracked.length
}

function taskChangedFileLabel(count: number): string {
    return `${count} changed file${count === 1 ? "" : "s"}`
}

function taskScopeLabel(scope: OpenADETaskGitScope): string {
    return scope.type === "branch" ? scope.name : scope.label
}

function taskGitCommitFileActionKey(commit: string, file: Pick<OpenADETaskGitChangedFile, "oldPath" | "path">): string {
    return `${commit}\0${file.oldPath ?? ""}\0${file.path}`
}

export type TaskGitCapabilities = {
    canReadChanges: boolean
    canReadLog: boolean
    canReadSummary: boolean
    canReadScopes: boolean
    canReadDiff: boolean
    canReadFilePair: boolean
    canReadCommitFiles: boolean
    canReadCommitFilePatch: boolean
    canReadFileAtTreeish: boolean
}

export function TaskGitPanel({
    changes,
    gitLog,
    gitSummary,
    gitScopes,
    loading,
    diff,
    actionPath,
    filePair,
    filePairActionPath,
    commitFiles,
    commitFilesActionSha,
    commitPatch,
    commitPatchActionKey,
    treeishFile,
    treeishFileActionKey,
    capabilities,
    onRefresh,
    onReadDiff,
    onReadFilePair,
    onReadCommitFiles,
    onReadCommitFilePatch,
    onReadCommitFileAtTreeish,
    onCommit,
}: {
    changes: OpenADETaskChangesReadResult | null
    gitLog: OpenADETaskGitLogResult | null
    gitSummary: OpenADETaskGitSummaryResult | null
    gitScopes: OpenADETaskGitScopesReadResult | null
    loading: boolean
    diff: OpenADETaskDiffReadResult | null
    actionPath: string | null
    filePair: OpenADETaskFilePairReadResult | null
    filePairActionPath: string | null
    commitFiles: OpenADETaskGitCommitFilesResult | null
    commitFilesActionSha: string | null
    commitPatch: OpenADETaskGitCommitFilePatchResult | null
    commitPatchActionKey: string | null
    treeishFile: OpenADETaskGitFileAtTreeishResult | null
    treeishFileActionKey: string | null
    capabilities: TaskGitCapabilities
    onRefresh?: () => void
    onReadDiff?: (file: OpenADETaskGitChangedFile) => void
    onReadFilePair?: (file: OpenADETaskGitChangedFile) => void
    onReadCommitFiles?: (commit: OpenADETaskGitLogEntry) => void
    onReadCommitFilePatch?: (file: OpenADETaskGitChangedFile) => void
    onReadCommitFileAtTreeish?: (file: OpenADETaskGitChangedFile) => void
    onCommit?: (message: string) => void
}) {
    const [commitMessage, setCommitMessage] = useState("")

    const canReadAnyTaskGit = capabilities.canReadChanges || capabilities.canReadLog || capabilities.canReadSummary || capabilities.canReadScopes
    const canRefreshGit = Boolean(onRefresh)
    const canReadDiff = Boolean(onReadDiff)
    const canReadFilePair = Boolean(onReadFilePair)
    const canReadCommitFiles = Boolean(onReadCommitFiles)
    const canReadCommitFilePatch = Boolean(onReadCommitFilePatch)
    const canReadFileAtTreeish = Boolean(onReadCommitFileAtTreeish)
    const canCommit = Boolean(onCommit)
    useEffect(() => {
        if (!canCommit) setCommitMessage("")
    }, [canCommit])

    if (!canReadAnyTaskGit) return null

    const visibleChanges = capabilities.canReadChanges ? changes : null
    const visibleGitLog = capabilities.canReadLog ? gitLog : null
    const visibleGitSummary = capabilities.canReadSummary ? gitSummary : null
    const visibleGitScopes = capabilities.canReadScopes ? gitScopes : null
    const visibleDiff = capabilities.canReadDiff ? diff : null
    const visibleFilePair = capabilities.canReadFilePair ? filePair : null
    const visibleCommitFiles = capabilities.canReadCommitFiles ? commitFiles : null
    const visibleCommitPatch = capabilities.canReadCommitFilePatch ? commitPatch : null
    const visibleTreeishFile = capabilities.canReadFileAtTreeish ? treeishFile : null
    const files = visibleChanges?.files ?? []
    const commits = visibleGitLog?.commits ?? []
    const commitFileList = visibleCommitFiles?.files ?? []
    const visibleScopes = (visibleGitScopes?.scopes ?? []).slice(0, 8)
    const isUnloaded =
        visibleChanges === null &&
        visibleGitLog === null &&
        visibleGitSummary === null &&
        visibleGitScopes === null &&
        !visibleDiff &&
        !visibleFilePair &&
        !visibleCommitFiles &&
        !visibleCommitPatch &&
        !visibleTreeishFile

    return (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Changes</div>
                {canRefreshGit && (
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {isUnloaded ? (capabilities.canReadChanges ? "Load Changes" : "Load Git") : "Refresh"}
                    </button>
                )}
            </div>
            {visibleGitSummary && (
                <div className="grid grid-cols-2 gap-2">
                    <div className="border border-border bg-base-100/60 p-2">
                        <div className="text-[11px] uppercase text-muted">Branch</div>
                        <div className="mt-1 truncate text-sm font-medium">{visibleGitSummary.branch ?? visibleGitScopes?.defaultBranch ?? "Detached"}</div>
                    </div>
                    <div className="border border-border bg-base-100/60 p-2">
                        <div className="text-[11px] uppercase text-muted">Head</div>
                        <div className="mt-1 truncate font-mono text-sm font-medium">{visibleGitSummary.headCommit.slice(0, 8)}</div>
                    </div>
                    <div className="border border-border bg-base-100/60 p-2">
                        <div className="text-[11px] uppercase text-muted">Status</div>
                        <div className="mt-1 text-sm font-medium">
                            {visibleGitSummary.hasChanges ? taskChangedFileLabel(taskGitChangeCount(visibleGitSummary)) : "Clean"}
                        </div>
                    </div>
                    <div className="border border-border bg-base-100/60 p-2">
                        <div className="text-[11px] uppercase text-muted">Ahead</div>
                        <div className="mt-1 text-sm font-medium">{visibleGitSummary.ahead ?? "Unknown"}</div>
                    </div>
                </div>
            )}
            {visibleScopes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {visibleScopes.map((scope) => (
                        <span
                            key={scope.id}
                            className={`border px-2 py-1 text-[11px] ${
                                scope.type === "branch" && scope.isDefault
                                    ? "border-primary/20 bg-primary/10 text-primary"
                                    : "border-border bg-base-100/60 text-muted"
                            }`}
                        >
                            {taskScopeLabel(scope)}
                        </span>
                    ))}
                </div>
            )}
            {canCommit && visibleGitSummary?.hasChanges && (
                <div className="flex min-w-0 gap-2">
                    <input
                        value={commitMessage}
                        aria-label="Commit message"
                        placeholder="Commit message"
                        onChange={(event) => setCommitMessage(event.target.value)}
                        className="input h-9 min-w-0 flex-1 border border-border bg-base-100 px-2 text-xs"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            const message = commitMessage.trim()
                            if (!message) return
                            onCommit?.(message)
                        }}
                        disabled={!commitMessage.trim()}
                        className="btn h-9 shrink-0 bg-base-300 px-3 text-xs disabled:opacity-50"
                    >
                        Commit
                    </button>
                </div>
            )}
            {!loading && isUnloaded && <div className="border border-border bg-base-100/50 p-2 text-xs text-muted">Not loaded.</div>}
            {capabilities.canReadChanges && (
                <div className="flex flex-col overflow-hidden border border-border bg-base-100/50">
                    {loading && files.length === 0 && <div className="p-2 text-xs text-muted">Loading changes...</div>}
                    {!loading && !isUnloaded && visibleChanges !== null && files.length === 0 && <div className="p-2 text-xs text-muted">No changes.</div>}
                    {files.map((file) => {
                        const busy = actionPath === file.path
                        const filePairBusy = filePairActionPath === file.path
                        return (
                            <div
                                key={`${file.oldPath ?? ""}:${file.path}`}
                                className="flex min-w-0 items-center gap-1 border-b border-border px-2 py-2 last:border-b-0"
                            >
                                <button
                                    type="button"
                                    onClick={() => onReadDiff?.(file)}
                                    disabled={busy || file.binary || !canReadDiff}
                                    className="btn flex min-w-0 flex-1 items-center gap-2 bg-transparent p-0 text-left disabled:opacity-60"
                                >
                                    {busy ? (
                                        <Loader2 size={13} className="shrink-0 animate-spin text-primary" />
                                    ) : (
                                        <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-primary">
                                            {taskChangeStatusLabel(file.status)}
                                        </span>
                                    )}
                                    <span className="min-w-0 flex-1 truncate text-xs text-base-content">{file.path}</span>
                                    {file.binary && <span className="shrink-0 text-[10px] uppercase text-muted">Binary</span>}
                                </button>
                                {canReadFilePair && (
                                    <button
                                        type="button"
                                        onClick={() => onReadFilePair?.(file)}
                                        disabled={filePairBusy || file.binary}
                                        className="btn flex h-7 shrink-0 items-center gap-1 bg-base-300 px-2 text-[11px] disabled:opacity-60"
                                    >
                                        {filePairBusy && <Loader2 size={11} className="animate-spin text-primary" />}
                                        Files
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
            {visibleDiff && (
                <div className="overflow-hidden border border-border bg-base-100/50">
                    <div className="border-b border-border px-2 py-1.5 text-xs font-medium text-muted">{visibleDiff.filePath}</div>
                    {visibleDiff.patch ? (
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed text-base-content [overflow-wrap:anywhere]">
                            {visibleDiff.patch}
                        </pre>
                    ) : (
                        <div className="p-2 text-xs text-muted">No diff content.</div>
                    )}
                    {visibleDiff.truncated && <div className="border-t border-border px-2 py-1.5 text-xs text-warning">Diff truncated.</div>}
                </div>
            )}
            {visibleFilePair && (
                <div className="overflow-hidden border border-border bg-base-100/50">
                    <div className="border-b border-border px-2 py-1.5 text-xs font-medium text-muted">{visibleFilePair.filePath}</div>
                    {visibleFilePair.tooLarge ? (
                        <div className="p-2 text-xs text-warning">File pair is too large to preview.</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2">
                            <div className="min-w-0 border-b border-border md:border-r md:border-b-0">
                                <div className="border-b border-border px-2 py-1.5 text-[11px] uppercase text-muted">Before</div>
                                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed text-base-content [overflow-wrap:anywhere]">
                                    {visibleFilePair.before}
                                </pre>
                            </div>
                            <div className="min-w-0">
                                <div className="border-b border-border px-2 py-1.5 text-[11px] uppercase text-muted">After</div>
                                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed text-base-content [overflow-wrap:anywhere]">
                                    {visibleFilePair.after}
                                </pre>
                            </div>
                        </div>
                    )}
                </div>
            )}
            {commits.length > 0 && (
                <div className="flex flex-col gap-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted">Recent commits</div>
                    <div className="flex flex-col overflow-hidden border border-border bg-base-100/50">
                        {commits.map((commit) => (
                            <div key={commit.sha} className="flex min-w-0 items-start gap-2 border-b border-border px-2 py-2 last:border-b-0">
                                <span className="shrink-0 font-mono text-[11px] text-muted">{commit.shortSha}</span>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs text-base-content">{commit.message}</div>
                                    <div className="truncate text-[11px] text-muted">
                                        {commit.author} - {commit.relativeDate || commit.date}
                                    </div>
                                </div>
                                {canReadCommitFiles && (
                                    <button
                                        type="button"
                                        aria-label={`Load files for commit ${commit.shortSha}`}
                                        onClick={() => onReadCommitFiles?.(commit)}
                                        disabled={commitFilesActionSha === commit.sha}
                                        className="btn flex h-7 shrink-0 items-center gap-1 bg-base-300 px-2 text-[11px] disabled:opacity-60"
                                    >
                                        {commitFilesActionSha === commit.sha && <Loader2 size={11} className="animate-spin text-primary" />}
                                        Files
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {visibleCommitFiles && (
                <div className="flex flex-col overflow-hidden border border-border bg-base-100/50">
                    <div className="border-b border-border px-2 py-1.5 text-xs font-medium text-muted">Commit {visibleCommitFiles.commit.slice(0, 8)}</div>
                    {commitFileList.length === 0 && <div className="p-2 text-xs text-muted">No files in commit.</div>}
                    {commitFileList.map((file) => {
                        const key = taskGitCommitFileActionKey(visibleCommitFiles.commit, file)
                        const patchBusy = commitPatchActionKey === key
                        const fileBusy = treeishFileActionKey === key
                        return (
                            <div key={key} className="flex min-w-0 items-center gap-1 border-b border-border px-2 py-2 last:border-b-0">
                                <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-primary">{taskChangeStatusLabel(file.status)}</span>
                                <span className="min-w-0 flex-1 truncate text-xs text-base-content">{file.path}</span>
                                {file.binary && <span className="shrink-0 text-[10px] uppercase text-muted">Binary</span>}
                                {canReadCommitFilePatch && (
                                    <button
                                        type="button"
                                        aria-label={`Read patch for ${file.path} at commit ${visibleCommitFiles.commit.slice(0, 8)}`}
                                        onClick={() => onReadCommitFilePatch?.(file)}
                                        disabled={patchBusy || file.binary}
                                        className="btn flex h-7 shrink-0 items-center gap-1 bg-base-300 px-2 text-[11px] disabled:opacity-60"
                                    >
                                        {patchBusy && <Loader2 size={11} className="animate-spin text-primary" />}
                                        Patch
                                    </button>
                                )}
                                {canReadFileAtTreeish && (
                                    <button
                                        type="button"
                                        aria-label={`View ${file.path} at commit ${visibleCommitFiles.commit.slice(0, 8)}`}
                                        onClick={() => onReadCommitFileAtTreeish?.(file)}
                                        disabled={fileBusy || file.binary}
                                        className="btn flex h-7 shrink-0 items-center gap-1 bg-base-300 px-2 text-[11px] disabled:opacity-60"
                                    >
                                        {fileBusy && <Loader2 size={11} className="animate-spin text-primary" />}
                                        View
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
            {visibleCommitPatch && (
                <div className="overflow-hidden border border-border bg-base-100/50">
                    <div className="border-b border-border px-2 py-1.5 text-xs font-medium text-muted">
                        {visibleCommitPatch.filePath} @ {visibleCommitPatch.commit.slice(0, 8)}
                    </div>
                    {visibleCommitPatch.patch ? (
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed text-base-content [overflow-wrap:anywhere]">
                            {visibleCommitPatch.patch}
                        </pre>
                    ) : (
                        <div className="p-2 text-xs text-muted">No patch content.</div>
                    )}
                    {visibleCommitPatch.truncated && <div className="border-t border-border px-2 py-1.5 text-xs text-warning">Patch truncated.</div>}
                </div>
            )}
            {visibleTreeishFile && (
                <div className="overflow-hidden border border-border bg-base-100/50">
                    <div className="border-b border-border px-2 py-1.5 text-xs font-medium text-muted">
                        {visibleTreeishFile.filePath} @ {visibleTreeishFile.treeish.slice(0, 8)}
                    </div>
                    {!visibleTreeishFile.exists ? (
                        <div className="p-2 text-xs text-muted">File does not exist at this commit.</div>
                    ) : visibleTreeishFile.tooLarge ? (
                        <div className="p-2 text-xs text-warning">File is too large to preview.</div>
                    ) : (
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed text-base-content [overflow-wrap:anywhere]">
                            {visibleTreeishFile.content}
                        </pre>
                    )}
                </div>
            )}
        </div>
    )
}
