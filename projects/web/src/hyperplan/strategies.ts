/**
 * HyperPlan Strategy Presets & Validation
 *
 * Factory functions for creating strategy DAGs, and a validator
 * that checks structural invariants.
 *
 * To add a new strategy:
 * 1. Write a factory function that returns HyperPlanStrategy
 * 2. Add it to STRATEGY_PRESETS
 * 3. The UI will pick it up automatically
 */

import type { AgentCouplet, HyperPlanStep, HyperPlanStrategy } from "./types"

// ============================================================================
// Strategy Presets
// ============================================================================

/** Standard — single agent, no reconciliation. Degenerates to normal plan. */
export function standardStrategy(agent: AgentCouplet): HyperPlanStrategy {
    return {
        id: "standard",
        name: "Standard",
        description: "Plan with a single agent",
        steps: [{ id: "plan_0", primitive: "plan", agent, inputs: [] }],
        terminalStepId: "plan_0",
    }
}

/** Ensemble — N agents plan in parallel, one reconciles. */
export function ensembleStrategy(planners: AgentCouplet[], reconciler: AgentCouplet): HyperPlanStrategy {
    const planSteps: HyperPlanStep[] = planners.map((agent, i) => ({
        id: `plan_${i}`,
        primitive: "plan" as const,
        agent,
        inputs: [],
    }))
    const reconcileStep: HyperPlanStep = {
        id: "reconcile_0",
        primitive: "reconcile",
        agent: reconciler,
        inputs: planSteps.map((s) => s.id),
    }
    return {
        id: "ensemble",
        name: "Ensemble",
        description: "Multiple agents plan in parallel, then reconcile into one plan",
        steps: [...planSteps, reconcileStep],
        terminalStepId: "reconcile_0",
    }
}

/** Cross-Review — 2 agents plan, each reviews the other's plan, then reconcile. */
export function crossReviewStrategy(agentA: AgentCouplet, agentB: AgentCouplet, reconciler: AgentCouplet): HyperPlanStrategy {
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

// ============================================================================
// Strategy Metadata (for UI)
// ============================================================================

export interface StrategyPreset {
    id: string
    name: string
    description: string
    /** Minimum number of distinct agents required */
    minAgents: number
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
    { id: "standard", name: "Standard", description: "Plan with a single agent", minAgents: 1 },
    { id: "ensemble", name: "Ensemble", description: "Multiple agents plan in parallel, then reconcile", minAgents: 2 },
    { id: "cross-review", name: "Cross-Review", description: "Two agents cross-review each other, then reconcile", minAgents: 2 },
]

/** Check if a strategy is a single-agent standard plan (no reconciliation needed) */
export function isStandardStrategy(strategy: HyperPlanStrategy): boolean {
    return strategy.id === "standard" && strategy.steps.length === 1
}

// ============================================================================
// Validation
// ============================================================================

/** Validate strategy DAG invariants. Returns error messages or empty array if valid. */
export function validateStrategy(strategy: HyperPlanStrategy): string[] {
    const errors: string[] = []
    const stepMap = new Map(strategy.steps.map((s) => [s.id, s]))

    // All step IDs unique
    if (stepMap.size !== strategy.steps.length) {
        errors.push("Duplicate step IDs")
    }

    // Terminal step exists and produces a plan
    const terminal = stepMap.get(strategy.terminalStepId)
    if (!terminal) {
        errors.push(`Terminal step "${strategy.terminalStepId}" not found`)
    } else if (terminal.primitive === "review") {
        errors.push("Terminal step must produce a plan (plan or reconcile), not a review")
    }

    for (const step of strategy.steps) {
        // Plan steps must have no inputs
        if (step.primitive === "plan" && step.inputs.length > 0) {
            errors.push(`Plan step "${step.id}" must have no inputs`)
        }
        // Review steps must have exactly 1 input
        if (step.primitive === "review" && step.inputs.length !== 1) {
            errors.push(`Review step "${step.id}" must have exactly 1 input`)
        }
        // Reconcile steps must have >= 1 input
        if (step.primitive === "reconcile" && step.inputs.length < 1) {
            errors.push(`Reconcile step "${step.id}" must have at least 1 input`)
        }
        // All inputs reference existing steps
        for (const inputId of step.inputs) {
            if (!stepMap.has(inputId)) {
                errors.push(`Step "${step.id}" references unknown input "${inputId}"`)
            }
        }
    }

    // DAG check (no cycles) — topological sort via DFS
    const visited = new Set<string>()
    const visiting = new Set<string>()
    function hasCycle(id: string): boolean {
        if (visiting.has(id)) return true
        if (visited.has(id)) return false
        visiting.add(id)
        const step = stepMap.get(id)
        if (step) {
            for (const inp of step.inputs) {
                if (hasCycle(inp)) return true
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

    // Exactly one terminal node (no other step depends on it)
    const depended = new Set(strategy.steps.flatMap((s) => s.inputs))
    const terminals = strategy.steps.filter((s) => !depended.has(s.id))
    if (terminals.length !== 1) {
        errors.push(`Expected 1 terminal step, found ${terminals.length}: [${terminals.map((t) => t.id).join(", ")}]`)
    } else if (terminals[0].id !== strategy.terminalStepId) {
        errors.push(`Terminal step "${strategy.terminalStepId}" has dependents, or orphan step "${terminals[0].id}" exists`)
    }

    return errors
}

// ============================================================================
// DAG Utilities
// ============================================================================

/**
 * Topological sort of strategy steps.
 * Returns steps in execution order (dependencies before dependents).
 */
export function topologicalSort(strategy: HyperPlanStrategy): HyperPlanStep[] {
    const stepMap = new Map(strategy.steps.map((s) => [s.id, s]))
    const visited = new Set<string>()
    const result: HyperPlanStep[] = []

    function visit(id: string): void {
        if (visited.has(id)) return
        visited.add(id)
        const step = stepMap.get(id)
        if (!step) return
        for (const inp of step.inputs) {
            visit(inp)
        }
        result.push(step)
    }

    for (const step of strategy.steps) {
        visit(step.id)
    }

    return result
}

/**
 * Group steps into layers by depth.
 * Steps in the same layer have no mutual dependencies and can run in parallel.
 */
export function groupByDepth(strategy: HyperPlanStrategy): HyperPlanStep[][] {
    const stepMap = new Map(strategy.steps.map((s) => [s.id, s]))
    const depthMap = new Map<string, number>()

    function getDepth(id: string): number {
        if (depthMap.has(id)) return depthMap.get(id)!
        const step = stepMap.get(id)
        if (!step || step.inputs.length === 0) {
            depthMap.set(id, 0)
            return 0
        }
        const maxInputDepth = Math.max(...step.inputs.map(getDepth))
        const depth = maxInputDepth + 1
        depthMap.set(id, depth)
        return depth
    }

    for (const step of strategy.steps) {
        getDepth(step.id)
    }

    // Group by depth
    const maxDepth = Math.max(...Array.from(depthMap.values()))
    const layers: HyperPlanStep[][] = []
    for (let d = 0; d <= maxDepth; d++) {
        const layer = strategy.steps.filter((s) => depthMap.get(s.id) === d)
        if (layer.length > 0) {
            layers.push(layer)
        }
    }

    return layers
}
