import { FileText, FolderOpen, Loader2, Play, RefreshCw, Search, Server, Square, Terminal } from "lucide-react"
import type {
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectProcessDefinition,
    OpenADEProjectProcessInstance,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectSearchResult,
} from "../../../../openade-module/src"

export function ProjectFilesPanel({
    files,
    loading,
    fileRead,
    actionPath,
    onRefresh,
    onReadFile,
}: {
    files: OpenADEProjectFilesTreeResult | null
    loading: boolean
    fileRead: OpenADEProjectFileReadResult | null
    actionPath: string | null
    onRefresh: () => void
    onReadFile: (path: string) => void
}) {
    const entries = files?.entries ?? []
    if (!loading && entries.length === 0 && !fileRead) return null

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <FolderOpen size={13} />
                    Files
                </div>
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
            <div className="grid min-h-0 grid-cols-1 border-b border-border md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                <div className="max-h-56 overflow-y-auto border-b border-border md:border-r md:border-b-0">
                    {loading && entries.length === 0 && <div className="p-3 text-sm text-muted">Loading files...</div>}
                    {entries.map((entry) => {
                        const isFile = entry.type === "file"
                        const busy = actionPath === entry.path
                        return (
                            <button
                                key={entry.path}
                                type="button"
                                onClick={() => isFile && onReadFile(entry.path)}
                                disabled={!isFile || busy}
                                className="btn flex w-full min-w-0 items-center gap-2 border-b border-border bg-transparent px-3 py-2 text-left last:border-b-0 disabled:opacity-60"
                            >
                                {busy ? (
                                    <Loader2 size={14} className="shrink-0 animate-spin text-primary" />
                                ) : isFile ? (
                                    <FileText size={14} className="shrink-0 text-info" />
                                ) : (
                                    <FolderOpen size={14} className="shrink-0 text-muted" />
                                )}
                                <span className="min-w-0 flex-1 truncate text-xs text-base-content">{entry.path}</span>
                            </button>
                        )
                    })}
                </div>
                <div className="min-h-28 overflow-hidden bg-base-100/50">
                    {fileRead ? (
                        <div className="flex h-full min-h-28 flex-col">
                            <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted">{fileRead.path}</div>
                            {fileRead.tooLarge ? (
                                <div className="p-3 text-sm text-warning">File is too large to preview.</div>
                            ) : (
                                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-base-content [overflow-wrap:anywhere]">
                                    {fileRead.content ?? ""}
                                </pre>
                            )}
                        </div>
                    ) : (
                        <div className="flex min-h-28 items-center justify-center p-3 text-sm text-muted">Select a file.</div>
                    )}
                </div>
            </div>
            {files?.truncated && <div className="border-t border-border px-3 py-2 text-xs text-warning">File list truncated.</div>}
        </section>
    )
}

export function ProjectSearchPanel({
    query,
    result,
    loading,
    onQueryChange,
    onSearch,
    onOpenFile,
}: {
    query: string
    result: OpenADEProjectSearchResult | null
    loading: boolean
    onQueryChange: (value: string) => void
    onSearch: () => void
    onOpenFile: (path: string) => void
}) {
    const matches = result?.matches ?? []

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Search size={13} className="shrink-0 text-muted" />
                <input
                    value={query}
                    aria-label="Search files"
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") onSearch()
                    }}
                    placeholder="Search files"
                    className="input h-8 min-w-0 flex-1 border border-border bg-base-100 px-2 text-sm"
                />
                <button
                    type="button"
                    onClick={onSearch}
                    disabled={loading || !query.trim()}
                    className="btn flex h-8 shrink-0 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                >
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                    Search
                </button>
            </div>
            {result && (
                <div className="flex max-h-64 flex-col overflow-y-auto">
                    {matches.length === 0 && <div className="p-3 text-sm text-muted">No matches.</div>}
                    {matches.map((match) => (
                        <button
                            key={`${match.path}:${match.line}:${match.matchStart}`}
                            type="button"
                            onClick={() => onOpenFile(match.path)}
                            className="btn flex min-w-0 flex-col border-b border-border px-3 py-2 text-left last:border-b-0"
                        >
                            <span className="max-w-full truncate text-xs font-medium text-base-content">
                                {match.path}:{match.line}
                            </span>
                            <span className="mt-1 line-clamp-2 text-xs text-muted">{match.content}</span>
                        </button>
                    ))}
                    {result.truncated && <div className="border-t border-border px-3 py-2 text-xs text-warning">Search truncated.</div>}
                </div>
            )}
        </section>
    )
}

export function ProjectProcessesPanel({
    processes,
    loading,
    actionId,
    output,
    onRefresh,
    onStart,
    onReconnect,
    onStop,
}: {
    processes: OpenADEProjectProcessListResult | null
    loading: boolean
    actionId: string | null
    output: OpenADEProjectProcessReconnectResult | null
    onRefresh: () => void
    onStart: (definitionId: string) => void
    onReconnect: (processId: string) => void
    onStop: (processId: string) => void
}) {
    const definitions = processes?.processes ?? []
    const instances = processes?.instances ?? []
    const errors = processes?.errors ?? []
    if (!loading && definitions.length === 0 && errors.length === 0 && !output) return null

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <Server size={13} />
                    Processes
                </div>
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
            <div className="flex w-full max-w-full flex-col overflow-hidden">
                {errors.map((error) => (
                    <div key={`${error.relativePath}:${error.line ?? "file"}`} className="border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning">
                        <span className="font-medium">{error.relativePath}</span>
                        <span> {error.error}</span>
                    </div>
                ))}
                {loading && definitions.length === 0 && <div className="p-3 text-sm text-muted">Loading processes...</div>}
                {definitions.map((definition) => {
                    const instance = instances.find((candidate) => candidate.definitionId === definition.id && !candidate.completed)
                    return (
                        <ProjectProcessRow
                            key={definition.id}
                            definition={definition}
                            instance={instance}
                            busy={actionId === definition.id || actionId === instance?.processId}
                            onStart={onStart}
                            onReconnect={onReconnect}
                            onStop={onStop}
                        />
                    )
                })}
                {output && <ProjectProcessOutput result={output} />}
            </div>
        </section>
    )
}

function projectProcessOutputStatus(result: OpenADEProjectProcessReconnectResult): string {
    if (!result.found) return "Unavailable"
    if (result.completed) {
        if (result.error) return "Error"
        if (result.exitCode !== undefined && result.exitCode !== null) return `Exited ${result.exitCode}`
        if (result.signal) return `Signaled ${result.signal}`
        return "Completed"
    }
    return "Running"
}

function ProjectProcessOutput({ result }: { result: OpenADEProjectProcessReconnectResult }) {
    const chunks = result.output ?? []
    return (
        <div className="border-t border-border bg-base-100/50">
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted">
                    <Terminal size={13} className="shrink-0" />
                    <span className="shrink-0 uppercase tracking-wide">Output</span>
                    <span className="min-w-0 truncate text-base-content">{result.processId}</span>
                </div>
                <span className="shrink-0 text-[11px] text-muted">{projectProcessOutputStatus(result)}</span>
            </div>
            {!result.found ? (
                <div className="p-3 text-sm text-muted">Process is no longer available.</div>
            ) : chunks.length === 0 ? (
                <div className="p-3 text-sm text-muted">No output yet.</div>
            ) : (
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-relaxed [overflow-wrap:anywhere]">
                    {chunks.map((chunk, index) => (
                        <span key={`${chunk.timestamp}:${index}`} className={chunk.type === "stderr" ? "text-error" : "text-base-content"}>
                            {chunk.data}
                        </span>
                    ))}
                </pre>
            )}
            {result.error && <div className="border-t border-border px-3 py-2 text-xs text-error">{result.error}</div>}
        </div>
    )
}

function ProjectProcessRow({
    definition,
    instance,
    busy,
    onStart,
    onReconnect,
    onStop,
}: {
    definition: OpenADEProjectProcessDefinition
    instance?: OpenADEProjectProcessInstance
    busy: boolean
    onStart: (definitionId: string) => void
    onReconnect: (processId: string) => void
    onStop: (processId: string) => void
}) {
    const running = Boolean(instance)
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border px-3 py-3 last:border-b-0">
            <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center border ${running ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-base-100/60 text-muted"}`}
            >
                {busy ? <Loader2 size={15} className="animate-spin" /> : running ? <Server size={15} /> : <Play size={15} />}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-base-content">{definition.name}</span>
                    <span className={`shrink-0 text-[11px] ${running ? "text-primary" : "text-muted"}`}>{running ? "Running" : "Stopped"}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">{definition.command}</div>
            </div>
            {running && instance ? (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => onReconnect(instance.processId)}
                        disabled={busy}
                        className="btn flex h-9 items-center gap-1 bg-base-300 px-3 text-xs disabled:opacity-50"
                    >
                        <Terminal size={13} />
                        Output
                    </button>
                    <button
                        type="button"
                        onClick={() => onStop(instance.processId)}
                        disabled={busy}
                        className="btn flex h-9 items-center gap-1 bg-error/10 px-3 text-xs text-error disabled:opacity-50"
                    >
                        <Square size={13} />
                        Stop
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => onStart(definition.id)}
                    disabled={busy}
                    className="btn ml-auto flex h-9 shrink-0 items-center gap-1 bg-base-300 px-3 text-xs disabled:opacity-50"
                >
                    <Play size={13} />
                    Start
                </button>
            )}
        </div>
    )
}
