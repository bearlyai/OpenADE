/**
 * HyperPlan Prompts
 *
 * Prompt builders for the three HyperPlan primitives: Plan, Review, and Reconcile.
 *
 * Key design decisions:
 * - Plan prompts are identical to the standard plan prompt + a Risks & Alternatives section.
 *   No agent knows it's part of a multi-agent flow during planning.
 * - Review prompts produce structured critique, NOT a new plan.
 * - Reconcile prompts randomly order inputs to avoid anchoring bias.
 */

import { PLAN_MODE_INSTRUCTIONS, PLANNING_GUIDELINES } from "../prompts/prompts"

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

export function buildHyperPlanStepPrompt(taskDescription: string): {
    systemPrompt: string
    userMessage: string
} {
    return {
        systemPrompt: HYPERPLAN_PLAN_SYSTEM_PROMPT,
        userMessage: taskDescription,
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
    planStepId: string,
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
3. Testability — Concrete, sufficient testing strategy?
4. Risk — Edge cases handled? What could go wrong?
5. Reusability — Leverages existing patterns vs. reinventing?
6. Clarity — Could another engineer execute this without questions?

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
    inputs: ReconcileInput[],
): {
    systemPrompt: string
    userMessage: string
} {
    // Randomly shuffle inputs to avoid ordering bias
    const shuffled = [...inputs].sort(() => Math.random() - 0.5)

    // Assign anonymous labels
    const inputBlocks = shuffled.map((input, i) => {
        const label = PLAN_LABELS[i] || `${i}`
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
    }
}
