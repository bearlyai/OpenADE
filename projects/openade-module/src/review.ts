export type OpenADEReviewType = "plan" | "work"

const REVIEW_MODE_INSTRUCTIONS = `<current_operating_mode mode="review">
<capabilities>
- Analyze the provided context and produce concise, actionable review feedback.
- Use read-only exploration when needed.
- Inspect relevant git state, diffs, commits, and touched files before concluding.
</capabilities>

<constraints>
- Do not modify files.
- Do not create commits or branches.
- Do not run state-changing commands.
- Keep feedback short and specific.
</constraints>
</current_operating_mode>`

export const REVIEW_FINDING_FORMAT =
    "For each finding: Location, Issue, Criticality: N/10, Suggestion. Always write the score with the /10 denominator. Bullets only, no prose."

export const REVIEW_DIMENSIONS = `Only raise findings you would be comfortable blocking a PR on. Do not make trivial, nitpicky, or speculative comments. Every finding should be a real bug, a real risk, or a meaningfully better approach.

Every finding must include a Criticality score written as N/10 so the user can decide whether the fix is worth the engineering effort. Score by severity, likelihood, user impact, and engineering risk: 10/10 is a release blocker, 7-9/10 is high risk, 4-6/10 is meaningful but not necessarily blocking, and 1-3/10 is low importance.

Evaluate through these lenses:

1. Bugs and correctness: logic errors, wrong assumptions, broken edge cases, and regressions.
2. Security: injection vectors, unsafe deserialization, secrets in code, missing input validation, and other trust-boundary issues.
3. Better approaches: clearly superior reuse, simplification, or architecture that avoids meaningful risk.
4. Test quality: tests that do not catch regressions, over-mocking, brittle assertions, and missing edge coverage.
5. Robustness: unexpected inputs, concurrency, partial failures, unhandled errors, and fragile assumptions.`

export const REVIEW_ENGINEERING_GUIDANCE = `Engineering standards to enforce when they affect correctness, maintainability, or test confidence:

- Tight contracts: flag loose typing, unchecked casts, broad public shapes, or missing validation where narrowing would prevent bugs.
- Modularity: point out interfaces that can be tightened to reduce coupling.
- Simplicity: prefer surgical fixes and existing patterns.
- High-signal tests: prefer tests that exercise behavior and real integration boundaries.
- Robustness: flag swallowed errors, missing status checks, race conditions, and weak failure handling.
- Operational visibility: flag missing logs, metrics, or docs where investigation would otherwise be hard.
- Infrastructure and data safety: flag hidden setup, unsafe migrations, destructive operations, and production-data risk.
- Docs and local instructions: flag stale CLAUDE.md or AGENTS.md guidance when workflow behavior changes.`

const REVIEW_SENSITIVITY_GUIDANCE = [
    "Do not comment on style, formatting, naming, or conventions unless it causes a real bug.",
    "Actively explore surrounding code to find existing patterns, utilities, or conventions.",
    "If something may be intentional, flag it as a confirmation item instead of a bug.",
    "Ignore unrelated changes from other agents or concurrent threads unless they directly affect the reviewed work.",
    "If you have no blocking findings, say so clearly and briefly.",
    "After findings, add a short section titled 'Things that might be intentional (confirm)' with up to 3 items.",
].join("\n")

export interface OpenADEReviewPromptResult {
    systemPrompt: string
    userMessage: string
}

function customInstructionsBlock(customInstructions?: string): string {
    const text = customInstructions?.trim()
    return text ? `\n\n<additional_instructions>\n${text}\n</additional_instructions>` : ""
}

function changedFilesBlock(changedFiles?: string[]): string {
    return changedFiles && changedFiles.length > 0 ? `\n\n<recent_changed_files>\n${changedFiles.map((file) => `- ${file}`).join("\n")}\n</recent_changed_files>` : ""
}

export function buildOpenADEPlanReviewPrompt({
    threadXml,
    planText,
    changedFiles,
    customInstructions,
}: {
    threadXml: string
    planText: string
    changedFiles?: string[]
    customInstructions?: string
}): OpenADEReviewPromptResult {
    return {
        systemPrompt: REVIEW_MODE_INSTRUCTIONS,
        userMessage:
            `<task_thread_context>\n${threadXml}\n</task_thread_context>\n\n` +
            `<plan_to_review>\n${planText}\n</plan_to_review>\n\n` +
            `Review this plan. ${REVIEW_FINDING_FORMAT}\n` +
            "Prioritize correctness gaps and blockers first.\n" +
            "If relevant, verify assumptions against the current code and recent diffs/commits.\n\n" +
            `${REVIEW_DIMENSIONS}\n\n` +
            `${REVIEW_ENGINEERING_GUIDANCE}\n\n` +
            `${REVIEW_SENSITIVITY_GUIDANCE}` +
            changedFilesBlock(changedFiles) +
            customInstructionsBlock(customInstructions),
    }
}

export function buildOpenADEWorkReviewPrompt({
    threadXml,
    changedFiles,
    customInstructions,
}: {
    threadXml: string
    changedFiles?: string[]
    customInstructions?: string
}): OpenADEReviewPromptResult {
    return {
        systemPrompt: REVIEW_MODE_INSTRUCTIONS,
        userMessage:
            `<task_thread_context>\n${threadXml}\n</task_thread_context>\n\n` +
            "Review the recent work. Use read-only exploration as needed.\n" +
            "Inspect relevant git status/diff, recent commits, and touched files before writing conclusions.\n" +
            `${REVIEW_FINDING_FORMAT}\n` +
            "Prioritize bugs, regressions, and risky complexity.\n\n" +
            `${REVIEW_DIMENSIONS}\n\n` +
            `${REVIEW_ENGINEERING_GUIDANCE}\n\n` +
            `${REVIEW_SENSITIVITY_GUIDANCE}` +
            changedFilesBlock(changedFiles) +
            customInstructionsBlock(customInstructions),
    }
}

export function buildOpenADEReviewHandoffPrompt({
    reviewType,
    reviewText,
}: {
    reviewType: OpenADEReviewType
    reviewText: string
}): string {
    const reviewedSubject = reviewType === "plan" ? "your plan" : "your recent work"
    return (
        `<review_feedback>\n${reviewText}\n</review_feedback>\n\n` +
        `A reviewer shared the feedback above on ${reviewedSubject}. For each finding, respond in this exact format:\n\n` +
        "### Finding N: <short bug summary>\n" +
        "- Criticality: <1-10>/10, preserving the reviewer's score if present or assigning one from severity, likelihood, user impact, and engineering risk\n" +
        "- Decision: Agree | Disagree\n" +
        "- Why: <brief reasoning>\n" +
        "- Fix: <specific change you would make, or N/A if disagree>\n\n" +
        "After all findings, add:\n" +
        "### Proposed Changes\n" +
        "- <concise bullet list of all fixes you agree with>\n\n" +
        'Then ask: "Would you like me to proceed with the agreed-upon changes?"'
    )
}
