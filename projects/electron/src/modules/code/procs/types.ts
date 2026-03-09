/**
 * Types for openade.toml / procs.toml configuration
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

// ============================================================================
// Config Types
// ============================================================================

export interface ProcsConfig {
    /** Path relative to repo root, e.g., "openade.toml" or "packages/api/procs.toml" */
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

