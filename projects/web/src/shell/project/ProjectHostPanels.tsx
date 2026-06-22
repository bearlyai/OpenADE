import { CalendarClock, FileText, FolderOpen, GitBranch, Loader2, Pause, Play, RefreshCw, Search, Server, Square, Terminal } from "lucide-react"
import { useState } from "react"
import type {
    OpenADECronDefinitionsReadResult,
    OpenADECronInstallStateReadResult,
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
    canReadInstallState: boolean
    canReplaceInstallState: boolean
    canRun: boolean
}

export function ProjectCronPanel({
    definitions,
    installState,
    loading,
    installStateLoading,
    installActionId,
    capabilities,
    onRefresh,
    onRefreshInstallState,
    onSetCronEnabled,
    onRunCron,
}: {
    definitions: OpenADECronDefinitionsReadResult | null
    installState: OpenADECronInstallStateReadResult | null
    loading: boolean
    installStateLoading: boolean
    installActionId: string | null
    capabilities: ProjectCronCapabilities
    onRefresh?: () => void
    onRefreshInstallState?: () => void
    onSetCronEnabled?: (cronId: string, enabled: boolean) => void
    onRunCron?: (cronId: string) => void
}) {
    if (!capabilities.canRead) return null

    const isUnloaded = definitions === null
    const configs = definitions?.configs ?? []
    const errors = definitions?.errors ?? []
    const visibleInstallState = capabilities.canReadInstallState ? installState : null
    const canRefreshCrons = capabilities.canRead && Boolean(onRefresh)
    const canRefreshInstallState = capabilities.canReadInstallState && Boolean(onRefreshInstallState)
    const canRunCron = capabilities.canRun && Boolean(onRunCron)
    const canReplaceInstallState = capabilities.canReplaceInstallState && Boolean(onSetCronEnabled)
    const showInstallStateControls = Boolean(definitions && capabilities.canReadInstallState && canRefreshInstallState)

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <CalendarClock size={13} />
                    Crons
                </div>
                <div className="flex items-center gap-1.5">
                    {showInstallStateControls && (
                        <button
                            type="button"
                            title={installState === null ? "Load cron install state" : "Refresh cron install state"}
                            aria-label={installState === null ? "Load cron install state" : "Refresh cron install state"}
                            onClick={onRefreshInstallState}
                            disabled={installStateLoading}
                            className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                        >
                            {installStateLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            State
                        </button>
                    )}
                    {canRefreshCrons && (
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
                    )}
                </div>
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
                        {config.crons.map((cron) => {
                            const installation = visibleInstallState?.installations[cron.id]
                            const enabled = installation?.enabled === true
                            const busy = installActionId === cron.id
                            return (
                                <div key={cron.id} className="flex min-w-0 items-start gap-2 border-b border-border px-3 py-2 last:border-b-0">
                                    <CalendarClock size={13} className="mt-0.5 shrink-0 text-info" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <div className="min-w-0 flex-1 truncate text-xs font-medium text-base-content">{cron.name}</div>
                                            {enabled && (
                                                <span className="shrink-0 border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                                    Enabled
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted">
                                            <span className="font-mono">{cron.schedule}</span>
                                            <span>{cron.type}</span>
                                            {cron.harness && <span>{cron.harness}</span>}
                                            {cron.isolation && <span>{cron.isolation}</span>}
                                            {installation?.lastTaskId && <span>{installation.lastTaskId}</span>}
                                        </div>
                                    </div>
                                    {(canRunCron || (canReplaceInstallState && visibleInstallState)) && (
                                        <div className="flex shrink-0 items-center gap-1.5">
                                            {canRunCron && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRunCron?.(cron.id)}
                                                    disabled={busy}
                                                    className="btn flex h-7 items-center gap-1 bg-base-300 px-2 text-[11px] disabled:opacity-50"
                                                    title="Run cron now"
                                                >
                                                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                                                    Run
                                                </button>
                                            )}
                                            {canReplaceInstallState && visibleInstallState && (
                                                <button
                                                    type="button"
                                                    onClick={() => onSetCronEnabled?.(cron.id, !enabled)}
                                                    disabled={busy}
                                                    className="btn flex h-7 items-center gap-1 bg-base-300 px-2 text-[11px] disabled:opacity-50"
                                                    title={enabled ? "Pause cron" : "Enable cron"}
                                                >
                                                    {busy ? <Loader2 size={12} className="animate-spin" /> : enabled ? <Pause size={12} /> : <Play size={12} />}
                                                    {enabled ? "Pause" : "Enable"}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
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
    canReadInfo: boolean
    canReadBranches: boolean
    canReadSummary: boolean
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
    onRefresh?: () => void
}) {
    const canReadAnyGit = capabilities.canReadInfo || capabilities.canReadBranches || capabilities.canReadSummary
    if (!canReadAnyGit) return null

    const visibleInfo = capabilities.canReadInfo ? info : null
    const visibleBranchResult = capabilities.canReadBranches ? branches : null
    const visibleSummary = capabilities.canReadSummary ? summary : null
    const isUnloaded = visibleInfo === null && visibleBranchResult === null && visibleSummary === null
    const visibleBranches = (visibleBranchResult?.branches ?? []).filter((branch) => !branch.isRemote).slice(0, 6)
    const canShowGitCards = visibleInfo !== null || visibleSummary !== null

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <GitBranch size={13} />
                    Git
                </div>
                {onRefresh && (
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {isUnloaded ? "Load Git" : "Refresh"}
                    </button>
                )}
            </div>
            <div className="flex flex-col overflow-hidden bg-base-100/50">
                {loading && isUnloaded && <div className="p-3 text-sm text-muted">Loading git...</div>}
                {!loading && isUnloaded && <div className="p-3 text-sm text-muted">Not loaded.</div>}
                {visibleInfo?.isGitRepo === false && <div className="p-3 text-sm text-warning">{visibleInfo.error ?? "Not a git repository."}</div>}
                {canShowGitCards && visibleInfo?.isGitRepo !== false && (
                    <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
                        <div className="border border-border bg-base-200/40 p-2">
                            <div className="text-[11px] uppercase text-muted">Branch</div>
                            <div className="mt-1 truncate text-sm font-medium">{visibleSummary?.branch ?? visibleInfo?.mainBranch ?? "Unknown"}</div>
                        </div>
                        <div className="border border-border bg-base-200/40 p-2">
                            <div className="text-[11px] uppercase text-muted">Head</div>
                            <div className="mt-1 truncate font-mono text-sm font-medium">{visibleSummary?.headCommit.slice(0, 8) ?? "Unknown"}</div>
                        </div>
                        <div className="border border-border bg-base-200/40 p-2">
                            <div className="text-[11px] uppercase text-muted">Status</div>
                            <div className="mt-1 text-sm font-medium">
                                {visibleSummary ? (visibleSummary.hasChanges ? changedFileLabel(projectChangeCount(visibleSummary)) : "Clean") : "Unknown"}
                            </div>
                        </div>
                        <div className="border border-border bg-base-200/40 p-2">
                            <div className="text-[11px] uppercase text-muted">Default</div>
                            <div className="mt-1 truncate text-sm font-medium">
                                {visibleBranchResult?.defaultBranch ?? visibleInfo?.mainBranch ?? "Unknown"}
                            </div>
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
    onRefresh?: () => void
    onReadFile?: (path: string) => void
    onFileSearchQueryChange: (value: string) => void
    onSearchFiles?: () => void
    onWriteFile?: (path: string, content: string) => void
}) {
    const canListFiles = capabilities.canList && Boolean(onRefresh)
    const canReadFile = capabilities.canRead && Boolean(onReadFile)
    const canSearchFiles = capabilities.canSearch && Boolean(onSearchFiles)
    const canWriteFile = capabilities.canWrite && Boolean(onWriteFile)
    const visibleFileRead = capabilities.canRead ? fileRead : null
    const visibleActionPath = capabilities.canRead ? actionPath : null
    const visibleFileSearchResult = capabilities.canSearch ? fileSearchResult : null
    const fileContent = visibleFileRead?.content ?? ""
    const canEditFile = Boolean(
        visibleFileRead && canWriteFile && !visibleFileRead.tooLarge && visibleFileRead.encoding === "utf8" && !visibleFileRead.isBinary
    )

    if (!capabilities.canList && !capabilities.canSearch) return null

    const entries = files?.entries ?? []
    const isUnloaded = files === null
    const fileSearchResults = visibleFileSearchResult?.results ?? []

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <FolderOpen size={13} />
                    Files
                </div>
                {canListFiles && (
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
            {canSearchFiles && (
                <div className="flex min-w-0 gap-2 border-b border-border px-3 py-2">
                    <input
                        value={fileSearchQuery}
                        aria-label="Find file"
                        onChange={(event) => onFileSearchQueryChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") onSearchFiles?.()
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
                    {visibleFileSearchResult && (
                        <div className="border-b border-border">
                            {fileSearchResults.length === 0 && <div className="p-3 text-sm text-muted">No file matches.</div>}
                            {fileSearchResults.map((path) => {
                                const busy = visibleActionPath === path
                                return (
                                    <button
                                        key={path}
                                        type="button"
                                        onClick={() => canReadFile && onReadFile?.(path)}
                                        disabled={busy || !canReadFile}
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
                            {visibleFileSearchResult.truncated && (
                                <div className="border-t border-border px-3 py-2 text-xs text-warning">File search truncated.</div>
                            )}
                        </div>
                    )}
                    {loading && entries.length === 0 && <div className="p-3 text-sm text-muted">Loading files...</div>}
                    {!loading && capabilities.canList && isUnloaded && <div className="p-3 text-sm text-muted">Not loaded.</div>}
                    {!loading && capabilities.canList && !isUnloaded && entries.length === 0 && <div className="p-3 text-sm text-muted">No files.</div>}
                    {capabilities.canList &&
                        entries.map((entry) => {
                            const isFile = entry.type === "file"
                            const busy = visibleActionPath === entry.path
                            return (
                                <button
                                    key={entry.path}
                                    type="button"
                                    onClick={() => isFile && canReadFile && onReadFile?.(entry.path)}
                                    disabled={!isFile || busy || !canReadFile}
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
                    {visibleFileRead && canEditFile && onWriteFile ? (
                        <ProjectEditableFileView
                            key={`${visibleFileRead.path}:${fileContent}`}
                            fileRead={visibleFileRead}
                            fileContent={fileContent}
                            onWriteFile={onWriteFile}
                        />
                    ) : visibleFileRead ? (
                        <ProjectReadOnlyFileView fileRead={visibleFileRead} fileContent={fileContent} />
                    ) : (
                        <div className="flex min-h-28 items-center justify-center p-3 text-sm text-muted">Select a file.</div>
                    )}
                </div>
            </div>
            {files?.truncated && <div className="border-t border-border px-3 py-2 text-xs text-warning">File list truncated.</div>}
        </section>
    )
}

function ProjectEditableFileView({
    fileRead,
    fileContent,
    onWriteFile,
}: {
    fileRead: OpenADEProjectFileReadResult
    fileContent: string
    onWriteFile: (path: string, content: string) => void
}) {
    const [draft, setDraft] = useState<string>(() => fileContent)
    const draftChanged = draft !== fileContent

    return (
        <div className="flex h-full min-h-28 flex-col">
            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="min-w-0 truncate text-xs font-medium text-muted">{fileRead.path}</div>
                <button
                    type="button"
                    onClick={() => onWriteFile(fileRead.path, draft)}
                    disabled={!draftChanged}
                    className="btn h-7 shrink-0 bg-base-300 px-2 text-[11px] disabled:opacity-50"
                >
                    Save
                </button>
            </div>
            <textarea
                value={draft}
                aria-label="File contents"
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-56 w-full resize-y border-0 bg-transparent p-3 font-mono text-xs leading-relaxed text-base-content outline-none"
            />
        </div>
    )
}

function ProjectReadOnlyFileView({ fileRead, fileContent }: { fileRead: OpenADEProjectFileReadResult; fileContent: string }) {
    return (
        <div className="flex h-full min-h-28 flex-col">
            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="min-w-0 truncate text-xs font-medium text-muted">{fileRead.path}</div>
            </div>
            {fileRead.tooLarge ? (
                <div className="p-3 text-sm text-warning">File is too large to preview.</div>
            ) : (
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-base-content [overflow-wrap:anywhere]">
                    {fileContent}
                </pre>
            )}
        </div>
    )
}

export type ProjectSearchCapabilities = {
    canSearch: boolean
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
    onSearch?: () => void
    onOpenFile?: (path: string) => void
}) {
    if (!capabilities.canSearch) return null

    const canSearch = Boolean(onSearch)
    const canOpenFile = Boolean(onOpenFile)
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
                        if (event.key === "Enter") onSearch?.()
                    }}
                    placeholder="Search files"
                    className="input h-8 min-w-0 flex-1 border border-border bg-base-100 px-2 text-sm"
                />
                <button
                    type="button"
                    onClick={onSearch}
                    disabled={loading || !query.trim() || !canSearch}
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
                            onClick={() => canOpenFile && onOpenFile?.(match.path)}
                            disabled={!canOpenFile}
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
    onRefresh?: () => void
    onStart?: (definitionId: string) => void
    onReconnect?: (processId: string) => void
    onStop?: (processId: string) => void
}) {
    if (!capabilities.canRead) return null

    const canRefreshProcesses = capabilities.canRead && Boolean(onRefresh)
    const canStartProcess = capabilities.canStart && Boolean(onStart)
    const canReconnectProcess = capabilities.canReconnect && Boolean(onReconnect)
    const canStopProcess = capabilities.canStop && Boolean(onStop)
    const visibleActionId = canStartProcess || canReconnectProcess || canStopProcess ? actionId : null
    const visibleOutput = canReconnectProcess ? output : null
    const definitions = processes?.processes ?? []
    const instances = processes?.instances ?? []
    const errors = processes?.errors ?? []
    const isUnloaded = processes === null && !visibleOutput
    if (!loading && !isUnloaded && definitions.length === 0 && errors.length === 0 && !visibleOutput) return null

    return (
        <section className="mb-3 w-full max-w-full overflow-hidden border border-border bg-base-200/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                    <Server size={13} />
                    Processes
                </div>
                {canRefreshProcesses && (
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {isUnloaded ? "Load Processes" : "Refresh"}
                    </button>
                )}
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
                            busy={visibleActionId === definition.id || visibleActionId === instance?.processId}
                            onStart={canStartProcess ? onStart : undefined}
                            onReconnect={canReconnectProcess ? onReconnect : undefined}
                            onStop={canStopProcess ? onStop : undefined}
                        />
                    )
                })}
                {visibleOutput && <ProjectProcessOutput result={visibleOutput} />}
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
    onStart?: (definitionId: string) => void
    onReconnect?: (processId: string) => void
    onStop?: (processId: string) => void
}) {
    const running = Boolean(instance)
    const canStart = Boolean(onStart)
    const canReconnect = Boolean(onReconnect)
    const canStop = Boolean(onStop)
    const showRunningActions = running && instance && (canReconnect || canStop)
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
                    {canReconnect && (
                        <button
                            type="button"
                            onClick={() => onReconnect?.(instance.processId)}
                            disabled={busy}
                            className="btn flex h-9 items-center gap-1 bg-base-300 px-3 text-xs disabled:opacity-50"
                        >
                            <Terminal size={13} />
                            Output
                        </button>
                    )}
                    {canStop && (
                        <button
                            type="button"
                            onClick={() => onStop?.(instance.processId)}
                            disabled={busy}
                            className="btn flex h-9 items-center gap-1 bg-error/10 px-3 text-xs text-error disabled:opacity-50"
                        >
                            <Square size={13} />
                            Stop
                        </button>
                    )}
                </div>
            ) : canStart ? (
                <button
                    type="button"
                    onClick={() => onStart?.(definition.id)}
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
