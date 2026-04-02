import type { PromptResult } from "./prompts"

export type ReviewType = "plan" | "work"

const REVIEW_MODE_INSTRUCTIONS = `<current_operating_mode mode="review">
Review the provided task context and produce structured, actionable feedback.

<capabilities>
- Read and analyze task context, plans, and recent execution output
- Use tools for read-only exploration when needed
- Identify correctness gaps, complexity risks, and missing edge cases
- Suggest specific improvements tied to concrete locations
</capabilities>

<constraints>
- Do NOT modify any files
- Do NOT create commits or branches
- Do NOT run state-changing commands
- Output only review feedback
</constraints>
</current_operating_mode>`

export function buildPlanReviewPrompt({ threadXml, planText }: { threadXml: string; planText: string }): PromptResult {
    return {
        systemPrompt: REVIEW_MODE_INSTRUCTIONS,
        userMessage:
            `<task_thread_context>\n${threadXml}\n</task_thread_context>\n\n` +
            `<plan_to_review>\n${planText}\n</plan_to_review>\n\n` +
            "Review this implementation plan.\n" +
            "For each issue, provide:\n" +
            "1. Location — which section/step\n" +
            "2. Issue — what is wrong or could be improved\n" +
            "3. Suggestion — a specific recommended change\n\n" +
            "Focus on correctness, completeness, simplicity, missed edge cases, and alignment with codebase patterns.",
        consumedCommentIds: [],
    }
}

export function buildWorkReviewPrompt({ threadXml }: { threadXml: string }): PromptResult {
    return {
        systemPrompt: REVIEW_MODE_INSTRUCTIONS,
        userMessage:
            `<task_thread_context>\n${threadXml}\n</task_thread_context>\n\n` +
            "Review the recent work done by the AI agent.\n" +
            "Use read-only exploration as needed (for example: inspect relevant files and diffs).\n\n" +
            "For each issue, provide:\n" +
            "1. Location — file path and line/function\n" +
            "2. Issue — what is wrong or could be improved\n" +
            "3. Suggestion — a specific recommended change\n\n" +
            "Focus on bugs, correctness, simplicity, unnecessary complexity, and alignment with codebase patterns.",
        consumedCommentIds: [],
    }
}

export function buildReviewHandoffPrompt({ reviewType, reviewText }: { reviewType: ReviewType; reviewText: string }): string {
    const reviewedSubject = reviewType === "plan" ? "your plan" : "your recent work"
    return (
        `<review_feedback>\n${reviewText}\n</review_feedback>\n\n` +
        `A reviewer shared the feedback above on ${reviewedSubject}. For each item:\n` +
        "1. State whether you agree or disagree, with a brief reason\n" +
        "2. If you agree, describe the exact fix you would make\n\n" +
        'Then ask: "Would you like me to proceed with the agreed-upon changes?"'
    )
}
