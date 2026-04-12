/**
 * Procs API Bridge
 *
 * Client-side API for reading openade.toml configuration files.
 * Communicates with Electron main process via openadeAPI.
 */

// ============================================================================
// Type Definitions
// Keep in sync with projects/electron/src/modules/code/procs/types.ts
// ============================================================================

/**
 * Process types:
 * - setup: Run once per session before other processes (e.g., npm install)
 * - daemon: Long-running background process (e.g., npm run dev)
 * - task: One-shot manual command (e.g., npm run build)
 * - check: Validation/linting, can be triggered by automation (e.g., npm run typecheck)
 */
export type ProcessType = "setup" | "daemon" | "task" | "check"

export interface ProcessDef {
    /** Unique ID: "{relativePath}::{name}" e.g., "packages/api/openade.toml::Backend" */
    id: string
    /** Display name */
    name: string
    /** Shell command to run */
    command: string
    /** Working directory relative to config file location */
    workDir?: string
    /** Optional URL for web servers (shown as quick-open link) */
    url?: string
    /** Process type - defaults to "daemon" */
    type: ProcessType
}

export type ProcessInput = Omit<ProcessDef, "id">

// ============================================================================
// Cron Types
// ============================================================================

export type CronTaskType = "plan" | "do" | "ask" | "hyperplan"

export interface CronDef {
    /** Unique ID: "{relativePath}::{name}" */
    id: string
    /** Display name */
    name: string
    /** 5-field cron expression (e.g., "0 9 * * 1") */
    schedule: string
    /** Execution type */
    type: CronTaskType
    /** The prompt to send to the agent */
    prompt: string
    /** Additional system prompt appended to execution */
    appendSystemPrompt?: string
    /** Image file paths relative to repo root */
    images?: string[]
    /** Isolation strategy: "head" (default) or "worktree" */
    isolation?: "head" | "worktree"
    /** Harness to use (e.g., "claude-code", "codex") */
    harness?: string
    /** If set, run in an existing task instead of creating a new one */
    inTaskId?: string
}

export type CronInput = Omit<CronDef, "id">

// ============================================================================
// Config Types
// ============================================================================

export interface ProcsConfig {
    /** Path relative to repo root, e.g., "openade.toml" */
    relativePath: string
    /** Processes defined in this config file */
    processes: ProcessDef[]
    /** Cron jobs defined in this config file */
    crons: CronDef[]
}

export interface ProcsConfigError {
    /** Which file had the problem */
    relativePath: string
    /** Human-readable error message */
    error: string
    /** Line number if available */
    line?: number
}

export interface ReadProcsResult {
    /** Git repo root (main checkout, not worktree) */
    repoRoot: string
    /** Where we searched from (could be worktree) */
    searchRoot: string
    /** Whether searchRoot is a worktree */
    isWorktree: boolean
    /** If worktree, the worktree root path */
    worktreeRoot?: string

    /** Successfully parsed configs */
    configs: ProcsConfig[]
    /** Files that failed to parse */
    errors: ProcsConfigError[]
}

export interface EditableProcsFile {
    filePath: string
    relativePath: string
    processes: ProcessInput[]
    crons: CronInput[]
    rawContent: string
}

export interface SaveEditableProcsResult {
    filePath: string
    relativePath: string
    rawContent: string
    readResult?: ReadProcsResult
}

/**
 * Context for running a process - determines which checkout to use
 */
export type RunContext =
    | { type: "repo"; root: string } // Run from main checkout (root = repo path)
    | { type: "worktree"; root: string } // Run from specific worktree

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
    if (!window.openadeAPI) {
        // Return empty result in non-Electron environment
        return {
            repoRoot: path,
            searchRoot: path,
            isWorktree: false,
            configs: [],
            errors: [],
        }
    }

    return window.openadeAPI.procs.read({ path }) as Promise<ReadProcsResult>
}

/**
 * Read raw content of a config file (for the editor)
 */
export async function readConfigFile(filePath: string): Promise<string> {
    if (!window.openadeAPI) return ""
    return window.openadeAPI.procs.readFile({ filePath })
}

/**
 * Write raw content to a config file (from the editor)
 */
export async function writeConfigFile(filePath: string, content: string): Promise<void> {
    if (!window.openadeAPI) return
    await window.openadeAPI.procs.writeFile({ filePath, content })
}

export async function loadEditableProcsFile(filePath: string, searchPath?: string): Promise<EditableProcsFile> {
    if (!window.openadeAPI) {
        return {
            filePath,
            relativePath: filePath,
            processes: [],
            crons: [],
            rawContent: "",
        }
    }
    return window.openadeAPI.procs.loadEditable({ filePath, searchPath }) as Promise<EditableProcsFile>
}

export async function parseEditableRaw(content: string, relativePath: string): Promise<{ processes: ProcessInput[]; crons: CronInput[] }> {
    if (!window.openadeAPI) {
        return { processes: [], crons: [] }
    }
    return window.openadeAPI.procs.parseRaw({ content, relativePath }) as Promise<{ processes: ProcessInput[]; crons: CronInput[] }>
}

export async function serializeEditableProcs(input: {
    processes: ProcessInput[]
    crons: CronInput[]
}): Promise<string> {
    if (!window.openadeAPI) return ""
    const result = (await window.openadeAPI.procs.serializeEditable(input)) as { rawContent: string }
    return result.rawContent
}

export async function saveEditableProcsFile(input: {
    filePath: string
    relativePath: string
    processes: ProcessInput[]
    crons: CronInput[]
    searchPath?: string
}): Promise<SaveEditableProcsResult> {
    if (!window.openadeAPI) {
        return {
            filePath: input.filePath,
            relativePath: input.relativePath,
            rawContent: "",
        }
    }

    return window.openadeAPI.procs.saveEditable(input) as Promise<SaveEditableProcsResult>
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
