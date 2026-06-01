import type { RuntimeNotification } from "../../../runtime-protocol/src"
import type {
    PairRequest,
    RemoteDeviceSelfRevokeResult,
    RemoteSnapshot,
    RemoteTask,
    RemoteTurnStartRequest,
    RemoteTurnStartResult,
} from "../../../shared/companion/src"
import type {
    OpenADECommentCreateRequest,
    OpenADECommentCreateResult,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADEProjectFileReadRequest,
    OpenADEProjectFileReadResult,
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
    OpenADEReviewStartRequest,
    OpenADETaskDeleteRequest,
    OpenADETaskDeleteResult,
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadRequest,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadRequest,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitLogRequest,
    OpenADETaskGitLogResult,
    OpenADETaskImageReadRequest,
    OpenADETaskImageReadResult,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskReadOptions,
} from "../../../openade-module/src"
import { RuntimeClientError } from "../../../runtime-client/src"
import {
    buildPairingTarget,
    defaultKernelSessionConstructors,
    KernelSessionManager,
    type KernelRealtimeConnectionStatus,
    type KernelRuntimeClientLike,
    type KernelSessionConfig,
    type KernelSessionConstructors,
    type KernelSessionEntry,
} from "../kernel/session"
import { KernelSessionConfigStore, type KernelSessionConfigInput } from "../kernel/sessionStore"
import { OpenADEProductStore, type OpenADEProductClient } from "../kernel/productStore"

export type { PairingTarget } from "../kernel/session"
export { buildPairingTarget, parsePairingCode } from "../kernel/session"

export interface RemoteConfig extends KernelSessionConfig {}

export const REMOTE_CONFIG_STORAGE_KEY = "openade-companion-config"
export type RemoteRealtimeConnectionStatus = KernelRealtimeConnectionStatus

interface RemoteRuntimeClient extends KernelRuntimeClientLike {}

interface RemoteOpenADEClient extends OpenADEProductClient {
    getSnapshot(): Promise<RemoteSnapshot>
    getTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<RemoteTask>
    startTurn(args: RemoteTurnStartRequest): Promise<RemoteTurnStartResult>
    interruptTurn(taskId: string): Promise<void>
}

type RemoteClientConstructors = KernelSessionConstructors<RemoteRuntimeClient, RemoteOpenADEClient>

const remoteSessionDefaults = {
    clientName: "OpenADE Companion",
    clientPlatform: "mobile" as const,
    protocolVersion: 1,
    reconnect: true,
}
let remoteSessionManager = new KernelSessionManager<RemoteRuntimeClient, RemoteOpenADEClient>(defaultKernelSessionConstructors, remoteSessionDefaults)
const remoteProductStores = new Map<string, { openade: RemoteOpenADEClient; store: OpenADEProductStore }>()

function clearRuntimeClientCache(): void {
    for (const entry of remoteProductStores.values()) {
        entry.store.destroy()
    }
    remoteProductStores.clear()
    remoteSessionManager.clear()
}

export function __setRemoteClientConstructorsForTest(constructors: RemoteClientConstructors): () => void {
    const previous = remoteSessionManager
    clearRuntimeClientCache()
    remoteSessionManager = new KernelSessionManager<RemoteRuntimeClient, RemoteOpenADEClient>(constructors, remoteSessionDefaults)
    return () => {
        clearRuntimeClientCache()
        remoteSessionManager = previous
    }
}

export function remoteErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof RuntimeClientError && error.code === "unsupported_protocol_version") {
        return "Desktop update required. Update OpenADE on your desktop, then reconnect this app."
    }
    return error instanceof Error ? error.message : fallback
}

function notifyConfigSaved(value: string | null): void {
    window.dispatchEvent(new CustomEvent("openade-companion-config", { detail: value }))
}

function remoteConfigStore(): KernelSessionConfigStore {
    return new KernelSessionConfigStore({ storage: window.localStorage, storageKey: REMOTE_CONFIG_STORAGE_KEY, onChange: notifyConfigSaved })
}

export function loadRemoteConfigs(): RemoteConfig[] {
    return remoteConfigStore().loadConfigs()
}

export function loadRemoteConfig(): RemoteConfig | null {
    return remoteConfigStore().loadActive()
}

export function saveRemoteConfig(config: KernelSessionConfigInput): RemoteConfig {
    return remoteConfigStore().save(config)
}

export function activateRemoteConfig(configId: string): RemoteConfig | null {
    return remoteConfigStore().activate(configId)
}

export function removeRemoteConfig(configId: string): RemoteConfig | null {
    return remoteConfigStore().remove(configId)
}

export function clearRemoteConfig(): void {
    remoteConfigStore().clear()
}

function isTransientRuntimeReadError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /Runtime socket (closed|disconnected|failed|is not connected)|WebSocket/i.test(message)
}

async function retryTransientRead<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read()
    } catch (error) {
        if (!isTransientRuntimeReadError(error)) throw error
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
        return read()
    }
}

function runtimeEntry(
    config: RemoteConfig,
    onStatus?: (status: RemoteRealtimeConnectionStatus) => void
): { entry: KernelSessionEntry<RemoteRuntimeClient, RemoteOpenADEClient>; removeStatus: () => void } {
    return remoteSessionManager.session(config, onStatus)
}

function productStore(config: RemoteConfig): OpenADEProductStore {
    const { entry } = runtimeEntry(config)
    const cached = remoteProductStores.get(config.id)
    if (cached?.openade === entry.openade) return cached.store
    cached?.store.destroy()

    const store = new OpenADEProductStore(entry.openade)
    remoteProductStores.set(config.id, { openade: entry.openade, store })
    return store
}

export async function pairRemote(baseUrl: string, token: string): Promise<RemoteConfig> {
    const target = buildPairingTarget(baseUrl, token)
    const body: PairRequest = {
        token: target.token,
        deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : "Companion",
        platform: navigator.userAgent.includes("Android") ? "android" : navigator.userAgent.includes("iPhone") ? "ios" : "web",
    }
    const response = await fetch(`${target.baseUrl}/v1/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await response.text())
    const result = (await response.json()) as { deviceToken: string }
    return saveRemoteConfig({ baseUrl: target.baseUrl, token: result.deviceToken, host: target.host, hostId: target.hostId })
}

export function getSnapshot(config: RemoteConfig): Promise<RemoteSnapshot> {
    return retryTransientRead(() => productStore(config).refreshSnapshot())
}

export function getTask(config: RemoteConfig, repoId: string, taskId: string, options: OpenADETaskReadOptions = {}): Promise<RemoteTask> {
    return retryTransientRead(() => productStore(config).getTask(repoId, taskId, options))
}

export function readRemoteTaskImage(config: RemoteConfig, args: OpenADETaskImageReadRequest): Promise<OpenADETaskImageReadResult> {
    return retryTransientRead(() => productStore(config).readTaskImage(args))
}

export function readRemoteTaskChanges(config: RemoteConfig, args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult> {
    return retryTransientRead(() => productStore(config).readTaskChanges(args))
}

export function readRemoteTaskDiff(config: RemoteConfig, args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult> {
    return retryTransientRead(() => productStore(config).readTaskDiff(args))
}

export function readRemoteTaskFilePair(config: RemoteConfig, args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult> {
    return retryTransientRead(() => productStore(config).readTaskFilePair(args))
}

export function readRemoteTaskGitLog(config: RemoteConfig, args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult> {
    return retryTransientRead(() => productStore(config).readTaskGitLog(args))
}

export function listRemoteProjectFiles(config: RemoteConfig, args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult> {
    return retryTransientRead(() => productStore(config).listProjectFiles(args))
}

export function readRemoteProjectFile(config: RemoteConfig, args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult> {
    return retryTransientRead(() => productStore(config).readProjectFile(args))
}

export function searchRemoteProject(config: RemoteConfig, args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult> {
    return retryTransientRead(() => productStore(config).searchProject(args))
}

export function listRemoteProjectProcesses(config: RemoteConfig, args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult> {
    return retryTransientRead(() => productStore(config).listProjectProcesses(args))
}

export function startRemoteProjectProcess(config: RemoteConfig, args: OpenADEProjectProcessStartRequest): Promise<OpenADEProjectProcessStartResult> {
    return productStore(config).startProjectProcess(args)
}

export function reconnectRemoteProjectProcess(
    config: RemoteConfig,
    args: OpenADEProjectProcessReconnectRequest
): Promise<OpenADEProjectProcessReconnectResult> {
    return retryTransientRead(() => productStore(config).reconnectProjectProcess(args))
}

export function stopRemoteProjectProcess(config: RemoteConfig, args: OpenADEProjectProcessStopRequest): Promise<OpenADEProjectProcessStopResult> {
    return productStore(config).stopProjectProcess(args)
}

export function startRemoteTurn(config: RemoteConfig, args: RemoteTurnStartRequest): Promise<RemoteTurnStartResult> {
    return productStore(config).startTurn(args)
}

export function abortRemote(config: RemoteConfig, taskId: string): Promise<void> {
    return productStore(config).interruptTurn(taskId)
}

export function startRemoteReview(config: RemoteConfig, args: OpenADEReviewStartRequest): Promise<{ taskId: string }> {
    return productStore(config).startReview(args)
}

export function cancelRemoteQueuedTurn(config: RemoteConfig, args: OpenADEQueuedTurnCancelRequest): Promise<OpenADEQueuedTurnCancelResult> {
    return productStore(config).cancelQueuedTurn(args)
}

export function updateRemoteTaskMetadata(config: RemoteConfig, args: OpenADETaskMetadataUpdateRequest): Promise<void> {
    return productStore(config).updateTaskMetadata(args)
}

export function createRemoteComment(config: RemoteConfig, args: OpenADECommentCreateRequest): Promise<OpenADECommentCreateResult> {
    return productStore(config).createComment(args)
}

export function editRemoteComment(config: RemoteConfig, args: OpenADECommentEditRequest): Promise<void> {
    return productStore(config).editComment(args)
}

export function deleteRemoteComment(config: RemoteConfig, args: OpenADECommentDeleteRequest): Promise<void> {
    return productStore(config).deleteComment(args)
}

export function deleteRemoteTask(config: RemoteConfig, args: OpenADETaskDeleteRequest): Promise<OpenADETaskDeleteResult> {
    return productStore(config).deleteTask(args)
}

export function selfRevokeRemoteDevice(config: RemoteConfig): Promise<RemoteDeviceSelfRevokeResult> {
    return runtimeEntry(config).entry.runtime.request("remote/device/selfRevoke")
}

export function subscribeRemoteChanges(
    config: RemoteConfig,
    onEvent: (notification: RuntimeNotification) => void,
    onStatus?: (status: RemoteRealtimeConnectionStatus) => void
): () => void {
    const { entry, removeStatus } = runtimeEntry(config, onStatus)
    const unsubscribe = entry.openade.subscribeToChanges((notification) => {
        onEvent(notification)
    })

    return () => {
        unsubscribe()
        removeStatus()
    }
}
