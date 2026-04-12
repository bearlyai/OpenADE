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
    "Important: this UI renders your response as plain text. There is no markdown rendering, no link support, and no citation viewer.",
    "- Never use markdown links (`[text](path)`) for local files — they render as raw noisy syntax.",
    "- Never include absolute filesystem paths.",
    "- Reference files as plain relative paths with optional :line, e.g. src/store/TaskModel.ts:333",
    "- Do not wrap file paths in backticks inside plan steps — just use the bare path.",
    '- Keep it compact; avoid section-heavy templates like "What changed" and "Verification run" unless requested.',
    "</raw_renderer_response_style>",
].join("\n")

export function buildRawRendererStyleInstruction(harnessId: HarnessId, _sourceType: ActionEventSource["type"]): string | undefined {
    if (harnessId !== "codex") return undefined
    return CODEX_RAW_RENDERER_STYLE_HINT
}

/** Merge two appendSystemPrompt fragments, preserving undefined when both are empty. */
export function mergeAppendSystemPrompt(base?: string, extra?: string): string | undefined {
    if (base && extra) {
        return `${base}\n\n${extra}`
    }
    return base ?? extra
}
