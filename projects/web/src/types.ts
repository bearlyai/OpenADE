/**
 * Code Module Types
 *
 * Type definitions for the Code module - repos, tasks, events, comments.
 */

import type { AnnotationSide } from "@pierre/diffs"
import type { ClaudeStreamEvent } from "./electronAPI/claudeEventTypes"

// Re-export types for convenience
export type { ClaudeStreamEvent }

// ============================================================================
// Execution Types - supports multiple execution engines
// ============================================================================

export interface GitRefs {
    sha: string
    branch?: string
}

/** Claude Code execution - uses Claude Agent SDK */
interface ClaudeCodeExecution {
    type: "claude-code"
    executionId: string
    sessionId?: string // Claude session ID returned from this execution
    parentSessionId?: string // Claude session ID we forked from (previous event's session)
    modelId?: string
    events: ClaudeStreamEvent[]
    gitRefsBefore?: GitRefs
    gitRefsAfter?: GitRefs
}

/** Union type for all execution engines (currently only claude-code) */
export type Execution = ClaudeCodeExecution

export interface User {
    id: string
    email: string
}

export interface Repo {
    id: string
    name: string
    path: string // THE source of truth for working directory
    createdBy: User
    createdAt: string
    updatedAt: string
}

// ============================================================================
// Comment Types - task-level comments with flexible source tracking
// ============================================================================

export type CommentSource =
    // Plan content (TaskEditor)
    | { type: "plan"; eventId: string; lineStart: number; lineEnd: number }
    // File in ChangesViewer
    | { type: "file"; filePath: string; lineStart: number; lineEnd: number }
    // Diff in ChangesViewer
    | { type: "diff"; eventId: string; filePath: string; side: AnnotationSide; lineStart: number; lineEnd: number }
    // Snapshot patch (ViewPatch)
    | { type: "patch"; snapshotEventId: string; filePath: string; side: AnnotationSide; lineStart: number; lineEnd: number }
    // LLM output text
    | { type: "llm_output"; eventId: string; lineStart: number; lineEnd: number }
    // InlineMessages - Edit tool diff
    | { type: "edit_diff"; actionEventId: string; toolUseId: string; filePath: string; side: AnnotationSide; lineStart: number; lineEnd: number }
    // InlineMessages - Write tool diff
    | { type: "write_diff"; actionEventId: string; toolUseId: string; filePath: string; lineStart: number; lineEnd: number }
    // InlineMessages - Bash output
    | { type: "bash_output"; actionEventId: string; toolUseId: string; lineStart: number; lineEnd: number }
    // InlineMessages - Assistant text message
    | { type: "assistant_text"; actionEventId: string; messageIndex: number; lineStart: number; lineEnd: number }

/** The text the user selected when making a comment, plus surrounding context */
export interface CommentSelectedText {
    text: string // The exact text user selected
    linesBefore: string // ~3 lines of context before selection
    linesAfter: string // ~3 lines of context after selection
}

export interface Comment {
    id: string
    content: string
    source: CommentSource
    selectedText: CommentSelectedText
    author: User
    createdAt: string
    updatedAt?: string
}

// ============================================================================
// Image Attachments
// ============================================================================

export interface ImageAttachment {
    id: string // ULID, maps to file on disk at ~/.openade/data/images/{id}.{ext}
    mediaType: string // "image/jpeg" | "image/png" | "image/webp" | "image/gif"
    ext: string // "jpg" | "png" | "webp" | "gif"
    originalWidth: number
    originalHeight: number
    resizedWidth: number // Dimensions after resize (equals original if no resize needed)
    resizedHeight: number
}

/** Everything the user submits with an action. Threaded from UI → execution → prompt building. */
export interface UserInputContext {
    userInput: string
    images: ImageAttachment[]
}

// ============================================================================
// Event Types
// ============================================================================

/** Base fields shared by all events */
interface BaseEvent {
    id: string
    status: "in_progress" | "completed" | "error" | "stopped"
    createdAt: string
    completedAt?: string
    userInput: string
}

/** Source type for ActionEvent - describes what triggered this action */
export type ActionEventSource =
    | { type: "plan"; userLabel: string }
    | { type: "revise"; userLabel: string; parentEventId: string }
    | { type: "run_plan"; userLabel: string; planEventId: string }
    | { type: "do"; userLabel: string }
    | { type: "ask"; userLabel: string }

/** Action event - all LLM executions (plans, revisions, direct actions, etc.) */
export interface ActionEvent extends BaseEvent {
    type: "action"
    execution: Execution // Required - actions always have an execution
    source: ActionEventSource // Required - describes what triggered this action
    includesCommentIds: string[] // Tracks which comments were included in this event
    images?: ImageAttachment[] // Image attachments submitted with this action
    result?: {
        success: boolean
    }
}

/** Setup environment event - sets up worktree for git repos (no execution) */
export interface SetupEnvironmentEvent extends BaseEvent {
    type: "setup_environment"
    worktreeId: string
    deviceId: string
    workingDir: string
    setupOutput?: string // Output from worktree creation and setup script
}

/** Snapshot event - captures code state after an action completes (no execution) */
export interface SnapshotEvent extends BaseEvent {
    type: "snapshot"
    actionEventId: string // The action this snapshot follows
    referenceBranch: string // Branch we're comparing against (e.g., "main") - for display
    mergeBaseCommit: string // Actual commit SHA we diffed against (frozen at worktree creation)
    fullPatch: string // Diff from mergeBaseCommit to current working tree (empty string if stored in file)
    patchFileId?: string // ID of the patch file in ~/.openade/data/snapshots/ (if stored externally)
    stats: {
        filesChanged: number
        insertions: number
        deletions: number
    }
}

// Discriminated union
export type CodeEvent = ActionEvent | SetupEnvironmentEvent | SnapshotEvent

// Isolation strategy - defines how the task is isolated from the main repo
// Uses discriminated union with exhaustive.tag() for type-safe handling
export type IsolationStrategy = { type: "worktree"; sourceBranch: string } | { type: "head" }

// Device-specific environment state - one per device that has set up this task
export interface TaskDeviceEnvironment {
    id: string // Required for YArrayHandle compatibility - set to deviceId value
    deviceId: string
    worktreeDir?: string // ONLY for worktree mode - the worktree directory
    setupComplete: boolean
    mergeBaseCommit?: string // ONLY for worktree mode - commit SHA we diff against for snapshots
    createdAt: string
    lastUsedAt: string
}

export interface Task {
    id: string
    repoId: string
    slug: string
    title: string
    description: string
    isolationStrategy: IsolationStrategy // How this task is isolated (worktree or head)
    deviceEnvironments: TaskDeviceEnvironment[] // Per-device environment state
    createdBy: User
    events: CodeEvent[]
    comments: Comment[] // Task-level comments with source tracking
    sessionIds: Record<string, string>
    createdAt: string
    updatedAt: string
    closed?: boolean
    cancelledPlanEventId?: string // ID of plan user explicitly cancelled (exits plan mode)
    enabledMcpServerIds?: string[] // IDs of MCP servers enabled for this task
    pullRequest?: { url: string; number?: number; provider: "github" | "gitlab" | "other" } // Associated PR
}
