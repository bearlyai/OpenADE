import { OPENADE_METHOD, OPENADE_METHODS, OPENADE_REMOTE_METHOD, type OpenADEMethod, type OpenADERemoteMethod } from "../../../openade-client/src"
import type { TaskTerminalCapabilities } from "../components/terminalSession"
import type { OpenADESettingsCapabilities } from "./OpenADESessionScreens"
import type {
    ProjectCronCapabilities,
    ProjectFileCapabilities,
    ProjectGitCapabilities,
    ProjectProcessCapabilities,
    ProjectSearchCapabilities,
} from "./project/ProjectHostPanels"
import type { TaskGitCapabilities } from "./task/TaskGitPanel"

export type OpenADEShellGenericRuntimeMethod = "runtime/list"
export type OpenADEShellRuntimeMethod = OpenADEMethod | OpenADERemoteMethod | OpenADEShellGenericRuntimeMethod

export interface OpenADEShellRuntimeCapabilities {
    has(method: OpenADEShellRuntimeMethod): boolean
    hasAll(methods: readonly OpenADEShellRuntimeMethod[]): boolean
}

export interface TaskResourceCapabilities {
    canRead: boolean
}

export interface TaskImageCapabilities {
    canRead: boolean
    canWrite: boolean
}

export interface TaskSnapshotPatchCapabilities {
    canRead: boolean
    canReadSlice: boolean
}

export interface TaskDirectoryCapabilities {
    canList: boolean
    canRead: boolean
}

export interface TaskRuntimeCapabilities {
    canReadWorkingTasks: boolean
}

export interface TaskRecordCapabilities {
    canCreate: boolean
    canDelete: boolean
    canUpdateMetadata: boolean
    canGenerateTitle: boolean
    canPrepareEnvironment: boolean
}

export interface TaskTurnCapabilities {
    canStart: boolean
    canEnqueue: boolean
    canInterrupt: boolean
}

export interface TaskReviewCapabilities {
    canStart: boolean
}

export interface TaskCommentCapabilities {
    canCreate: boolean
    canEdit: boolean
    canDelete: boolean
}

export interface QueuedTurnCapabilities {
    canCancel: boolean
    canReorder: boolean
}

export interface ProjectDirectoryCapabilities {
    canReadSnapshot: boolean
    canReadProjects: boolean
}

export interface ProjectRecordCapabilities {
    canCreate: boolean
    canInspectPath: boolean
    canUpdate: boolean
    canDelete: boolean
}

export interface ProjectSdkCapabilities {
    canRead: boolean
}

export const OPENADE_SHELL_METHOD = {
    runtimeList: "runtime/list",
    snapshotRead: OPENADE_METHOD.snapshotRead,
    projectList: OPENADE_METHOD.projectList,
    taskList: OPENADE_METHOD.taskList,
    taskRead: OPENADE_METHOD.taskRead,
    taskTerminalStart: OPENADE_METHOD.taskTerminalStart,
    taskTerminalReconnect: OPENADE_METHOD.taskTerminalReconnect,
    taskTerminalWrite: OPENADE_METHOD.taskTerminalWrite,
    taskTerminalResize: OPENADE_METHOD.taskTerminalResize,
    taskTerminalStop: OPENADE_METHOD.taskTerminalStop,
    projectProcessList: OPENADE_METHOD.projectProcessList,
    projectProcessStart: OPENADE_METHOD.projectProcessStart,
    projectProcessReconnect: OPENADE_METHOD.projectProcessReconnect,
    projectProcessStop: OPENADE_METHOD.projectProcessStop,
    projectFilesTree: OPENADE_METHOD.projectFilesTree,
    projectFilesFuzzySearch: OPENADE_METHOD.projectFilesFuzzySearch,
    projectFileRead: OPENADE_METHOD.projectFileRead,
    projectFileWrite: OPENADE_METHOD.projectFileWrite,
    projectSearch: OPENADE_METHOD.projectSearch,
    projectGitInfoRead: OPENADE_METHOD.projectGitInfoRead,
    projectGitBranchesRead: OPENADE_METHOD.projectGitBranchesRead,
    projectGitSummaryRead: OPENADE_METHOD.projectGitSummaryRead,
    projectSdkCapabilitiesRead: OPENADE_METHOD.projectSdkCapabilitiesRead,
    cronDefinitionsRead: OPENADE_METHOD.cronDefinitionsRead,
    cronInstallStateRead: OPENADE_METHOD.cronInstallStateRead,
    cronInstallStateReplace: OPENADE_METHOD.cronInstallStateReplace,
    cronRun: OPENADE_METHOD.cronRun,
    taskChangesRead: OPENADE_METHOD.taskChangesRead,
    taskGitLog: OPENADE_METHOD.taskGitLog,
    taskGitSummaryRead: OPENADE_METHOD.taskGitSummaryRead,
    taskGitScopesRead: OPENADE_METHOD.taskGitScopesRead,
    taskDiffRead: OPENADE_METHOD.taskDiffRead,
    taskFilePairRead: OPENADE_METHOD.taskFilePairRead,
    taskGitCommitFilesRead: OPENADE_METHOD.taskGitCommitFilesRead,
    taskGitFileAtTreeishRead: OPENADE_METHOD.taskGitFileAtTreeishRead,
    taskGitCommitFilePatchRead: OPENADE_METHOD.taskGitCommitFilePatchRead,
    taskGitCommit: OPENADE_METHOD.taskGitCommit,
    taskResourceInventoryRead: OPENADE_METHOD.taskResourceInventoryRead,
    taskImageRead: OPENADE_METHOD.taskImageRead,
    taskImageWrite: OPENADE_METHOD.taskImageWrite,
    taskSnapshotPatchRead: OPENADE_METHOD.taskSnapshotPatchRead,
    taskSnapshotIndexRead: OPENADE_METHOD.taskSnapshotIndexRead,
    taskSnapshotPatchReadSlice: OPENADE_METHOD.taskSnapshotPatchReadSlice,
    settingsMcpServersRead: OPENADE_METHOD.settingsMcpServersRead,
    settingsMcpServersUpsert: OPENADE_METHOD.settingsMcpServersUpsert,
    settingsMcpServersDelete: OPENADE_METHOD.settingsMcpServersDelete,
    settingsPersonalRead: OPENADE_METHOD.settingsPersonalRead,
    settingsPersonalReplace: OPENADE_METHOD.settingsPersonalReplace,
    repoPathInspect: OPENADE_METHOD.repoPathInspect,
    repoCreate: OPENADE_METHOD.repoCreate,
    repoUpdate: OPENADE_METHOD.repoUpdate,
    repoDelete: OPENADE_METHOD.repoDelete,
    taskCreate: OPENADE_METHOD.taskCreate,
    taskDelete: OPENADE_METHOD.taskDelete,
    turnStart: OPENADE_METHOD.turnStart,
    turnInterrupt: OPENADE_METHOD.turnInterrupt,
    reviewStart: OPENADE_METHOD.reviewStart,
    taskMetadataUpdate: OPENADE_METHOD.taskMetadataUpdate,
    taskTitleGenerate: OPENADE_METHOD.taskTitleGenerate,
    taskEnvironmentPrepare: OPENADE_METHOD.taskEnvironmentPrepare,
    commentCreate: OPENADE_METHOD.commentCreate,
    commentEdit: OPENADE_METHOD.commentEdit,
    commentDelete: OPENADE_METHOD.commentDelete,
    queuedTurnEnqueue: OPENADE_METHOD.queuedTurnEnqueue,
    queuedTurnCancel: OPENADE_METHOD.queuedTurnCancel,
    queuedTurnReorder: OPENADE_METHOD.queuedTurnReorder,
    remoteDeviceSelfRevoke: OPENADE_REMOTE_METHOD.remoteDeviceSelfRevoke,
} as const

export interface OpenADEShellCapabilities {
    projectDirectoryCapabilities: ProjectDirectoryCapabilities
    projectRecordCapabilities: ProjectRecordCapabilities
    projectSdkCapabilities: ProjectSdkCapabilities
    taskDirectoryCapabilities: TaskDirectoryCapabilities
    taskRuntimeCapabilities: TaskRuntimeCapabilities
    projectProcessCapabilities: ProjectProcessCapabilities
    projectFileCapabilities: ProjectFileCapabilities
    projectSearchCapabilities: ProjectSearchCapabilities
    projectGitCapabilities: ProjectGitCapabilities
    projectCronCapabilities: ProjectCronCapabilities
    taskGitCapabilities: TaskGitCapabilities
    taskCanCommitGit: boolean
    taskTerminalCapabilities: TaskTerminalCapabilities
    taskResourceCapabilities: TaskResourceCapabilities
    taskImageCapabilities: TaskImageCapabilities
    taskSnapshotPatchCapabilities: TaskSnapshotPatchCapabilities
    taskRecordCapabilities: TaskRecordCapabilities
    taskTurnCapabilities: TaskTurnCapabilities
    taskReviewCapabilities: TaskReviewCapabilities
    taskCommentCapabilities: TaskCommentCapabilities
    queuedTurnCapabilities: QueuedTurnCapabilities
    settingsCapabilities: OpenADESettingsCapabilities
}

const OPENADE_METHOD_SET = new Set<string>(OPENADE_METHODS)

function isOpenADEMethod(method: OpenADEShellRuntimeMethod): method is OpenADEMethod {
    return OPENADE_METHOD_SET.has(method)
}

export function buildOpenADEShellCapabilitiesFromOpenADEMethods(
    hasOpenADEMethod: (method: OpenADEMethod) => boolean,
    hasNonOpenADEMethod: (method: OpenADEShellRuntimeMethod) => boolean = () => false
): OpenADEShellCapabilities {
    return buildOpenADEShellCapabilities({
        has(method) {
            return isOpenADEMethod(method) ? hasOpenADEMethod(method) : hasNonOpenADEMethod(method)
        },
        hasAll(methods) {
            return methods.every((method) => (isOpenADEMethod(method) ? hasOpenADEMethod(method) : hasNonOpenADEMethod(method)))
        },
    })
}

export function buildOpenADEShellCapabilities(runtimeCapabilities: OpenADEShellRuntimeCapabilities): OpenADEShellCapabilities {
    const taskSnapshotPatchCanReadSlice = runtimeCapabilities.hasAll([
        OPENADE_SHELL_METHOD.taskSnapshotIndexRead,
        OPENADE_SHELL_METHOD.taskSnapshotPatchReadSlice,
    ])

    return {
        projectDirectoryCapabilities: {
            canReadSnapshot: runtimeCapabilities.has(OPENADE_SHELL_METHOD.snapshotRead),
            canReadProjects: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectList),
        },
        projectRecordCapabilities: {
            canCreate: runtimeCapabilities.has(OPENADE_SHELL_METHOD.repoCreate),
            canInspectPath: runtimeCapabilities.has(OPENADE_SHELL_METHOD.repoPathInspect),
            canUpdate: runtimeCapabilities.has(OPENADE_SHELL_METHOD.repoUpdate),
            canDelete: runtimeCapabilities.has(OPENADE_SHELL_METHOD.repoDelete),
        },
        projectSdkCapabilities: {
            canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectSdkCapabilitiesRead),
        },
        taskDirectoryCapabilities: {
            canList: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskList),
            canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskRead),
        },
        taskRuntimeCapabilities: {
            canReadWorkingTasks: runtimeCapabilities.has(OPENADE_SHELL_METHOD.runtimeList),
        },
        projectProcessCapabilities: buildOpenADEProjectProcessCapabilities(runtimeCapabilities),
        projectFileCapabilities: buildOpenADEProjectFileCapabilities(runtimeCapabilities),
        projectSearchCapabilities: buildOpenADEProjectSearchCapabilities(runtimeCapabilities),
        projectGitCapabilities: {
            canReadInfo: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectGitInfoRead),
            canReadBranches: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectGitBranchesRead),
            canReadSummary: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectGitSummaryRead),
        },
        projectCronCapabilities: {
            canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.cronDefinitionsRead),
            canReadInstallState: runtimeCapabilities.has(OPENADE_SHELL_METHOD.cronInstallStateRead),
            canReplaceInstallState: runtimeCapabilities.has(OPENADE_SHELL_METHOD.cronInstallStateReplace),
            canRun: runtimeCapabilities.has(OPENADE_SHELL_METHOD.cronRun),
        },
        taskGitCapabilities: buildOpenADETaskGitCapabilities(runtimeCapabilities),
        taskCanCommitGit: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskGitCommit),
        taskTerminalCapabilities: buildOpenADETaskTerminalCapabilities(runtimeCapabilities),
        taskResourceCapabilities: {
            canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskResourceInventoryRead),
        },
        taskImageCapabilities: {
            canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskImageRead),
            canWrite: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskImageWrite),
        },
        taskSnapshotPatchCapabilities: {
            canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskSnapshotPatchRead) || taskSnapshotPatchCanReadSlice,
            canReadSlice: taskSnapshotPatchCanReadSlice,
        },
        taskRecordCapabilities: {
            canCreate: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskCreate),
            canDelete: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskDelete),
            canUpdateMetadata: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskMetadataUpdate),
            canGenerateTitle: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskTitleGenerate),
            canPrepareEnvironment: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskEnvironmentPrepare),
        },
        taskTurnCapabilities: {
            canStart: runtimeCapabilities.has(OPENADE_SHELL_METHOD.turnStart),
            canEnqueue: runtimeCapabilities.has(OPENADE_SHELL_METHOD.queuedTurnEnqueue),
            canInterrupt: runtimeCapabilities.has(OPENADE_SHELL_METHOD.turnInterrupt),
        },
        taskReviewCapabilities: {
            canStart: runtimeCapabilities.has(OPENADE_SHELL_METHOD.reviewStart),
        },
        taskCommentCapabilities: {
            canCreate: runtimeCapabilities.has(OPENADE_SHELL_METHOD.commentCreate),
            canEdit: runtimeCapabilities.has(OPENADE_SHELL_METHOD.commentEdit),
            canDelete: runtimeCapabilities.has(OPENADE_SHELL_METHOD.commentDelete),
        },
        queuedTurnCapabilities: {
            canCancel: runtimeCapabilities.has(OPENADE_SHELL_METHOD.queuedTurnCancel),
            canReorder: runtimeCapabilities.has(OPENADE_SHELL_METHOD.queuedTurnReorder),
        },
        settingsCapabilities: {
            personalSettings: {
                canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.settingsPersonalRead),
                canReplace: runtimeCapabilities.has(OPENADE_SHELL_METHOD.settingsPersonalReplace),
            },
            mcpServers: {
                canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.settingsMcpServersRead),
                canUpsert: runtimeCapabilities.has(OPENADE_SHELL_METHOD.settingsMcpServersUpsert),
                canDelete: runtimeCapabilities.has(OPENADE_SHELL_METHOD.settingsMcpServersDelete),
            },
            canSelfRevoke: runtimeCapabilities.has(OPENADE_SHELL_METHOD.remoteDeviceSelfRevoke),
        },
    }
}

export function buildOpenADEProjectFileCapabilities(runtimeCapabilities: { has(method: OpenADEMethod): boolean }): ProjectFileCapabilities {
    return {
        canList: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectFilesTree),
        canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectFileRead),
        canSearch: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectFilesFuzzySearch),
        canWrite: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectFileWrite),
    }
}

export function buildOpenADEProjectSearchCapabilities(runtimeCapabilities: { has(method: OpenADEMethod): boolean }): ProjectSearchCapabilities {
    return {
        canSearch: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectSearch),
    }
}

export function buildOpenADETaskGitCapabilities(runtimeCapabilities: { has(method: OpenADEMethod): boolean }): TaskGitCapabilities {
    return {
        canReadChanges: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskChangesRead),
        canReadLog: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskGitLog),
        canReadSummary: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskGitSummaryRead),
        canReadScopes: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskGitScopesRead),
        canReadDiff: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskDiffRead),
        canReadFilePair: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskFilePairRead),
        canReadCommitFiles: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskGitCommitFilesRead),
        canReadCommitFilePatch: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskGitCommitFilePatchRead),
        canReadFileAtTreeish: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskGitFileAtTreeishRead),
    }
}

export function buildOpenADETaskTerminalCapabilities(runtimeCapabilities: { has(method: OpenADEMethod): boolean }): TaskTerminalCapabilities {
    return {
        canStart: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskTerminalStart),
        canReconnect: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskTerminalReconnect),
        canWrite: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskTerminalWrite),
        canResize: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskTerminalResize),
        canStop: runtimeCapabilities.has(OPENADE_SHELL_METHOD.taskTerminalStop),
    }
}

export function buildOpenADEProjectProcessCapabilities(runtimeCapabilities: { has(method: OpenADEMethod): boolean }): ProjectProcessCapabilities {
    return {
        canRead: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectProcessList),
        canStart: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectProcessStart),
        canReconnect: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectProcessReconnect),
        canStop: runtimeCapabilities.has(OPENADE_SHELL_METHOD.projectProcessStop),
    }
}
