import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, open, type FileHandle } from "node:fs/promises"
import { dirname } from "node:path"
import type { Readable, Writable } from "node:stream"
import { promisify } from "node:util"
import type { Harness } from "./harness.js"
import { ClaudeCodeHarness } from "./harnesses/claude-code/index.js"
import { CodexHarness } from "./harnesses/codex/index.js"
import type { HarnessEvent, HarnessId, HarnessQuery, HarnessUsage, McpServerConfig, PromptPart, SlashCommand } from "./types.js"

const execFileAsync = promisify(execFile)
const WORKER_PROTOCOL_VERSION = 1

type WorkerStatus = "completed" | "failed" | "stopped"

export interface CommandAgentWorkerOptions {
    input: Readable
    output: Writable
    errorOutput?: Writable
    harnesses?: Partial<Record<HarnessId, WorkerHarness>>
    signal?: AbortSignal
    now?: () => Date
    gitRefs?: (cwd: string) => Promise<WorkerGitRefs | undefined>
    eventId?: () => string
    recoveryFile?: string
}

export interface WorkerHarness {
    query(query: HarnessQuery): AsyncGenerator<HarnessEvent<unknown>>
    discoverSlashCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]>
}

interface WorkerGitRefs {
    sha: string
    branch?: string
}

interface WorkerStartEnvelope {
    type: "start"
    protocolVersion: typeof WORKER_PROTOCOL_VERSION
    request: WorkerStartRequest
}

interface WorkerSDKCapabilitiesEnvelope {
    type: "sdkCapabilities"
    protocolVersion: typeof WORKER_PROTOCOL_VERSION
    request: WorkerSDKCapabilitiesRequest
}

type WorkerEnvelope = WorkerStartEnvelope | WorkerSDKCapabilitiesEnvelope

interface WorkerSDKCapabilitiesRequest {
    repoId: string
    repoPath: string
    cwd: string
    taskId?: string
    harnessId: HarnessId
}

interface WorkerStartRequest {
    runtimeId: string
    repoId: string
    repoPath: string
    cwd: string
    taskId: string
    eventId: string
    queuedTurnId?: string
    executionId: string
    harnessId: HarnessId
    modelId?: string
    turnType: string
    input: string
    appendSystemPrompt?: string
    enabledMcpServerIds?: string[]
    mcpServerConfigs?: Record<string, McpServerConfig>
    readOnly?: boolean
    includeComments?: boolean
    thinking?: "low" | "med" | "high" | "max"
    fastMode?: boolean
    source?: unknown
    images?: unknown
}

type WorkerStreamEvent =
    | {
          id: string
          direction: "execution"
          type: "raw_message"
          executionId: string
          harnessId: HarnessId
          message: unknown
      }
    | {
          id: string
          direction: "execution"
          type: "session_started"
          executionId: string
          harnessId: HarnessId
          sessionId: string
      }
    | {
          id: string
          direction: "execution"
          type: "stderr"
          executionId: string
          harnessId: HarnessId
          data: string
      }
    | {
          id: string
          direction: "execution"
          type: "complete"
          executionId: string
          harnessId: HarnessId
          usage?: HarnessUsage
      }
    | {
          id: string
          direction: "execution"
          type: "error"
          executionId: string
          harnessId: HarnessId
          error: string
          code?: string
      }

type WorkerMessage =
    | { type: "stream"; event: WorkerStreamEvent }
    | { type: "execution"; sessionId?: string; gitRefsAfter?: WorkerGitRefs }
    | { type: "sdkCapabilities"; slash_commands: string[]; skills: string[]; plugins: WorkerPluginCapability[]; cachedAt: number }
    | { type: "result"; status: WorkerStatus; success?: boolean; error?: string; completedAt: string }

interface WorkerPluginCapability {
    name: string
    path: string
}

interface WorkerRunState {
    sessionId?: string
    sawError: boolean
    sawComplete: boolean
    errorMessage?: string
}

interface RecoveryWriter {
    append(line: string): Promise<void>
    close(): Promise<void>
}

interface WorkerOutputState {
    available: boolean
}

export async function runCommandAgentWorker(options: CommandAgentWorkerOptions): Promise<number> {
    const now = options.now ?? (() => new Date())
    const recoveryWriter = await openRecoveryWriter(options.recoveryFile, options.errorOutput)
    const outputState: WorkerOutputState = { available: true }
    if (recoveryWriter) {
        options.output.on("error", () => {
            outputState.available = false
        })
    }
    const write = (message: WorkerMessage) => writeWorkerMessage(options.output, message, recoveryWriter, outputState)

    try {
        let envelope: WorkerEnvelope
        try {
            envelope = parseWorkerEnvelope(JSON.parse(await readAll(options.input)))
        } catch (error) {
            writeError(options.errorOutput, `Invalid worker envelope: ${errorMessage(error)}\n`)
            return 1
        }

        if (envelope.type === "sdkCapabilities") {
            return runSDKCapabilitiesWorker(envelope.request, workerHarnesses(options.harnesses), write, now, options.signal)
        }

        const request = envelope.request
        const harness = workerHarnesses(options.harnesses)[request.harnessId]
        if (!harness) {
            await write({
                type: "result",
                status: "failed",
                success: false,
                error: `Harness is not configured: ${request.harnessId}`,
                completedAt: now().toISOString(),
            })
            return 0
        }

        const state: WorkerRunState = {
            sawError: false,
            sawComplete: false,
        }

        try {
            const query = commandWorkerHarnessQuery(request, options.signal ?? new AbortController().signal)
            for await (const event of harness.query(query)) {
                await emitHarnessEvent(write, request, event, state, options.eventId ?? defaultEventId)
            }
        } catch (error) {
            state.sawError = true
            state.errorMessage = errorMessage(error)
            await write({
                type: "stream",
                event: {
                    id: (options.eventId ?? defaultEventId)(),
                    direction: "execution",
                    type: "error",
                    executionId: request.executionId,
                    harnessId: request.harnessId,
                    error: state.errorMessage,
                    code: "unknown",
                },
            })
        }

        if (options.signal?.aborted) {
            await write({
                type: "result",
                status: "stopped",
                success: false,
                completedAt: now().toISOString(),
            })
            return 0
        }

        const gitRefsAfter = await readGitRefsAfter(request.cwd || request.repoPath, options.gitRefs ?? defaultGitRefs)
        if (state.sessionId || gitRefsAfter) {
            await write({
                type: "execution",
                sessionId: state.sessionId,
                gitRefsAfter,
            })
        }

        const failed = state.sawError && !state.sawComplete
        await write({
            type: "result",
            status: failed ? "failed" : "completed",
            success: !state.sawError,
            error: failed ? state.errorMessage : undefined,
            completedAt: now().toISOString(),
        })
        return 0
    } finally {
        await recoveryWriter?.close()
    }
}

async function runSDKCapabilitiesWorker(
    request: WorkerSDKCapabilitiesRequest,
    harnesses: Partial<Record<HarnessId, WorkerHarness>>,
    write: (message: WorkerMessage) => Promise<void>,
    now: () => Date,
    signal: AbortSignal | undefined
): Promise<number> {
    const harness = harnesses[request.harnessId]
    if (!harness) {
        await write({
            type: "result",
            status: "failed",
            success: false,
            error: `Harness is not configured: ${request.harnessId}`,
            completedAt: now().toISOString(),
        })
        return 0
    }

    try {
        const commands = await harness.discoverSlashCommands(request.cwd || request.repoPath, signal)
        await write({
            type: "sdkCapabilities",
            slash_commands: commands.filter((command) => command.type === "slash_command").map((command) => command.name),
            skills: commands.filter((command) => command.type === "skill").map((command) => command.name),
            plugins: [],
            cachedAt: now().getTime(),
        })
    } catch (error) {
        await write({
            type: "result",
            status: "failed",
            success: false,
            error: errorMessage(error),
            completedAt: now().toISOString(),
        })
    }
    return 0
}

function commandWorkerHarnessQuery(request: WorkerStartRequest, signal: AbortSignal): HarnessQuery {
    return {
        prompt: promptFromRequest(request),
        cwd: request.cwd || request.repoPath,
        mode: request.readOnly === true ? "read-only" : "yolo",
        model: request.modelId,
        thinking: request.thinking,
        fastMode: request.fastMode,
        appendSystemPrompt: request.appendSystemPrompt,
        mcpServers: request.mcpServerConfigs,
        processLabel: `openade-agent-${request.executionId}`,
        signal,
    }
}

async function emitHarnessEvent(
    write: (message: WorkerMessage) => Promise<void>,
    request: WorkerStartRequest,
    event: HarnessEvent<unknown>,
    state: WorkerRunState,
    eventId: () => string
): Promise<void> {
    switch (event.type) {
        case "message":
            await write({
                type: "stream",
                event: {
                    id: eventId(),
                    direction: "execution",
                    type: "raw_message",
                    executionId: request.executionId,
                    harnessId: request.harnessId,
                    message: event.message,
                },
            })
            break
        case "session_started":
            state.sessionId = event.sessionId
            await write({
                type: "stream",
                event: {
                    id: eventId(),
                    direction: "execution",
                    type: "session_started",
                    executionId: request.executionId,
                    harnessId: request.harnessId,
                    sessionId: event.sessionId,
                },
            })
            break
        case "stderr":
            await write({
                type: "stream",
                event: {
                    id: eventId(),
                    direction: "execution",
                    type: "stderr",
                    executionId: request.executionId,
                    harnessId: request.harnessId,
                    data: event.data,
                },
            })
            break
        case "complete":
            state.sawComplete = true
            await write({
                type: "stream",
                event: {
                    id: eventId(),
                    direction: "execution",
                    type: "complete",
                    executionId: request.executionId,
                    harnessId: request.harnessId,
                    usage: event.usage,
                },
            })
            break
        case "error":
            state.sawError = true
            state.errorMessage = event.error
            await write({
                type: "stream",
                event: {
                    id: eventId(),
                    direction: "execution",
                    type: "error",
                    executionId: request.executionId,
                    harnessId: request.harnessId,
                    error: event.error,
                    code: event.code,
                },
            })
            break
    }
}

function defaultHarnesses(): Record<HarnessId, WorkerHarness> {
    return {
        "claude-code": adaptHarness(new ClaudeCodeHarness()),
        codex: adaptHarness(new CodexHarness()),
    }
}

function workerHarnesses(harnesses: Partial<Record<HarnessId, WorkerHarness>> | undefined): Partial<Record<HarnessId, WorkerHarness>> {
    if (harnesses) return harnesses
    return deterministicSmokeHarnessEnabled() ? deterministicSmokeHarnesses() : defaultHarnesses()
}

function deterministicSmokeHarnessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.OPENADE_SMOKE_TEST === "1" && env.OPENADE_SMOKE_DETERMINISTIC_HARNESS === "1"
}

function deterministicSmokeHarnesses(): Record<HarnessId, WorkerHarness> {
    return {
        "claude-code": deterministicSmokeHarness("claude-code"),
        codex: deterministicSmokeHarness("codex"),
    }
}

function deterministicSmokeHarness(harnessId: HarnessId, env: NodeJS.ProcessEnv = process.env): WorkerHarness {
    return {
        async discoverSlashCommands(): Promise<SlashCommand[]> {
            return []
        },
        async *query(query: HarnessQuery): AsyncGenerator<HarnessEvent<unknown>> {
            const delayMs = deterministicSmokeDelayMs(query, env)
            if (delayMs > 0) {
                await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
            }
            yield { type: "session_started", sessionId: `smoke-${harnessId}-session` }
            yield { type: "message", message: deterministicSmokeMessage(harnessId) }
            yield { type: "complete", usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 } }
        },
    }
}

function deterministicSmokeDelayMs(query: HarnessQuery, env: NodeJS.ProcessEnv): number {
    const promptNeedle = env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_PROMPT?.trim()
    if (!promptNeedle || !promptText(query.prompt).includes(promptNeedle)) return 0
    const parsed = Number(env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_MS?.trim())
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.min(Math.trunc(parsed), 30_000)
}

function promptText(prompt: HarnessQuery["prompt"]): string {
    if (typeof prompt === "string") return prompt
    if (!Array.isArray(prompt)) return ""
    return prompt.map((part) => (part.type === "text" ? part.text : "")).join("\n")
}

function deterministicSmokeMessage(harnessId: HarnessId): unknown {
    if (harnessId === "codex") {
        return {
            type: "item.completed",
            item: {
                type: "agent_message",
                text: "Deterministic Core smoke response.",
            },
        }
    }

    return {
        type: "assistant",
        message: {
            content: [{ type: "text", text: "Deterministic Core smoke response." }],
        },
    }
}

function adaptHarness<M>(harness: Harness<M>): WorkerHarness {
    return {
        discoverSlashCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]> {
            return harness.discoverSlashCommands(cwd, signal)
        },
        query(query: HarnessQuery): AsyncGenerator<HarnessEvent<unknown>> {
            return queryUnknown(harness, query)
        },
    }
}

async function* queryUnknown<M>(harness: Harness<M>, query: HarnessQuery): AsyncGenerator<HarnessEvent<unknown>> {
    for await (const event of harness.query(query)) {
        yield event
    }
}

function promptFromRequest(request: WorkerStartRequest): HarnessQuery["prompt"] {
    const imageParts = promptImageParts(request.images)
    if (imageParts.length === 0) return request.input
    const textPart: PromptPart = { type: "text", text: request.input }
    return [textPart, ...imageParts]
}

function promptImageParts(images: unknown): PromptPart[] {
    if (!Array.isArray(images)) return []
    const parts: PromptPart[] = []
    for (const image of images) {
        if (!isRecord(image)) continue
        const source = image.source
        if (isRecord(source) && source.kind === "base64" && typeof source.data === "string" && typeof source.mediaType === "string") {
            parts.push({ type: "image", source: { kind: "base64", data: source.data, mediaType: source.mediaType } })
            continue
        }
        if (isRecord(source) && source.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string") {
            parts.push({ type: "image", source: { kind: "base64", data: source.data, mediaType: source.media_type } })
        }
    }
    return parts
}

async function defaultGitRefs(cwd: string): Promise<WorkerGitRefs | undefined> {
    try {
        const [{ stdout: shaRaw }, { stdout: branchRaw }] = await Promise.all([
            execFileAsync("git", ["rev-parse", "HEAD"], { cwd }),
            execFileAsync("git", ["branch", "--show-current"], { cwd }),
        ])
        const sha = shaRaw.trim()
        if (!sha) return undefined
        const branch = branchRaw.trim()
        return branch ? { sha, branch } : { sha }
    } catch {
        return undefined
    }
}

async function readGitRefsAfter(cwd: string, gitRefs: (cwd: string) => Promise<WorkerGitRefs | undefined>): Promise<WorkerGitRefs | undefined> {
    if (!cwd.trim()) return undefined
    return gitRefs(cwd)
}

function parseWorkerEnvelope(value: unknown): WorkerEnvelope {
    const envelope = objectValue(value, "envelope")
    if (envelope.type === "sdkCapabilities") return parseSDKCapabilitiesEnvelope(envelope)
    return parseStartEnvelope(envelope)
}

function parseStartEnvelope(envelope: Record<string, unknown>): WorkerStartEnvelope {
    if (envelope.type !== "start") throw new Error("type must be start")
    if (envelope.protocolVersion !== WORKER_PROTOCOL_VERSION) throw new Error("protocolVersion is unsupported")
    const request = objectValue(envelope.request, "request")
    return {
        type: "start",
        protocolVersion: WORKER_PROTOCOL_VERSION,
        request: {
            runtimeId: requiredString(request.runtimeId, "runtimeId"),
            repoId: requiredString(request.repoId, "repoId"),
            repoPath: requiredString(request.repoPath, "repoPath"),
            cwd: optionalString(request.cwd) ?? requiredString(request.repoPath, "repoPath"),
            taskId: requiredString(request.taskId, "taskId"),
            eventId: requiredString(request.eventId, "eventId"),
            queuedTurnId: optionalString(request.queuedTurnId),
            executionId: requiredString(request.executionId, "executionId"),
            harnessId: harnessIdValue(request.harnessId),
            modelId: optionalString(request.modelId),
            turnType: requiredString(request.turnType, "turnType"),
            input: typeof request.input === "string" ? request.input : "",
            appendSystemPrompt: optionalString(request.appendSystemPrompt),
            enabledMcpServerIds: stringArray(request.enabledMcpServerIds),
            mcpServerConfigs: mcpServerConfigs(request.mcpServerConfigs),
            readOnly: optionalBoolean(request.readOnly),
            includeComments: optionalBoolean(request.includeComments),
            thinking: thinkingValue(request.thinking),
            fastMode: optionalBoolean(request.fastMode),
            source: request.source,
            images: request.images,
        },
    }
}

function parseSDKCapabilitiesEnvelope(envelope: Record<string, unknown>): WorkerSDKCapabilitiesEnvelope {
    if (envelope.protocolVersion !== WORKER_PROTOCOL_VERSION) throw new Error("protocolVersion is unsupported")
    const request = objectValue(envelope.request, "request")
    const repoPath = requiredString(request.repoPath, "repoPath")
    return {
        type: "sdkCapabilities",
        protocolVersion: WORKER_PROTOCOL_VERSION,
        request: {
            repoId: requiredString(request.repoId, "repoId"),
            repoPath,
            cwd: optionalString(request.cwd) ?? repoPath,
            taskId: optionalString(request.taskId),
            harnessId: harnessIdValue(request.harnessId),
        },
    }
}

async function readAll(input: Readable): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of input) {
        if (typeof chunk === "string") {
            chunks.push(Buffer.from(chunk))
        } else if (chunk instanceof Buffer) {
            chunks.push(chunk)
        } else {
            chunks.push(Buffer.from(String(chunk)))
        }
    }
    return Buffer.concat(chunks).toString("utf8")
}

async function openRecoveryWriter(filePath: string | undefined, errorOutput: Writable | undefined): Promise<RecoveryWriter | undefined> {
    const trimmed = filePath?.trim()
    if (!trimmed) return undefined
    try {
        await mkdir(dirname(trimmed), { recursive: true })
        const handle = await open(trimmed, "a")
        return newFileRecoveryWriter(handle)
    } catch (error) {
        writeError(errorOutput, `Failed to open worker recovery file: ${errorMessage(error)}\n`)
        return undefined
    }
}

function newFileRecoveryWriter(handle: FileHandle): RecoveryWriter {
    return {
        async append(line: string): Promise<void> {
            await handle.write(`${line}\n`)
        },
        async close(): Promise<void> {
            await handle.close()
        },
    }
}

async function writeWorkerMessage(
    output: Writable,
    message: WorkerMessage,
    recoveryWriter: RecoveryWriter | undefined,
    outputState: WorkerOutputState
): Promise<void> {
    const line = JSON.stringify(message)
    await recoveryWriter?.append(line)
    if (recoveryWriter && !outputState.available) return
    return new Promise((resolve, reject) => {
        output.write(`${line}\n`, (error: Error | null | undefined) => {
            if (error && !recoveryWriter) {
                reject(error)
                return
            }
            if (error) outputState.available = false
            resolve()
        })
    })
}

function writeError(output: Writable | undefined, message: string): void {
    output?.write(message)
}

function defaultEventId(): string {
    return randomUUID()
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown worker error"
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`${name} must be an object`)
    return value
}

function requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`)
    return value
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const result = value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    return result.length > 0 ? result : undefined
}

function mcpServerConfigs(value: unknown): Record<string, McpServerConfig> | undefined {
    if (!isRecord(value)) return undefined
    const result: Record<string, McpServerConfig> = {}
    for (const [name, config] of Object.entries(value)) {
        if (name.trim() === "" || !isRecord(config)) continue
        if (config.type === "http") {
            const url = requiredString(config.url, `mcpServerConfigs.${name}.url`)
            result[name] = {
                type: "http",
                url,
                headers: stringRecord(config.headers),
            }
            continue
        }
        if (config.type === "stdio") {
            const command = requiredString(config.command, `mcpServerConfigs.${name}.command`)
            result[name] = {
                type: "stdio",
                command,
                args: stringArray(config.args),
                env: stringRecord(config.env),
                cwd: optionalString(config.cwd),
            }
        }
    }
    return Object.keys(result).length > 0 ? result : undefined
}

function stringRecord(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) return undefined
    const result: Record<string, string> = {}
    for (const [key, nested] of Object.entries(value)) {
        if (typeof nested === "string") result[key] = nested
    }
    return Object.keys(result).length > 0 ? result : undefined
}

function harnessIdValue(value: unknown): HarnessId {
    if (value === "claude-code" || value === "codex") return value
    throw new Error("harnessId is unsupported")
}

function thinkingValue(value: unknown): WorkerStartRequest["thinking"] {
    if (value === "low" || value === "med" || value === "high" || value === "max") return value
    return undefined
}
