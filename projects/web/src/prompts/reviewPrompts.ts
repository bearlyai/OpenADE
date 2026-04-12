import type { PromptResult } from "./prompts"

export type ReviewType = "plan" | "work"

const REVIEW_MODE_INSTRUCTIONS = `<current_operating_mode mode="review">
<capabilities>
- Analyze the provided context and produce concise, actionable review feedback
- Use read-only exploration when needed
- Inspect relevant git state, diffs, commits, and touched files before concluding
</capabilities>

<constraints>
- Do NOT modify any files
- Do NOT create commits or branches
- Do NOT run state-changing commands
- Keep feedback short and specific
</constraints>
</current_operating_mode>`

export const REVIEW_DIMENSIONS = `Only raise findings you would be comfortable blocking a PR on. Do not make trivial, nitpicky, or speculative comments. Every finding should be a real bug, a real risk, or a meaningfully better approach.

Evaluate through these lenses:

1. **Bugs & correctness** — Logic errors, off-by-one mistakes, wrong assumptions, broken edge cases, regressions. If it would break in production, flag it.
2. **Security** — Injection vectors (command, SQL, XSS), unsafe deserialization, secrets in code, missing input validation at trust boundaries, and other OWASP-class vulnerabilities.
3. **Better approaches** — Actively look for materially better ways to do this. Can it unify with an existing pattern in the codebase? Is there already a utility, helper, or convention that does this? Would a different strategy avoid an entire class of bugs or simplify the code significantly? The best review comments are "we already do this over in X, you can reuse that" or "this whole thing collapses if you use Y instead." Don't flag "could also do it this way" alternatives — only flag approaches that are clearly superior.
4. **Test quality** — Tests that don't actually catch regressions: excessive mocking that hides real behavior, assertions on trivial/tautological conditions, tests that mirror the implementation, and missing coverage of edge cases that matter.
5. **Robustness** — Will this code behave correctly under unexpected inputs, concurrency, partial failures, or edge cases? Unhandled errors, race conditions, missing guards at system boundaries, and assumptions that could silently break.`

const REVIEW_SENSITIVITY_GUIDANCE = [
    "Do NOT comment on style, formatting, naming, or conventions unless it causes a real bug. Linters handle that.",
    "Actively explore the surrounding codebase to find existing patterns, utilities, or conventions the author may not know about. The highest-value review finding is showing someone a better way that already exists.",
    "If something may be intentional, do not label it as a bug; flag it as a confirmation item.",
    "Other agents or threads may be working concurrently in the same worktree. If you see unrelated changes in the diff or file tree, ignore them and focus only on the work described in the task thread context.",
    "If you have no blocking findings, say so clearly and briefly. An empty review is better than a padded one.",
    "After your findings, add a short section titled 'Things that might be intentional (confirm)' with up to 3 items.",
].join("\n")

function buildCustomInstructionsBlock(customInstructions?: string): string {
    const text = customInstructions?.trim()
    if (!text) return ""
    return `\n\n<additional_instructions>\n${text}\n</additional_instructions>`
}

function buildChangedFilesBlock(changedFiles?: string[]): string {
    if (!changedFiles || changedFiles.length === 0) return ""
    return `\n\n<recent_changed_files>\n${changedFiles.map((file) => `- ${file}`).join("\n")}\n</recent_changed_files>`
}

export function buildPlanReviewPrompt({
    threadXml,
    planText,
    changedFiles,
    customInstructions,
}: {
    threadXml: string
    planText: string
    changedFiles?: string[]
    customInstructions?: string
}): PromptResult {
    return {
        systemPrompt: REVIEW_MODE_INSTRUCTIONS,
        userMessage:
            `<task_thread_context>\n${threadXml}\n</task_thread_context>\n\n` +
            `<plan_to_review>\n${planText}\n</plan_to_review>\n\n` +
            "Review this plan. For each finding, provide: Location, Issue, Suggestion.\n" +
            "Prioritize correctness gaps and blockers first.\n" +
            "If relevant, verify assumptions against the current code and recent diffs/commits.\n\n" +
            `${REVIEW_DIMENSIONS}\n\n` +
            `${REVIEW_SENSITIVITY_GUIDANCE}` +
            buildChangedFilesBlock(changedFiles) +
            buildCustomInstructionsBlock(customInstructions),
        consumedCommentIds: [],
    }
}

export function buildWorkReviewPrompt({
    threadXml,
    changedFiles,
    customInstructions,
}: {
    threadXml: string
    changedFiles?: string[]
    customInstructions?: string
}): PromptResult {
    return {
        systemPrompt: REVIEW_MODE_INSTRUCTIONS,
        userMessage:
            `<task_thread_context>\n${threadXml}\n</task_thread_context>\n\n` +
            "Review the recent work. Use read-only exploration as needed.\n" +
            "Inspect relevant git status/diff, recent commits, and touched files before writing conclusions.\n" +
            "For each finding, provide: Location, Issue, Suggestion.\n" +
            "Prioritize bugs, regressions, and risky complexity.\n\n" +
            `${REVIEW_DIMENSIONS}\n\n` +
            `${REVIEW_SENSITIVITY_GUIDANCE}` +
            buildChangedFilesBlock(changedFiles) +
            buildCustomInstructionsBlock(customInstructions),
        consumedCommentIds: [],
    }
}

export function buildReviewHandoffPrompt({
    reviewType,
    reviewText,
}: {
    reviewType: ReviewType
    reviewText: string
}): string {
    const reviewedSubject = reviewType === "plan" ? "your plan" : "your recent work"
    return (
        `<review_feedback>\n${reviewText}\n</review_feedback>\n\n` +
        `A reviewer shared the feedback above on ${reviewedSubject}. For each finding, respond in this exact format:\n\n` +
        "### Finding N: <short bug summary>\n" +
        "- Decision: Agree | Disagree\n" +
        "- Why: <brief reasoning>\n" +
        "- Fix: <specific change you would make, or N/A if disagree>\n\n" +
        "After all findings, add:\n" +
        "### Proposed Changes\n" +
        "- <concise bullet list of all fixes you agree with>\n\n" +
        'Then ask: "Would you like me to proceed with the agreed-upon changes?"'
    )
}
