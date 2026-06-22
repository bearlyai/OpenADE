import { Archive, CheckCircle2, ChevronRight, CircleAlert, CircleDot, FolderOpen, Loader2, Plus, Save, Settings, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import type {
    OpenADECronDefinitionsReadResult,
    OpenADECronInstallStateReadResult,
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
    type ProjectCronCapabilities,
    ProjectCronPanel,
    type ProjectFileCapabilities,
    ProjectFilesPanel,
    type ProjectGitCapabilities,
    ProjectGitPanel,
    type ProjectProcessCapabilities,
    ProjectProcessesPanel,
    type ProjectSearchCapabilities,
    ProjectSearchPanel,
} from "./ProjectHostPanels"

export interface ProjectUpdateInput {
    repoId: string
    name?: string
    path?: string
    archived?: boolean
}

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
    cronInstallState,
    cronDefinitionsLoading,
    cronInstallStateLoading,
    cronInstallActionId,
    cronCapabilities,
    processes,
    processesLoading,
    processActionId,
    processOutput,
    fileCapabilities,
    searchCapabilities,
    processCapabilities,
    projectActionLoading,
    onUpdateProject,
    onDeleteProject,
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
    onRefreshCronInstallState,
    onSetCronEnabled,
    onRunCron,
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
    cronInstallState: OpenADECronInstallStateReadResult | null
    cronDefinitionsLoading: boolean
    cronInstallStateLoading: boolean
    cronInstallActionId: string | null
    cronCapabilities: ProjectCronCapabilities
    processes: OpenADEProjectProcessListResult | null
    processesLoading: boolean
    processActionId: string | null
    processOutput: OpenADEProjectProcessReconnectResult | null
    fileCapabilities: ProjectFileCapabilities
    searchCapabilities: ProjectSearchCapabilities
    processCapabilities: ProjectProcessCapabilities
    projectActionLoading: boolean
    onUpdateProject?: (project: ProjectUpdateInput) => Promise<boolean> | boolean
    onDeleteProject?: (repoId: string) => Promise<boolean> | boolean
    onSelectTask?: (taskId: string) => void
    onNewTask?: () => void
    onRefreshFiles?: () => void
    onReadFile?: (path: string) => void
    onFileSearchQueryChange: (value: string) => void
    onSearchFiles?: () => void
    onWriteFile?: (path: string, content: string) => void
    onSearchQueryChange: (value: string) => void
    onSearch?: () => void
    onRefreshGit?: () => void
    onRefreshCronDefinitions?: () => void
    onRefreshCronInstallState?: () => void
    onSetCronEnabled?: (cronId: string, enabled: boolean) => void
    onRunCron?: (cronId: string) => void
    onRefreshProcesses?: () => void
    onStartProcess?: (definitionId: string) => void
    onReconnectProcess?: (processId: string) => void
    onStopProcess?: (processId: string) => void
}) {
    if (!repo) {
        return (
            <div className="w-full max-w-full p-3">
                <div className="border border-border bg-base-200/40 p-3 text-sm text-muted">Choose a project.</div>
            </div>
        )
    }

    const runningCount = repo.tasks.filter((task) => workingTaskIds.includes(task.id)).length
    const canManageProject = Boolean(onUpdateProject || onDeleteProject)

    return (
        <div className="flex h-full w-full max-w-full flex-col overflow-hidden">
            <div className="min-h-0 w-full max-w-full flex-1 overflow-y-auto overflow-x-hidden p-3">
                <ProjectSummaryPanel
                    key={`${repo.id}:${repo.name}:${repo.path}:${canManageProject ? "manage" : "readonly"}`}
                    repo={repo}
                    runningCount={runningCount}
                    projectActionLoading={projectActionLoading}
                    onNewTask={onNewTask}
                    onUpdateProject={onUpdateProject}
                    onDeleteProject={onDeleteProject}
                />

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
                    installState={cronInstallState}
                    loading={cronDefinitionsLoading}
                    installStateLoading={cronInstallStateLoading}
                    installActionId={cronInstallActionId}
                    capabilities={cronCapabilities}
                    onRefresh={onRefreshCronDefinitions}
                    onRefreshInstallState={onRefreshCronInstallState}
                    onSetCronEnabled={onSetCronEnabled}
                    onRunCron={onRunCron}
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
                            <ProjectTaskRow
                                key={task.id}
                                task={task}
                                isRunning={workingTaskIds.includes(task.id)}
                                onSelect={onSelectTask ? () => onSelectTask(task.id) : undefined}
                            />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    )
}

function ProjectSummaryPanel({
    repo,
    runningCount,
    projectActionLoading,
    onNewTask,
    onUpdateProject,
    onDeleteProject,
}: {
    repo: OpenADEProject
    runningCount: number
    projectActionLoading: boolean
    onNewTask?: () => void
    onUpdateProject?: (project: ProjectUpdateInput) => Promise<boolean> | boolean
    onDeleteProject?: (repoId: string) => Promise<boolean> | boolean
}) {
    const [projectManagerOpen, setProjectManagerOpen] = useState(false)
    const canManageProject = Boolean(onUpdateProject || onDeleteProject)
    const canCreateTask = Boolean(onNewTask)

    useEffect(() => {
        if (!canManageProject) setProjectManagerOpen(false)
    }, [canManageProject])

    return (
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
                {canManageProject && (
                    <button
                        type="button"
                        onClick={() => setProjectManagerOpen((value) => !value)}
                        className="btn flex h-10 shrink-0 items-center gap-1.5 px-3 text-sm"
                    >
                        <Settings size={15} />
                        Manage
                    </button>
                )}
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
                {repo.archived === true && <span className="border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning">Archived</span>}
                {runningCount > 0 && (
                    <span className="flex items-center gap-1 border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                        <Loader2 size={11} className="animate-spin" />
                        {runningCount} running
                    </span>
                )}
            </div>
            {projectManagerOpen && canManageProject && (
                <ProjectManagerPanel
                    repo={repo}
                    projectActionLoading={projectActionLoading}
                    onUpdateProject={onUpdateProject}
                    onDeleteProject={onDeleteProject}
                />
            )}
        </div>
    )
}

function ProjectManagerPanel({
    repo,
    projectActionLoading,
    onUpdateProject,
    onDeleteProject,
}: {
    repo: OpenADEProject
    projectActionLoading: boolean
    onUpdateProject?: (project: ProjectUpdateInput) => Promise<boolean> | boolean
    onDeleteProject?: (repoId: string) => Promise<boolean> | boolean
}) {
    return (
        <div className="grid gap-2 border-t border-border bg-base-100/70 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
            {onUpdateProject && (
                <ProjectManagerEditFields
                    key={`${repo.id}:${repo.name}:${repo.path}`}
                    repo={repo}
                    projectActionLoading={projectActionLoading}
                    onUpdateProject={onUpdateProject}
                />
            )}
            <div className="flex flex-wrap items-center gap-2">
                {onDeleteProject && (
                    <button
                        type="button"
                        onClick={() => onDeleteProject(repo.id)}
                        disabled={projectActionLoading}
                        className="btn flex h-10 items-center gap-1.5 bg-error px-3 text-sm text-error-content"
                    >
                        <Trash2 size={14} />
                        Delete
                    </button>
                )}
            </div>
        </div>
    )
}

function ProjectManagerEditFields({
    repo,
    projectActionLoading,
    onUpdateProject,
}: {
    repo: OpenADEProject
    projectActionLoading: boolean
    onUpdateProject: (project: ProjectUpdateInput) => Promise<boolean> | boolean
}) {
    const [projectNameDraft, setProjectNameDraft] = useState<string>(() => repo.name)
    const [projectPathDraft, setProjectPathDraft] = useState<string>(() => repo.path)
    const trimmedProjectName = projectNameDraft.trim()
    const trimmedProjectPath = projectPathDraft.trim()
    const projectDraftChanged = trimmedProjectName !== repo.name || trimmedProjectPath !== repo.path

    const submitProjectUpdate = async () => {
        if (!trimmedProjectName || !trimmedProjectPath || !projectDraftChanged) return
        const update: ProjectUpdateInput = { repoId: repo.id }
        if (trimmedProjectName !== repo.name) update.name = trimmedProjectName
        if (trimmedProjectPath !== repo.path) update.path = trimmedProjectPath
        await onUpdateProject(update)
    }

    const toggleProjectArchived = async () => {
        await onUpdateProject({ repoId: repo.id, archived: repo.archived !== true })
    }

    return (
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
                className="input h-10 min-w-0"
                aria-label="Project name"
                value={projectNameDraft}
                onChange={(event) => setProjectNameDraft(event.target.value)}
                disabled={projectActionLoading}
            />
            <input
                className="input h-10 min-w-0"
                aria-label="Project path"
                value={projectPathDraft}
                onChange={(event) => setProjectPathDraft(event.target.value)}
                disabled={projectActionLoading}
            />
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={submitProjectUpdate}
                    disabled={projectActionLoading || !projectDraftChanged || !trimmedProjectName || !trimmedProjectPath}
                    className="btn flex h-10 items-center gap-1.5 px-3 text-sm"
                >
                    {projectActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save
                </button>
                <button
                    type="button"
                    onClick={toggleProjectArchived}
                    disabled={projectActionLoading}
                    className="btn flex h-10 items-center gap-1.5 px-3 text-sm"
                >
                    <Archive size={14} />
                    {repo.archived === true ? "Reopen" : "Archive"}
                </button>
            </div>
        </div>
    )
}

function ProjectTaskRow({
    task,
    isRunning,
    onSelect,
}: {
    task: OpenADETaskPreview
    isRunning: boolean
    onSelect?: () => void
}) {
    const status = task.lastEvent?.status
    const isError = status === "error"
    const statusLabel = isRunning ? "Running" : task.closed ? "Closed" : (task.lastEvent?.sourceLabel ?? "No events")
    const tone = isRunning ? "text-primary" : isError ? "text-error" : task.closed ? "text-muted" : "text-base-content"
    const canSelectTask = Boolean(onSelect)

    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={!canSelectTask}
            className="btn group flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden border-b border-border bg-transparent px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-base-200/70 disabled:cursor-not-allowed disabled:opacity-60"
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
            {canSelectTask && <ChevronRight size={15} className="shrink-0 text-muted opacity-60 group-hover:text-base-content" />}
        </button>
    )
}
