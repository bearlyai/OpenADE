/**
 * HyperPlan Types
 *
 * Type definitions for the multi-agent parallel planning system.
 * HyperPlan runs multiple harness+model agents in parallel, then
 * reconciles their plans into a single final plan.
 */

import type { HarnessId, HarnessStreamEvent } from "../electronAPI/harnessEventTypes"

// ============================================================================
// Agent Couplet — a specific harness+model combination
// ============================================================================

/** A specific harness+model pair, e.g. { harnessId: "claude-code", modelId: "opus" } */
export interface AgentCouplet {
    harnessId: HarnessId
    /** Model alias from MODEL_REGISTRY, e.g. "opus", "gpt-5.3-codex" */
    modelId: string
}

// ============================================================================
// Strategy Primitives
// ============================================================================

export type StepPrimitive = "plan" | "review" | "reconcile"

export interface HyperPlanStep {
    id: string
    primitive: StepPrimitive
    agent: AgentCouplet
    /** Step IDs this step depends on. Empty for "plan" steps (roots). */
    inputs: string[]
}

export interface HyperPlanStrategy {
    id: string
    name: string
    description: string
    steps: HyperPlanStep[]
    /** Must point to a plan or reconcile step (never review). */
    terminalStepId: string
}

// ============================================================================
// Runtime State — tracks execution of a strategy
// ============================================================================

export type SubPlanStatus = "pending" | "running" | "completed" | "error"

export interface SubPlanState {
    stepId: string
    agent: AgentCouplet
    executionId: string
    status: SubPlanStatus
    /** Extracted final plan/review text when completed */
    resultText?: string
    error?: string
}

export type HyperPlanPhase = "planning" | "reconciling" | "completed" | "error"

// ============================================================================
// Persisted Sub-Execution (stored on ActionEvent)
// ============================================================================

/** A single sub-execution within a HyperPlan event, stored in YJS. */
export interface HyperPlanSubExecution {
    stepId: string
    primitive: StepPrimitive
    harnessId: HarnessId
    modelId: string
    executionId: string
    status: "in_progress" | "completed" | "error"
    events: HarnessStreamEvent[]
    /** Extracted plan/review text. Set on completion. */
    resultText?: string
    error?: string
}
