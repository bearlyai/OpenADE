import type { IsolationStrategy } from "../types"

/**
 * Builds a worktree-only execution safety instruction.
 * Returned text is appended as system prompt context.
 */
export function buildWorktreeExecutionInstruction(isolationStrategy: IsolationStrategy | undefined, workDir: string): string | undefined {
    if (isolationStrategy?.type !== "worktree") {
        return undefined
    }

    return [
        "<worktree_instruction>",
        `Important: you're in a worktree (${workDir}) do all your work in this worktree.`,
        "Never run edits, git operations, or file writes from repo root or any other directory.",
        "</worktree_instruction>",
    ].join("\n")
}

/** Merge two appendSystemPrompt fragments, preserving undefined when both are empty. */
export function mergeAppendSystemPrompt(base?: string, extra?: string): string | undefined {
    if (base && extra) {
        return `${base}\n\n${extra}`
    }
    return base ?? extra
}
