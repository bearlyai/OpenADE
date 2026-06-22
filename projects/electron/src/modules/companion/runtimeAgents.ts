import type { RuntimeServer } from "../../../../runtime/src"
import type { HarnessIpcContentBlock, HarnessIpcQueryOptions, HarnessIpcToolResult } from "@openade/harness"
import {
    createRuntimeNodeAgentBridgeRegistry,
    createRuntimeNodeHarnessAgentExecutor,
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
const sessionAgentExecutor = createRuntimeNodeHarnessAgentExecutor()

export function registerServerProtocolAgentBridge(bridge: RuntimeNodeServerProtocolAgentBridge): () => void {
    return registerRuntimeNodeServerProtocolAgentBridge(bridge, electronAgentBridgeRegistry)
}

type RuntimeHarnessStartParams = Parameters<typeof startRuntimeHarnessQuery>[0]

function recordValue(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function requiredString(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is invalid`)
    return value
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (!Array.isArray(value)) throw new Error(`${key} is invalid`)
    for (const [index, item] of value.entries()) {
        if (typeof item !== "string") throw new Error(`${key}.${index} is invalid`)
    }
    return value
}

function optionalStringRecord(record: Record<string, unknown>, key: string): Record<string, string> | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${key} is invalid`)
    const result: Record<string, string> = {}
    for (const [recordKey, recordValue] of Object.entries(value)) {
        if (typeof recordValue !== "string") throw new Error(`${key}.${recordKey} is invalid`)
        result[recordKey] = recordValue
    }
    return result
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
    const value = record[key]
    return typeof value === "boolean" ? value : undefined
}

function optionalThinking(record: Record<string, unknown>, key: string): HarnessIpcQueryOptions["thinking"] {
    const value = record[key]
    return value === "low" || value === "med" || value === "high" || value === "max" ? value : undefined
}

function optionalMode(record: Record<string, unknown>, key: string): HarnessIpcQueryOptions["mode"] {
    const value = record[key]
    return value === "read-only" || value === "yolo" ? value : undefined
}

function knownHarnessId(value: string): HarnessIpcQueryOptions["harnessId"] | null {
    if (value === "claude-code" || value === "codex") return value
    return null
}

function runtimeHarnessContentBlock(value: unknown): HarnessIpcContentBlock | null {
    const record = recordValue(value)
    if (record.type === "text" && typeof record.text === "string") return { type: "text", text: record.text }
    if (record.type !== "image") return null

    const source = recordValue(record.source)
    if (source.type === "base64" && typeof source.media_type === "string" && typeof source.data === "string") {
        return { type: "image", source: { type: "base64", media_type: source.media_type, data: source.data } }
    }
    if (source.kind === "base64" && typeof source.mediaType === "string" && typeof source.data === "string") {
        return { type: "image", source: { type: "base64", media_type: source.mediaType, data: source.data } }
    }
    return null
}

function runtimeHarnessPrompt(value: RuntimeNodeAgentStartParams["prompt"]): RuntimeHarnessStartParams["prompt"] {
    if (typeof value === "string") return value
    return value.map((part, index) => {
        const block = runtimeHarnessContentBlock(part)
        if (!block) throw new Error(`prompt.${index} is invalid`)
        return block
    })
}

function runtimeHarnessOptionsFromRecord(record: Record<string, unknown>, parsedHarnessId: HarnessIpcQueryOptions["harnessId"]): HarnessIpcQueryOptions {
    return {
        harnessId: parsedHarnessId,
        cwd: requiredString(record, "cwd"),
        mode: optionalMode(record, "mode"),
        model: optionalString(record, "model"),
        thinking: optionalThinking(record, "thinking"),
        fastMode: optionalBoolean(record, "fastMode"),
        appendSystemPrompt: optionalString(record, "appendSystemPrompt"),
        resumeSessionId: optionalString(record, "resumeSessionId"),
        forkSession: optionalBoolean(record, "forkSession"),
        processLabel: optionalString(record, "processLabel"),
        additionalDirectories: optionalStringArray(record, "additionalDirectories"),
        env: optionalStringRecord(record, "env"),
    }
}

function runtimeHarnessStartOptions(
    params: RuntimeNodeAgentStartParams,
    parsedHarnessId: HarnessIpcQueryOptions["harnessId"]
): RuntimeHarnessStartParams["options"] {
    return {
        harnessId: parsedHarnessId,
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
    }
}

function runtimeToolResult(value: unknown): HarnessIpcToolResult | undefined {
    if (value === undefined) return undefined
    const record = recordValue(value)
    const content = record.content
    if (!Array.isArray(content)) throw new Error("result.content is invalid")
    return {
        content: content.map((item, index) => {
            const contentRecord = recordValue(item)
            if (contentRecord.type !== "text" || typeof contentRecord.text !== "string") throw new Error(`result.content.${index} is invalid`)
            return { type: "text", text: contentRecord.text }
        }),
        isError: typeof record.isError === "boolean" ? record.isError : undefined,
    }
}

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
        const parsedHarnessId = knownHarnessId(params.harnessId)
        if (!parsedHarnessId) return Promise.resolve({ ok: false, error: `Unknown harness: ${params.harnessId}` })
        return startRuntimeHarnessQuery({
            executionId: params.executionId,
            prompt: runtimeHarnessPrompt(params.prompt),
            options: runtimeHarnessStartOptions(params, parsedHarnessId),
            onEvent: callbacks?.onEvent,
            onSpawn: callbacks?.onSpawn,
        })
    },
    interrupt(executionId) {
        return abortRuntimeHarnessQuery({ executionId })
    },
    reconnect(executionId, callbacks) {
        return reconnectRuntimeHarnessQuery({
            executionId,
            onEvent: callbacks?.onEvent,
        })
    },
    respondTool(params) {
        return respondRuntimeHarnessTool({
            executionId: params.executionId,
            callId: params.callId,
            result: runtimeToolResult(params.result),
            error: params.error,
        })
    },
    clearBuffer(executionId) {
        return clearRuntimeHarnessBuffer({ executionId })
    },
    structuredQuery(params) {
        const optionsRecord = params.options
        const rawHarnessId = requiredString(optionsRecord, "harnessId")
        const parsedHarnessId = knownHarnessId(rawHarnessId)
        if (!parsedHarnessId) return { ok: false, error: `Unknown harness: ${rawHarnessId}` }
        return structuredRuntimeHarnessQuery({
            prompt: runtimeHarnessPrompt(params.prompt),
            options: runtimeHarnessOptionsFromRecord(optionsRecord, parsedHarnessId),
            outputSchema: params.outputSchema,
        })
    },
    listSessions(params) {
        return sessionAgentExecutor.listSessions?.(params) ?? []
    },
    readSession(params) {
        return sessionAgentExecutor.readSession?.(params) ?? null
    },
    activeSession(params) {
        return sessionAgentExecutor.activeSession?.(params) ?? { active: false }
    },
    deleteSession(params) {
        return deleteRuntimeHarnessSession(params)
    },
}

export function registerRuntimeAgentModule(server: RuntimeServer): void {
    registerRuntimeNodeAgentModule(server, electronAgentExecutor, { bridgeRegistry: electronAgentBridgeRegistry })
}
