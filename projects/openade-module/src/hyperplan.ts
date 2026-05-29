import type {
    OpenADEAgentCouplet,
    OpenADEHyperPlanStep,
    OpenADEHyperPlanStrategy,
} from "./types"

export interface OpenADEMainThreadContextMeta {
    truncated: boolean
    includedEvents: number
    omittedEvents: number
    byteLength: number
}

export interface OpenADEHyperPlanStepPromptContext {
    mainThreadContextXml?: string
    mainThreadContextMeta?: OpenADEMainThreadContextMeta
}

export interface OpenADEReconcileInput {
    stepId: string
    primitive: "plan" | "review"
    text: string
    reviewsStepId?: string
}

const COMPACT_STYLE_RULES = `
- Bullets > paragraphs. One bullet = one fact, choice, risk, or action.
- No filler. Never start with "Based on my analysis..." or end with "In summary...".
- Tradeoffs on labeled lines, never buried in prose.
- Markdown is supported. Use concise markdown when it helps readability.
- To link a local file, write its path relative to the cwd/project root with an optional line number, like src/store/TaskModel.ts:333; the UI opens it as a file link.
- Omit empty sections. A one-section response is fine.`

const PLANNING_GUIDELINES = `
- State assumptions in Decisions. Note what clarification would help.
- Prefer simple solutions. Challenge the request if simpler exists.
- Surgical changes only. Match existing code style.
- Include a testing step. Follow existing test patterns. No over-mocking.
- Update docs when changes affect APIs or workflows.
${COMPACT_STYLE_RULES}`

const HYPERPLAN_PLAN_SYSTEM_PROMPT = `<current_operating_mode mode="plan">
Generate a clear, actionable implementation plan for the task provided.

<constraints>
- Do not modify any files.
- Do not run commands that change state.
- Do not execute code or scripts.
- Do not create commits or branches.
</constraints>

<guidelines>
${PLANNING_GUIDELINES}
</guidelines>

<additional_output_section>
Include this section before the final ## TL;DR section:

## Risks & Alternatives
- Key risks with this approach and how they are mitigated
- Alternatives considered and why they were rejected
- Assumptions that, if wrong, would change the plan
</additional_output_section>
</current_operating_mode>`

const REVIEW_SYSTEM_PROMPT = `<current_operating_mode mode="review">
Review the implementation plan provided and produce structured feedback.
You are not producing a new plan, only evaluating the given one.

<constraints>
- Do not produce a new plan.
- Do not modify files.
- Do not run commands that change state.
</constraints>

<guidelines>
${PLANNING_GUIDELINES}
</guidelines>

<output_format>
## Strengths
Specific parts that are strong and why.

## Weaknesses
Specific gaps, mistakes, or missing work.

## Risks
Failure modes, edge cases, or assumptions that could break.

## Suggestions
Specific, actionable improvements with rationale.
</output_format>
</current_operating_mode>`

const REVISE_APPEND_SYSTEM_PROMPT = `<revision_mode>
The user will share peer review feedback on your plan from an independent reviewer.
Adopt suggestions that genuinely improve the plan, reject suggestions you disagree with, and produce a complete revised plan.
End the revised plan with ## TL;DR containing 3-6 concise bullets. Do not add anything after that section.
</revision_mode>`

const RECONCILE_SYSTEM_PROMPT = `<current_operating_mode mode="reconcile">
You are given multiple implementation plans and/or reviews for the same task.
Your job is to produce a single, optimal final plan.

<constraints>
- You must produce exactly one final plan.
- Do not modify files.
- Do not run commands that change state.
- Evaluate objectively. No input has inherent priority over another.
</constraints>

<guidelines>
${PLANNING_GUIDELINES}
</guidelines>

<evaluation_rubric>
Evaluate correctness, minimality, testability, risk, reusability, clarity, security, and robustness.
</evaluation_rubric>

<output_format>
## Overview
Brief summary of the plan.

## User-Specified Requirements
Explicit requests, constraints, preferences, or acceptance criteria from the user.

## Outcomes
A bulleted list of outcomes to expect when the task is completed.

## Decisions
Meaningful choices and alternatives.

## Plan
Implementation steps with code blocks for key interfaces and signatures.

## Reconciliation Notes
- Which input(s) formed the basis and why
- What was adopted
- What was rejected and why

## TL;DR
3-6 concise bullets. Do not add anything after this section.
</output_format>
</current_operating_mode>`

const PLAN_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

export function standardOpenADEHyperPlanStrategy(agent: OpenADEAgentCouplet): OpenADEHyperPlanStrategy {
    return {
        id: "standard",
        name: "Standard",
        description: "Plan with a single agent",
        steps: [{ id: "plan_0", primitive: "plan", agent, inputs: [] }],
        terminalStepId: "plan_0",
    }
}

export function ensembleOpenADEHyperPlanStrategy(planners: OpenADEAgentCouplet[], reconciler: OpenADEAgentCouplet): OpenADEHyperPlanStrategy {
    const planSteps: OpenADEHyperPlanStep[] = planners.map((agent, index) => ({
        id: `plan_${index}`,
        primitive: "plan",
        agent,
        inputs: [],
    }))
    return {
        id: "ensemble",
        name: "Ensemble",
        description: "Multiple agents plan in parallel, then reconcile into one plan",
        steps: [
            ...planSteps,
            {
                id: "reconcile_0",
                primitive: "reconcile",
                agent: reconciler,
                inputs: planSteps.map((step) => step.id),
            },
        ],
        terminalStepId: "reconcile_0",
    }
}

export function peerReviewOpenADEHyperPlanStrategy(planner: OpenADEAgentCouplet, reviewer: OpenADEAgentCouplet): OpenADEHyperPlanStrategy {
    return {
        id: "peer-review",
        name: "Peer Review",
        description: "One agent plans, another reviews, then the planner revises based on feedback",
        steps: [
            { id: "plan_a", primitive: "plan", agent: planner, inputs: [] },
            { id: "review_b", primitive: "review", agent: reviewer, inputs: ["plan_a"] },
            { id: "revise_a", primitive: "revise", agent: planner, inputs: ["review_b"], resumeStepId: "plan_a" },
        ],
        terminalStepId: "revise_a",
    }
}

export function crossReviewOpenADEHyperPlanStrategy(
    agentA: OpenADEAgentCouplet,
    agentB: OpenADEAgentCouplet,
    reconciler: OpenADEAgentCouplet
): OpenADEHyperPlanStrategy {
    return {
        id: "cross-review",
        name: "Cross-Review",
        description: "Two agents plan and cross-review each other, then reconcile",
        steps: [
            { id: "plan_a", primitive: "plan", agent: agentA, inputs: [] },
            { id: "plan_b", primitive: "plan", agent: agentB, inputs: [] },
            { id: "review_a_of_b", primitive: "review", agent: agentA, inputs: ["plan_b"] },
            { id: "review_b_of_a", primitive: "review", agent: agentB, inputs: ["plan_a"] },
            {
                id: "reconcile_0",
                primitive: "reconcile",
                agent: reconciler,
                inputs: ["plan_a", "plan_b", "review_a_of_b", "review_b_of_a"],
            },
        ],
        terminalStepId: "reconcile_0",
    }
}

export function resolveOpenADEHyperPlanStrategy(args: {
    settings?: Record<string, unknown>
    fallbackAgent: OpenADEAgentCouplet
}): OpenADEHyperPlanStrategy {
    const settings = args.settings ?? {}
    const strategyId = typeof settings.hyperplanStrategyId === "string" ? settings.hyperplanStrategyId : "standard"
    const agents = Array.isArray(settings.hyperplanAgents)
        ? settings.hyperplanAgents
              .map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null))
              .filter((item): item is Record<string, unknown> => item !== null)
              .map((item) => ({
                  harnessId: typeof item.harnessId === "string" ? item.harnessId : args.fallbackAgent.harnessId,
                  modelId: typeof item.modelId === "string" ? item.modelId : args.fallbackAgent.modelId,
              }))
        : [args.fallbackAgent]
    const reconcilerRecord =
        typeof settings.hyperplanReconciler === "object" && settings.hyperplanReconciler !== null
            ? (settings.hyperplanReconciler as Record<string, unknown>)
            : undefined
    const reconciler = reconcilerRecord
        ? {
              harnessId: typeof reconcilerRecord.harnessId === "string" ? reconcilerRecord.harnessId : agents[0].harnessId,
              modelId: typeof reconcilerRecord.modelId === "string" ? reconcilerRecord.modelId : agents[0].modelId,
          }
        : agents[0]

    switch (strategyId) {
        case "peer-review":
            return agents.length < 2 ? standardOpenADEHyperPlanStrategy(agents[0]) : peerReviewOpenADEHyperPlanStrategy(agents[0], agents[1])
        case "ensemble":
            return agents.length < 2 ? standardOpenADEHyperPlanStrategy(agents[0]) : ensembleOpenADEHyperPlanStrategy(agents, reconciler)
        case "cross-review":
            return agents.length < 2 ? standardOpenADEHyperPlanStrategy(agents[0]) : crossReviewOpenADEHyperPlanStrategy(agents[0], agents[1], reconciler)
        default:
            return standardOpenADEHyperPlanStrategy(agents[0])
    }
}

export function isStandardOpenADEHyperPlanStrategy(strategy: OpenADEHyperPlanStrategy): boolean {
    return strategy.id === "standard" && strategy.steps.length === 1
}

export function validateOpenADEHyperPlanStrategy(strategy: OpenADEHyperPlanStrategy): string[] {
    const errors: string[] = []
    const stepMap = new Map(strategy.steps.map((step) => [step.id, step]))
    if (stepMap.size !== strategy.steps.length) errors.push("Duplicate step IDs")
    const terminal = stepMap.get(strategy.terminalStepId)
    if (!terminal) errors.push(`Terminal step "${strategy.terminalStepId}" not found`)
    else if (terminal.primitive === "review") errors.push("Terminal step must produce a plan, not a review")

    for (const step of strategy.steps) {
        if (step.primitive === "plan" && step.inputs.length > 0) errors.push(`Plan step "${step.id}" must have no inputs`)
        if (step.primitive === "review" && step.inputs.length !== 1) errors.push(`Review step "${step.id}" must have exactly 1 input`)
        if (step.primitive === "reconcile" && step.inputs.length < 1) errors.push(`Reconcile step "${step.id}" must have at least 1 input`)
        if (step.primitive === "revise" && (step.inputs.length !== 1 || !step.resumeStepId)) {
            errors.push(`Revise step "${step.id}" must have exactly 1 input and a resumeStepId`)
        }
        for (const input of step.inputs) {
            if (!stepMap.has(input)) errors.push(`Step "${step.id}" references unknown input "${input}"`)
        }
        if (step.resumeStepId && !stepMap.has(step.resumeStepId)) errors.push(`Step "${step.id}" references unknown resume step "${step.resumeStepId}"`)
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()
    function hasCycle(id: string): boolean {
        if (visiting.has(id)) return true
        if (visited.has(id)) return false
        visiting.add(id)
        const step = stepMap.get(id)
        if (step) {
            for (const input of step.inputs) {
                if (hasCycle(input)) return true
            }
        }
        visiting.delete(id)
        visited.add(id)
        return false
    }
    for (const step of strategy.steps) {
        if (hasCycle(step.id)) {
            errors.push("Strategy contains a cycle")
            break
        }
    }

    return errors
}

export function groupOpenADEHyperPlanByDepth(strategy: OpenADEHyperPlanStrategy): OpenADEHyperPlanStep[][] {
    const stepMap = new Map(strategy.steps.map((step) => [step.id, step]))
    const depthMap = new Map<string, number>()
    function depth(id: string): number {
        const existing = depthMap.get(id)
        if (existing !== undefined) return existing
        const step = stepMap.get(id)
        if (!step || step.inputs.length === 0) {
            depthMap.set(id, 0)
            return 0
        }
        const value = Math.max(...step.inputs.map(depth)) + 1
        depthMap.set(id, value)
        return value
    }

    const groups = new Map<number, OpenADEHyperPlanStep[]>()
    for (const step of strategy.steps) {
        const value = depth(step.id)
        groups.set(value, [...(groups.get(value) ?? []), step])
    }
    return Array.from(groups.entries())
        .sort(([a], [b]) => a - b)
        .map(([, steps]) => steps)
}

export function buildOpenADEHyperPlanStepPrompt(
    taskDescription: string,
    context: OpenADEHyperPlanStepPromptContext = {}
): { systemPrompt: string; userMessage: string } {
    if (!context.mainThreadContextXml) return { systemPrompt: HYPERPLAN_PLAN_SYSTEM_PROMPT, userMessage: taskDescription }
    const attrs = [`format="task_thread_xml"`]
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

export function buildOpenADEReviewStepPrompt(taskDescription: string, planText: string, planStepId: string): { systemPrompt: string; userMessage: string } {
    return {
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        userMessage: `<task_description>\n${taskDescription}\n</task_description>\n\n<plan_to_review id="${planStepId}">\n${planText}\n</plan_to_review>`,
    }
}

export function buildOpenADEReviseStepPrompt(reviewText: string, reviewerStepId: string): { systemPrompt: string; userMessage: string } {
    return {
        systemPrompt: REVISE_APPEND_SYSTEM_PROMPT,
        userMessage: `I asked an independent reviewer to evaluate your plan. Here is their feedback:
<peer_review from="${reviewerStepId}">
${reviewText}
</peer_review>
Please produce a revised plan incorporating the feedback you agree with.`,
    }
}

export function buildOpenADEReconcileStepPrompt(
    taskDescription: string,
    inputs: OpenADEReconcileInput[]
): { systemPrompt: string; userMessage: string; labelMapping: Array<{ stepId: string; label: string }> } {
    const shuffled = [...inputs].sort(() => Math.random() - 0.5)
    const labelMapping: Array<{ stepId: string; label: string }> = []
    const inputBlocks = shuffled.map((input, index) => {
        const label = PLAN_LABELS[index] || `${index}`
        labelMapping.push({ stepId: input.stepId, label })
        const tag = input.primitive === "plan" ? "plan" : "review"
        let reviewsAttr = ""
        if (input.primitive === "review" && input.reviewsStepId) {
            const reviewedPlanIndex = shuffled.findIndex((candidate) => candidate.stepId === input.reviewsStepId)
            if (reviewedPlanIndex >= 0) reviewsAttr = ` reviews="Plan ${PLAN_LABELS[reviewedPlanIndex] || `${reviewedPlanIndex}` }"`
        }
        return `<${tag} id="${label}"${reviewsAttr}>\n${input.text}\n</${tag}>`
    })
    return {
        systemPrompt: RECONCILE_SYSTEM_PROMPT,
        userMessage: `<task_description>\n${taskDescription}\n</task_description>\n\n<inputs randomly_ordered="true">\n${inputBlocks.join("\n\n")}\n</inputs>`,
        labelMapping,
    }
}

export function extractOpenADEPlanText(events: Array<Record<string, unknown>>, harnessId: string): string | null {
    const rawMessages = events.filter((event) => event.type === "raw_message" && typeof event.message === "object")
    if (harnessId === "claude-code") return extractClaudePlanText(rawMessages)
    if (harnessId === "codex" || harnessId === "codex-cli") return extractCodexPlanText(rawMessages)
    return null
}

function extractClaudePlanText(rawMessages: Array<Record<string, unknown>>): string | null {
    for (let index = rawMessages.length - 1; index >= 0; index--) {
        const message = rawMessages[index].message as Record<string, unknown>
        if (message.type === "result" && typeof message.result === "string" && message.result.length > 0) return message.result
    }
    for (let index = rawMessages.length - 1; index >= 0; index--) {
        const message = rawMessages[index].message as Record<string, unknown>
        if (message.type !== "assistant") continue
        const nested = typeof message.message === "object" && message.message !== null ? (message.message as Record<string, unknown>) : {}
        const content = Array.isArray(nested.content) ? nested.content : []
        const textParts = content
            .filter((block): block is Record<string, unknown> => typeof block === "object" && block !== null)
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text as string)
        if (textParts.length > 0) return textParts.join("\n")
    }
    return null
}

function extractCodexPlanText(rawMessages: Array<Record<string, unknown>>): string | null {
    const textParts: string[] = []
    for (const raw of rawMessages) {
        const message = raw.message as Record<string, unknown>
        if (message.type !== "item.completed") continue
        const item = typeof message.item === "object" && message.item !== null ? (message.item as Record<string, unknown>) : {}
        if (item.type === "agent_message" && typeof item.text === "string") textParts.push(item.text)
    }
    return textParts.length > 0 ? textParts.join("\n") : null
}
