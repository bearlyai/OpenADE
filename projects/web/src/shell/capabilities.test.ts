import { describe, expect, it } from "vitest"
import { OPENADE_METHOD, OPENADE_METHODS, type OpenADEMethod } from "../../../openade-client/src"
import { COMPANION_RUNTIME_PERMISSIONS } from "../../../shared/companion/src"
import {
    OPENADE_SHELL_METHOD,
    type OpenADEShellRuntimeCapabilities,
    buildOpenADEProjectFileCapabilities,
    buildOpenADEProjectProcessCapabilities,
    buildOpenADEProjectSearchCapabilities,
    buildOpenADEShellCapabilities,
    buildOpenADEShellCapabilitiesFromOpenADEMethods,
    buildOpenADETaskGitCapabilities,
    buildOpenADETaskTerminalCapabilities,
} from "./capabilities"

const OPENADE_METHODS_OUTSIDE_SHARED_SHELL = [
    OPENADE_METHOD.importLegacyResources,
    OPENADE_METHOD.settingsMcpServersReplace,
    OPENADE_METHOD.taskImageStagedRead,
    OPENADE_METHOD.taskImageImportLegacy,
    OPENADE_METHOD.taskImagesImportLegacy,
    OPENADE_METHOD.taskImagesGcStaged,
    OPENADE_METHOD.taskSessionsImportLegacy,
    OPENADE_METHOD.taskSnapshotsImportLegacy,
    OPENADE_METHOD.queuedTurnImportLegacy,
    OPENADE_METHOD.actionCreate,
    OPENADE_METHOD.actionStreamAppend,
    OPENADE_METHOD.actionComplete,
    OPENADE_METHOD.actionError,
    OPENADE_METHOD.actionStopped,
    OPENADE_METHOD.actionReconcileRuntime,
    OPENADE_METHOD.actionExecutionUpdate,
    OPENADE_METHOD.hyperplanSubExecutionAdd,
    OPENADE_METHOD.hyperplanSubExecutionStreamAppend,
    OPENADE_METHOD.hyperplanSubExecutionUpdate,
    OPENADE_METHOD.hyperplanReconcileLabelsSet,
    OPENADE_METHOD.snapshotCreate,
    OPENADE_METHOD.taskUsageBackfill,
    OPENADE_METHOD.taskUsageRecalculate,
    OPENADE_METHOD.taskEnvironmentSetup,
    OPENADE_METHOD.cronInstallStateList,
] as const satisfies readonly OpenADEMethod[]

function capabilitiesWith(methods: readonly string[]): OpenADEShellRuntimeCapabilities {
    const advertisedMethods = new Set<string>(methods)
    return {
        has(method) {
            return advertisedMethods.has(method)
        },
        hasAll(requiredMethods) {
            return requiredMethods.every((method) => advertisedMethods.has(method))
        },
    }
}

describe("buildOpenADEShellCapabilities", () => {
    it("accounts for every generated OpenADE method as shell-projected or intentionally outside the shared shell", () => {
        const shellMethods = new Set<string>(Object.values(OPENADE_SHELL_METHOD).filter((method) => method.startsWith("openade/")))
        const outsideShellMethods = new Set<string>(OPENADE_METHODS_OUTSIDE_SHARED_SHELL)
        const unaccountedMethods = OPENADE_METHODS.filter((method: OpenADEMethod) => !shellMethods.has(method) && !outsideShellMethods.has(method))
        const duplicatedMethods = OPENADE_METHODS_OUTSIDE_SHARED_SHELL.filter((method) => shellMethods.has(method))

        expect(unaccountedMethods).toEqual([])
        expect(duplicatedMethods).toEqual([])
    })

    it("keeps paired product grants within shared-shell-projected methods", () => {
        const shellMethods = new Set<string>(Object.values(OPENADE_SHELL_METHOD))
        const outsideShellMethods = new Set<string>(OPENADE_METHODS_OUTSIDE_SHARED_SHELL)
        const pairedShellRelevantPermissions = COMPANION_RUNTIME_PERMISSIONS.filter(
            (method): method is (typeof COMPANION_RUNTIME_PERMISSIONS)[number] =>
                method.startsWith("openade/") || method === OPENADE_SHELL_METHOD.remoteDeviceSelfRevoke
        )

        const pairedOutsideSharedShell = pairedShellRelevantPermissions.filter((method) => outsideShellMethods.has(method as OpenADEMethod))
        const pairedWithoutShellProjection = pairedShellRelevantPermissions.filter((method) => !shellMethods.has(method))

        expect(pairedOutsideSharedShell).toEqual([])
        expect(pairedWithoutShellProjection).toEqual([])
    })

    it("fails closed when a runtime advertises no shell methods", () => {
        const capabilities = buildOpenADEShellCapabilities(capabilitiesWith([]))

        expect(capabilities.projectDirectoryCapabilities).toEqual({ canReadSnapshot: false, canReadProjects: false })
        expect(capabilities.taskDirectoryCapabilities).toEqual({ canList: false, canRead: false })
        expect(capabilities.taskRuntimeCapabilities).toEqual({ canReadWorkingTasks: false })
        expect(capabilities.projectProcessCapabilities).toEqual({ canRead: false, canStart: false, canReconnect: false, canStop: false })
        expect(capabilities.projectFileCapabilities).toEqual({ canList: false, canRead: false, canSearch: false, canWrite: false })
        expect(capabilities.projectGitCapabilities).toEqual({ canReadInfo: false, canReadBranches: false, canReadSummary: false })
        expect(capabilities.taskTerminalCapabilities).toEqual({ canStart: false, canReconnect: false, canWrite: false, canResize: false, canStop: false })
        expect(capabilities.taskCanCommitGit).toBe(false)
        expect(capabilities.taskRecordCapabilities).toEqual({
            canCreate: false,
            canDelete: false,
            canUpdateMetadata: false,
            canGenerateTitle: false,
            canPrepareEnvironment: false,
        })
        expect(capabilities.taskTurnCapabilities).toEqual({ canStart: false, canEnqueue: false, canInterrupt: false })
        expect(capabilities.taskReviewCapabilities).toEqual({ canStart: false })
        expect(capabilities.taskCommentCapabilities).toEqual({ canCreate: false, canEdit: false, canDelete: false })
        expect(capabilities.queuedTurnCapabilities).toEqual({ canCancel: false, canReorder: false })
        expect(capabilities.taskResourceCapabilities).toEqual({ canRead: false })
        expect(capabilities.taskImageCapabilities).toEqual({ canRead: false, canWrite: false })
        expect(capabilities.taskSnapshotPatchCapabilities).toEqual({ canRead: false, canReadSlice: false })
        expect(capabilities.projectRecordCapabilities).toEqual({ canCreate: false, canInspectPath: false, canUpdate: false, canDelete: false })
        expect(capabilities.projectSdkCapabilities).toEqual({ canRead: false })
        expect(capabilities.settingsCapabilities).toEqual({
            personalSettings: { canRead: false, canReplace: false },
            mcpServers: { canRead: false, canUpsert: false, canDelete: false },
            canSelfRevoke: false,
        })
    })

    it("derives desktop classic shell capabilities from OpenADE method checks without granting remote-only powers", () => {
        const grantedMethods = new Set<OpenADEMethod>([
            OPENADE_METHOD.repoCreate,
            OPENADE_METHOD.repoDelete,
            OPENADE_METHOD.taskMetadataUpdate,
            OPENADE_METHOD.taskDelete,
            OPENADE_METHOD.taskResourceInventoryRead,
            OPENADE_METHOD.settingsPersonalRead,
        ])
        const capabilities = buildOpenADEShellCapabilitiesFromOpenADEMethods((method) => grantedMethods.has(method))

        expect(capabilities.projectRecordCapabilities).toEqual({ canCreate: true, canInspectPath: false, canUpdate: false, canDelete: true })
        expect(capabilities.taskRecordCapabilities).toMatchObject({ canDelete: true, canUpdateMetadata: true })
        expect(capabilities.taskResourceCapabilities).toEqual({ canRead: true })
        expect(capabilities.settingsCapabilities.personalSettings).toEqual({ canRead: true, canReplace: false })
        expect(capabilities.settingsCapabilities.canSelfRevoke).toBe(false)
        expect(capabilities.taskRuntimeCapabilities.canReadWorkingTasks).toBe(false)
    })

    it("projects granular product and shell controls from advertised runtime methods", () => {
        const capabilities = buildOpenADEShellCapabilities(
            capabilitiesWith([
                OPENADE_SHELL_METHOD.projectFileRead,
                OPENADE_SHELL_METHOD.projectFilesFuzzySearch,
                OPENADE_SHELL_METHOD.projectGitSummaryRead,
                OPENADE_SHELL_METHOD.projectProcessList,
                OPENADE_SHELL_METHOD.projectProcessStop,
                OPENADE_SHELL_METHOD.taskGitLog,
                OPENADE_SHELL_METHOD.taskGitCommit,
                OPENADE_SHELL_METHOD.taskSnapshotIndexRead,
                OPENADE_SHELL_METHOD.taskSnapshotPatchReadSlice,
                OPENADE_SHELL_METHOD.taskImageWrite,
                OPENADE_SHELL_METHOD.taskTerminalReconnect,
                OPENADE_SHELL_METHOD.taskTerminalWrite,
                OPENADE_SHELL_METHOD.taskMetadataUpdate,
                OPENADE_SHELL_METHOD.commentCreate,
                OPENADE_SHELL_METHOD.repoDelete,
                OPENADE_SHELL_METHOD.taskCreate,
                OPENADE_SHELL_METHOD.taskRead,
                OPENADE_SHELL_METHOD.turnStart,
                OPENADE_SHELL_METHOD.queuedTurnEnqueue,
                OPENADE_SHELL_METHOD.snapshotRead,
                OPENADE_SHELL_METHOD.projectList,
                OPENADE_SHELL_METHOD.taskList,
                OPENADE_SHELL_METHOD.runtimeList,
                OPENADE_SHELL_METHOD.settingsPersonalRead,
                OPENADE_SHELL_METHOD.repoPathInspect,
                OPENADE_SHELL_METHOD.remoteDeviceSelfRevoke,
            ])
        )

        expect(capabilities.projectDirectoryCapabilities).toEqual({ canReadSnapshot: true, canReadProjects: true })
        expect(capabilities.taskDirectoryCapabilities).toEqual({ canList: true, canRead: true })
        expect(capabilities.taskRuntimeCapabilities).toEqual({ canReadWorkingTasks: true })
        expect(capabilities.projectFileCapabilities).toEqual({ canList: false, canRead: true, canSearch: true, canWrite: false })
        expect(capabilities.projectFileCapabilities).toEqual(
            buildOpenADEProjectFileCapabilities(capabilitiesWith([OPENADE_SHELL_METHOD.projectFileRead, OPENADE_SHELL_METHOD.projectFilesFuzzySearch]))
        )
        expect(capabilities.projectSearchCapabilities).toEqual({ canSearch: false })
        expect(capabilities.projectSearchCapabilities).toEqual(buildOpenADEProjectSearchCapabilities(capabilitiesWith([OPENADE_SHELL_METHOD.projectFileRead])))
        expect(capabilities.projectGitCapabilities).toEqual({ canReadInfo: false, canReadBranches: false, canReadSummary: true })
        expect(capabilities.projectProcessCapabilities).toEqual({ canRead: true, canStart: false, canReconnect: false, canStop: true })
        expect(capabilities.projectProcessCapabilities).toEqual(
            buildOpenADEProjectProcessCapabilities(capabilitiesWith([OPENADE_SHELL_METHOD.projectProcessList, OPENADE_SHELL_METHOD.projectProcessStop]))
        )
        expect(capabilities.taskTerminalCapabilities).toEqual({ canStart: false, canReconnect: true, canWrite: true, canResize: false, canStop: false })
        expect(capabilities.taskTerminalCapabilities).toEqual(
            buildOpenADETaskTerminalCapabilities(capabilitiesWith([OPENADE_SHELL_METHOD.taskTerminalReconnect, OPENADE_SHELL_METHOD.taskTerminalWrite]))
        )
        expect(capabilities.taskGitCapabilities).toEqual(buildOpenADETaskGitCapabilities(capabilitiesWith([OPENADE_SHELL_METHOD.taskGitLog])))
        expect(capabilities.taskGitCapabilities).toMatchObject({ canReadLog: true, canReadSummary: false, canReadFileAtTreeish: false })
        expect(capabilities.taskCanCommitGit).toBe(true)
        expect(capabilities.taskRecordCapabilities).toEqual({
            canCreate: true,
            canDelete: false,
            canUpdateMetadata: true,
            canGenerateTitle: false,
            canPrepareEnvironment: false,
        })
        expect(capabilities.taskTurnCapabilities).toEqual({ canStart: true, canEnqueue: true, canInterrupt: false })
        expect(capabilities.taskReviewCapabilities).toEqual({ canStart: false })
        expect(capabilities.taskCommentCapabilities).toEqual({ canCreate: true, canEdit: false, canDelete: false })
        expect(capabilities.queuedTurnCapabilities).toEqual({ canCancel: false, canReorder: false })
        expect(capabilities.taskImageCapabilities).toEqual({ canRead: false, canWrite: true })
        expect(capabilities.taskSnapshotPatchCapabilities).toEqual({ canRead: true, canReadSlice: true })
        expect(capabilities.projectRecordCapabilities).toEqual({ canCreate: false, canInspectPath: true, canUpdate: false, canDelete: true })
        expect(capabilities.projectSdkCapabilities).toEqual({ canRead: false })
        expect(capabilities.projectCronCapabilities).toEqual({ canRead: false, canReadInstallState: false, canReplaceInstallState: false, canRun: false })
        expect(capabilities.settingsCapabilities).toEqual({
            personalSettings: { canRead: true, canReplace: false },
            mcpServers: { canRead: false, canUpsert: false, canDelete: false },
            canSelfRevoke: true,
        })
    })

    it("projects the paired mobile attach profile into product controls without trusted host powers", () => {
        const capabilities = buildOpenADEShellCapabilities(capabilitiesWith(COMPANION_RUNTIME_PERMISSIONS))

        expect(capabilities.projectDirectoryCapabilities).toEqual({ canReadSnapshot: true, canReadProjects: true })
        expect(capabilities.taskDirectoryCapabilities).toEqual({ canList: true, canRead: true })
        expect(capabilities.taskRuntimeCapabilities).toEqual({ canReadWorkingTasks: false })
        expect(capabilities.projectFileCapabilities).toEqual({ canList: true, canRead: true, canSearch: true, canWrite: false })
        expect(capabilities.projectSearchCapabilities).toEqual({ canSearch: true })
        expect(capabilities.projectGitCapabilities).toEqual({ canReadInfo: true, canReadBranches: true, canReadSummary: true })
        expect(capabilities.projectProcessCapabilities).toEqual({ canRead: true, canStart: false, canReconnect: true, canStop: false })
        expect(capabilities.projectCronCapabilities).toEqual({ canRead: true, canReadInstallState: false, canReplaceInstallState: false, canRun: false })
        expect(capabilities.projectRecordCapabilities).toMatchObject({ canUpdate: false, canDelete: false })
        expect(capabilities.taskGitCapabilities).toMatchObject({
            canReadChanges: true,
            canReadLog: true,
            canReadSummary: true,
            canReadScopes: true,
            canReadDiff: true,
            canReadFilePair: true,
            canReadCommitFiles: true,
            canReadCommitFilePatch: true,
            canReadFileAtTreeish: true,
        })
        expect(capabilities.taskCanCommitGit).toBe(false)
        expect(capabilities.taskRecordCapabilities).toEqual({
            canCreate: true,
            canDelete: true,
            canUpdateMetadata: true,
            canGenerateTitle: false,
            canPrepareEnvironment: false,
        })
        expect(capabilities.taskTurnCapabilities).toEqual({ canStart: true, canEnqueue: true, canInterrupt: true })
        expect(capabilities.taskReviewCapabilities).toEqual({ canStart: true })
        expect(capabilities.taskCommentCapabilities).toEqual({ canCreate: true, canEdit: true, canDelete: true })
        expect(capabilities.queuedTurnCapabilities).toEqual({ canCancel: true, canReorder: true })
        expect(capabilities.taskTerminalCapabilities).toEqual({ canStart: false, canReconnect: false, canWrite: false, canResize: false, canStop: false })
        expect(capabilities.taskResourceCapabilities).toEqual({ canRead: true })
        expect(capabilities.taskImageCapabilities).toEqual({ canRead: true, canWrite: true })
        expect(capabilities.taskSnapshotPatchCapabilities).toEqual({ canRead: true, canReadSlice: true })
        expect(capabilities.settingsCapabilities).toEqual({
            personalSettings: { canRead: false, canReplace: false },
            mcpServers: { canRead: true, canUpsert: false, canDelete: false },
            canSelfRevoke: true,
        })
        expect(capabilities.projectRecordCapabilities).toMatchObject({ canCreate: false, canInspectPath: false })
        expect(capabilities.projectSdkCapabilities).toEqual({ canRead: true })
    })

    it("allows direct snapshot patch reads without requiring indexed patch slices", () => {
        const capabilities = buildOpenADEShellCapabilities(capabilitiesWith([OPENADE_SHELL_METHOD.taskSnapshotPatchRead]))

        expect(capabilities.taskSnapshotPatchCapabilities).toEqual({ canRead: true, canReadSlice: false })
    })
})
