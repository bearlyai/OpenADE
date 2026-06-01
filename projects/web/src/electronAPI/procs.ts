/**
 * Procs API Bridge
 *
 * Client-side API for reading openade.toml configuration files.
 * Communicates with the local runtime protocol bridge.
 */

import { localRuntimeClient } from "../runtime/localRuntimeClient"
import type {
    OpenADEEditableProcsFile,
    OpenADEProcsConfig,
    OpenADEProcsConfigError,
    OpenADEProcsCronDef,
    OpenADEProcsCronInput,
    OpenADEProcsCronTaskType,
    OpenADEProcsProcessDef,
    OpenADEProcsProcessInput,
    OpenADEProcsProcessType,
    OpenADEProcsReadResult,
    OpenADEProcsRunContext,
    OpenADESaveEditableProcsResult,
} from "../../../openade-module/src"

// ============================================================================
// Type Definitions
// ============================================================================

export type ProcessType = OpenADEProcsProcessType

export type ProcessDef = OpenADEProcsProcessDef

export type ProcessInput = OpenADEProcsProcessInput

// ============================================================================
// Cron Types
// ============================================================================

export type CronTaskType = OpenADEProcsCronTaskType

export type CronDef = OpenADEProcsCronDef

export type CronInput = OpenADEProcsCronInput

// ============================================================================
// Config Types
// ============================================================================

export type ProcsConfig = OpenADEProcsConfig

export type ProcsConfigError = OpenADEProcsConfigError

export type ReadProcsResult = OpenADEProcsReadResult

export type EditableProcsFile = OpenADEEditableProcsFile

export type SaveEditableProcsResult = OpenADESaveEditableProcsResult

/**
 * Context for running a process - determines which checkout to use
 */
export type RunContext = OpenADEProcsRunContext

// ============================================================================
// API Functions
// ============================================================================

/**
 * Read all config files (openade.toml) from a directory tree
 *
 * @param path - Directory to search from (usually repo root or worktree root)
 * @returns Parsed configs and any errors
 */
export async function readProcs(path: string): Promise<ReadProcsResult> {
    if (!window.openadeAPI?.runtime) {
        // Return empty result in non-Electron environment
        return {
            repoRoot: path,
            searchRoot: path,
            isWorktree: false,
            configs: [],
            errors: [],
        }
    }

    return localRuntimeClient.request<ReadProcsResult>("host/procs/read", { path })
}

/**
 * Read raw content of a config file (for the editor)
 */
export async function readConfigFile(filePath: string): Promise<string> {
    if (!window.openadeAPI?.runtime) return ""
    return localRuntimeClient.request<string>("host/procs/file/read", { filePath })
}

/**
 * Write raw content to a config file (from the editor)
 */
export async function writeConfigFile(filePath: string, content: string): Promise<void> {
    if (!window.openadeAPI?.runtime) return
    await localRuntimeClient.request("host/procs/file/write", { filePath, content })
}

export async function loadEditableProcsFile(filePath: string, searchPath?: string): Promise<EditableProcsFile> {
    if (!window.openadeAPI?.runtime) {
        return {
            filePath,
            relativePath: filePath,
            processes: [],
            crons: [],
            rawContent: "",
        }
    }
    return localRuntimeClient.request<EditableProcsFile>("host/procs/editable/load", { filePath, searchPath })
}

export async function parseEditableRaw(content: string, relativePath: string): Promise<{ processes: ProcessInput[]; crons: CronInput[] }> {
    if (!window.openadeAPI?.runtime) {
        return { processes: [], crons: [] }
    }
    return localRuntimeClient.request<{ processes: ProcessInput[]; crons: CronInput[] }>("host/procs/raw/parse", { content, relativePath })
}

export async function serializeEditableProcs(input: {
    processes: ProcessInput[]
    crons: CronInput[]
}): Promise<string> {
    if (!window.openadeAPI?.runtime) return ""
    const result = await localRuntimeClient.request<{ rawContent: string }>("host/procs/editable/serialize", input)
    return result.rawContent
}

export async function saveEditableProcsFile(input: {
    filePath: string
    relativePath: string
    processes: ProcessInput[]
    crons: CronInput[]
    searchPath?: string
}): Promise<SaveEditableProcsResult> {
    if (!window.openadeAPI?.runtime) {
        return {
            filePath: input.filePath,
            relativePath: input.relativePath,
            rawContent: "",
        }
    }

    return localRuntimeClient.request<SaveEditableProcsResult>("host/procs/editable/save", input)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute the working directory for running a process
 *
 * @param config - The config file containing the process
 * @param process - The process definition
 * @param context - Whether to run from repo or worktree
 * @param result - The full procs result (for repo root)
 * @returns Absolute path to the working directory
 */
export function getCwd(config: ProcsConfig, process: ProcessDef, context: RunContext, result: ReadProcsResult): string {
    // Determine root based on context
    const root = context.type === "repo" ? result.repoRoot : context.root

    // Base directory is where the config file lives
    const baseDir = dirname(join(root, config.relativePath))

    // Apply workDir if specified, otherwise use baseDir
    return process.workDir ? join(baseDir, process.workDir) : baseDir
}

// ============================================================================
// Path Helpers (browser-compatible)
// ============================================================================

function join(...parts: string[]): string {
    return parts.join("/").replace(/\/+/g, "/").replace(/\/$/, "") // Remove trailing slash
}

function dirname(p: string): string {
    const lastSlash = p.lastIndexOf("/")
    return lastSlash > 0 ? p.slice(0, lastSlash) : "/"
}
