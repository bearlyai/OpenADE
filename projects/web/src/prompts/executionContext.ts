import type { HarnessId } from "../electronAPI/harnessEventTypes"
import type { ActionEventSource, IsolationStrategy } from "../types"

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

const CODEX_RAW_RENDERER_STYLE_HINT = [
    "<raw_renderer_response_style>",
    "Important: this UI shows your response as raw markdown text.",
    "For final summaries:",
    "- Do not use markdown links for local files.",
    "- Do not include absolute filesystem paths.",
    "- Use plain relative file paths with optional :line (example: src/store/TaskModel.ts:333).",
    '- Keep it compact; avoid section-heavy templates like "What changed" and "Verification run" unless requested.',
    "</raw_renderer_response_style>",
].join("\n")

/**
 * Codex-specific output style hint for raw markdown rendering in execution output.
 *
 * This is intentionally scoped to execution-like modes so plan/revise formatting
 * remains fully controlled by the planning mode prompts.
 */
export function buildRawRendererStyleInstruction(harnessId: HarnessId, sourceType: ActionEventSource["type"]): string | undefined {
    if (harnessId !== "codex") return undefined
    if (sourceType === "do" || sourceType === "ask" || sourceType === "run_plan" || sourceType === "review") {
        return CODEX_RAW_RENDERER_STYLE_HINT
    }
    return undefined
}

/** Merge two appendSystemPrompt fragments, preserving undefined when both are empty. */
export function mergeAppendSystemPrompt(base?: string, extra?: string): string | undefined {
    if (base && extra) {
        return `${base}\n\n${extra}`
    }
    return base ?? extra
}
