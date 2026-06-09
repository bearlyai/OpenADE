export type RuntimeRequestId = string | number

export interface RuntimeRequest {
    id: RuntimeRequestId
    method: string
    params?: unknown
}

export interface RuntimeResponse {
    id: RuntimeRequestId
    result?: unknown
    error?: RuntimeError
}

export interface RuntimeNotification {
    method: string
    params?: unknown
    cursor?: string
}

export type RuntimeMessage = RuntimeRequest | RuntimeResponse | RuntimeNotification

export interface RuntimeError {
    code: string
    message: string
    data?: unknown
}

export interface RuntimeInitializeParams {
    clientName?: string
    clientVersion?: string
    clientPlatform?: "desktop" | "mobile" | "web" | "cli" | "unknown"
    protocolVersion?: number
}

export interface RuntimeInitializeResult {
    protocolVersion: number
    serverName: string
    serverVersion?: string
    capabilities: RuntimeCapabilities
}

export interface RuntimeSubscriptionUpdateParams {
    methods?: string[]
    cursor?: RuntimeRequestId
}

export interface RuntimeCapabilities {
    methods: string[]
    notifications: string[]
    agentProviders: AgentProviderSummary[]
}

export interface AgentProviderSummary {
    providerId: string
    label: string
    kind: "process" | "serverProtocol"
    capabilities: AgentProviderCapabilities
}

export interface AgentProviderCapabilities {
    execution: boolean
    streaming: boolean
    sessions: boolean
    steering: boolean
    interrupt: boolean
    goals: boolean
    approvals: boolean
    filesystem: boolean
    processExec: boolean
}

export type RuntimeStatus = "starting" | "running" | "completed" | "failed" | "stopped" | "orphaned"

export interface RuntimeScope {
    workspaceId?: string
    rootPath?: string
    repoPath?: string
    correlationId?: string
    ownerType?: string
    ownerId?: string
    labels?: Record<string, string>
}

export interface RuntimeRecord {
    runtimeId: string
    kind: "agent" | "process" | "pty" | "git" | "fsWatch" | "composite"
    status: RuntimeStatus
    scope: RuntimeScope
    startedAt: string
    updatedAt: string
    lastActivityAt: string
    nativeId?: string
    pid?: number
    pgid?: number
    processLabel?: string
    processStartedAt?: string
    exitedAt?: string
    exitCode?: number | null
    signal?: string | null
    error?: string
}

export interface RuntimeListParams {
    ownerType?: string
    ownerId?: string
    status?: RuntimeStatus
    statuses?: RuntimeStatus[]
}

export interface RuntimeIdParams {
    runtimeId: string
}

export interface RuntimeStopParams extends RuntimeIdParams {
    reason?: string
}

export interface AgentProviderIdParams {
    providerId: string
}

export interface AgentGoalCreateParams {
    providerId: string
    threadId?: string
    objective: string
    tokenBudget?: number
}

export type AgentThreadGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete"

export interface AgentThreadGoal {
    providerId: string
    threadId: string
    objective: string
    status: AgentThreadGoalStatus
    tokenBudget?: number | null
    tokensUsed?: number
    timeUsedSeconds?: number
    createdAt?: string
    updatedAt?: string
}

export interface AgentThreadStartParams {
    providerId: string
    cwd?: string
    model?: string
    approvalPolicy?: string
    sandbox?: string
    config?: Record<string, unknown>
    baseInstructions?: string
    developerInstructions?: string
    ephemeral?: boolean
}

export interface AgentThreadResumeParams extends AgentThreadStartParams {
    threadId: string
}

export interface AgentTurnStartParams {
    providerId: string
    threadId: string
    input: string
    approvalPolicy?: string
    approvalsReviewer?: string
    cwd?: string
    config?: Record<string, unknown>
}

export interface AgentTurnSteerParams extends AgentTurnStartParams {
    expectedTurnId?: string
    turnId?: string
}

export interface AgentTurnInterruptParams {
    providerId: string
    threadId: string
    turnId?: string
}

export interface AgentGoalSetParams {
    providerId: string
    threadId: string
    objective?: string | null
    status?: AgentThreadGoalStatus | null
    tokenBudget?: number | null
}

export interface AgentGoalGetParams {
    providerId: string
    threadId: string
}

export interface AgentGoalClearParams {
    providerId: string
    threadId: string
}

export interface AgentGoalUpdateParams {
    providerId: string
    goalId?: string
    threadId?: string
    objective?: string
    status?: "active" | "complete" | "blocked"
    tokenBudget?: number | null
    note?: string
}

export interface RuntimeValidationError {
    code: string
    message: string
    path?: string
}

export type RuntimeValidationResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: RuntimeValidationError }

export const RuntimeRequestIdSchema = {
    anyOf: [{ type: "string" }, { type: "number" }],
} as const

export const RuntimeErrorSchema = {
    type: "object",
    required: ["code", "message"],
    additionalProperties: true,
    properties: {
        code: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1 },
        data: {},
    },
} as const

export const RuntimeRequestSchema = {
    type: "object",
    required: ["id", "method"],
    additionalProperties: true,
    properties: {
        id: RuntimeRequestIdSchema,
        method: { type: "string", minLength: 1 },
        params: {},
    },
} as const

export const RuntimeResponseSchema = {
    type: "object",
    required: ["id"],
    additionalProperties: true,
    properties: {
        id: RuntimeRequestIdSchema,
        result: {},
        error: RuntimeErrorSchema,
    },
} as const

export const RuntimeNotificationSchema = {
    type: "object",
    required: ["method"],
    additionalProperties: true,
    properties: {
        method: { type: "string", minLength: 1 },
        params: {},
        cursor: { type: "string" },
    },
} as const

export const RuntimeScopeSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        workspaceId: { type: "string" },
        rootPath: { type: "string" },
        repoPath: { type: "string" },
        correlationId: { type: "string" },
        ownerType: { type: "string" },
        ownerId: { type: "string" },
        labels: {
            type: "object",
            additionalProperties: { type: "string" },
        },
    },
} as const

export const RuntimeRecordSchema = {
    type: "object",
    required: ["runtimeId", "kind", "status", "scope", "startedAt", "updatedAt", "lastActivityAt"],
    additionalProperties: false,
    properties: {
        runtimeId: { type: "string", minLength: 1 },
        kind: { enum: ["agent", "process", "pty", "git", "fsWatch", "composite"] },
        status: { enum: ["starting", "running", "completed", "failed", "stopped", "orphaned"] },
        scope: RuntimeScopeSchema,
        startedAt: { type: "string", minLength: 1 },
        updatedAt: { type: "string", minLength: 1 },
        lastActivityAt: { type: "string", minLength: 1 },
        nativeId: { type: "string" },
        pid: { type: "number" },
        pgid: { type: "number" },
        processLabel: { type: "string" },
        processStartedAt: { type: "string" },
        exitedAt: { type: "string" },
        exitCode: { anyOf: [{ type: "number" }, { type: "null" }] },
        signal: { anyOf: [{ type: "string" }, { type: "null" }] },
        error: { type: "string" },
    },
} as const

export const RuntimeInitializeParamsSchema = {
    type: "object",
    additionalProperties: true,
    properties: {
        clientName: { type: "string" },
        clientVersion: { type: "string" },
        clientPlatform: { enum: ["desktop", "mobile", "web", "cli", "unknown"] },
        protocolVersion: { type: "number" },
    },
} as const

export const RuntimeSubscriptionUpdateParamsSchema = {
    type: "object",
    additionalProperties: true,
    properties: {
        methods: {
            type: "array",
            items: { type: "string", minLength: 1 },
        },
        cursor: RuntimeRequestIdSchema,
    },
} as const

export const RuntimeListParamsSchema = {
    type: "object",
    additionalProperties: true,
    properties: {
        ownerType: { type: "string", minLength: 1 },
        ownerId: { type: "string", minLength: 1 },
        status: { enum: ["starting", "running", "completed", "failed", "stopped", "orphaned"] },
        statuses: {
            type: "array",
            items: { enum: ["starting", "running", "completed", "failed", "stopped", "orphaned"] },
        },
    },
} as const

export const RuntimeIdParamsSchema = {
    type: "object",
    required: ["runtimeId"],
    additionalProperties: true,
    properties: {
        runtimeId: { type: "string", minLength: 1 },
    },
} as const

export const RuntimeStopParamsSchema = {
    type: "object",
    required: ["runtimeId"],
    additionalProperties: true,
    properties: {
        runtimeId: { type: "string", minLength: 1 },
        reason: { type: "string" },
    },
} as const

export const AgentProviderIdParamsSchema = {
    type: "object",
    required: ["providerId"],
    additionalProperties: true,
    properties: {
        providerId: { type: "string", minLength: 1 },
    },
} as const

function validationError(path: string, message: string, code = "invalid_message"): RuntimeValidationResult<never> {
    return { ok: false, error: { code, message, path } }
}

function paramsError(path: string, message: string): RuntimeValidationResult<never> {
    return validationError(path, message, "invalid_params")
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is RuntimeRequestId {
    return typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
}

function isRuntimeStatus(value: unknown): value is RuntimeStatus {
    return value === "starting" || value === "running" || value === "completed" || value === "failed" || value === "stopped" || value === "orphaned"
}

function isRuntimeKind(value: unknown): value is RuntimeRecord["kind"] {
    return value === "agent" || value === "process" || value === "pty" || value === "git" || value === "fsWatch" || value === "composite"
}

const RUNTIME_SCOPE_KEYS = new Set(["workspaceId", "rootPath", "repoPath", "correlationId", "ownerType", "ownerId", "labels"])
const RUNTIME_RECORD_KEYS = new Set([
    "runtimeId",
    "kind",
    "status",
    "scope",
    "startedAt",
    "updatedAt",
    "lastActivityAt",
    "nativeId",
    "pid",
    "pgid",
    "processLabel",
    "processStartedAt",
    "exitedAt",
    "exitCode",
    "signal",
    "error",
])

function paramsRecord(value: unknown): RuntimeValidationResult<Record<string, unknown>> {
    if (value === undefined) return { ok: true, value: {} }
    if (!isRecord(value)) return paramsError("$", "Runtime params must be an object")
    return { ok: true, value }
}

function optionalString(record: Record<string, unknown>, key: string): RuntimeValidationResult<string | undefined> {
    const value = record[key]
    if (value === undefined) return { ok: true, value: undefined }
    if (typeof value !== "string") return paramsError(`$.${key}`, `${key} must be a string`)
    return { ok: true, value }
}

function requiredString(record: Record<string, unknown>, key: string): RuntimeValidationResult<string> {
    const value = record[key]
    if (typeof value !== "string" || value.length < 1) return paramsError(`$.${key}`, `${key} must be a non-empty string`)
    return { ok: true, value }
}

export function validateRuntimeRequest(value: unknown): RuntimeValidationResult<RuntimeRequest> {
    if (!isRecord(value)) return validationError("$", "Runtime request must be an object")
    if (!isRequestId(value.id)) return validationError("$.id", "Runtime request id must be a string or finite number")
    if (typeof value.method !== "string" || value.method.length < 1) return validationError("$.method", "Runtime request method must be a non-empty string")
    return { ok: true, value: value as unknown as RuntimeRequest }
}

export function validateRuntimeResponse(value: unknown): RuntimeValidationResult<RuntimeResponse> {
    if (!isRecord(value)) return validationError("$", "Runtime response must be an object")
    if (!isRequestId(value.id)) return validationError("$.id", "Runtime response id must be a string or finite number")
    if (!("result" in value) && !("error" in value)) return validationError("$", "Runtime response must include result or error")
    if ("error" in value) {
        if (!isRecord(value.error)) return validationError("$.error", "Runtime response error must be an object")
        if (typeof value.error.code !== "string" || value.error.code.length < 1) return validationError("$.error.code", "Runtime response error code must be a non-empty string")
        if (typeof value.error.message !== "string" || value.error.message.length < 1) {
            return validationError("$.error.message", "Runtime response error message must be a non-empty string")
        }
    }
    return { ok: true, value: value as unknown as RuntimeResponse }
}

export function validateRuntimeNotification(value: unknown): RuntimeValidationResult<RuntimeNotification> {
    if (!isRecord(value)) return validationError("$", "Runtime notification must be an object")
    if ("id" in value) return validationError("$.id", "Runtime notification must not include an id")
    if (typeof value.method !== "string" || value.method.length < 1) {
        return validationError("$.method", "Runtime notification method must be a non-empty string")
    }
    if ("cursor" in value && typeof value.cursor !== "string") return validationError("$.cursor", "Runtime notification cursor must be a string")
    return { ok: true, value: value as unknown as RuntimeNotification }
}

export function validateRuntimeScope(value: unknown): RuntimeValidationResult<RuntimeScope> {
    if (!isRecord(value)) return validationError("$", "Runtime scope must be an object")
    for (const key of Object.keys(value)) {
        if (!RUNTIME_SCOPE_KEYS.has(key)) return validationError(`$.${key}`, `${key} is not allowed in runtime scope`)
    }

    const output: RuntimeScope = {}
    for (const key of ["workspaceId", "rootPath", "repoPath", "correlationId", "ownerType", "ownerId"] as const) {
        const field = value[key]
        if (field === undefined) continue
        if (typeof field !== "string") return validationError(`$.${key}`, `${key} must be a string`)
        output[key] = field
    }

    if (value.labels !== undefined) {
        if (!isRecord(value.labels)) return validationError("$.labels", "labels must be an object")
        const labels: Record<string, string> = {}
        for (const [labelKey, labelValue] of Object.entries(value.labels)) {
            if (typeof labelValue !== "string") return validationError(`$.labels.${labelKey}`, "label values must be strings")
            labels[labelKey] = labelValue
        }
        output.labels = labels
    }

    return { ok: true, value: output }
}

export function validateRuntimeRecord(value: unknown): RuntimeValidationResult<RuntimeRecord> {
    if (!isRecord(value)) return validationError("$", "Runtime record must be an object")
    for (const key of Object.keys(value)) {
        if (!RUNTIME_RECORD_KEYS.has(key)) return validationError(`$.${key}`, `${key} is not allowed in runtime record`)
    }
    if ("ownerType" in value) return validationError("$.ownerType", "Runtime record ownerType must be nested under scope")
    if ("ownerId" in value) return validationError("$.ownerId", "Runtime record ownerId must be nested under scope")
    if ("rootPath" in value) return validationError("$.rootPath", "Runtime record rootPath must be nested under scope")
    if ("repoPath" in value) return validationError("$.repoPath", "Runtime record repoPath must be nested under scope")

    const runtimeId = requiredString(value, "runtimeId")
    if (!runtimeId.ok) return runtimeId
    if (!isRuntimeKind(value.kind)) return validationError("$.kind", "Runtime record kind is invalid")
    if (!isRuntimeStatus(value.status)) return validationError("$.status", "Runtime record status is invalid")

    const scope = validateRuntimeScope(value.scope)
    if (!scope.ok) {
        const scopePath = scope.error.path ?? "$"
        return { ok: false, error: { ...scope.error, path: scopePath === "$" ? "$.scope" : `$.scope${scopePath.slice(1)}` } }
    }

    const startedAt = requiredString(value, "startedAt")
    if (!startedAt.ok) return startedAt
    const updatedAt = requiredString(value, "updatedAt")
    if (!updatedAt.ok) return updatedAt
    const lastActivityAt = requiredString(value, "lastActivityAt")
    if (!lastActivityAt.ok) return lastActivityAt

    const output: RuntimeRecord = {
        runtimeId: runtimeId.value,
        kind: value.kind,
        status: value.status,
        scope: scope.value,
        startedAt: startedAt.value,
        updatedAt: updatedAt.value,
        lastActivityAt: lastActivityAt.value,
    }

    for (const key of ["nativeId", "processLabel", "processStartedAt", "exitedAt", "error"] as const) {
        const field = value[key]
        if (field === undefined) continue
        if (typeof field !== "string") return validationError(`$.${key}`, `${key} must be a string`)
        output[key] = field
    }

    if (value.signal !== undefined) {
        if (value.signal !== null && typeof value.signal !== "string") return validationError("$.signal", "signal must be a string or null")
        output.signal = value.signal
    }

    for (const key of ["pid", "pgid"] as const) {
        const field = value[key]
        if (field === undefined) continue
        if (typeof field !== "number" || !Number.isFinite(field)) return validationError(`$.${key}`, `${key} must be a finite number`)
        output[key] = field
    }

    if (value.exitCode !== undefined) {
        if (value.exitCode !== null && (typeof value.exitCode !== "number" || !Number.isFinite(value.exitCode))) {
            return validationError("$.exitCode", "exitCode must be a finite number or null")
        }
        output.exitCode = value.exitCode
    }

    return { ok: true, value: output }
}

export function validateRuntimeInitializeParams(value: unknown): RuntimeValidationResult<RuntimeInitializeParams> {
    const record = paramsRecord(value)
    if (!record.ok) return record

    const clientName = optionalString(record.value, "clientName")
    if (!clientName.ok) return clientName
    const clientVersion = optionalString(record.value, "clientVersion")
    if (!clientVersion.ok) return clientVersion

    const clientPlatform = record.value.clientPlatform
    if (clientPlatform !== undefined && !["desktop", "mobile", "web", "cli", "unknown"].includes(String(clientPlatform))) {
        return paramsError("$.clientPlatform", "clientPlatform must be desktop, mobile, web, cli, or unknown")
    }

    const protocolVersion = record.value.protocolVersion
    if (protocolVersion !== undefined && (typeof protocolVersion !== "number" || !Number.isFinite(protocolVersion))) {
        return paramsError("$.protocolVersion", "protocolVersion must be a finite number")
    }

    return {
        ok: true,
        value: {
            ...(clientName.value !== undefined ? { clientName: clientName.value } : {}),
            ...(clientVersion.value !== undefined ? { clientVersion: clientVersion.value } : {}),
            ...(typeof clientPlatform === "string" ? { clientPlatform: clientPlatform as RuntimeInitializeParams["clientPlatform"] } : {}),
            ...(typeof protocolVersion === "number" ? { protocolVersion } : {}),
        },
    }
}

export function validateRuntimeSubscriptionUpdateParams(value: unknown): RuntimeValidationResult<RuntimeSubscriptionUpdateParams> {
    const record = paramsRecord(value)
    if (!record.ok) return record

    const methods = record.value.methods
    if (methods !== undefined) {
        if (!Array.isArray(methods)) return paramsError("$.methods", "methods must be an array")
        for (let i = 0; i < methods.length; i++) {
            if (typeof methods[i] !== "string" || methods[i].length < 1) return paramsError(`$.methods[${i}]`, "methods entries must be non-empty strings")
        }
    }

    const cursor = record.value.cursor
    if (cursor !== undefined && !isRequestId(cursor)) return paramsError("$.cursor", "cursor must be a string or finite number")

    return {
        ok: true,
        value: {
            ...(methods !== undefined ? { methods: methods as string[] } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
        },
    }
}

export function validateRuntimeListParams(value: unknown): RuntimeValidationResult<RuntimeListParams> {
    const record = paramsRecord(value)
    if (!record.ok) return record

    const ownerType = optionalString(record.value, "ownerType")
    if (!ownerType.ok) return ownerType
    const ownerId = optionalString(record.value, "ownerId")
    if (!ownerId.ok) return ownerId
    const status = record.value.status
    if (status !== undefined && !isRuntimeStatus(status)) return paramsError("$.status", "status is invalid")
    const statuses = record.value.statuses
    if (statuses !== undefined) {
        if (!Array.isArray(statuses)) return paramsError("$.statuses", "statuses must be an array")
        for (const [index, value] of statuses.entries()) {
            if (!isRuntimeStatus(value)) return paramsError(`$.statuses[${index}]`, "status is invalid")
        }
    }

    return {
        ok: true,
        value: {
            ...(ownerType.value ? { ownerType: ownerType.value } : {}),
            ...(ownerId.value ? { ownerId: ownerId.value } : {}),
            ...(status !== undefined ? { status } : {}),
            ...(statuses !== undefined ? { statuses } : {}),
        },
    }
}

export function validateRuntimeIdParams(value: unknown): RuntimeValidationResult<RuntimeIdParams> {
    const record = paramsRecord(value)
    if (!record.ok) return record
    const runtimeId = requiredString(record.value, "runtimeId")
    if (!runtimeId.ok) return runtimeId
    return { ok: true, value: { runtimeId: runtimeId.value } }
}

export function validateRuntimeStopParams(value: unknown): RuntimeValidationResult<RuntimeStopParams> {
    const record = paramsRecord(value)
    if (!record.ok) return record
    const runtimeId = requiredString(record.value, "runtimeId")
    if (!runtimeId.ok) return runtimeId
    const reason = optionalString(record.value, "reason")
    if (!reason.ok) return reason
    return {
        ok: true,
        value: {
            runtimeId: runtimeId.value,
            ...(reason.value !== undefined ? { reason: reason.value } : {}),
        },
    }
}

export function validateAgentProviderIdParams(value: unknown): RuntimeValidationResult<AgentProviderIdParams> {
    const record = paramsRecord(value)
    if (!record.ok) return record
    const providerId = requiredString(record.value, "providerId")
    if (!providerId.ok) return providerId
    return { ok: true, value: { providerId: providerId.value } }
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
    return validateRuntimeRequest(value).ok
}

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
    return validateRuntimeResponse(value).ok
}

export function isRuntimeNotification(value: unknown): value is RuntimeNotification {
    return validateRuntimeNotification(value).ok
}

export function runtimeError(code: string, message: string, data?: unknown): RuntimeError {
    return data === undefined ? { code, message } : { code, message, data }
}
