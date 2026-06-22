import type { OpenADEIsolationStrategy } from "../../../../openade-module/src"

export const HEAD_ISOLATION_STRATEGY: OpenADEIsolationStrategy = { type: "head" }

export function isolationStrategyForBranchCapability(
    strategy: OpenADEIsolationStrategy,
    canReadBranches: boolean
): OpenADEIsolationStrategy {
    if (!canReadBranches) return HEAD_ISOLATION_STRATEGY
    if (strategy.type !== "worktree") return HEAD_ISOLATION_STRATEGY

    const sourceBranch = strategy.sourceBranch.trim()
    return sourceBranch ? { type: "worktree", sourceBranch } : HEAD_ISOLATION_STRATEGY
}
