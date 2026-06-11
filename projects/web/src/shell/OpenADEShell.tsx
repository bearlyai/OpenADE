import { FolderOpen, MessageSquarePlus, Server, Settings } from "lucide-react"
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
    OpenADESnapshotPatchFile,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogResult,
    OpenADETaskGitLogEntry,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryResult,
    OpenADETaskPreview,
    OpenADETaskResourceInventory,
} from "../../../openade-module/src"
import { OpenADEChrome, type OpenADEChromeNavItem, type OpenADEChromeStatus } from "./OpenADEChrome"
import { type OpenADESessionConfig, OpenADESessionsScreen, OpenADESettingsScreen, type OpenADEThemeSetting } from "./OpenADESessionScreens"
import { ProjectTasksScreen } from "./project/ProjectTasksScreen"
import { type ProjectSessionSummary, ProjectsScreen } from "./project/ProjectsScreen"
import { NewTaskScreen } from "./task/NewTaskScreen"
import type { TaskImageLoader, TaskSnapshotPatchView } from "./task/TaskEventThread"
import type { TaskComposerAgentControls } from "./task/TaskComposer"
import type { OpenADETaskCommentView, TaskProductCapabilities, TaskReviewType } from "./task/TaskProductPanel"
import { TaskScreen } from "./task/TaskScreen"
import type { TaskTerminalProductAccess } from "../components/terminalSession"
import type {
    ProjectCronCapabilities,
    ProjectFileCapabilities,
    ProjectGitCapabilities,
    ProjectProcessCapabilities,
    ProjectSearchCapabilities,
} from "./project/ProjectHostPanels"
import type { TaskGitCapabilities } from "./task/TaskGitPanel"
import type { TaskSnapshotBlock } from "./task/taskEventPresentation"
import type { TaskCommandType } from "./task/taskCommands"

export type OpenADEShellScreen = "projects" | "project" | "task" | "new_task" | "sessions" | "settings"

const openADENavItems: Array<OpenADEChromeNavItem<OpenADEShellScreen>> = [
    { screen: "projects", label: "Projects", icon: FolderOpen },
    { screen: "new_task", label: "New", icon: MessageSquarePlus },
    { screen: "sessions", label: "Sessions", icon: Server },
    { screen: "settings", label: "Settings", icon: Settings },
]

function openADEShellNavItems(canCreateTask: boolean): Array<OpenADEChromeNavItem<OpenADEShellScreen>> {
    return canCreateTask ? openADENavItems : openADENavItems.filter((item) => item.screen !== "new_task")
}

function openADEShellTitle(screen: OpenADEShellScreen, selectedRepo: OpenADEProject | null, selectedTask: OpenADETaskPreview | null): string {
    if (screen === "task") return selectedTask?.title ?? "Task"
    if (screen === "project") return selectedRepo?.name ?? "Tasks"
    if (screen === "new_task") return "New Task"
    if (screen === "sessions") return "Sessions"
    if (screen === "settings") return "Settings"
    return "Projects"
}

export function OpenADEShell({
    className,
    screen,
    host,
    status,
    isLoading,
    isSubmitting,
    isOnline,
    error,
    notice,
    connectionWarning,
    sessions,
    showArchivedProjects,
    selectedRepo,
    selectedTask,
    visibleRepos,
    workingTaskIds,
    projectFiles,
    projectFilesLoading,
    projectFileRead,
    projectFileActionPath,
    projectFileSearchQuery,
    projectFileSearchResult,
    projectFileSearchLoading,
    projectSearchQuery,
    projectSearchResult,
    projectSearchLoading,
    projectGitInfo,
    projectGitBranches,
    projectGitSummary,
    projectGitLoading,
    projectGitCapabilities,
    projectCronDefinitions,
    projectCronDefinitionsLoading,
    projectCronCapabilities,
    projectProcesses,
    projectProcessesLoading,
    projectProcessActionId,
    projectProcessOutput,
    projectFileCapabilities,
    projectSearchCapabilities,
    projectProcessCapabilities,
    task,
    input,
    commandType,
    taskTitleDraft,
    commentDraft,
    editingCommentId,
    editingCommentDraft,
    reviewInstructions,
    taskChanges,
    taskGitLog,
    taskGitSummary,
    taskGitScopes,
    taskChangesLoading,
    taskDiff,
    taskDiffActionPath,
    taskFilePair,
    taskFilePairActionPath,
    taskCommitFiles,
    taskCommitFilesActionSha,
    taskCommitPatch,
    taskCommitPatchActionKey,
    taskTreeishFile,
    taskTreeishFileActionKey,
    taskResources,
    taskResourcesLoading,
    taskTerminalProductAccess,
    taskGitCapabilities,
    taskProductCapabilities,
    taskCanReadResources,
    taskCanDelete,
    taskCanStartTurn,
    taskCanEnqueueQueuedTurn,
    taskCanInterrupt,
    taskCanReadSnapshotPatch,
    taskCanReadSnapshotPatchSlice,
    taskAgentControls,
    newTaskRepoId,
    newTaskMode,
    newTaskTitle,
    newTaskPrompt,
    newTaskCanCreate,
    newTaskCanStartTurn,
    newTaskAgentControls,
    configs,
    activeConfigId,
    settingsConfig,
    snapshot,
    themeSetting,
    settingsCanSelfRevoke,
    loadTaskImage,
    taskSnapshotPatches,
    taskSnapshotPatchActionId,
    onBack,
    onRefresh,
    onNavigate,
    onToggleArchivedProjects,
    onSelectProject,
    onAddHost,
    onSelectTask,
    onNewTask,
    onRefreshProjectProcesses,
    onStartProjectProcess,
    onReconnectProjectProcess,
    onStopProjectProcess,
    onRefreshProjectFiles,
    onReadProjectFile,
    onProjectFileSearchQueryChange,
    onSearchProjectFiles,
    onWriteProjectFile,
    onProjectSearchQueryChange,
    onSearchProject,
    onRefreshProjectGit,
    onRefreshProjectCronDefinitions,
    onInputChange,
    onCommandTypeChange,
    onTaskTitleChange,
    onSaveTaskTitle,
    onGenerateTaskTitle,
    onPrepareTaskEnvironment,
    onToggleTaskClosed,
    onDeleteTask,
    onCommentDraftChange,
    onCreateComment,
    onStartEditComment,
    onEditingCommentDraftChange,
    onSaveComment,
    onCancelEditComment,
    onDeleteComment,
    onCancelQueuedTurn,
    onReorderQueuedTurns,
    onReviewInstructionsChange,
    onStartReview,
    onRefreshTaskGit,
    onReadTaskDiff,
    onReadTaskFilePair,
    onReadTaskCommitFiles,
    onReadTaskCommitFilePatch,
    onReadTaskCommitFileAtTreeish,
    onCommitTaskGit,
    onRefreshTaskResources,
    onLoadTaskSnapshotPatch,
    onLoadTaskSnapshotPatchSlice,
    onSendTaskInput,
    onAbortTask,
    onNewTaskRepoChange,
    onNewTaskModeChange,
    onNewTaskTitleChange,
    onNewTaskPromptChange,
    onCreateTask,
    onSelectHost,
    onRemoveHost,
    onForget,
    onSelfRevoke,
    onThemeChange,
}: {
    className: string
    screen: OpenADEShellScreen
    host: string
    status: OpenADEChromeStatus
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    error: string | null
    notice: string | null
    connectionWarning: string | null
    sessions: ProjectSessionSummary[]
    showArchivedProjects: boolean
    selectedRepo: OpenADEProject | null
    selectedTask: OpenADETaskPreview | null
    visibleRepos: OpenADEProject[]
    workingTaskIds: string[]
    projectFiles: OpenADEProjectFilesTreeResult | null
    projectFilesLoading: boolean
    projectFileRead: OpenADEProjectFileReadResult | null
    projectFileActionPath: string | null
    projectFileSearchQuery: string
    projectFileSearchResult: OpenADEProjectFilesFuzzySearchResult | null
    projectFileSearchLoading: boolean
    projectSearchQuery: string
    projectSearchResult: OpenADEProjectSearchResult | null
    projectSearchLoading: boolean
    projectGitInfo: OpenADEProjectGitInfoResult | null
    projectGitBranches: OpenADEProjectGitBranchesReadResult | null
    projectGitSummary: OpenADEProjectGitSummaryReadResult | null
    projectGitLoading: boolean
    projectGitCapabilities: ProjectGitCapabilities
    projectCronDefinitions: OpenADECronDefinitionsReadResult | null
    projectCronDefinitionsLoading: boolean
    projectCronCapabilities: ProjectCronCapabilities
    projectProcesses: OpenADEProjectProcessListResult | null
    projectProcessesLoading: boolean
    projectProcessActionId: string | null
    projectProcessOutput: OpenADEProjectProcessReconnectResult | null
    projectFileCapabilities: ProjectFileCapabilities
    projectSearchCapabilities: ProjectSearchCapabilities
    projectProcessCapabilities: ProjectProcessCapabilities
    task: OpenADETask | null
    input: string
    commandType: TaskCommandType
    taskTitleDraft: string
    commentDraft: string
    editingCommentId: string | null
    editingCommentDraft: string
    reviewInstructions: string
    taskChanges: OpenADETaskChangesReadResult | null
    taskGitLog: OpenADETaskGitLogResult | null
    taskGitSummary: OpenADETaskGitSummaryResult | null
    taskGitScopes: OpenADETaskGitScopesReadResult | null
    taskChangesLoading: boolean
    taskDiff: OpenADETaskDiffReadResult | null
    taskDiffActionPath: string | null
    taskFilePair: OpenADETaskFilePairReadResult | null
    taskFilePairActionPath: string | null
    taskCommitFiles: OpenADETaskGitCommitFilesResult | null
    taskCommitFilesActionSha: string | null
    taskCommitPatch: OpenADETaskGitCommitFilePatchResult | null
    taskCommitPatchActionKey: string | null
    taskTreeishFile: OpenADETaskGitFileAtTreeishResult | null
    taskTreeishFileActionKey: string | null
    taskResources: OpenADETaskResourceInventory | null
    taskResourcesLoading: boolean
    taskTerminalProductAccess: TaskTerminalProductAccess | null
    taskGitCapabilities: TaskGitCapabilities
    taskProductCapabilities: TaskProductCapabilities
    taskCanReadResources: boolean
    taskCanDelete: boolean
    taskCanStartTurn: boolean
    taskCanEnqueueQueuedTurn: boolean
    taskCanInterrupt: boolean
    taskCanReadSnapshotPatch: boolean
    taskCanReadSnapshotPatchSlice: boolean
    taskAgentControls?: TaskComposerAgentControls
    newTaskRepoId: string | null
    newTaskMode: TaskCommandType
    newTaskTitle: string
    newTaskPrompt: string
    newTaskCanCreate: boolean
    newTaskCanStartTurn: boolean
    newTaskAgentControls?: TaskComposerAgentControls
    configs: OpenADESessionConfig[]
    activeConfigId: string
    settingsConfig: OpenADESessionConfig
    snapshot: OpenADESnapshot | null
    themeSetting: OpenADEThemeSetting
    settingsCanSelfRevoke: boolean
    loadTaskImage?: TaskImageLoader
    taskSnapshotPatches?: Record<string, TaskSnapshotPatchView>
    taskSnapshotPatchActionId?: string | null
    onBack: () => void
    onRefresh: () => void
    onNavigate: (screen: OpenADEShellScreen) => void
    onToggleArchivedProjects: () => void
    onSelectProject: (configId: string, repoId: string) => void
    onAddHost: () => void
    onSelectTask: (taskId: string) => void
    onNewTask: () => void
    onRefreshProjectProcesses: () => void
    onStartProjectProcess: (definitionId: string) => void
    onReconnectProjectProcess: (processId: string) => void
    onStopProjectProcess: (processId: string) => void
    onRefreshProjectFiles: () => void
    onReadProjectFile: (path: string) => void
    onProjectFileSearchQueryChange: (value: string) => void
    onSearchProjectFiles: () => void
    onWriteProjectFile: (path: string, content: string) => void
    onProjectSearchQueryChange: (value: string) => void
    onSearchProject: () => void
    onRefreshProjectGit: () => void
    onRefreshProjectCronDefinitions: () => void
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: TaskCommandType) => void
    onTaskTitleChange: (value: string) => void
    onSaveTaskTitle: () => void
    onGenerateTaskTitle: () => void
    onPrepareTaskEnvironment: () => void
    onToggleTaskClosed: () => void
    onDeleteTask: () => void
    onCommentDraftChange: (value: string) => void
    onCreateComment: () => void
    onStartEditComment: (comment: OpenADETaskCommentView) => void
    onEditingCommentDraftChange: (value: string) => void
    onSaveComment: (commentId: string) => void
    onCancelEditComment: () => void
    onDeleteComment: (commentId: string) => void
    onCancelQueuedTurn: (queuedTurnId: string) => void
    onReorderQueuedTurns: (queuedTurnIds: string[]) => void
    onReviewInstructionsChange: (value: string) => void
    onStartReview: (reviewType: TaskReviewType) => void
    onRefreshTaskGit: () => void
    onReadTaskDiff: (file: OpenADETaskGitChangedFile) => void
    onReadTaskFilePair: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFiles: (commit: OpenADETaskGitLogEntry) => void
    onReadTaskCommitFilePatch: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFileAtTreeish: (file: OpenADETaskGitChangedFile) => void
    onCommitTaskGit: (message: string) => void
    onRefreshTaskResources: () => void
    onLoadTaskSnapshotPatch?: (block: TaskSnapshotBlock) => void
    onLoadTaskSnapshotPatchSlice?: (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => void
    onSendTaskInput: () => void
    onAbortTask: () => void
    onNewTaskRepoChange: (repoId: string) => void
    onNewTaskModeChange: (value: TaskCommandType) => void
    onNewTaskTitleChange: (value: string) => void
    onNewTaskPromptChange: (value: string) => void
    onCreateTask: () => void
    onSelectHost: (configId: string) => void
    onRemoveHost: (configId: string) => void
    onForget: () => void
    onSelfRevoke: () => void
    onThemeChange: (value: OpenADEThemeSetting) => void
}) {
    return (
        <OpenADEChrome
            className={className}
            title={openADEShellTitle(screen, selectedRepo, selectedTask)}
            host={host}
            status={status}
            showBack={screen === "project" || screen === "task" || screen === "new_task" || screen === "sessions" || screen === "settings"}
            isLoading={isLoading}
            error={error}
            notice={notice}
            connectionWarning={connectionWarning}
            activeNav={screen === "project" ? "projects" : screen}
            navItems={openADEShellNavItems(newTaskCanCreate)}
            onBack={onBack}
            onRefresh={onRefresh}
            onNavigate={onNavigate}
        >
            {screen === "projects" && (
                <ProjectsScreen
                    sessions={sessions}
                    showArchived={showArchivedProjects}
                    onToggleArchived={onToggleArchivedProjects}
                    onSelectProject={onSelectProject}
                    onAddSession={onAddHost}
                />
            )}
            {screen === "project" && (
                <ProjectTasksScreen
                    repo={selectedRepo}
                    workingTaskIds={workingTaskIds}
                    files={projectFiles}
                    filesLoading={projectFilesLoading}
                    fileRead={projectFileRead}
                    fileActionPath={projectFileActionPath}
                    fileSearchQuery={projectFileSearchQuery}
                    fileSearchResult={projectFileSearchResult}
                    fileSearchLoading={projectFileSearchLoading}
                    searchQuery={projectSearchQuery}
                    searchResult={projectSearchResult}
                    searchLoading={projectSearchLoading}
                    gitInfo={projectGitInfo}
                    gitBranches={projectGitBranches}
                    gitSummary={projectGitSummary}
                    gitLoading={projectGitLoading}
                    gitCapabilities={projectGitCapabilities}
                    cronDefinitions={projectCronDefinitions}
                    cronDefinitionsLoading={projectCronDefinitionsLoading}
                    cronCapabilities={projectCronCapabilities}
                    processes={projectProcesses}
                    processesLoading={projectProcessesLoading}
                    processActionId={projectProcessActionId}
                    processOutput={projectProcessOutput}
                    fileCapabilities={projectFileCapabilities}
                    searchCapabilities={projectSearchCapabilities}
                    processCapabilities={projectProcessCapabilities}
                    canCreateTask={newTaskCanCreate}
                    onSelectTask={onSelectTask}
                    onNewTask={onNewTask}
                    onRefreshProcesses={onRefreshProjectProcesses}
                    onStartProcess={onStartProjectProcess}
                    onReconnectProcess={onReconnectProjectProcess}
                    onStopProcess={onStopProjectProcess}
                    onRefreshFiles={onRefreshProjectFiles}
                    onReadFile={onReadProjectFile}
                    onFileSearchQueryChange={onProjectFileSearchQueryChange}
                    onSearchFiles={onSearchProjectFiles}
                    onWriteFile={onWriteProjectFile}
                    onSearchQueryChange={onProjectSearchQueryChange}
                    onSearch={onSearchProject}
                    onRefreshGit={onRefreshProjectGit}
                    onRefreshCronDefinitions={onRefreshProjectCronDefinitions}
                />
            )}
            {screen === "task" && (
                <TaskScreen
                    task={task}
                    preview={selectedTask}
                    isRunning={Boolean(selectedTask && workingTaskIds.includes(selectedTask.id))}
                    input={input}
                    commandType={commandType}
                    titleDraft={taskTitleDraft}
                    commentDraft={commentDraft}
                    editingCommentId={editingCommentId}
                    editingCommentDraft={editingCommentDraft}
                    reviewInstructions={reviewInstructions}
                    taskChanges={taskChanges}
                    taskGitLog={taskGitLog}
                    taskGitSummary={taskGitSummary}
                    taskGitScopes={taskGitScopes}
                    taskChangesLoading={taskChangesLoading}
                    taskDiff={taskDiff}
                    taskDiffActionPath={taskDiffActionPath}
                    taskFilePair={taskFilePair}
                    taskFilePairActionPath={taskFilePairActionPath}
                    taskCommitFiles={taskCommitFiles}
                    taskCommitFilesActionSha={taskCommitFilesActionSha}
                    taskCommitPatch={taskCommitPatch}
                    taskCommitPatchActionKey={taskCommitPatchActionKey}
                    taskTreeishFile={taskTreeishFile}
                    taskTreeishFileActionKey={taskTreeishFileActionKey}
                    taskResources={taskResources}
                    taskResourcesLoading={taskResourcesLoading}
                    taskTerminalProductAccess={taskTerminalProductAccess}
                    taskGitCapabilities={taskGitCapabilities}
                    taskProductCapabilities={taskProductCapabilities}
                    taskCanReadResources={taskCanReadResources}
                    taskCanDelete={taskCanDelete}
                    taskCanStartTurn={taskCanStartTurn}
                    taskCanEnqueueQueuedTurn={taskCanEnqueueQueuedTurn}
                    taskCanInterrupt={taskCanInterrupt}
                    isLoading={isLoading}
                    isSubmitting={isSubmitting}
                    isOnline={isOnline}
                    agentControls={taskAgentControls}
                    loadImage={loadTaskImage}
                    snapshotPatches={taskSnapshotPatches}
                    snapshotPatchActionId={taskSnapshotPatchActionId}
                    onInputChange={onInputChange}
                    onCommandTypeChange={onCommandTypeChange}
                    onTitleChange={onTaskTitleChange}
                    onSaveTitle={onSaveTaskTitle}
                    onGenerateTitle={onGenerateTaskTitle}
                    onPrepareEnvironment={onPrepareTaskEnvironment}
                    onToggleClosed={onToggleTaskClosed}
                    onDeleteTask={onDeleteTask}
                    onCommentDraftChange={onCommentDraftChange}
                    onCreateComment={onCreateComment}
                    onStartEditComment={onStartEditComment}
                    onEditingCommentDraftChange={onEditingCommentDraftChange}
                    onSaveComment={onSaveComment}
                    onCancelEditComment={onCancelEditComment}
                    onDeleteComment={onDeleteComment}
                    onCancelQueuedTurn={onCancelQueuedTurn}
                    onReorderQueuedTurns={onReorderQueuedTurns}
                    onReviewInstructionsChange={onReviewInstructionsChange}
                    onStartReview={onStartReview}
                    onRefreshTaskGit={onRefreshTaskGit}
                    onReadTaskDiff={onReadTaskDiff}
                    onReadTaskFilePair={onReadTaskFilePair}
                    onReadTaskCommitFiles={onReadTaskCommitFiles}
                    onReadTaskCommitFilePatch={onReadTaskCommitFilePatch}
                    onReadTaskCommitFileAtTreeish={onReadTaskCommitFileAtTreeish}
                    onCommitTaskGit={onCommitTaskGit}
                    onRefreshTaskResources={onRefreshTaskResources}
                    onLoadSnapshotPatch={taskCanReadSnapshotPatch ? onLoadTaskSnapshotPatch : undefined}
                    onLoadSnapshotPatchSlice={taskCanReadSnapshotPatchSlice ? onLoadTaskSnapshotPatchSlice : undefined}
                    onSend={onSendTaskInput}
                    onAbort={onAbortTask}
                />
            )}
            {screen === "new_task" && (
                <NewTaskScreen
                    repos={visibleRepos}
                    repoId={newTaskRepoId}
                    mode={newTaskMode}
                    title={newTaskTitle}
                    prompt={newTaskPrompt}
                    isLoading={isLoading}
                    isSubmitting={isSubmitting}
                    isOnline={isOnline}
                    canCreateTask={newTaskCanCreate}
                    canStartTurn={newTaskCanStartTurn}
                    agentControls={newTaskAgentControls}
                    onRepoChange={onNewTaskRepoChange}
                    onModeChange={onNewTaskModeChange}
                    onTitleChange={onNewTaskTitleChange}
                    onPromptChange={onNewTaskPromptChange}
                    onCreate={onCreateTask}
                />
            )}
            {screen === "sessions" && (
                <OpenADESessionsScreen configs={configs} activeConfigId={activeConfigId} onSelect={onSelectHost} onRemove={onRemoveHost} onAdd={onAddHost} />
            )}
            {screen === "settings" && (
                <OpenADESettingsScreen
                    config={settingsConfig}
                    snapshot={snapshot}
                    status={status}
                    themeSetting={themeSetting}
                    canSelfRevoke={settingsCanSelfRevoke}
                    onRefresh={onRefresh}
                    onForget={onForget}
                    onSelfRevoke={onSelfRevoke}
                    onSessions={() => onNavigate("sessions")}
                    onAdd={onAddHost}
                    onThemeChange={onThemeChange}
                />
            )}
        </OpenADEChrome>
    )
}
