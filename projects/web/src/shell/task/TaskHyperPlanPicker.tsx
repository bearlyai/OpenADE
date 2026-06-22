import { Zap } from "lucide-react"
import type { OpenADEHyperPlanStrategy } from "../../../../openade-module/src"
import { MODEL_REGISTRY, getDefaultModelForHarness } from "../../constants"
import type { HarnessId } from "../../electronAPI/harnessEventTypes"
import { crossReviewStrategy, ensembleStrategy, peerReviewStrategy } from "../../hyperplan/strategies"
import type { AgentCouplet } from "../../hyperplan/types"

export type TaskHyperPlanPresetId = "peer-review" | "ensemble" | "cross-review"

const TASK_HYPERPLAN_PRESETS: Array<{ id: TaskHyperPlanPresetId; label: string; description: string }> = [
    { id: "ensemble", label: "Ensemble", description: "Parallel plans, then reconcile" },
    { id: "peer-review", label: "Peer Review", description: "Planner plus independent reviewer" },
    { id: "cross-review", label: "Cross Review", description: "Two plans, cross-review, reconcile" },
]

function appendUniqueAgent(agents: AgentCouplet[], agent: AgentCouplet): void {
    if (agents.some((candidate) => candidate.harnessId === agent.harnessId && candidate.modelId === agent.modelId)) return
    agents.push(agent)
}

function defaultAgentCouplets(primaryAgent?: AgentCouplet): AgentCouplet[] {
    const agents: AgentCouplet[] = []
    if (primaryAgent) appendUniqueAgent(agents, primaryAgent)

    for (const harnessId of Object.keys(MODEL_REGISTRY) as HarnessId[]) {
        appendUniqueAgent(agents, {
            harnessId,
            modelId: getDefaultModelForHarness(harnessId),
        })
    }

    for (const harnessId of Object.keys(MODEL_REGISTRY) as HarnessId[]) {
        for (const model of MODEL_REGISTRY[harnessId].models) {
            appendUniqueAgent(agents, { harnessId, modelId: model.id })
            if (agents.length >= 2) return agents
        }
    }

    return agents
}

export function buildTaskHyperPlanStrategy(presetId: TaskHyperPlanPresetId, primaryAgent?: AgentCouplet): OpenADEHyperPlanStrategy | null {
    const agents = defaultAgentCouplets(primaryAgent)
    if (agents.length < 2) return null

    if (presetId === "peer-review") return peerReviewStrategy(agents[0], agents[1])
    if (presetId === "cross-review") return crossReviewStrategy(agents[0], agents[1], agents[0])
    return ensembleStrategy(agents, agents[0])
}

export function TaskHyperPlanPicker({
    value,
    primaryAgent,
    disabled = false,
    onChange,
}: {
    value: TaskHyperPlanPresetId
    primaryAgent?: AgentCouplet
    disabled?: boolean
    onChange?: (value: TaskHyperPlanPresetId) => void
}) {
    const canBuildStrategy = buildTaskHyperPlanStrategy(value, primaryAgent) !== null
    const controlsDisabled = disabled || !onChange

    return (
        <div className="border border-border bg-base-200/30 p-2">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
                <Zap size={13} />
                <span>HyperPlan Strategy</span>
            </div>
            <div className="flex max-w-full gap-1 overflow-x-auto overscroll-x-contain">
                {TASK_HYPERPLAN_PRESETS.map((preset) => (
                    <button
                        key={preset.id}
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() => onChange?.(preset.id)}
                        title={preset.description}
                        className={`btn shrink-0 border border-border px-2 py-1 text-xs ${
                            value === preset.id ? "bg-primary text-primary-content" : "bg-base-100 text-base-content"
                        }`}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
            {!canBuildStrategy && <div className="mt-2 text-xs text-warning">HyperPlan needs two available agent models.</div>}
        </div>
    )
}
