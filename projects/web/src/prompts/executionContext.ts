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
    "Important: this UI renders markdown, including headings, lists, code fences, tables, task lists, and links.",
    "- To link a local repository file, write its path relative to the cwd/project root with optional :line, e.g. src/store/TaskModel.ts:333; the UI opens it in the file tray.",
    "- Use normal markdown links for web URLs; use project-relative paths for local files.",
    "- Do not wrap file paths in backticks inside plan steps — just use the bare path.",
    '- Keep it compact; avoid section-heavy templates like "What changed" and "Verification run" unless requested.',
    "</raw_renderer_response_style>",
].join("\n")

const ACTION_RESPONSE_STYLE_SOURCE_TYPES: ReadonlySet<ActionEventSource["type"]> = new Set(["do", "run_plan"])

const ACTION_RESPONSE_STYLE_INSTRUCTION = [
    "<action_response_style>",
    "Keep final user-facing completion reports compact.",
    "Markdown is supported. To link a local file, write its path relative to the cwd/project root with an optional :line, e.g. src/store/TaskModel.ts:333; the UI opens it as a file link.",
    "Always end final user-facing completion reports with ## TL;DR containing 3-6 concise bullets chosen to fit the response; do not use predefined content slots. Do not add anything after this section.",
    "</action_response_style>",
].join("\n")

export function buildRawRendererStyleInstruction(harnessId: HarnessId, _sourceType: ActionEventSource["type"]): string | undefined {
    if (harnessId !== "codex") return undefined
    return CODEX_RAW_RENDERER_STYLE_HINT
}

export function buildActionResponseStyleInstruction(sourceType: ActionEventSource["type"]): string | undefined {
    if (!ACTION_RESPONSE_STYLE_SOURCE_TYPES.has(sourceType)) return undefined
    return ACTION_RESPONSE_STYLE_INSTRUCTION
}

/** Merge two appendSystemPrompt fragments, preserving undefined when both are empty. */
export function mergeAppendSystemPrompt(base?: string, extra?: string): string | undefined {
    if (base && extra) {
        return `${base}\n\n${extra}`
    }
    return base ?? extra
}
