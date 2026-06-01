import { FolderOpen, MessageSquarePlus, Server, Settings } from "lucide-react"
import type {
    OpenADEProject,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectSearchResult,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitLogResult,
    OpenADETaskPreview,
} from "../../../openade-module/src"
import { OpenADEChrome, type OpenADEChromeNavItem, type OpenADEChromeStatus } from "./OpenADEChrome"
import { type OpenADESessionConfig, OpenADESessionsScreen, OpenADESettingsScreen, type OpenADEThemeSetting } from "./OpenADESessionScreens"
import { ProjectTasksScreen } from "./project/ProjectTasksScreen"
import { type ProjectSessionSummary, ProjectsScreen } from "./project/ProjectsScreen"
import { NewTaskScreen } from "./task/NewTaskScreen"
import type { TaskImageLoader } from "./task/TaskEventThread"
import type { OpenADETaskCommentView, TaskReviewType } from "./task/TaskProductPanel"
import { TaskScreen } from "./task/TaskScreen"
import type { TaskCommandType } from "./task/taskCommands"

export type OpenADEShellScreen = "projects" | "project" | "task" | "new_task" | "sessions" | "settings"

const openADENavItems: Array<OpenADEChromeNavItem<OpenADEShellScreen>> = [
    { screen: "projects", label: "Projects", icon: FolderOpen },
    { screen: "new_task", label: "New", icon: MessageSquarePlus },
    { screen: "sessions", label: "Sessions", icon: Server },
    { screen: "settings", label: "Settings", icon: Settings },
]

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
    projectSearchQuery,
    projectSearchResult,
    projectSearchLoading,
    projectProcesses,
    projectProcessesLoading,
    projectProcessActionId,
    projectProcessOutput,
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
    taskChangesLoading,
    taskDiff,
    taskDiffActionPath,
    newTaskRepoId,
    newTaskMode,
    newTaskTitle,
    newTaskPrompt,
    configs,
    activeConfigId,
    settingsConfig,
    snapshot,
    themeSetting,
    loadTaskImage,
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
    onProjectSearchQueryChange,
    onSearchProject,
    onInputChange,
    onCommandTypeChange,
    onTaskTitleChange,
    onSaveTaskTitle,
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
    onReviewInstructionsChange,
    onStartReview,
    onRefreshTaskGit,
    onReadTaskDiff,
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
    projectSearchQuery: string
    projectSearchResult: OpenADEProjectSearchResult | null
    projectSearchLoading: boolean
    projectProcesses: OpenADEProjectProcessListResult | null
    projectProcessesLoading: boolean
    projectProcessActionId: string | null
    projectProcessOutput: OpenADEProjectProcessReconnectResult | null
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
    taskChangesLoading: boolean
    taskDiff: OpenADETaskDiffReadResult | null
    taskDiffActionPath: string | null
    newTaskRepoId: string | null
    newTaskMode: TaskCommandType
    newTaskTitle: string
    newTaskPrompt: string
    configs: OpenADESessionConfig[]
    activeConfigId: string
    settingsConfig: OpenADESessionConfig
    snapshot: OpenADESnapshot | null
    themeSetting: OpenADEThemeSetting
    loadTaskImage?: TaskImageLoader
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
    onProjectSearchQueryChange: (value: string) => void
    onSearchProject: () => void
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: TaskCommandType) => void
    onTaskTitleChange: (value: string) => void
    onSaveTaskTitle: () => void
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
    onReviewInstructionsChange: (value: string) => void
    onStartReview: (reviewType: TaskReviewType) => void
    onRefreshTaskGit: () => void
    onReadTaskDiff: (file: OpenADETaskGitChangedFile) => void
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
            navItems={openADENavItems}
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
                    searchQuery={projectSearchQuery}
                    searchResult={projectSearchResult}
                    searchLoading={projectSearchLoading}
                    processes={projectProcesses}
                    processesLoading={projectProcessesLoading}
                    processActionId={projectProcessActionId}
                    processOutput={projectProcessOutput}
                    onSelectTask={onSelectTask}
                    onNewTask={onNewTask}
                    onRefreshProcesses={onRefreshProjectProcesses}
                    onStartProcess={onStartProjectProcess}
                    onReconnectProcess={onReconnectProjectProcess}
                    onStopProcess={onStopProjectProcess}
                    onRefreshFiles={onRefreshProjectFiles}
                    onReadFile={onReadProjectFile}
                    onSearchQueryChange={onProjectSearchQueryChange}
                    onSearch={onSearchProject}
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
                    taskChangesLoading={taskChangesLoading}
                    taskDiff={taskDiff}
                    taskDiffActionPath={taskDiffActionPath}
                    isLoading={isLoading}
                    isSubmitting={isSubmitting}
                    isOnline={isOnline}
                    loadImage={loadTaskImage}
                    onInputChange={onInputChange}
                    onCommandTypeChange={onCommandTypeChange}
                    onTitleChange={onTaskTitleChange}
                    onSaveTitle={onSaveTaskTitle}
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
                    onReviewInstructionsChange={onReviewInstructionsChange}
                    onStartReview={onStartReview}
                    onRefreshTaskGit={onRefreshTaskGit}
                    onReadTaskDiff={onReadTaskDiff}
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
