import path from "node:path"
import type {
    OpenADEProcsConfig,
    OpenADEProcsProcessDef,
    OpenADEProjectProcessConfigError,
    OpenADEProjectProcessDefinition,
    OpenADEProjectProcessInstance,
    OpenADEProjectProcessOutputChunk,
    OpenADEProjectProcessReconnectRequest,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStopRequest,
    OpenADEProjectProcessStopResult,
} from "./types"

export interface OpenADEProjectProcessDefinitionsResult {
    processes: OpenADEProjectProcessDefinition[]
    errors: OpenADEProjectProcessConfigError[]
}

export interface OpenADEProjectProcessRegistration {
    repoId: string
    taskId?: string
    definitionId: string
    cwd: string
}

export interface OpenADEProjectProcessRuntimeInfo {
    processId: string
    completed: boolean
    exitCode: number | null
    signal: string | null
    error?: string
    pid?: number
}

export const OPENADE_PROJECT_PROCESS_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
export const OPENADE_PROJECT_PROCESS_DAEMON_TIMEOUT_MS = 24 * 60 * 60 * 1000
export const OPENADE_PROJECT_PROCESS_MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000

function recordValue(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function ensurePathInsideRoot(root: string, target: string, message: string): void {
    const resolvedRoot = path.resolve(root)
    const resolvedTarget = path.resolve(target)
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(message)
    }
}

export function resolveOpenADEProjectProcessCwd(root: string, configRelativePath: string, workDir?: string): string {
    const resolvedRoot = path.resolve(root)
    const configPath = path.resolve(resolvedRoot, configRelativePath)
    ensurePathInsideRoot(resolvedRoot, configPath, "process config path is outside the repository")
    const cwd = path.resolve(path.dirname(configPath), workDir ?? "")
    ensurePathInsideRoot(resolvedRoot, cwd, "process cwd is outside the repository")
    return cwd
}

export function openADEProjectProcessDefinitionFromConfig(
    root: string,
    config: OpenADEProcsConfig,
    processDef: OpenADEProcsProcessDef
): OpenADEProjectProcessDefinition {
    return {
        id: processDef.id,
        name: processDef.name,
        command: processDef.command,
        workDir: processDef.workDir,
        url: processDef.url,
        type: processDef.type,
        configPath: config.relativePath,
        cwd: resolveOpenADEProjectProcessCwd(root, config.relativePath, processDef.workDir),
    }
}

export function buildOpenADEProjectProcessDefinitions(params: {
    root: string
    configs: OpenADEProcsConfig[]
}): OpenADEProjectProcessDefinitionsResult {
    const processes: OpenADEProjectProcessDefinition[] = []
    const errors: OpenADEProjectProcessConfigError[] = []

    for (const config of params.configs) {
        for (const processDef of config.processes) {
            try {
                processes.push(openADEProjectProcessDefinitionFromConfig(params.root, config, processDef))
            } catch (error) {
                errors.push({
                    relativePath: config.relativePath,
                    error: error instanceof Error ? error.message : "Process cwd is invalid",
                })
            }
        }
    }

    return { processes, errors }
}

export function openADEProjectProcessScopeMatches(registration: OpenADEProjectProcessRegistration, params: { repoId: string; taskId?: string }): boolean {
    return registration.repoId === params.repoId && (registration.taskId ?? "") === (params.taskId ?? "")
}

export function openADEProjectProcessTimeout(processDef: OpenADEProjectProcessDefinition, timeoutMs?: number): number {
    const fallback = processDef.type === "daemon" ? OPENADE_PROJECT_PROCESS_DAEMON_TIMEOUT_MS : OPENADE_PROJECT_PROCESS_DEFAULT_TIMEOUT_MS
    return Math.min(timeoutMs ?? fallback, OPENADE_PROJECT_PROCESS_MAX_TIMEOUT_MS)
}

export function openADEProjectProcessOutputChunkFromUnknown(value: unknown): OpenADEProjectProcessOutputChunk | null {
    const record = recordValue(value)
    if (!record) return null
    const type = record.type
    const data = record.data
    const timestamp = record.timestamp
    if ((type !== "stdout" && type !== "stderr") || typeof data !== "string" || typeof timestamp !== "number") return null
    return { type, data, timestamp }
}

export function openADEProjectProcessStartResponseFromUnknown(value: unknown): { processId: string; runtimeId?: string } {
    const record = recordValue(value)
    if (!record || typeof record.processId !== "string") throw new Error("process start response is invalid")
    return {
        processId: record.processId,
        runtimeId: typeof record.runtimeId === "string" ? record.runtimeId : undefined,
    }
}

export function openADEProjectProcessInstanceFromRuntimeInfo(
    processInfo: OpenADEProjectProcessRuntimeInfo,
    registration: OpenADEProjectProcessRegistration
): OpenADEProjectProcessInstance {
    return {
        processId: processInfo.processId,
        definitionId: registration.definitionId,
        repoId: registration.repoId,
        taskId: registration.taskId,
        cwd: registration.cwd,
        completed: processInfo.completed,
        exitCode: processInfo.exitCode,
        signal: processInfo.signal,
        error: processInfo.error,
        pid: processInfo.pid,
    }
}

export function openADEProjectProcessInstanceFromUnknown(
    value: unknown,
    registration: OpenADEProjectProcessRegistration
): OpenADEProjectProcessInstance | null {
    const record = recordValue(value)
    if (!record || typeof record.processId !== "string") return null
    return openADEProjectProcessInstanceFromRuntimeInfo(
        {
            processId: record.processId,
            completed: typeof record.completed === "boolean" ? record.completed : false,
            exitCode: typeof record.exitCode === "number" || record.exitCode === null ? record.exitCode : null,
            signal: typeof record.signal === "string" || record.signal === null ? record.signal : null,
            error: typeof record.error === "string" ? record.error : undefined,
            pid: typeof record.pid === "number" ? record.pid : undefined,
        },
        registration
    )
}

export function openADEProjectProcessReconnectResultFromUnknown(
    value: unknown,
    params: OpenADEProjectProcessReconnectRequest
): OpenADEProjectProcessReconnectResult {
    const record = recordValue(value)
    if (!record || record.found !== true) return { repoId: params.repoId, taskId: params.taskId, processId: params.processId, found: false, output: [] }
    const output = Array.isArray(record.output)
        ? record.output.map(openADEProjectProcessOutputChunkFromUnknown).filter((chunk): chunk is OpenADEProjectProcessOutputChunk => chunk !== null)
        : []
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        processId: params.processId,
        found: true,
        completed: typeof record.completed === "boolean" ? record.completed : undefined,
        exitCode: typeof record.exitCode === "number" || record.exitCode === null ? record.exitCode : undefined,
        signal: typeof record.signal === "string" || record.signal === null ? record.signal : undefined,
        error: typeof record.error === "string" ? record.error : undefined,
        outputCount: typeof record.outputCount === "number" ? record.outputCount : output.length,
        output,
    }
}

export function openADEProjectProcessStopResultFromUnknown(
    value: unknown,
    params: OpenADEProjectProcessStopRequest
): OpenADEProjectProcessStopResult {
    const record = recordValue(value)
    const ok = record?.ok === true
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        processId: params.processId,
        ok,
        error: typeof record?.error === "string" ? record.error : ok ? undefined : "Process stop response is invalid",
    }
}
