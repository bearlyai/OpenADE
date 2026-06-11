import { CheckCircle2, ChevronRight, CircleAlert, CircleDot, FolderOpen, Loader2, Plus } from "lucide-react"
import type {
    OpenADECronDefinitionsReadResult,
    OpenADEProject,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadResult,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectSearchResult,
    OpenADETaskPreview,
} from "../../../../openade-module/src"
import {
    ProjectCronPanel,
    type ProjectCronCapabilities,
    type ProjectFileCapabilities,
    ProjectFilesPanel,
    type ProjectGitCapabilities,
    ProjectGitPanel,
    type ProjectProcessCapabilities,
    ProjectProcessesPanel,
    type ProjectSearchCapabilities,
    ProjectSearchPanel,
} from "./ProjectHostPanels"

export function ProjectTasksScreen({
    repo,
    workingTaskIds,
    files,
    filesLoading,
    fileRead,
    fileActionPath,
    fileSearchQuery,
    fileSearchResult,
    fileSearchLoading,
    searchQuery,
    searchResult,
    searchLoading,
    gitInfo,
    gitBranches,
    gitSummary,
    gitLoading,
    gitCapabilities,
    cronDefinitions,
    cronDefinitionsLoading,
    cronCapabilities,
    processes,
    processesLoading,
    processActionId,
    processOutput,
    fileCapabilities,
    searchCapabilities,
    processCapabilities,
    canCreateTask,
    onSelectTask,
    onNewTask,
    onRefreshFiles,
    onReadFile,
    onFileSearchQueryChange,
    onSearchFiles,
    onWriteFile,
    onSearchQueryChange,
    onSearch,
    onRefreshGit,
    onRefreshCronDefinitions,
    onRefreshProcesses,
    onStartProcess,
    onReconnectProcess,
    onStopProcess,
}: {
    repo: OpenADEProject | null
    workingTaskIds: string[]
    files: OpenADEProjectFilesTreeResult | null
    filesLoading: boolean
    fileRead: OpenADEProjectFileReadResult | null
    fileActionPath: string | null
    fileSearchQuery: string
    fileSearchResult: OpenADEProjectFilesFuzzySearchResult | null
    fileSearchLoading: boolean
    searchQuery: string
    searchResult: OpenADEProjectSearchResult | null
    searchLoading: boolean
    gitInfo: OpenADEProjectGitInfoResult | null
    gitBranches: OpenADEProjectGitBranchesReadResult | null
    gitSummary: OpenADEProjectGitSummaryReadResult | null
    gitLoading: boolean
    gitCapabilities: ProjectGitCapabilities
    cronDefinitions: OpenADECronDefinitionsReadResult | null
    cronDefinitionsLoading: boolean
    cronCapabilities: ProjectCronCapabilities
    processes: OpenADEProjectProcessListResult | null
    processesLoading: boolean
    processActionId: string | null
    processOutput: OpenADEProjectProcessReconnectResult | null
    fileCapabilities: ProjectFileCapabilities
    searchCapabilities: ProjectSearchCapabilities
    processCapabilities: ProjectProcessCapabilities
    canCreateTask: boolean
    onSelectTask: (taskId: string) => void
    onNewTask: () => void
    onRefreshFiles: () => void
    onReadFile: (path: string) => void
    onFileSearchQueryChange: (value: string) => void
    onSearchFiles: () => void
    onWriteFile: (path: string, content: string) => void
    onSearchQueryChange: (value: string) => void
    onSearch: () => void
    onRefreshGit: () => void
    onRefreshCronDefinitions: () => void
    onRefreshProcesses: () => void
    onStartProcess: (definitionId: string) => void
    onReconnectProcess: (processId: string) => void
    onStopProcess: (processId: string) => void
}) {
    if (!repo) {
        return (
            <div className="w-full max-w-full p-3">
                <div className="border border-border bg-base-200/40 p-3 text-sm text-muted">Choose a project.</div>
            </div>
        )
    }

    const runningCount = repo.tasks.filter((task) => workingTaskIds.includes(task.id)).length

    return (
        <div className="flex h-full w-full max-w-full flex-col overflow-hidden">
            <div className="min-h-0 w-full max-w-full flex-1 overflow-y-auto overflow-x-hidden p-3">
                <div className="mb-3 overflow-hidden border border-border bg-base-200/25">
                    <div className="flex min-w-0 items-center gap-3 border-b border-border bg-base-200/60 p-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-info/20 bg-info/10 text-info">
                            <FolderOpen size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">Project</div>
                            <div className="truncate text-base font-semibold">{repo.name}</div>
                            <div className="truncate text-xs text-muted">{repo.path}</div>
                        </div>
                        {canCreateTask && (
                            <button
                                type="button"
                                onClick={onNewTask}
                                className="btn flex h-10 shrink-0 items-center gap-1.5 bg-primary px-3 text-sm text-primary-content"
                            >
                                <Plus size={15} />
                                New
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 px-3 py-2">
                        <span className="border border-border bg-base-100/60 px-2 py-1 text-[11px] text-muted">
                            {repo.tasks.length} task{repo.tasks.length === 1 ? "" : "s"}
                        </span>
                        {runningCount > 0 && (
                            <span className="flex items-center gap-1 border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                                <Loader2 size={11} className="animate-spin" />
                                {runningCount} running
                            </span>
                        )}
                    </div>
                </div>

                <ProjectGitPanel
                    info={gitInfo}
                    branches={gitBranches}
                    summary={gitSummary}
                    loading={gitLoading}
                    capabilities={gitCapabilities}
                    onRefresh={onRefreshGit}
                />

                <ProjectCronPanel
                    definitions={cronDefinitions}
                    loading={cronDefinitionsLoading}
                    capabilities={cronCapabilities}
                    onRefresh={onRefreshCronDefinitions}
                />

                <ProjectProcessesPanel
                    processes={processes}
                    loading={processesLoading}
                    actionId={processActionId}
                    output={processOutput}
                    capabilities={processCapabilities}
                    onRefresh={onRefreshProcesses}
                    onStart={onStartProcess}
                    onReconnect={onReconnectProcess}
                    onStop={onStopProcess}
                />

                <ProjectFilesPanel
                    files={files}
                    loading={filesLoading}
                    fileRead={fileRead}
                    actionPath={fileActionPath}
                    fileSearchQuery={fileSearchQuery}
                    fileSearchResult={fileSearchResult}
                    fileSearchLoading={fileSearchLoading}
                    capabilities={fileCapabilities}
                    onRefresh={onRefreshFiles}
                    onReadFile={onReadFile}
                    onFileSearchQueryChange={onFileSearchQueryChange}
                    onSearchFiles={onSearchFiles}
                    onWriteFile={onWriteFile}
                />

                <ProjectSearchPanel
                    query={searchQuery}
                    result={searchResult}
                    loading={searchLoading}
                    capabilities={searchCapabilities}
                    onQueryChange={onSearchQueryChange}
                    onSearch={onSearch}
                    onOpenFile={onReadFile}
                />

                <section className="w-full max-w-full overflow-hidden border border-border bg-base-200/20">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted">Tasks</div>
                        {runningCount > 0 && <div className="text-[11px] text-primary">Live</div>}
                    </div>
                    <div className="flex w-full max-w-full flex-col overflow-hidden">
                        {repo.tasks.length === 0 && <div className="p-3 text-sm text-muted">No tasks yet.</div>}
                        {repo.tasks.map((task) => (
                            <ProjectTaskRow key={task.id} task={task} isRunning={workingTaskIds.includes(task.id)} onSelect={() => onSelectTask(task.id)} />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    )
}

function ProjectTaskRow({ task, isRunning, onSelect }: { task: OpenADETaskPreview; isRunning: boolean; onSelect: () => void }) {
    const status = task.lastEvent?.status
    const isError = status === "error"
    const statusLabel = isRunning ? "Running" : task.closed ? "Closed" : (task.lastEvent?.sourceLabel ?? "No events")
    const tone = isRunning ? "text-primary" : isError ? "text-error" : task.closed ? "text-muted" : "text-base-content"

    return (
        <button
            type="button"
            onClick={onSelect}
            className="btn group flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden border-b border-border bg-transparent px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-base-200/70"
        >
            <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center border ${
                    isRunning
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : isError
                          ? "border-error/20 bg-error/10 text-error"
                          : task.closed
                            ? "border-border bg-base-200/60 text-muted"
                            : "border-info/20 bg-info/10 text-info"
                }`}
            >
                {isRunning ? (
                    <Loader2 size={16} className="animate-spin" />
                ) : isError ? (
                    <CircleAlert size={16} />
                ) : task.closed ? (
                    <CheckCircle2 size={16} />
                ) : (
                    <CircleDot size={16} />
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block min-w-0 overflow-hidden truncate whitespace-nowrap text-sm font-semibold text-base-content">{task.title}</span>
                <span className={`mt-0.5 block max-w-full truncate text-xs ${tone}`}>{statusLabel}</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-muted opacity-60 group-hover:text-base-content" />
        </button>
    )
}
