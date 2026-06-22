import { FolderOpen, MessageSquarePlus, Server, Settings } from "lucide-react"
import { useEffect, type ReactNode } from "react"
import type {
    OpenADECronDefinitionsReadResult,
    OpenADECronInstallStateReadResult,
    OpenADEIsolationStrategy,
    OpenADEMCPServer,
    OpenADEPersonalSettings,
    OpenADEProject,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadResult,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADERepoPathInspectResult,
    OpenADEProjectSearchResult,
    OpenADESnapshot,
    OpenADESnapshotPatchFile,
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogEntry,
    OpenADETaskGitLogResult,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryResult,
    OpenADETaskPreview,
    OpenADETaskResourceInventory,
} from "../../../openade-module/src"
import type { TaskTerminalProductAccess } from "../components/terminalSession"
import { OpenADEChrome, type OpenADEChromeNavItem, type OpenADEChromeStatus } from "./OpenADEChrome"
import {
    type OpenADESessionConfig,
    OpenADESessionsScreen,
    type OpenADESettingsProductState,
    OpenADESettingsScreen,
    type OpenADEThemeSetting,
} from "./OpenADESessionScreens"
import type { OpenADEShellCapabilities } from "./capabilities"
import { ProjectTasksScreen, type ProjectUpdateInput } from "./project/ProjectTasksScreen"
import { type ProjectSessionSummary, ProjectsScreen } from "./project/ProjectsScreen"
import { NewTaskScreen, type NewTaskDraftView, type NewTaskPendingCreationView } from "./task/NewTaskScreen"
import type { TaskComposerAgentControls, TaskComposerImageAttachment, TaskComposerRepeatState } from "./task/TaskComposer"
import type { TaskImageLoader, TaskSnapshotPatchView } from "./task/TaskEventThread"
import { TaskHyperPlanPicker, type TaskHyperPlanPresetId } from "./task/TaskHyperPlanPicker"
import type { OpenADETaskCommentView, TaskReviewType } from "./task/TaskProductPanel"
import { isolationStrategyForBranchCapability } from "./task/isolationStrategy"
import { TaskScreen } from "./task/TaskScreen"
import { canQueueTaskCommandWhileRunning, type TaskCommandType } from "./task/taskCommands"
import type { TaskSnapshotBlock } from "./task/taskEventPresentation"

export type OpenADEShellScreen = "projects" | "project" | "task" | "new_task" | "sessions" | "settings"
export type OpenADEShellSettingsProductData = Omit<OpenADESettingsProductState, "capabilities">
const emptyNewTaskDrafts: NewTaskDraftView[] = []
const emptyNewTaskPendingCreations: NewTaskPendingCreationView[] = []

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

export function openADEShellSettingsProductStateForCapabilities(
    productData: OpenADEShellSettingsProductData,
    settingsCapabilities: OpenADEShellCapabilities["settingsCapabilities"]
): OpenADESettingsProductState {
    const personalSettingsCanRead = settingsCapabilities.personalSettings.canRead
    const personalSettingsCanReplace = personalSettingsCanRead && settingsCapabilities.personalSettings.canReplace
    const mcpServersCanRead = settingsCapabilities.mcpServers.canRead
    const mcpServersCanMutate = mcpServersCanRead && (settingsCapabilities.mcpServers.canUpsert || settingsCapabilities.mcpServers.canDelete)

    return {
        capabilities: settingsCapabilities,
        personalSettings: personalSettingsCanRead ? productData.personalSettings : null,
        personalSettingsLoading: personalSettingsCanRead ? productData.personalSettingsLoading : false,
        personalSettingsActionLoading: personalSettingsCanReplace ? productData.personalSettingsActionLoading : false,
        mcpServers: mcpServersCanRead ? productData.mcpServers : [],
        mcpServersLoading: mcpServersCanRead ? productData.mcpServersLoading : false,
        mcpServerActionId: mcpServersCanMutate ? productData.mcpServerActionId : null,
    }
}

function openADEShellSnapshotPatchesForCapabilities({
    patches,
    canReadPatch,
    canReadSlice,
}: {
    patches?: Record<string, TaskSnapshotPatchView>
    canReadPatch: boolean
    canReadSlice: boolean
}): Record<string, TaskSnapshotPatchView> | undefined {
    if (!canReadPatch) return undefined
    if (canReadSlice) return patches
    if (!patches) return undefined
    return Object.fromEntries(Object.entries(patches).map(([id, patch]) => [id, { ...patch, slices: undefined }]))
}

function agentControlsWithMcpCapability(agentControls: TaskComposerAgentControls | undefined, canUseMcpControl: boolean): TaskComposerAgentControls | undefined {
    if (!agentControls || canUseMcpControl) return agentControls
    return { ...agentControls, mcpControl: undefined }
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
    shellCapabilities,
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
    projectCronDefinitions,
    projectCronInstallState,
    projectCronDefinitionsLoading,
    projectCronInstallStateLoading,
    projectCronInstallActionId,
    projectProcesses,
    projectProcessesLoading,
    projectProcessActionId,
    projectProcessOutput,
    projectActionLoading,
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
    taskAgentControls,
    taskHyperplanPresetId = "ensemble",
    taskImageAttachments,
    taskImageAttachLoading,
    taskRepeatState,
    taskComposerEditor,
    onFocusTaskInputShortcut,
    newTaskRepoId,
    newTaskMode,
    newTaskTitle,
    newTaskPrompt,
    newTaskIsolationStrategy,
    newTaskBranches,
    newTaskBranchesLoading,
    newTaskPreferredSourceBranch,
    newTaskAgentControls,
    newTaskHyperplanPresetId = "ensemble",
    newTaskImageAttachments,
    newTaskImageAttachLoading,
    newTaskComposerEditor,
    onFocusNewTaskInputShortcut,
    newTaskDrafts = emptyNewTaskDrafts,
    newTaskPendingCreations = emptyNewTaskPendingCreations,
    newTaskCanStashDraft = false,
    newTaskCanRestoreDraft = true,
    newTaskCreateMore = false,
    configs,
    activeConfigId,
    settingsConfig,
    settingsProductData,
    snapshot,
    themeSetting,
    loadTaskImage,
    taskSnapshotPatches,
    taskSnapshotPatchActionId,
    onBack,
    onRefresh,
    onNavigate,
    onToggleArchivedProjects,
    onSelectSession,
    onSelectProject,
    onCreateProject,
    onInspectProjectPath,
    onUpdateProject,
    onDeleteProject,
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
    onRefreshProjectCronInstallState,
    onSetProjectCronEnabled,
    onRunProjectCron,
    onInputChange,
    onCommandTypeChange,
    onAttachTaskImage,
    onRemoveTaskImage,
    onTaskTitleChange,
    onSaveTaskTitle,
    onGenerateTaskTitle,
    onPrepareTaskEnvironment,
    onToggleTaskClosed,
    onDeleteTask,
    onCancelPlan,
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
    onCommitAndPushTask,
    onStartTaskRepeat,
    onStopTaskRepeat,
    onRefreshTaskResources,
    onLoadTaskSnapshotPatch,
    onLoadTaskSnapshotPatchSlice,
    onSendTaskInput,
    onAbortTask,
    onRetryTask,
    onTaskHyperplanPresetChange,
    onNewTaskRepoChange,
    onNewTaskModeChange,
    onNewTaskTitleChange,
    onNewTaskPromptChange,
    onNewTaskIsolationStrategyChange,
    onRefreshNewTaskBranches,
    onNewTaskHyperplanPresetChange,
    onStashNewTaskDraft,
    onRestoreNewTaskDraft,
    onDeleteNewTaskDraft,
    onRetryNewTaskPendingCreation,
    onOpenNewTaskPendingCreation,
    onCancelNewTaskPendingCreation,
    onDismissNewTaskPendingCreation,
    onNewTaskCreateMoreChange,
    onAttachNewTaskImage,
    onRemoveNewTaskImage,
    onCreateTask,
    onSelectHost,
    onRemoveHost,
    onForget,
    onSelfRevoke,
    onThemeChange,
    onPersonalSettingsChange,
    onMcpServerChange,
    onMcpServerDelete,
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
    shellCapabilities: OpenADEShellCapabilities
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
    projectCronDefinitions: OpenADECronDefinitionsReadResult | null
    projectCronInstallState: OpenADECronInstallStateReadResult | null
    projectCronDefinitionsLoading: boolean
    projectCronInstallStateLoading: boolean
    projectCronInstallActionId: string | null
    projectProcesses: OpenADEProjectProcessListResult | null
    projectProcessesLoading: boolean
    projectProcessActionId: string | null
    projectProcessOutput: OpenADEProjectProcessReconnectResult | null
    projectActionLoading: boolean
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
    taskAgentControls?: TaskComposerAgentControls
    taskHyperplanPresetId?: TaskHyperPlanPresetId
    taskImageAttachments?: TaskComposerImageAttachment[]
    taskImageAttachLoading?: boolean
    taskRepeatState?: TaskComposerRepeatState
    taskComposerEditor?: ReactNode
    onFocusTaskInputShortcut?: () => void
    newTaskRepoId: string | null
    newTaskMode: TaskCommandType
    newTaskTitle: string
    newTaskPrompt: string
    newTaskIsolationStrategy: OpenADEIsolationStrategy
    newTaskBranches: OpenADEProjectGitBranchesReadResult | null
    newTaskBranchesLoading: boolean
    newTaskPreferredSourceBranch?: string | null
    newTaskAgentControls?: TaskComposerAgentControls
    newTaskHyperplanPresetId?: TaskHyperPlanPresetId
    newTaskImageAttachments?: TaskComposerImageAttachment[]
    newTaskImageAttachLoading?: boolean
    newTaskComposerEditor?: ReactNode
    onFocusNewTaskInputShortcut?: () => void
    newTaskDrafts?: NewTaskDraftView[]
    newTaskPendingCreations?: NewTaskPendingCreationView[]
    newTaskCanStashDraft?: boolean
    newTaskCanRestoreDraft?: boolean
    newTaskCreateMore?: boolean
    configs: OpenADESessionConfig[]
    activeConfigId: string
    settingsConfig: OpenADESessionConfig
    settingsProductData: OpenADEShellSettingsProductData
    snapshot: OpenADESnapshot | null
    themeSetting: OpenADEThemeSetting
    loadTaskImage?: TaskImageLoader
    taskSnapshotPatches?: Record<string, TaskSnapshotPatchView>
    taskSnapshotPatchActionId?: string | null
    onBack: () => void
    onRefresh: () => void
    onNavigate: (screen: OpenADEShellScreen) => void
    onToggleArchivedProjects: () => void
    onSelectSession: (configId: string) => void
    onSelectProject?: (configId: string, repoId: string) => void
    onCreateProject?: (project: { name: string; path: string }) => Promise<boolean> | boolean
    onInspectProjectPath?: (path: string) => Promise<OpenADERepoPathInspectResult | null> | OpenADERepoPathInspectResult | null
    onUpdateProject?: (project: ProjectUpdateInput) => Promise<boolean> | boolean
    onDeleteProject?: (repoId: string) => Promise<boolean> | boolean
    onAddHost: () => void
    onSelectTask?: (taskId: string) => void
    onNewTask?: () => void
    onRefreshProjectProcesses?: () => void
    onStartProjectProcess?: (definitionId: string) => void
    onReconnectProjectProcess?: (processId: string) => void
    onStopProjectProcess?: (processId: string) => void
    onRefreshProjectFiles?: () => void
    onReadProjectFile?: (path: string) => void
    onProjectFileSearchQueryChange: (value: string) => void
    onSearchProjectFiles?: () => void
    onWriteProjectFile?: (path: string, content: string) => void
    onProjectSearchQueryChange: (value: string) => void
    onSearchProject?: () => void
    onRefreshProjectGit?: () => void
    onRefreshProjectCronDefinitions?: () => void
    onRefreshProjectCronInstallState?: () => void
    onSetProjectCronEnabled?: (cronId: string, enabled: boolean) => void
    onRunProjectCron?: (cronId: string) => void
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: TaskCommandType) => void
    onAttachTaskImage?: (file: File) => void
    onRemoveTaskImage?: (imageId: string) => void
    onTaskTitleChange: (value: string) => void
    onSaveTaskTitle?: () => void
    onGenerateTaskTitle?: () => void
    onPrepareTaskEnvironment?: () => void
    onToggleTaskClosed?: () => void
    onDeleteTask?: () => void
    onCancelPlan?: (planEventId: string) => void
    onCommentDraftChange: (value: string) => void
    onCreateComment?: () => void
    onStartEditComment?: (comment: OpenADETaskCommentView) => void
    onEditingCommentDraftChange: (value: string) => void
    onSaveComment?: (commentId: string) => void
    onCancelEditComment: () => void
    onDeleteComment?: (commentId: string) => void
    onCancelQueuedTurn?: (queuedTurnId: string) => void
    onReorderQueuedTurns?: (queuedTurnIds: string[]) => void
    onReviewInstructionsChange: (value: string) => void
    onStartReview?: (reviewType: TaskReviewType) => void
    onRefreshTaskGit?: () => void
    onReadTaskDiff?: (file: OpenADETaskGitChangedFile) => void
    onReadTaskFilePair?: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFiles?: (commit: OpenADETaskGitLogEntry) => void
    onReadTaskCommitFilePatch?: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFileAtTreeish?: (file: OpenADETaskGitChangedFile) => void
    onCommitTaskGit?: (message: string) => void
    onCommitAndPushTask?: () => void
    onStartTaskRepeat?: () => void
    onStopTaskRepeat?: () => void
    onRefreshTaskResources?: () => void
    onLoadTaskSnapshotPatch?: (block: TaskSnapshotBlock) => void
    onLoadTaskSnapshotPatchSlice?: (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => void
    onSendTaskInput?: () => void
    onAbortTask?: () => void
    onRetryTask?: () => void
    onTaskHyperplanPresetChange?: (value: TaskHyperPlanPresetId) => void
    onNewTaskRepoChange: (repoId: string) => void
    onNewTaskModeChange: (value: TaskCommandType) => void
    onNewTaskTitleChange: (value: string) => void
    onNewTaskPromptChange: (value: string) => void
    onNewTaskIsolationStrategyChange: (strategy: OpenADEIsolationStrategy) => void
    onRefreshNewTaskBranches?: () => void
    onNewTaskHyperplanPresetChange?: (value: TaskHyperPlanPresetId) => void
    onStashNewTaskDraft?: () => void
    onRestoreNewTaskDraft?: (draftId: string) => void
    onDeleteNewTaskDraft?: (draftId: string) => void
    onRetryNewTaskPendingCreation?: (creationId: string) => void
    onOpenNewTaskPendingCreation?: (creationId: string) => void
    onCancelNewTaskPendingCreation?: (creationId: string) => void
    onDismissNewTaskPendingCreation?: (creationId: string) => void
    onNewTaskCreateMoreChange?: (value: boolean) => void
    onAttachNewTaskImage?: (file: File) => void
    onRemoveNewTaskImage?: (imageId: string) => void
    onCreateTask?: (mode?: TaskCommandType) => void
    onSelectHost: (configId: string) => void
    onRemoveHost: (configId: string) => void
    onForget: () => void
    onSelfRevoke?: () => void
    onThemeChange: (value: OpenADEThemeSetting) => void
    onPersonalSettingsChange?: (settings: OpenADEPersonalSettings) => void
    onMcpServerChange?: (server: OpenADEMCPServer) => void
    onMcpServerDelete?: (serverId: string) => void
}) {
    const {
        projectDirectoryCapabilities,
        projectRecordCapabilities,
        projectGitCapabilities,
        projectCronCapabilities,
        projectFileCapabilities,
        projectSearchCapabilities,
        projectProcessCapabilities,
        taskGitCapabilities,
        taskCanCommitGit,
        taskTerminalCapabilities,
        taskDirectoryCapabilities,
        taskRecordCapabilities,
        taskTurnCapabilities,
        taskReviewCapabilities,
        taskCommentCapabilities,
        queuedTurnCapabilities,
        taskResourceCapabilities,
        taskImageCapabilities,
        taskSnapshotPatchCapabilities,
        settingsCapabilities,
    } = shellCapabilities
    const taskReadGranted = taskDirectoryCapabilities.canRead
    const newTaskCreateGranted = taskRecordCapabilities.canCreate
    const taskDeleteGranted = taskReadGranted && taskRecordCapabilities.canDelete
    const taskMetadataGranted = taskReadGranted && taskRecordCapabilities.canUpdateMetadata
    const taskTitleGenerateGranted = taskReadGranted && taskRecordCapabilities.canGenerateTitle
    const taskEnvironmentPrepareGranted = taskReadGranted && taskRecordCapabilities.canPrepareEnvironment
    const turnStartGranted = taskReadGranted && taskTurnCapabilities.canStart
    const queuedTurnEnqueueGranted = taskReadGranted && taskTurnCapabilities.canEnqueue
    const taskInterruptGranted = taskReadGranted && taskTurnCapabilities.canInterrupt
    const taskReviewStartGranted = taskReadGranted && taskReviewCapabilities.canStart
    const taskCommentCreateGranted = taskReadGranted && taskCommentCapabilities.canCreate
    const taskCommentEditGranted = taskReadGranted && taskCommentCapabilities.canEdit
    const taskCommentDeleteGranted = taskReadGranted && taskCommentCapabilities.canDelete
    const queuedTurnCancelGranted = taskReadGranted && queuedTurnCapabilities.canCancel
    const queuedTurnReorderGranted = taskReadGranted && queuedTurnCapabilities.canReorder
    const projectCanReadSnapshot = projectDirectoryCapabilities.canReadSnapshot
    const projectCanReadProjects = projectDirectoryCapabilities.canReadProjects
    const projectCanCreate = projectRecordCapabilities.canCreate
    const projectCanInspectPath = projectRecordCapabilities.canInspectPath
    const projectCanUpdate = projectRecordCapabilities.canUpdate
    const projectCanDelete = projectRecordCapabilities.canDelete
    const newTaskCanReadBranches = projectGitCapabilities.canReadBranches
    const personalSettingsCapabilities = settingsCapabilities.personalSettings
    const mcpServerCapabilities = settingsCapabilities.mcpServers
    const settingsCanReplacePersonal = personalSettingsCapabilities.canRead && personalSettingsCapabilities.canReplace
    const settingsCanUpsertMcpServer = mcpServerCapabilities.canRead && mcpServerCapabilities.canUpsert
    const settingsCanDeleteMcpServer = mcpServerCapabilities.canRead && mcpServerCapabilities.canDelete
    const canReadProjectDirectory = projectCanReadSnapshot || projectCanReadProjects
    const newTaskCanStartTurn = turnStartGranted && Boolean(onCreateTask)
    const visibleReposForCapabilities = canReadProjectDirectory ? visibleRepos : []
    const selectedRepoForCapabilities = canReadProjectDirectory ? selectedRepo : null
    const selectedTaskForCapabilities = canReadProjectDirectory ? selectedTask : null
    const snapshotForCapabilities = canReadProjectDirectory ? snapshot : null
    const sessionsForCapabilities = canReadProjectDirectory ? sessions : sessions.map((session) => ({ ...session, snapshot: null }))
    const workingTaskIdsForCapabilities = canReadProjectDirectory ? workingTaskIds : []
    const canOpenNewTask = newTaskCreateGranted && canReadProjectDirectory && Boolean(onCreateTask)
    const selectedTaskIsRunning = Boolean(selectedTaskForCapabilities && workingTaskIdsForCapabilities.includes(selectedTaskForCapabilities.id))
    const taskCanSubmitAnyInput = Boolean(onSendTaskInput) && (turnStartGranted || queuedTurnEnqueueGranted)
    const taskCanSubmitCurrentMode =
        Boolean(onSendTaskInput) &&
        (selectedTaskIsRunning ? queuedTurnEnqueueGranted && canQueueTaskCommandWhileRunning(commandType) : turnStartGranted)
    const taskCanAttachUploadedImages = taskImageCapabilities.canWrite && taskCanSubmitCurrentMode && Boolean(onAttachTaskImage)
    const newTaskCanAttachUploadedImages = taskImageCapabilities.canWrite && newTaskCanStartTurn && Boolean(onAttachNewTaskImage)
    const taskImageLoader = taskImageCapabilities.canRead ? loadTaskImage : undefined
    const canReadAnyProjectGit = projectGitCapabilities.canReadInfo || projectGitCapabilities.canReadBranches || projectGitCapabilities.canReadSummary
    const canReadAnyTaskGit =
        taskGitCapabilities.canReadChanges || taskGitCapabilities.canReadLog || taskGitCapabilities.canReadSummary || taskGitCapabilities.canReadScopes
    const visibleProjectFiles = projectFileCapabilities.canList ? projectFiles : null
    const visibleProjectFilesLoading = projectFileCapabilities.canList ? projectFilesLoading : false
    const visibleProjectFileRead = projectFileCapabilities.canRead ? projectFileRead : null
    const visibleProjectFileActionPath = projectFileCapabilities.canRead ? projectFileActionPath : null
    const visibleProjectFileSearchResult = projectFileCapabilities.canSearch ? projectFileSearchResult : null
    const visibleProjectFileSearchLoading = projectFileCapabilities.canSearch ? projectFileSearchLoading : false
    const visibleProjectSearchResult = projectSearchCapabilities.canSearch ? projectSearchResult : null
    const visibleProjectSearchLoading = projectSearchCapabilities.canSearch ? projectSearchLoading : false
    const visibleProjectGitInfo = projectGitCapabilities.canReadInfo ? projectGitInfo : null
    const visibleProjectGitBranches = projectGitCapabilities.canReadBranches ? projectGitBranches : null
    const visibleProjectGitSummary = projectGitCapabilities.canReadSummary ? projectGitSummary : null
    const visibleProjectGitLoading = canReadAnyProjectGit ? projectGitLoading : false
    const visibleProjectCronDefinitions = projectCronCapabilities.canRead ? projectCronDefinitions : null
    const visibleProjectCronDefinitionsLoading = projectCronCapabilities.canRead ? projectCronDefinitionsLoading : false
    const visibleProjectCronInstallState = projectCronCapabilities.canReadInstallState ? projectCronInstallState : null
    const visibleProjectCronInstallStateLoading = projectCronCapabilities.canReadInstallState ? projectCronInstallStateLoading : false
    const visibleProjectCronInstallActionId =
        (projectCronCapabilities.canRead && projectCronCapabilities.canRun) ||
        (projectCronCapabilities.canReadInstallState && projectCronCapabilities.canReplaceInstallState)
            ? projectCronInstallActionId
            : null
    const visibleProjectProcesses = projectProcessCapabilities.canRead ? projectProcesses : null
    const visibleProjectProcessesLoading = projectProcessCapabilities.canRead ? projectProcessesLoading : false
    const visibleProjectProcessActionId =
        projectProcessCapabilities.canRead &&
        (projectProcessCapabilities.canStart || projectProcessCapabilities.canReconnect || projectProcessCapabilities.canStop)
            ? projectProcessActionId
            : null
    const visibleProjectProcessOutput = projectProcessCapabilities.canRead && projectProcessCapabilities.canReconnect ? projectProcessOutput : null
    const visibleProjectActionLoading = projectCanUpdate || projectCanDelete ? projectActionLoading : false
    const visibleTaskChanges = taskGitCapabilities.canReadChanges ? taskChanges : null
    const visibleTaskGitLog = taskGitCapabilities.canReadLog ? taskGitLog : null
    const visibleTaskGitSummary = taskGitCapabilities.canReadSummary ? taskGitSummary : null
    const visibleTaskGitScopes = taskGitCapabilities.canReadScopes ? taskGitScopes : null
    const visibleTaskChangesLoading = canReadAnyTaskGit ? taskChangesLoading : false
    const visibleTaskDiff = taskGitCapabilities.canReadDiff ? taskDiff : null
    const visibleTaskDiffActionPath = taskGitCapabilities.canReadDiff ? taskDiffActionPath : null
    const visibleTaskFilePair = taskGitCapabilities.canReadFilePair ? taskFilePair : null
    const visibleTaskFilePairActionPath = taskGitCapabilities.canReadFilePair ? taskFilePairActionPath : null
    const visibleTaskCommitFiles = taskGitCapabilities.canReadCommitFiles ? taskCommitFiles : null
    const visibleTaskCommitFilesActionSha = taskGitCapabilities.canReadCommitFiles ? taskCommitFilesActionSha : null
    const visibleTaskCommitPatch = taskGitCapabilities.canReadCommitFilePatch ? taskCommitPatch : null
    const visibleTaskCommitPatchActionKey = taskGitCapabilities.canReadCommitFilePatch ? taskCommitPatchActionKey : null
    const visibleTaskTreeishFile = taskGitCapabilities.canReadFileAtTreeish ? taskTreeishFile : null
    const visibleTaskTreeishFileActionKey = taskGitCapabilities.canReadFileAtTreeish ? taskTreeishFileActionKey : null
    const visibleTaskResources = taskResourceCapabilities.canRead ? taskResources : null
    const visibleTaskResourcesLoading = taskResourceCapabilities.canRead ? taskResourcesLoading : false
    const newTaskCanLoadBranches = newTaskCanReadBranches && Boolean(onRefreshNewTaskBranches)
    const newTaskVisibleBranches = newTaskCanLoadBranches ? newTaskBranches : null
    const newTaskVisibleBranchesLoading = newTaskCanLoadBranches ? newTaskBranchesLoading : false
    const newTaskVisibleIsolationStrategy = isolationStrategyForBranchCapability(newTaskIsolationStrategy, newTaskCanLoadBranches)
    const visibleNewTaskTitle = canOpenNewTask ? newTaskTitle : ""
    const visibleNewTaskPrompt = canOpenNewTask ? newTaskPrompt : ""
    const visibleNewTaskMode = canOpenNewTask ? newTaskMode : "do"
    const visibleTaskInput = taskCanSubmitAnyInput ? input : ""
    const visibleTaskCommandType = taskCanSubmitAnyInput ? commandType : "do"
    const taskVisibleSnapshotPatches = openADEShellSnapshotPatchesForCapabilities({
        patches: taskSnapshotPatches,
        canReadPatch: taskSnapshotPatchCapabilities.canRead,
        canReadSlice: taskSnapshotPatchCapabilities.canReadSlice,
    })
    const taskTerminalAccessCapabilities =
        taskTerminalProductAccess === null
            ? null
            : {
                  canStart: taskTerminalProductAccess.capabilities.canStart && taskTerminalCapabilities.canStart,
                  canReconnect: taskTerminalProductAccess.capabilities.canReconnect && taskTerminalCapabilities.canReconnect,
                  canWrite: taskTerminalProductAccess.capabilities.canWrite && taskTerminalCapabilities.canWrite,
                  canResize: taskTerminalProductAccess.capabilities.canResize && taskTerminalCapabilities.canResize,
                  canStop: taskTerminalProductAccess.capabilities.canStop && taskTerminalCapabilities.canStop,
              }
    const taskTerminalAccess =
        taskTerminalProductAccess && taskTerminalAccessCapabilities && (taskTerminalAccessCapabilities.canStart || taskTerminalAccessCapabilities.canReconnect)
            ? { ...taskTerminalProductAccess, capabilities: taskTerminalAccessCapabilities }
            : null
    const effectiveScreen: OpenADEShellScreen =
        (screen === "task" && !taskReadGranted) || (screen === "new_task" && !canOpenNewTask) || (screen === "project" && !canReadProjectDirectory)
            ? selectedRepoForCapabilities
                ? "project"
                : "projects"
            : screen
    const settingsProductState = openADEShellSettingsProductStateForCapabilities(settingsProductData, settingsCapabilities)

    const taskHyperplanPrimaryAgent =
        taskAgentControls?.harnessId && taskAgentControls.selectedModel
            ? { harnessId: taskAgentControls.harnessId, modelId: taskAgentControls.selectedModel }
            : undefined
    const taskCanSubmitHyperplan = selectedTaskIsRunning ? queuedTurnEnqueueGranted : turnStartGranted
    const taskAgentControlsForCapabilities = agentControlsWithMcpCapability(
        taskAgentControls,
        mcpServerCapabilities.canRead && taskMetadataGranted
    )
    const newTaskAgentControlsForCapabilities = agentControlsWithMcpCapability(newTaskAgentControls, mcpServerCapabilities.canRead && newTaskCreateGranted)
    const taskHyperplanControl = taskCanSubmitHyperplan ? (
        <TaskHyperPlanPicker
            value={taskHyperplanPresetId}
            primaryAgent={taskHyperplanPrimaryAgent}
            disabled={isSubmitting}
            onChange={onTaskHyperplanPresetChange}
        />
    ) : undefined
    const visibleTaskTitleDraft = taskMetadataGranted ? taskTitleDraft : (task?.title ?? "")
    const visibleCommentDraft = taskCommentCreateGranted ? commentDraft : ""
    const visibleReviewInstructions = taskReviewStartGranted ? reviewInstructions : ""

    useEffect(() => {
        if (!taskMetadataGranted && task && taskTitleDraft !== task.title) onTaskTitleChange(task.title)
    }, [onTaskTitleChange, task, taskMetadataGranted, taskTitleDraft])

    useEffect(() => {
        if (!taskCommentCreateGranted && commentDraft) onCommentDraftChange("")
    }, [commentDraft, onCommentDraftChange, taskCommentCreateGranted])

    useEffect(() => {
        if (!taskReviewStartGranted && reviewInstructions) onReviewInstructionsChange("")
    }, [onReviewInstructionsChange, reviewInstructions, taskReviewStartGranted])

    useEffect(() => {
        if (taskCanSubmitAnyInput) return
        if (input) onInputChange("")
        if (commandType !== "do") onCommandTypeChange("do")
        if (taskHyperplanPresetId !== "ensemble") onTaskHyperplanPresetChange?.("ensemble")
    }, [commandType, input, onCommandTypeChange, onInputChange, onTaskHyperplanPresetChange, taskCanSubmitAnyInput, taskHyperplanPresetId])

    useEffect(() => {
        if (canOpenNewTask) {
            if (!newTaskCanLoadBranches && newTaskIsolationStrategy.type !== "head") onNewTaskIsolationStrategyChange({ type: "head" })
            return
        }
        if (newTaskTitle) onNewTaskTitleChange("")
        if (newTaskPrompt) onNewTaskPromptChange("")
        if (newTaskMode !== "do") onNewTaskModeChange("do")
        if (newTaskIsolationStrategy.type !== "head") onNewTaskIsolationStrategyChange({ type: "head" })
        if (newTaskHyperplanPresetId !== "ensemble") onNewTaskHyperplanPresetChange?.("ensemble")
    }, [
        canOpenNewTask,
        newTaskCanLoadBranches,
        newTaskHyperplanPresetId,
        newTaskIsolationStrategy,
        newTaskMode,
        newTaskPrompt,
        newTaskTitle,
        onNewTaskHyperplanPresetChange,
        onNewTaskIsolationStrategyChange,
        onNewTaskModeChange,
        onNewTaskPromptChange,
        onNewTaskTitleChange,
    ])

    return (
        <OpenADEChrome
            className={className}
            title={openADEShellTitle(effectiveScreen, selectedRepoForCapabilities, selectedTaskForCapabilities)}
            host={host}
            status={status}
            showBack={
                effectiveScreen === "project" ||
                effectiveScreen === "task" ||
                effectiveScreen === "new_task" ||
                effectiveScreen === "sessions" ||
                effectiveScreen === "settings"
            }
            isLoading={isLoading}
            error={error}
            notice={notice}
            connectionWarning={connectionWarning}
            activeNav={effectiveScreen === "project" ? "projects" : effectiveScreen}
            navItems={openADEShellNavItems(canOpenNewTask)}
            onBack={onBack}
            onRefresh={onRefresh}
            onNavigate={onNavigate}
        >
            {effectiveScreen === "projects" && (
                <ProjectsScreen
                    sessions={sessionsForCapabilities}
                    showArchived={showArchivedProjects}
                    createProjectLoading={isSubmitting}
                    onToggleArchived={onToggleArchivedProjects}
                    onSelectSession={onSelectSession}
                    onSelectProject={canReadProjectDirectory ? onSelectProject : undefined}
                    onCreateProject={projectCanCreate ? onCreateProject : undefined}
                    onInspectProjectPath={projectCanInspectPath ? onInspectProjectPath : undefined}
                    onAddSession={onAddHost}
                />
            )}
            {effectiveScreen === "project" && (
                <ProjectTasksScreen
                    repo={selectedRepoForCapabilities}
                    workingTaskIds={workingTaskIdsForCapabilities}
                    files={visibleProjectFiles}
                    filesLoading={visibleProjectFilesLoading}
                    fileRead={visibleProjectFileRead}
                    fileActionPath={visibleProjectFileActionPath}
                    fileSearchQuery={projectFileSearchQuery}
                    fileSearchResult={visibleProjectFileSearchResult}
                    fileSearchLoading={visibleProjectFileSearchLoading}
                    searchQuery={projectSearchQuery}
                    searchResult={visibleProjectSearchResult}
                    searchLoading={visibleProjectSearchLoading}
                    gitInfo={visibleProjectGitInfo}
                    gitBranches={visibleProjectGitBranches}
                    gitSummary={visibleProjectGitSummary}
                    gitLoading={visibleProjectGitLoading}
                    gitCapabilities={projectGitCapabilities}
                    cronDefinitions={visibleProjectCronDefinitions}
                    cronInstallState={visibleProjectCronInstallState}
                    cronDefinitionsLoading={visibleProjectCronDefinitionsLoading}
                    cronInstallStateLoading={visibleProjectCronInstallStateLoading}
                    cronInstallActionId={visibleProjectCronInstallActionId}
                    cronCapabilities={projectCronCapabilities}
                    processes={visibleProjectProcesses}
                    processesLoading={visibleProjectProcessesLoading}
                    processActionId={visibleProjectProcessActionId}
                    processOutput={visibleProjectProcessOutput}
                    fileCapabilities={projectFileCapabilities}
                    searchCapabilities={projectSearchCapabilities}
                    processCapabilities={projectProcessCapabilities}
                    projectActionLoading={visibleProjectActionLoading}
                    onUpdateProject={projectCanUpdate ? onUpdateProject : undefined}
                    onDeleteProject={projectCanDelete ? onDeleteProject : undefined}
                    onSelectTask={taskReadGranted ? onSelectTask : undefined}
                    onNewTask={canOpenNewTask ? onNewTask : undefined}
                    onRefreshProcesses={projectProcessCapabilities.canRead ? onRefreshProjectProcesses : undefined}
                    onStartProcess={projectProcessCapabilities.canRead && projectProcessCapabilities.canStart ? onStartProjectProcess : undefined}
                    onReconnectProcess={projectProcessCapabilities.canRead && projectProcessCapabilities.canReconnect ? onReconnectProjectProcess : undefined}
                    onStopProcess={projectProcessCapabilities.canRead && projectProcessCapabilities.canStop ? onStopProjectProcess : undefined}
                    onRefreshFiles={projectFileCapabilities.canList ? onRefreshProjectFiles : undefined}
                    onReadFile={projectFileCapabilities.canRead ? onReadProjectFile : undefined}
                    onFileSearchQueryChange={onProjectFileSearchQueryChange}
                    onSearchFiles={projectFileCapabilities.canSearch ? onSearchProjectFiles : undefined}
                    onWriteFile={projectFileCapabilities.canRead && projectFileCapabilities.canWrite ? onWriteProjectFile : undefined}
                    onSearchQueryChange={onProjectSearchQueryChange}
                    onSearch={projectSearchCapabilities.canSearch ? onSearchProject : undefined}
                    onRefreshGit={canReadAnyProjectGit ? onRefreshProjectGit : undefined}
                    onRefreshCronDefinitions={projectCronCapabilities.canRead ? onRefreshProjectCronDefinitions : undefined}
                    onRefreshCronInstallState={projectCronCapabilities.canReadInstallState ? onRefreshProjectCronInstallState : undefined}
                    onSetCronEnabled={
                        projectCronCapabilities.canReadInstallState && projectCronCapabilities.canReplaceInstallState ? onSetProjectCronEnabled : undefined
                    }
                    onRunCron={projectCronCapabilities.canRead && projectCronCapabilities.canRun ? onRunProjectCron : undefined}
                />
            )}
            {effectiveScreen === "task" && (
                <TaskScreen
                    task={task}
                    preview={selectedTaskForCapabilities}
                    isRunning={Boolean(selectedTaskForCapabilities && workingTaskIdsForCapabilities.includes(selectedTaskForCapabilities.id))}
                    input={visibleTaskInput}
                    commandType={visibleTaskCommandType}
                    titleDraft={visibleTaskTitleDraft}
                    commentDraft={visibleCommentDraft}
                    editingCommentId={editingCommentId}
                    editingCommentDraft={editingCommentDraft}
                    reviewInstructions={visibleReviewInstructions}
                    taskChanges={visibleTaskChanges}
                    taskGitLog={visibleTaskGitLog}
                    taskGitSummary={visibleTaskGitSummary}
                    taskGitScopes={visibleTaskGitScopes}
                    taskChangesLoading={visibleTaskChangesLoading}
                    taskDiff={visibleTaskDiff}
                    taskDiffActionPath={visibleTaskDiffActionPath}
                    taskFilePair={visibleTaskFilePair}
                    taskFilePairActionPath={visibleTaskFilePairActionPath}
                    taskCommitFiles={visibleTaskCommitFiles}
                    taskCommitFilesActionSha={visibleTaskCommitFilesActionSha}
                    taskCommitPatch={visibleTaskCommitPatch}
                    taskCommitPatchActionKey={visibleTaskCommitPatchActionKey}
                    taskTreeishFile={visibleTaskTreeishFile}
                    taskTreeishFileActionKey={visibleTaskTreeishFileActionKey}
                    taskResources={visibleTaskResources}
                    taskResourcesLoading={visibleTaskResourcesLoading}
                    taskTerminalProductAccess={taskTerminalAccess}
                    taskGitCapabilities={taskGitCapabilities}
                    taskTurnCapabilities={{
                        canStart: turnStartGranted && Boolean(onSendTaskInput),
                        canEnqueue: queuedTurnEnqueueGranted && Boolean(onSendTaskInput),
                        canInterrupt: taskInterruptGranted && Boolean(onAbortTask),
                    }}
                    isLoading={isLoading}
                    isSubmitting={isSubmitting}
                    isOnline={isOnline}
                    agentControls={taskAgentControlsForCapabilities}
                    hyperplanControl={taskHyperplanControl}
                    imageAttachments={taskImageAttachments}
                    imageAttachLoading={taskImageAttachLoading}
                    repeatState={taskRepeatState}
                    editor={taskComposerEditor}
                    onFocusInputShortcut={onFocusTaskInputShortcut}
                    loadImage={taskImageLoader}
                    snapshotPatches={taskVisibleSnapshotPatches}
                    snapshotPatchActionId={taskSnapshotPatchCapabilities.canRead ? taskSnapshotPatchActionId : null}
                    onInputChange={onInputChange}
                    onCommandTypeChange={onCommandTypeChange}
                    onAttachImage={taskCanAttachUploadedImages ? onAttachTaskImage : undefined}
                    onRemoveImage={taskCanAttachUploadedImages ? onRemoveTaskImage : undefined}
                    onTitleChange={taskMetadataGranted ? onTaskTitleChange : undefined}
                    onSaveTitle={taskMetadataGranted ? onSaveTaskTitle : undefined}
                    onGenerateTitle={taskTitleGenerateGranted ? onGenerateTaskTitle : undefined}
                    onPrepareEnvironment={taskEnvironmentPrepareGranted ? onPrepareTaskEnvironment : undefined}
                    onToggleClosed={taskMetadataGranted ? onToggleTaskClosed : undefined}
                    onDeleteTask={taskDeleteGranted ? onDeleteTask : undefined}
                    onCancelPlan={taskMetadataGranted ? onCancelPlan : undefined}
                    onCommentDraftChange={taskCommentCreateGranted ? onCommentDraftChange : undefined}
                    onCreateComment={taskCommentCreateGranted ? onCreateComment : undefined}
                    onStartEditComment={taskCommentEditGranted ? onStartEditComment : undefined}
                    onEditingCommentDraftChange={onEditingCommentDraftChange}
                    onSaveComment={taskCommentEditGranted ? onSaveComment : undefined}
                    onCancelEditComment={onCancelEditComment}
                    onDeleteComment={taskCommentDeleteGranted ? onDeleteComment : undefined}
                    onCancelQueuedTurn={queuedTurnCancelGranted ? onCancelQueuedTurn : undefined}
                    onReorderQueuedTurns={queuedTurnReorderGranted ? onReorderQueuedTurns : undefined}
                    onReviewInstructionsChange={taskReviewStartGranted ? onReviewInstructionsChange : undefined}
                    onStartReview={taskReviewStartGranted ? onStartReview : undefined}
                    onRefreshTaskGit={canReadAnyTaskGit ? onRefreshTaskGit : undefined}
                    onReadTaskDiff={taskGitCapabilities.canReadDiff ? onReadTaskDiff : undefined}
                    onReadTaskFilePair={taskGitCapabilities.canReadFilePair ? onReadTaskFilePair : undefined}
                    onReadTaskCommitFiles={taskGitCapabilities.canReadCommitFiles ? onReadTaskCommitFiles : undefined}
                    onReadTaskCommitFilePatch={taskGitCapabilities.canReadCommitFilePatch ? onReadTaskCommitFilePatch : undefined}
                    onReadTaskCommitFileAtTreeish={taskGitCapabilities.canReadFileAtTreeish ? onReadTaskCommitFileAtTreeish : undefined}
                    onCommitTaskGit={taskCanCommitGit ? onCommitTaskGit : undefined}
                    onCommitAndPush={turnStartGranted && !selectedTaskIsRunning ? onCommitAndPushTask : undefined}
                    onStartRepeat={turnStartGranted && !selectedTaskIsRunning ? onStartTaskRepeat : undefined}
                    onStopRepeat={onStopTaskRepeat}
                    onRefreshTaskResources={taskResourceCapabilities.canRead ? onRefreshTaskResources : undefined}
                    onLoadSnapshotPatch={taskSnapshotPatchCapabilities.canRead ? onLoadTaskSnapshotPatch : undefined}
                    onLoadSnapshotPatchSlice={taskSnapshotPatchCapabilities.canReadSlice ? onLoadTaskSnapshotPatchSlice : undefined}
                    onSend={taskCanSubmitCurrentMode ? onSendTaskInput : undefined}
                    onAbort={taskInterruptGranted ? onAbortTask : undefined}
                    onRetry={turnStartGranted && !selectedTaskIsRunning ? onRetryTask : undefined}
                />
            )}
            {effectiveScreen === "new_task" && (
                <NewTaskScreen
                    repos={visibleReposForCapabilities}
                    repoId={newTaskRepoId}
                    mode={visibleNewTaskMode}
                    title={visibleNewTaskTitle}
                    prompt={visibleNewTaskPrompt}
                    isolationStrategy={newTaskVisibleIsolationStrategy}
                    branchOptions={newTaskVisibleBranches}
                    branchesLoading={newTaskVisibleBranchesLoading}
                    preferredSourceBranch={newTaskPreferredSourceBranch}
                    isLoading={isLoading}
                    isSubmitting={isSubmitting}
                    isOnline={isOnline}
                    agentControls={newTaskAgentControlsForCapabilities}
                    hyperplanPresetId={newTaskHyperplanPresetId}
                    imageAttachments={newTaskImageAttachments}
                    imageAttachLoading={newTaskImageAttachLoading}
                    editor={newTaskComposerEditor}
                    onFocusInputShortcut={onFocusNewTaskInputShortcut}
                    drafts={newTaskDrafts}
                    pendingCreations={newTaskPendingCreations}
                    canStashDraft={newTaskCanStashDraft}
                    canRestoreDraft={newTaskCanRestoreDraft}
                    createMore={newTaskCreateMore}
                    onRepoChange={onNewTaskRepoChange}
                    onModeChange={onNewTaskModeChange}
                    onTitleChange={onNewTaskTitleChange}
                    onPromptChange={onNewTaskPromptChange}
                    onIsolationStrategyChange={onNewTaskIsolationStrategyChange}
                    onRefreshBranches={newTaskCanLoadBranches ? onRefreshNewTaskBranches : undefined}
                    onHyperplanPresetChange={onNewTaskHyperplanPresetChange}
                    onStashDraft={onStashNewTaskDraft}
                    onRestoreDraft={onRestoreNewTaskDraft}
                    onDeleteDraft={onDeleteNewTaskDraft}
                    onRetryPendingCreation={onRetryNewTaskPendingCreation}
                    onOpenPendingCreation={onOpenNewTaskPendingCreation}
                    onCancelPendingCreation={onCancelNewTaskPendingCreation}
                    onDismissPendingCreation={onDismissNewTaskPendingCreation}
                    onCreateMoreChange={onNewTaskCreateMoreChange}
                    onAttachImage={newTaskCanAttachUploadedImages ? onAttachNewTaskImage : undefined}
                    onRemoveImage={newTaskCanAttachUploadedImages ? onRemoveNewTaskImage : undefined}
                    onCreateTask={canOpenNewTask ? () => onCreateTask?.() : undefined}
                    onCreateAndRun={canOpenNewTask && newTaskCanStartTurn ? onCreateTask : undefined}
                />
            )}
            {effectiveScreen === "sessions" && (
                <OpenADESessionsScreen configs={configs} activeConfigId={activeConfigId} onSelect={onSelectHost} onRemove={onRemoveHost} onAdd={onAddHost} />
            )}
            {effectiveScreen === "settings" && (
                <OpenADESettingsScreen
                    config={settingsConfig}
                    snapshot={snapshotForCapabilities}
                    status={status}
                    themeSetting={themeSetting}
                    productState={settingsProductState}
                    onRefresh={onRefresh}
                    onForget={onForget}
                    onSelfRevoke={settingsCapabilities.canSelfRevoke ? onSelfRevoke : undefined}
                    onSessions={() => onNavigate("sessions")}
                    onAdd={onAddHost}
                    onThemeChange={onThemeChange}
                    onPersonalSettingsChange={settingsCanReplacePersonal ? onPersonalSettingsChange : undefined}
                    onMcpServerChange={settingsCanUpsertMcpServer ? onMcpServerChange : undefined}
                    onMcpServerDelete={settingsCanDeleteMcpServer ? onMcpServerDelete : undefined}
                />
            )}
        </OpenADEChrome>
    )
}
