import type {
    OpenADEActionEventCompleteRequest,
    OpenADEActionEventCreateRequest,
    OpenADEActionEventCreateResult,
    OpenADEActionEventErrorRequest,
    OpenADEActionEventRuntimeReconcileRequest,
    OpenADEActionEventRuntimeReconcileResult,
    OpenADEActionEventStoppedRequest,
    OpenADEActionExecutionUpdateRequest,
    OpenADEActionStreamAppendRequest,
    OpenADECommentCreateRequest,
    OpenADECommentCreateResult,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADEHyperPlanReconcileLabelsSetRequest,
    OpenADEHyperPlanSubExecutionAddRequest,
    OpenADEHyperPlanSubExecutionStreamAppendRequest,
    OpenADEHyperPlanSubExecutionUpdateRequest,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoDeleteRequest,
    OpenADERepoUpdateRequest,
    OpenADESnapshot,
    OpenADESnapshotEventCreateRequest,
    OpenADESnapshotEventCreateResult,
    OpenADETask,
    OpenADETaskDeleteRequest,
    OpenADETaskDeleteResult,
    OpenADETaskEnvironmentSetupRequest,
    OpenADETaskMetadataUpdateRequest,
    OpenADEReviewStartRequest,
    OpenADETurnStartRequest,
} from "../../openade-module/src/types"
import type { RuntimeNotification } from "../../runtime-protocol/src"
import type { RuntimeClientStatus } from "../../runtime-client/src"

export type OpenADEClientConnectionStatus = RuntimeClientStatus

export interface RuntimeClientLike {
    request<T>(method: string, params?: unknown): Promise<T>
    subscribe(listener: (notification: RuntimeNotification) => void): () => void
    close(): void | Promise<void>
}

export interface OpenADEClientOptions {
    runtime: RuntimeClientLike
    clientName?: string
    clientPlatform?: "desktop" | "mobile" | "web" | "cli" | "unknown"
    protocolVersion?: number
}

export interface OpenADERequestOptions {
    clientRequestId?: string
}

export type OpenADETurnStartOptions = OpenADERequestOptions

function createClientRequestId(): string {
    const crypto = globalThis.crypto
    if (crypto?.randomUUID) return crypto.randomUUID()
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function withClientRequestId<T extends object>(args: T, options: OpenADERequestOptions = {}): T & { clientRequestId: string } {
    const existing = "clientRequestId" in args && typeof args.clientRequestId === "string" && args.clientRequestId.length > 0 ? args.clientRequestId : undefined
    return {
        ...args,
        clientRequestId: options.clientRequestId ?? existing ?? createClientRequestId(),
    }
}

function isOpenADENotification(notification: RuntimeNotification): boolean {
    return notification.method === "connection/lagged" || notification.method.startsWith("openade/") || notification.method.startsWith("runtime/") || notification.method.startsWith("remote/")
}

export class OpenADEClient {
    constructor(private readonly options: OpenADEClientOptions) {}

    async getSnapshot(): Promise<OpenADESnapshot> {
        return this.request("openade/snapshot/read")
    }

    async getTask(repoId: string, taskId: string): Promise<OpenADETask> {
        return this.request("openade/task/read", { repoId, taskId })
    }

    async createRepo(args: OpenADERepoCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADERepoCreateResult> {
        return this.request("openade/repo/create", withClientRequestId(args, options))
    }

    async updateRepo(args: OpenADERepoUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/repo/update", withClientRequestId(args, options))
    }

    async deleteRepo(args: OpenADERepoDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/repo/delete", withClientRequestId(args, options))
    }

    async startTurn(args: OpenADETurnStartRequest, options: OpenADETurnStartOptions = {}): Promise<{ taskId: string }> {
        return this.request("openade/turn/start", withClientRequestId(args, options))
    }

    async startReview(args: OpenADEReviewStartRequest, options: OpenADETurnStartOptions = {}): Promise<{ taskId: string }> {
        return this.request("openade/review/start", withClientRequestId(args, options))
    }

    async interruptTurn(taskId: string, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/turn/interrupt", withClientRequestId({ taskId }, options))
    }

    async createActionEvent(args: OpenADEActionEventCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADEActionEventCreateResult> {
        return this.request("openade/action/create", withClientRequestId(args, options))
    }

    async appendActionStreamEvent(args: OpenADEActionStreamAppendRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/stream/append", withClientRequestId(args, options))
    }

    async completeActionEvent(args: OpenADEActionEventCompleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/complete", withClientRequestId(args, options))
    }

    async errorActionEvent(args: OpenADEActionEventErrorRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/error", withClientRequestId(args, options))
    }

    async stoppedActionEvent(args: OpenADEActionEventStoppedRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/stopped", withClientRequestId(args, options))
    }

    async reconcileActionEventRuntime(
        args: OpenADEActionEventRuntimeReconcileRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEActionEventRuntimeReconcileResult> {
        return this.request("openade/action/reconcileRuntime", withClientRequestId(args, options))
    }

    async updateActionExecution(args: OpenADEActionExecutionUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/execution/update", withClientRequestId(args, options))
    }

    async addHyperPlanSubExecution(args: OpenADEHyperPlanSubExecutionAddRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/hyperplan/subExecution/add", withClientRequestId(args, options))
    }

    async appendHyperPlanSubExecutionStreamEvent(args: OpenADEHyperPlanSubExecutionStreamAppendRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/hyperplan/subExecution/stream/append", withClientRequestId(args, options))
    }

    async updateHyperPlanSubExecution(args: OpenADEHyperPlanSubExecutionUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/hyperplan/subExecution/update", withClientRequestId(args, options))
    }

    async setHyperPlanReconcileLabels(args: OpenADEHyperPlanReconcileLabelsSetRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/hyperplan/reconcileLabels/set", withClientRequestId(args, options))
    }

    async createSnapshotEvent(args: OpenADESnapshotEventCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADESnapshotEventCreateResult> {
        return this.request("openade/snapshot/create", withClientRequestId(args, options))
    }

    async createComment(args: OpenADECommentCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADECommentCreateResult> {
        return this.request("openade/comment/create", withClientRequestId(args, options))
    }

    async editComment(args: OpenADECommentEditRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/comment/edit", withClientRequestId(args, options))
    }

    async deleteComment(args: OpenADECommentDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/comment/delete", withClientRequestId(args, options))
    }

    async updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/task/metadata/update", withClientRequestId(args, options))
    }

    async deleteTask(args: OpenADETaskDeleteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskDeleteResult> {
        return this.request("openade/task/delete", withClientRequestId(args, options))
    }

    async setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/task/environment/setup", withClientRequestId(args, options))
    }

    subscribeToChanges(onEvent: (notification: RuntimeNotification) => void): () => void {
        return this.options.runtime.subscribe((notification) => {
            if (isOpenADENotification(notification)) onEvent(notification)
        })
    }

    close(): void {
        this.options.runtime.close()
    }

    private async request<T>(method: string, params?: unknown): Promise<T> {
        return this.options.runtime.request<T>(method, params)
    }
}
