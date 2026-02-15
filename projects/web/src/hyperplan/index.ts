/**
 * HyperPlan — Multi-agent parallel planning system
 *
 * Entry point that re-exports the public API.
 */

export type { AgentCouplet, HyperPlanStep, HyperPlanStrategy, HyperPlanSubExecution, StepPrimitive, SubPlanState, HyperPlanPhase } from "./types"
export { standardStrategy, ensembleStrategy, crossReviewStrategy, isStandardStrategy, validateStrategy, STRATEGY_PRESETS } from "./strategies"
export type { StrategyPreset } from "./strategies"
export { HyperPlanExecutor } from "./HyperPlanExecutor"
export type { HyperPlanCallbacks, HyperPlanExecutorConfig } from "./HyperPlanExecutor"
export { extractPlanText } from "./extractPlanText"
