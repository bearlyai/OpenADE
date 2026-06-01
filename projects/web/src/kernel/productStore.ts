import type { OpenADERequestOptions, OpenADETurnStartOptions } from "../../../openade-client/src"
import type {
    OpenADECommentCreateRequest,
    OpenADECommentCreateResult,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADEProjectFileReadRequest,
    OpenADEProjectFileReadResult,
    OpenADEProjectFileWriteRequest,
    OpenADEProjectFileWriteResult,
    OpenADEProjectFilesTreeRequest,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectProcessListRequest,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectRequest,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartRequest,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopRequest,
    OpenADEProjectProcessStopResult,
    OpenADEProjectSearchRequest,
    OpenADEProjectSearchResult,
    OpenADEQueuedTurnCancelRequest,
    OpenADEQueuedTurnCancelResult,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoDeleteRequest,
    OpenADERepoUpdateRequest,
    OpenADEReviewStartRequest,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
    OpenADETaskDeleteRequest,
    OpenADETaskDeleteResult,
    OpenADETaskDiffReadRequest,
    OpenADETaskDiffReadResult,
    OpenADETaskEnvironmentSetupRequest,
    OpenADETaskFilePairReadRequest,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitCommitRequest,
    OpenADETaskGitCommitResult,
    OpenADETaskGitLogRequest,
    OpenADETaskGitLogResult,
    OpenADETaskImageReadRequest,
    OpenADETaskImageReadResult,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskReadOptions,
    OpenADETaskSnapshotIndexReadRequest,
    OpenADETaskSnapshotIndexReadResult,
    OpenADETaskSnapshotPatchReadRequest,
    OpenADETaskSnapshotPatchReadResult,
    OpenADETaskSnapshotPatchSliceReadRequest,
    OpenADETaskSnapshotPatchSliceReadResult,
    OpenADETaskTerminalMutationResult,
    OpenADETaskTerminalReconnectRequest,
    OpenADETaskTerminalReconnectResult,
    OpenADETaskTerminalResizeRequest,
    OpenADETaskTerminalStartRequest,
    OpenADETaskTerminalStartResult,
    OpenADETaskTerminalStopRequest,
    OpenADETaskTerminalWriteRequest,
    OpenADETurnStartRequest,
    OpenADETurnStartResult,
} from "../../../openade-module/src"
import { RuntimeRecordCache } from "../../../runtime-client/src"
import type { RuntimeNotification } from "../../../runtime-protocol/src"

function taskKey(repoId: string, taskId: string): string {
    return `${repoId}\0${taskId}`
}

function notificationRecord(notification: RuntimeNotification): Record<string, unknown> {
    return typeof notification.params === "object" && notification.params !== null && !Array.isArray(notification.params)
        ? (notification.params as Record<string, unknown>)
        : {}
}

export class OpenADEProductStore {
    snapshot: OpenADESnapshot | null = null
    readonly runtimes = new RuntimeRecordCache()
    private readonly tasks = new Map<string, OpenADETask>()
    private unsubscribe: (() => void) | null = null

    constructor(private readonly client: OpenADEProductClient) {}

    getCachedTask(repoId: string, taskId: string): OpenADETask | null {
        return this.tasks.get(taskKey(repoId, taskId)) ?? null
    }

    async refreshSnapshot(): Promise<OpenADESnapshot> {
        const snapshot = await this.client.getSnapshot()
        this.snapshot = snapshot
        return snapshot
    }

    async getTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = {}): Promise<OpenADETask> {
        const task = await this.client.getTask(repoId, taskId, options)
        this.tasks.set(taskKey(repoId, taskId), task)
        return task
    }

    async refreshTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = {}): Promise<OpenADETask> {
        return this.getTask(repoId, taskId, options)
    }

    async listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult> {
        return this.client.listProjectFiles(args)
    }

    async readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult> {
        return this.client.readProjectFile(args)
    }

    async writeProjectFile(args: OpenADEProjectFileWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectFileWriteResult> {
        return this.client.writeProjectFile(args, options)
    }

    async searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult> {
        return this.client.searchProject(args)
    }

    async listProjectProcesses(args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult> {
        return this.client.listProjectProcesses(args)
    }

    async startProjectProcess(args: OpenADEProjectProcessStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStartResult> {
        return this.client.startProjectProcess(args, options)
    }

    async reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult> {
        return this.client.reconnectProjectProcess(args)
    }

    async stopProjectProcess(args: OpenADEProjectProcessStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStopResult> {
        return this.client.stopProjectProcess(args, options)
    }

    async readTaskChanges(args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult> {
        return this.client.readTaskChanges(args)
    }

    async readTaskDiff(args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult> {
        return this.client.readTaskDiff(args)
    }

    async readTaskFilePair(args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult> {
        return this.client.readTaskFilePair(args)
    }

    async readTaskGitLog(args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult> {
        return this.client.readTaskGitLog(args)
    }

    async commitTaskGit(args: OpenADETaskGitCommitRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskGitCommitResult> {
        return this.client.commitTaskGit(args, options)
    }

    async startTaskTerminal(args: OpenADETaskTerminalStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalStartResult> {
        return this.client.startTaskTerminal(args, options)
    }

    async reconnectTaskTerminal(args: OpenADETaskTerminalReconnectRequest): Promise<OpenADETaskTerminalReconnectResult> {
        return this.client.reconnectTaskTerminal(args)
    }

    async writeTaskTerminal(args: OpenADETaskTerminalWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.client.writeTaskTerminal(args, options)
    }

    async resizeTaskTerminal(args: OpenADETaskTerminalResizeRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.client.resizeTaskTerminal(args, options)
    }

    async stopTaskTerminal(args: OpenADETaskTerminalStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.client.stopTaskTerminal(args, options)
    }

    async readTaskImage(args: OpenADETaskImageReadRequest): Promise<OpenADETaskImageReadResult> {
        return this.client.readTaskImage(args)
    }

    async readTaskSnapshotPatch(args: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult> {
        return this.client.readTaskSnapshotPatch(args)
    }

    async readTaskSnapshotIndex(args: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult> {
        return this.client.readTaskSnapshotIndex(args)
    }

    async readTaskSnapshotPatchSlice(args: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
        return this.client.readTaskSnapshotPatchSlice(args)
    }

    async createRepo(args: OpenADERepoCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADERepoCreateResult> {
        const result = await this.client.createRepo(args, options)
        await this.refreshSnapshot()
        return result
    }

    async updateRepo(args: OpenADERepoUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.updateRepo(args, options)
        await this.refreshSnapshot()
    }

    async deleteRepo(args: OpenADERepoDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.deleteRepo(args, options)
        await this.refreshSnapshot()
    }

    async startTurn(args: OpenADETurnStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADETurnStartResult> {
        const result = await this.client.startTurn(args, options)
        await this.refreshSnapshot()
        if (result.taskId) await this.refreshTask(args.repoId, result.taskId)
        return result
    }

    async startReview(args: OpenADEReviewStartRequest, options: OpenADETurnStartOptions = {}): Promise<{ taskId: string }> {
        const result = await this.client.startReview(args, options)
        await this.refreshTask(args.repoId, result.taskId)
        return result
    }

    async interruptTurn(taskId: string, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.interruptTurn(taskId, options)
    }

    async cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnCancelResult> {
        const result = await this.client.cancelQueuedTurn(args, options)
        await this.refreshTask(args.repoId, args.taskId)
        return result
    }

    async updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.updateTaskMetadata(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
        await this.refreshSnapshot()
    }

    async createComment(args: OpenADECommentCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADECommentCreateResult> {
        const result = await this.client.createComment(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
        return result
    }

    async editComment(args: OpenADECommentEditRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.editComment(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
    }

    async deleteComment(args: OpenADECommentDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.deleteComment(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
    }

    async deleteTask(args: OpenADETaskDeleteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskDeleteResult> {
        const result = await this.client.deleteTask(args, options)
        this.tasks.delete(taskKey(args.repoId, args.taskId))
        await this.refreshSnapshot()
        return result
    }

    async setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.setupTaskEnvironment(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
        await this.refreshSnapshot()
    }

    async handleNotification(notification: RuntimeNotification): Promise<void> {
        this.runtimes.applyNotification(notification)
        const params = notificationRecord(notification)
        const repoId = typeof params.repoId === "string" ? params.repoId : undefined
        const taskId = typeof params.taskId === "string" ? params.taskId : undefined

        if (
            notification.method === "openade/snapshotChanged" ||
            notification.method === "openade/repo/updated" ||
            notification.method === "openade/repo/deleted"
        ) {
            await this.refreshSnapshot()
            return
        }

        if (notification.method === "openade/task/deleted" && repoId && taskId) {
            this.tasks.delete(taskKey(repoId, taskId))
            await this.refreshSnapshot()
            return
        }

        if (notification.method === "openade/task/previewChanged") {
            await this.refreshSnapshot()
        }

        if ((notification.method === "openade/task/updated" || notification.method === "openade/queuedTurn/updated") && repoId && taskId) {
            await this.refreshTask(repoId, taskId)
        }
    }

    subscribe(): () => void {
        if (this.unsubscribe) return this.unsubscribe
        this.unsubscribe = this.client.subscribeToChanges((notification) => {
            void this.handleNotification(notification)
        })
        return this.unsubscribe
    }

    destroy(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
        this.tasks.clear()
        this.runtimes.clear()
    }
}

export interface OpenADEProductClient {
    getSnapshot(): Promise<OpenADESnapshot>
    getTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<OpenADETask>
    listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult>
    readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult>
    writeProjectFile(args: OpenADEProjectFileWriteRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectFileWriteResult>
    searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult>
    listProjectProcesses(args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult>
    startProjectProcess(args: OpenADEProjectProcessStartRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectProcessStartResult>
    reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult>
    stopProjectProcess(args: OpenADEProjectProcessStopRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectProcessStopResult>
    readTaskChanges(args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult>
    readTaskDiff(args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult>
    readTaskFilePair(args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult>
    readTaskGitLog(args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult>
    commitTaskGit(args: OpenADETaskGitCommitRequest, options?: OpenADERequestOptions): Promise<OpenADETaskGitCommitResult>
    startTaskTerminal(args: OpenADETaskTerminalStartRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTerminalStartResult>
    reconnectTaskTerminal(args: OpenADETaskTerminalReconnectRequest): Promise<OpenADETaskTerminalReconnectResult>
    writeTaskTerminal(args: OpenADETaskTerminalWriteRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTerminalMutationResult>
    resizeTaskTerminal(args: OpenADETaskTerminalResizeRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTerminalMutationResult>
    stopTaskTerminal(args: OpenADETaskTerminalStopRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTerminalMutationResult>
    readTaskImage(args: OpenADETaskImageReadRequest): Promise<OpenADETaskImageReadResult>
    readTaskSnapshotPatch(args: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult>
    readTaskSnapshotIndex(args: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult>
    readTaskSnapshotPatchSlice(args: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult>
    createRepo(args: OpenADERepoCreateRequest, options?: OpenADERequestOptions): Promise<OpenADERepoCreateResult>
    updateRepo(args: OpenADERepoUpdateRequest, options?: OpenADERequestOptions): Promise<void>
    deleteRepo(args: OpenADERepoDeleteRequest, options?: OpenADERequestOptions): Promise<void>
    startTurn(args: OpenADETurnStartRequest, options?: OpenADETurnStartOptions): Promise<OpenADETurnStartResult>
    startReview(args: OpenADEReviewStartRequest, options?: OpenADETurnStartOptions): Promise<{ taskId: string }>
    interruptTurn(taskId: string, options?: OpenADERequestOptions): Promise<void>
    cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options?: OpenADERequestOptions): Promise<OpenADEQueuedTurnCancelResult>
    updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest, options?: OpenADERequestOptions): Promise<void>
    createComment(args: OpenADECommentCreateRequest, options?: OpenADERequestOptions): Promise<OpenADECommentCreateResult>
    editComment(args: OpenADECommentEditRequest, options?: OpenADERequestOptions): Promise<void>
    deleteComment(args: OpenADECommentDeleteRequest, options?: OpenADERequestOptions): Promise<void>
    deleteTask(args: OpenADETaskDeleteRequest, options?: OpenADERequestOptions): Promise<OpenADETaskDeleteResult>
    setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options?: OpenADERequestOptions): Promise<void>
    subscribeToChanges(onEvent: (notification: RuntimeNotification) => void): () => void
}
