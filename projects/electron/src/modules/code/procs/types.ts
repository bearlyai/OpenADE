/**
 * Types for procs.toml configuration
 *
 * These types are designed to be extractable to a standalone library.
 * No Electron or Node-specific dependencies.
 */

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

