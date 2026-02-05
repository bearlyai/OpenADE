/**
 * Procs API Bridge
 *
 * Client-side API for reading procs.toml configuration files.
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
    /** Unique ID: "{relativePath}::{name}" e.g., "packages/api/procs.toml::Backend" */
    id: string
    /** Display name */
    name: string
    /** Shell command to run */
    command: string
    /** Working directory relative to procs.toml location */
    workDir?: string
    /** Optional URL for web servers (shown as quick-open link) */
    url?: string
    /** Process type - defaults to "daemon" */
    type: ProcessType
}

export interface ProcsConfig {
    /** Path relative to repo root, e.g., "packages/api/procs.toml" */
    relativePath: string
    /** Processes defined in this config file */
    processes: ProcessDef[]
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

/**
 * Context for running a process - determines which checkout to use
 */
export type RunContext =
    | { type: "repo" } // Run from main checkout
    | { type: "worktree"; root: string } // Run from specific worktree

// ============================================================================
// API Functions
// ============================================================================

/**
 * Read all procs.toml files from a directory tree
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

    // Base directory is where the procs.toml file lives
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
