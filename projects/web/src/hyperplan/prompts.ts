/**
 * HyperPlan Prompts
 *
 * Prompt builders for HyperPlan primitives: Plan, Review, Reconcile, and Revise.
 *
 * Key design decisions:
 * - Plan prompts are identical to the standard plan prompt + a Risks & Alternatives section.
 *   No agent knows it's part of a multi-agent flow during planning.
 * - Review prompts produce structured critique, NOT a new plan.
 * - Reconcile prompts randomly order inputs to avoid anchoring bias.
 */

import { PLAN_MODE_INSTRUCTIONS, PLANNING_GUIDELINES } from "../prompts/prompts"
import { REVIEW_DIMENSIONS } from "../prompts/reviewPrompts"

// ============================================================================
// Plan Step Prompt — same as standard plan but with Risks & Alternatives
// ============================================================================

const HYPERPLAN_PLAN_SYSTEM_PROMPT = `${PLAN_MODE_INSTRUCTIONS}

<additional_output_section>
After the ## Plan section, include:

## Risks & Alternatives
- Key risks with this approach and how they're mitigated
- Alternatives you considered and why you rejected them
- Assumptions that, if wrong, would change the plan
</additional_output_section>`

export interface MainThreadContextMeta {
    truncated: boolean
    includedEvents: number
    omittedEvents: number
    byteLength: number
}

export interface HyperPlanStepPromptContext {
    mainThreadContextXml?: string
    mainThreadContextMeta?: MainThreadContextMeta
}

export function buildHyperPlanStepPrompt(taskDescription: string): {
    systemPrompt: string
    userMessage: string
}
export function buildHyperPlanStepPrompt(
    taskDescription: string,
    context: HyperPlanStepPromptContext
): {
    systemPrompt: string
    userMessage: string
}
export function buildHyperPlanStepPrompt(
    taskDescription: string,
    context?: HyperPlanStepPromptContext
): {
    systemPrompt: string
    userMessage: string
} {
    if (!context?.mainThreadContextXml) {
        return {
            systemPrompt: HYPERPLAN_PLAN_SYSTEM_PROMPT,
            userMessage: taskDescription,
        }
    }

    const attrs: string[] = ['format="task_thread_xml"']
    if (context.mainThreadContextMeta) {
        attrs.push(
            `truncated="${context.mainThreadContextMeta.truncated}"`,
            `includedEvents="${context.mainThreadContextMeta.includedEvents}"`,
            `omittedEvents="${context.mainThreadContextMeta.omittedEvents}"`,
            `byteLength="${context.mainThreadContextMeta.byteLength}"`
        )
    }

    return {
        systemPrompt: HYPERPLAN_PLAN_SYSTEM_PROMPT,
        userMessage: `${taskDescription}\n\n<main_thread_context ${attrs.join(" ")}>\n${context.mainThreadContextXml}\n</main_thread_context>`,
    }
}

// ============================================================================
// Review Step Prompt — structured critique of one plan
// ============================================================================

const REVIEW_SYSTEM_PROMPT = `<current_operating_mode mode="review">
Review the implementation plan provided and produce structured feedback.
You are NOT producing a new plan — only evaluating the given one.

<capabilities>
- Analyze the plan for correctness, completeness, and feasibility
- Identify risks, gaps, and potential failure modes
- Suggest specific improvements with rationale
- Read files and explore the codebase to verify claims in the plan
</capabilities>

<constraints>
- Do not produce a new plan — only review the existing one
- Do not modify any files
- Do not run commands that change state
- Be specific — reference exact sections, steps, or code from the plan
</constraints>

<review_dimensions>
${REVIEW_DIMENSIONS}
</review_dimensions>

<guidelines>
${PLANNING_GUIDELINES}
</guidelines>

<output_format>
## Strengths
What the plan gets right — be specific about which parts are strong and why.

## Weaknesses
What the plan gets wrong or misses — be specific about which parts are weak and why.

## Risks
Potential failure modes, edge cases, or assumptions that could break.

## Suggestions
Specific, actionable improvements. For each suggestion, reference the plan section it applies to.
</output_format>
</current_operating_mode>`

export function buildReviewStepPrompt(
    taskDescription: string,
    planText: string,
    planStepId: string
): {
    systemPrompt: string
    userMessage: string
} {
    return {
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        userMessage: `<task_description>\n${taskDescription}\n</task_description>\n\n<plan_to_review id="${planStepId}">\n${planText}\n</plan_to_review>`,
    }
}

// ============================================================================
// Revise Step Prompt — resume planner session with peer review feedback
// ============================================================================

const REVISE_APPEND_SYSTEM_PROMPT = `<revision_mode>
The user will share peer review feedback on your plan from an independent reviewer.
Evaluate each point on its merits:
- Adopt suggestions that genuinely improve the plan
- Reject suggestions you disagree with (briefly note why in Revision Notes)
- Produce a complete revised plan, not just a diff
</revision_mode>`

export function buildReviseStepPrompt(
    reviewText: string,
    reviewerStepId: string
): {
    systemPrompt: string
    userMessage: string
} {
    return {
        systemPrompt: REVISE_APPEND_SYSTEM_PROMPT,
        userMessage: `I asked an independent reviewer to evaluate your plan. Here's their feedback — consider what resonates and what doesn't. Don't assume they're right about everything; use your own judgment.
<peer_review from="${reviewerStepId}">
${reviewText}
</peer_review>
Please produce a revised plan incorporating the feedback you agree with. In a "Revision Notes" section at the end, note what you changed and what you kept, and briefly explain why for any suggestions you rejected.`,
    }
}

// ============================================================================
// Reconcile Step Prompt — merge N plans/reviews into one final plan
// ============================================================================

const RECONCILE_SYSTEM_PROMPT = `<current_operating_mode mode="reconcile">
You are given multiple implementation plans and/or reviews for the same task.
Your job is to produce a single, optimal final plan.

<capabilities>
- Analyze and compare multiple plans side-by-side
- Identify the strongest elements from each plan
- Merge, adopt, or synthesize approaches as appropriate
- Read files and explore the codebase to verify claims
</capabilities>

<constraints>
- You MUST produce exactly one final plan
- Do not modify any files
- Do not run commands that change state
- Evaluate objectively — no plan has inherent priority over another
</constraints>

<guidelines>
${PLANNING_GUIDELINES}
</guidelines>

<evaluation_rubric>
For each plan, evaluate on these dimensions:
1. Correctness — Does it fully address the requirements?
2. Minimality — Only necessary changes, no over-engineering?
3. Testability — Are tests meaningful (not excessive mocking or tautological assertions)?
4. Risk — Edge cases handled? What could go wrong?
5. Reusability — Leverages existing patterns vs. reinventing?
6. Clarity — Could another engineer execute this without questions?
7. Security — Free of injection, unsafe deserialization, or missing trust-boundary validation?
8. Robustness — Handles unexpected inputs, partial failures, and concurrency safely?

You may adopt one plan wholesale if it's clearly superior,
or merge the strongest elements from multiple plans.
</evaluation_rubric>

<output_format>
## Overview
Brief summary of the plan.

## Outcomes
A bulleted list of outcomes to expect when the task is completed.

## Decisions
When there are meaningful choices to make, present each as a decision with alternatives.

## Plan
Implementation steps with code blocks for key interfaces and signatures.

## Reconciliation Notes
- Which plan(s) formed the basis and why
- What was adopted from each input
- What was rejected and why
</output_format>
</current_operating_mode>`

/** Letters for anonymous plan/review IDs */
const PLAN_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

export interface ReconcileInput {
    stepId: string
    primitive: "plan" | "review"
    text: string
    /** For reviews: which plan step this reviews */
    reviewsStepId?: string
}

export function buildReconcileStepPrompt(
    taskDescription: string,
    inputs: ReconcileInput[]
): {
    systemPrompt: string
    userMessage: string
    /** Maps each input stepId to its anonymous label (A, B, C, ...) */
    labelMapping: Array<{ stepId: string; label: string }>
} {
    // Randomly shuffle inputs to avoid ordering bias
    const shuffled = [...inputs].sort(() => Math.random() - 0.5)

    const labelMapping: Array<{ stepId: string; label: string }> = []

    // Assign anonymous labels
    const inputBlocks = shuffled.map((input, i) => {
        const label = PLAN_LABELS[i] || `${i}`
        labelMapping.push({ stepId: input.stepId, label })
        const tag = input.primitive === "plan" ? "plan" : "review"

        // For reviews, indicate which plan they review (using the anonymous label of that plan)
        let reviewsAttr = ""
        if (input.primitive === "review" && input.reviewsStepId) {
            const reviewedPlanIndex = shuffled.findIndex((s) => s.stepId === input.reviewsStepId)
            if (reviewedPlanIndex >= 0) {
                const reviewedLabel = PLAN_LABELS[reviewedPlanIndex] || `${reviewedPlanIndex}`
                reviewsAttr = ` reviews="Plan ${reviewedLabel}"`
            }
        }

        return `<${tag} id="${label}"${reviewsAttr}>\n${input.text}\n</${tag}>`
    })

    const userMessage = `<task_description>\n${taskDescription}\n</task_description>\n\n<inputs randomly_ordered="true">\n${inputBlocks.join("\n\n")}\n</inputs>`

    return {
        systemPrompt: RECONCILE_SYSTEM_PROMPT,
        userMessage,
        labelMapping,
    }
}
