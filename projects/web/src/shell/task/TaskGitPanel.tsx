import { Loader2, RefreshCw } from "lucide-react"
import type {
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitLogResult,
} from "../../../../openade-module/src"

function taskChangeStatusLabel(status: OpenADETaskGitChangedFile["status"]): string {
    if (status === "added") return "A"
    if (status === "deleted") return "D"
    if (status === "renamed") return "R"
    return "M"
}

export function TaskGitPanel({
    changes,
    gitLog,
    loading,
    diff,
    actionPath,
    onRefresh,
    onReadDiff,
}: {
    changes: OpenADETaskChangesReadResult | null
    gitLog: OpenADETaskGitLogResult | null
    loading: boolean
    diff: OpenADETaskDiffReadResult | null
    actionPath: string | null
    onRefresh: () => void
    onReadDiff: (file: OpenADETaskGitChangedFile) => void
}) {
    const files = changes?.files ?? []
    const commits = gitLog?.commits ?? []

    return (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Changes</div>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={loading}
                    className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                >
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    Refresh
                </button>
            </div>
            <div className="flex flex-col overflow-hidden border border-border bg-base-100/50">
                {loading && files.length === 0 && <div className="p-2 text-xs text-muted">Loading changes...</div>}
                {!loading && files.length === 0 && <div className="p-2 text-xs text-muted">No changes.</div>}
                {files.map((file) => {
                    const busy = actionPath === file.path
                    return (
                        <button
                            key={`${file.oldPath ?? ""}:${file.path}`}
                            type="button"
                            onClick={() => onReadDiff(file)}
                            disabled={busy || file.binary}
                            className="btn flex min-w-0 items-center gap-2 border-b border-border px-2 py-2 text-left last:border-b-0 disabled:opacity-60"
                        >
                            {busy ? (
                                <Loader2 size={13} className="shrink-0 animate-spin text-primary" />
                            ) : (
                                <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-primary">{taskChangeStatusLabel(file.status)}</span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-xs text-base-content">{file.path}</span>
                            {file.binary && <span className="shrink-0 text-[10px] uppercase text-muted">Binary</span>}
                        </button>
                    )
                })}
            </div>
            {diff && (
                <div className="overflow-hidden border border-border bg-base-100/50">
                    <div className="border-b border-border px-2 py-1.5 text-xs font-medium text-muted">{diff.filePath}</div>
                    {diff.patch ? (
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed text-base-content [overflow-wrap:anywhere]">
                            {diff.patch}
                        </pre>
                    ) : (
                        <div className="p-2 text-xs text-muted">No diff content.</div>
                    )}
                    {diff.truncated && <div className="border-t border-border px-2 py-1.5 text-xs text-warning">Diff truncated.</div>}
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
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
