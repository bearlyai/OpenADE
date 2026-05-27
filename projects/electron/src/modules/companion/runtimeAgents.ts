import type { RuntimeServer } from "../../../../runtime/src"
import {
    createRuntimeNodeAgentBridgeRegistry,
    registerRuntimeNodeAgentModule,
    registerRuntimeNodeServerProtocolAgentBridge,
    type RuntimeNodeAgentExecutor,
    type RuntimeNodeAgentStartCallbacks,
    type RuntimeNodeAgentStartParams,
    type RuntimeNodeServerProtocolAgentBridge,
} from "../../../../runtime-node/src"
import {
    abortRuntimeHarnessQuery,
    checkRuntimeHarnessStatus,
    clearRuntimeHarnessBuffer,
    deleteRuntimeHarnessSession,
    reconnectRuntimeHarnessQuery,
    respondRuntimeHarnessTool,
    startRuntimeHarnessQuery,
    structuredRuntimeHarnessQuery,
} from "../code/harness"

export type ServerProtocolAgentBridge = RuntimeNodeServerProtocolAgentBridge
const electronAgentBridgeRegistry = createRuntimeNodeAgentBridgeRegistry()

export function registerServerProtocolAgentBridge(bridge: RuntimeNodeServerProtocolAgentBridge): () => void {
    return registerRuntimeNodeServerProtocolAgentBridge(bridge, electronAgentBridgeRegistry)
}

type RuntimeHarnessStartParams = Parameters<typeof startRuntimeHarnessQuery>[0]
type RuntimeHarnessStructuredParams = Parameters<typeof structuredRuntimeHarnessQuery>[0]
type RuntimeToolResponseParams = Parameters<typeof respondRuntimeHarnessTool>[0]

const electronAgentExecutor: RuntimeNodeAgentExecutor = {
    providers() {
        return []
    },
    async status(providerId) {
        const status = await checkRuntimeHarnessStatus()
        return providerId
            ? (status[providerId] as Awaited<ReturnType<RuntimeNodeAgentExecutor["status"]>> | undefined) ?? null
            : (status as Awaited<ReturnType<RuntimeNodeAgentExecutor["status"]>>)
    },
    start(params: RuntimeNodeAgentStartParams, callbacks?: RuntimeNodeAgentStartCallbacks) {
        return startRuntimeHarnessQuery({
            executionId: params.executionId,
            prompt: params.prompt as RuntimeHarnessStartParams["prompt"],
            options: {
                harnessId: params.harnessId,
                cwd: params.cwd,
                mode: params.mode,
                model: params.model,
                thinking: params.thinking,
                fastMode: params.fastMode,
                appendSystemPrompt: params.appendSystemPrompt,
                resumeSessionId: params.resumeSessionId,
                forkSession: params.forkSession,
                processLabel: params.processLabel,
                additionalDirectories: params.additionalDirectories,
                env: params.env,
                mcpServerConfigs: params.mcpServerConfigs,
            } as RuntimeHarnessStartParams["options"],
            onEvent: callbacks?.onEvent as RuntimeHarnessStartParams["onEvent"],
            onSpawn: callbacks?.onSpawn,
        })
    },
    interrupt(executionId) {
        return abortRuntimeHarnessQuery({ executionId })
    },
    reconnect(executionId, callbacks) {
        return reconnectRuntimeHarnessQuery({
            executionId,
            onEvent: callbacks?.onEvent as Parameters<typeof reconnectRuntimeHarnessQuery>[0]["onEvent"],
        })
    },
    respondTool(params) {
        return respondRuntimeHarnessTool(params as RuntimeToolResponseParams)
    },
    clearBuffer(executionId) {
        return clearRuntimeHarnessBuffer({ executionId })
    },
    structuredQuery(params) {
        return structuredRuntimeHarnessQuery({
            prompt: params.prompt as RuntimeHarnessStructuredParams["prompt"],
            options: params.options as unknown as RuntimeHarnessStructuredParams["options"],
            outputSchema: params.outputSchema,
        })
    },
    deleteSession(params) {
        return deleteRuntimeHarnessSession(params)
    },
}

export function registerRuntimeAgentModule(server: RuntimeServer): void {
    registerRuntimeNodeAgentModule(server, electronAgentExecutor, { bridgeRegistry: electronAgentBridgeRegistry })
}
