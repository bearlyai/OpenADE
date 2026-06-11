import { CalendarClock, FileText, FolderOpen, GitBranch, Loader2, Play, RefreshCw, Search, Server, Square, Terminal } from "lucide-react"
import { useState } from "react"
import type {
    OpenADECronDefinitionsReadResult,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadResult,
    OpenADEProjectProcessDefinition,
    OpenADEProjectProcessInstance,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectSearchResult,
} from "../../../../openade-module/src"

function cronDefinitionsCount(result: OpenADECronDefinitionsReadResult): number {
    return result.configs.reduce((total, config) => total + config.crons.length, 0)
}

export type ProjectCronCapabilities = {
    canRead: boolean
}

export function ProjectCronPanel({
    definitions,
    loading,
    capabilities,
    onRefresh,
}: {
    definitions: OpenADECronDefinitionsReadResult | null
    loading: boolean
    capabilities: ProjectCronCapabilities
    onRefresh: () => void
}) {
    if (!capabilities.canRead) return null

    const isUnloaded = definitions === null
    const configs = definitions?.configs ?? []
    const errors = definitions?.errors ?? []

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <CalendarClock size={13} />
                    Crons
                </div>
                <button
                    type="button"
                    title={isUnloaded ? "Load project crons" : "Refresh project crons"}
                    aria-label={isUnloaded ? "Load project crons" : "Refresh project crons"}
                    onClick={onRefresh}
                    disabled={loading}
                    className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                >
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {isUnloaded ? "Load Crons" : "Refresh"}
                </button>
            </div>
            <div className="flex flex-col overflow-hidden bg-base-100/50">
                {loading && isUnloaded && <div className="p-3 text-sm text-muted">Loading crons...</div>}
                {!loading && isUnloaded && <div className="p-3 text-sm text-muted">Not loaded.</div>}
                {definitions && configs.length === 0 && errors.length === 0 && <div className="p-3 text-sm text-muted">No crons.</div>}
                {definitions && configs.length > 0 && (
                    <div className="border-b border-border px-3 py-2 text-xs text-muted">
                        {cronDefinitionsCount(definitions)} cron{cronDefinitionsCount(definitions) === 1 ? "" : "s"}
                    </div>
                )}
                {errors.map((error) => (
                    <div key={`${error.relativePath}:${error.line ?? "file"}`} className="border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning">
                        <span className="font-medium">{error.relativePath}</span>
                        <span> {error.error}</span>
                    </div>
                ))}
                {configs.map((config) => (
                    <div key={config.relativePath} className="border-b border-border last:border-b-0">
                        <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium text-muted">{config.relativePath}</div>
                        {config.crons.map((cron) => (
                            <div key={cron.id} className="flex min-w-0 items-start gap-2 border-b border-border px-3 py-2 last:border-b-0">
                                <CalendarClock size={13} className="mt-0.5 shrink-0 text-info" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-medium text-base-content">{cron.name}</div>
                                    <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted">
                                        <span className="font-mono">{cron.schedule}</span>
                                        <span>{cron.type}</span>
                                        {cron.harness && <span>{cron.harness}</span>}
                                        {cron.isolation && <span>{cron.isolation}</span>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </section>
    )
}

function projectChangeCount(summary: OpenADEProjectGitSummaryReadResult): number {
    return summary.staged.files.length + summary.unstaged.files.length + summary.untracked.length
}

function changedFileLabel(count: number): string {
    return `${count} changed file${count === 1 ? "" : "s"}`
}

export type ProjectGitCapabilities = {
    canRead: boolean
}

export function ProjectGitPanel({
    info,
    branches,
    summary,
    loading,
    capabilities,
    onRefresh,
}: {
    info: OpenADEProjectGitInfoResult | null
    branches: OpenADEProjectGitBranchesReadResult | null
    summary: OpenADEProjectGitSummaryReadResult | null
    loading: boolean
    capabilities: ProjectGitCapabilities
    onRefresh: () => void
}) {
    if (!capabilities.canRead) return null

    const isUnloaded = info === null && branches === null && summary === null
    const visibleBranches = (branches?.branches ?? []).filter((branch) => !branch.isRemote).slice(0, 6)

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <GitBranch size={13} />
                    Git
                </div>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={loading}
                    className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                >
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {isUnloaded ? "Load Git" : "Refresh"}
                </button>
            </div>
            <div className="flex flex-col overflow-hidden bg-base-100/50">
                {loading && isUnloaded && <div className="p-3 text-sm text-muted">Loading git...</div>}
                {!loading && isUnloaded && <div className="p-3 text-sm text-muted">Not loaded.</div>}
                {info?.isGitRepo === false && <div className="p-3 text-sm text-warning">{info.error ?? "Not a git repository."}</div>}
                {info?.isGitRepo === true && (
                    <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
                        <div className="border border-border bg-base-200/40 p-2">
                            <div className="text-[11px] uppercase text-muted">Branch</div>
                            <div className="mt-1 truncate text-sm font-medium">{summary?.branch ?? info.mainBranch}</div>
                        </div>
                        <div className="border border-border bg-base-200/40 p-2">
                            <div className="text-[11px] uppercase text-muted">Head</div>
                            <div className="mt-1 truncate font-mono text-sm font-medium">{summary?.headCommit.slice(0, 8) ?? "Unknown"}</div>
                        </div>
                        <div className="border border-border bg-base-200/40 p-2">
                            <div className="text-[11px] uppercase text-muted">Status</div>
                            <div className="mt-1 text-sm font-medium">
                                {summary ? (summary.hasChanges ? changedFileLabel(projectChangeCount(summary)) : "Clean") : "Unknown"}
                            </div>
                        </div>
                        <div className="border border-border bg-base-200/40 p-2">
                            <div className="text-[11px] uppercase text-muted">Default</div>
                            <div className="mt-1 truncate text-sm font-medium">{branches?.defaultBranch ?? info.mainBranch}</div>
                        </div>
                    </div>
                )}
                {visibleBranches.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
                        {visibleBranches.map((branch) => (
                            <span
                                key={`${branch.name}:${branch.isRemote ? "remote" : "local"}`}
                                className={`border px-2 py-1 text-[11px] ${
                                    branch.isDefault ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-base-200/40 text-muted"
                                }`}
                            >
                                {branch.name}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </section>
    )
}

export type ProjectFileCapabilities = {
    canList: boolean
    canRead: boolean
    canSearch: boolean
    canWrite: boolean
}

export function ProjectFilesPanel({
    files,
    loading,
    fileRead,
    actionPath,
    fileSearchQuery,
    fileSearchResult,
    fileSearchLoading,
    capabilities,
    onRefresh,
    onReadFile,
    onFileSearchQueryChange,
    onSearchFiles,
    onWriteFile,
}: {
    files: OpenADEProjectFilesTreeResult | null
    loading: boolean
    fileRead: OpenADEProjectFileReadResult | null
    actionPath: string | null
    fileSearchQuery: string
    fileSearchResult: OpenADEProjectFilesFuzzySearchResult | null
    fileSearchLoading: boolean
    capabilities: ProjectFileCapabilities
    onRefresh: () => void
    onReadFile: (path: string) => void
    onFileSearchQueryChange: (value: string) => void
    onSearchFiles: () => void
    onWriteFile: (path: string, content: string) => void
}) {
    const [fileDraft, setFileDraft] = useState<{ path: string; sourceContent: string; content: string } | null>(null)

    const fileContent = fileRead?.content ?? ""
    const canEditFile = Boolean(fileRead && capabilities.canWrite && !fileRead.tooLarge && fileRead.encoding === "utf8" && !fileRead.isBinary)
    const activeDraft = fileRead && fileDraft?.path === fileRead.path && fileDraft.sourceContent === fileContent ? fileDraft.content : fileContent
    const draftChanged = canEditFile && activeDraft !== fileContent

    if (!capabilities.canList && !capabilities.canSearch) return null

    const entries = files?.entries ?? []
    const isUnloaded = files === null
    const fileSearchResults = fileSearchResult?.results ?? []

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <FolderOpen size={13} />
                    Files
                </div>
                {capabilities.canList && (
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {isUnloaded ? "Load Files" : "Refresh"}
                    </button>
                )}
            </div>
            {capabilities.canSearch && (
                <div className="flex min-w-0 gap-2 border-b border-border px-3 py-2">
                    <input
                        value={fileSearchQuery}
                        aria-label="Find file"
                        onChange={(event) => onFileSearchQueryChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") onSearchFiles()
                        }}
                        placeholder="Find file"
                        className="input h-8 min-w-0 flex-1 border border-border bg-base-100 px-2 text-sm"
                    />
                    <button
                        type="button"
                        onClick={onSearchFiles}
                        disabled={fileSearchLoading || !fileSearchQuery.trim()}
                        className="btn flex h-8 shrink-0 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                    >
                        {fileSearchLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                        Find
                    </button>
                </div>
            )}
            <div className="grid min-h-0 grid-cols-1 border-b border-border md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                <div className="max-h-56 overflow-y-auto border-b border-border md:border-r md:border-b-0">
                    {fileSearchResult && (
                        <div className="border-b border-border">
                            {fileSearchResults.length === 0 && <div className="p-3 text-sm text-muted">No file matches.</div>}
                            {fileSearchResults.map((path) => {
                                const busy = actionPath === path
                                return (
                                    <button
                                        key={path}
                                        type="button"
                                        onClick={() => capabilities.canRead && onReadFile(path)}
                                        disabled={busy || !capabilities.canRead}
                                        className="btn flex w-full min-w-0 items-center gap-2 border-b border-border bg-base-100/50 px-3 py-2 text-left last:border-b-0 disabled:opacity-60"
                                    >
                                        {busy ? (
                                            <Loader2 size={14} className="shrink-0 animate-spin text-primary" />
                                        ) : (
                                            <FileText size={14} className="shrink-0 text-info" />
                                        )}
                                        <span className="min-w-0 flex-1 truncate text-xs text-base-content">{path}</span>
                                    </button>
                                )
                            })}
                            {fileSearchResult.truncated && <div className="border-t border-border px-3 py-2 text-xs text-warning">File search truncated.</div>}
                        </div>
                    )}
                    {loading && entries.length === 0 && <div className="p-3 text-sm text-muted">Loading files...</div>}
                    {!loading && capabilities.canList && isUnloaded && <div className="p-3 text-sm text-muted">Not loaded.</div>}
                    {!loading && capabilities.canList && !isUnloaded && entries.length === 0 && <div className="p-3 text-sm text-muted">No files.</div>}
                    {capabilities.canList &&
                        entries.map((entry) => {
                            const isFile = entry.type === "file"
                            const busy = actionPath === entry.path
                            return (
                                <button
                                    key={entry.path}
                                    type="button"
                                    onClick={() => isFile && capabilities.canRead && onReadFile(entry.path)}
                                    disabled={!isFile || busy || !capabilities.canRead}
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
                            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                                <div className="min-w-0 truncate text-xs font-medium text-muted">{fileRead.path}</div>
                                {canEditFile && (
                                    <button
                                        type="button"
                                        onClick={() => onWriteFile(fileRead.path, activeDraft)}
                                        disabled={!draftChanged}
                                        className="btn h-7 shrink-0 bg-base-300 px-2 text-[11px] disabled:opacity-50"
                                    >
                                        Save
                                    </button>
                                )}
                            </div>
                            {fileRead.tooLarge ? (
                                <div className="p-3 text-sm text-warning">File is too large to preview.</div>
                            ) : canEditFile ? (
                                <textarea
                                    value={activeDraft}
                                    aria-label="File contents"
                                    onChange={(event) => {
                                        setFileDraft({
                                            path: fileRead.path,
                                            sourceContent: fileContent,
                                            content: event.target.value,
                                        })
                                    }}
                                    className="min-h-56 w-full resize-y border-0 bg-transparent p-3 font-mono text-xs leading-relaxed text-base-content outline-none"
                                />
                            ) : (
                                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-base-content [overflow-wrap:anywhere]">
                                    {fileContent}
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

export type ProjectSearchCapabilities = {
    canSearch: boolean
    canOpenFile: boolean
}

export function ProjectSearchPanel({
    query,
    result,
    loading,
    capabilities,
    onQueryChange,
    onSearch,
    onOpenFile,
}: {
    query: string
    result: OpenADEProjectSearchResult | null
    loading: boolean
    capabilities: ProjectSearchCapabilities
    onQueryChange: (value: string) => void
    onSearch: () => void
    onOpenFile: (path: string) => void
}) {
    if (!capabilities.canSearch) return null

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
                            onClick={() => capabilities.canOpenFile && onOpenFile(match.path)}
                            disabled={!capabilities.canOpenFile}
                            className="btn flex min-w-0 flex-col border-b border-border px-3 py-2 text-left last:border-b-0 disabled:opacity-60"
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

export type ProjectProcessCapabilities = {
    canRead: boolean
    canStart: boolean
    canReconnect: boolean
    canStop: boolean
}

export function ProjectProcessesPanel({
    processes,
    loading,
    actionId,
    output,
    capabilities,
    onRefresh,
    onStart,
    onReconnect,
    onStop,
}: {
    processes: OpenADEProjectProcessListResult | null
    loading: boolean
    actionId: string | null
    output: OpenADEProjectProcessReconnectResult | null
    capabilities: ProjectProcessCapabilities
    onRefresh: () => void
    onStart: (definitionId: string) => void
    onReconnect: (processId: string) => void
    onStop: (processId: string) => void
}) {
    if (!capabilities.canRead) return null

    const definitions = processes?.processes ?? []
    const instances = processes?.instances ?? []
    const errors = processes?.errors ?? []
    const isUnloaded = processes === null && !output
    if (!loading && !isUnloaded && definitions.length === 0 && errors.length === 0 && !output) return null

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
                    {isUnloaded ? "Load Processes" : "Refresh"}
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
                {isUnloaded && <div className="p-3 text-sm text-muted">Not loaded.</div>}
                {definitions.map((definition) => {
                    const instance = instances.find((candidate) => candidate.definitionId === definition.id && !candidate.completed)
                    return (
                        <ProjectProcessRow
                            key={definition.id}
                            definition={definition}
                            instance={instance}
                            busy={actionId === definition.id || actionId === instance?.processId}
                            capabilities={capabilities}
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
    capabilities,
    onStart,
    onReconnect,
    onStop,
}: {
    definition: OpenADEProjectProcessDefinition
    instance?: OpenADEProjectProcessInstance
    busy: boolean
    capabilities: ProjectProcessCapabilities
    onStart: (definitionId: string) => void
    onReconnect: (processId: string) => void
    onStop: (processId: string) => void
}) {
    const running = Boolean(instance)
    const showRunningActions = running && instance && (capabilities.canReconnect || capabilities.canStop)
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
            {showRunningActions ? (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {capabilities.canReconnect && (
                        <button
                            type="button"
                            onClick={() => onReconnect(instance.processId)}
                            disabled={busy}
                            className="btn flex h-9 items-center gap-1 bg-base-300 px-3 text-xs disabled:opacity-50"
                        >
                            <Terminal size={13} />
                            Output
                        </button>
                    )}
                    {capabilities.canStop && (
                        <button
                            type="button"
                            onClick={() => onStop(instance.processId)}
                            disabled={busy}
                            className="btn flex h-9 items-center gap-1 bg-error/10 px-3 text-xs text-error disabled:opacity-50"
                        >
                            <Square size={13} />
                            Stop
                        </button>
                    )}
                </div>
            ) : capabilities.canStart ? (
                <button
                    type="button"
                    onClick={() => onStart(definition.id)}
                    disabled={busy}
                    className="btn ml-auto flex h-9 shrink-0 items-center gap-1 bg-base-300 px-3 text-xs disabled:opacity-50"
                >
                    <Play size={13} />
                    Start
                </button>
            ) : null}
        </div>
    )
}
