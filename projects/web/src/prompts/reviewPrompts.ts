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
            "If relevant, verify assumptions against the current code and recent diffs/commits." +
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
            "Prioritize bugs, regressions, and risky complexity." +
            buildChangedFilesBlock(changedFiles) +
            buildCustomInstructionsBlock(customInstructions),
        consumedCommentIds: [],
    }
}

export function buildReviewHandoffPrompt({ reviewType, reviewText }: { reviewType: ReviewType; reviewText: string }): string {
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
