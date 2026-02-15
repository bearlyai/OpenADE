/**
 * HyperPlan Strategy Picker — Full modal for configuring and launching multi-agent planning.
 *
 * Features:
 * - Strategy preset cards with inline SVG flow diagrams
 * - Agent couplet selection grouped by harness
 * - Reconciler (star) designation
 * - "Run HyperPlan" primary action + "Normal Plan" secondary
 */

import cx from "classnames"
import { AlertTriangle, Check, FileText, Play, Star, X, Zap } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useState } from "react"
import { MODEL_REGISTRY } from "../../constants"
import type { HarnessId } from "../../electronAPI/harnessEventTypes"
import { type HarnessInstallStatus, type HarnessStatusMap, getHarnessStatuses } from "../../electronAPI/harnessStatus"
import { STRATEGY_PRESETS } from "../../hyperplan/strategies"
import type { AgentCouplet } from "../../hyperplan/types"
import { useCodeStore } from "../../store/context"
import { getHarnessDisplayName } from "../settings/harnessStatusUtils"

// ─── Flow Diagram SVGs ──────────────────────────────────────────────────────

function DiagramNode({ x, y, label, variant = "agent" }: { x: number; y: number; label: string; variant?: "agent" | "reconciler" | "output" }) {
    const fill = variant === "reconciler" ? "var(--color-warning)" : variant === "output" ? "var(--color-success)" : "var(--color-primary)"
    const textFill = variant === "reconciler" ? "var(--color-warning-content)" : variant === "output" ? "var(--color-success-content)" : "var(--color-primary-content)"
    const w = label.length * 6.5 + 18
    return (
        <g>
            <rect x={x - w / 2} y={y - 11} width={w} height={22} fill={fill} />
            <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="600" fontFamily="ui-monospace, monospace" fill={textFill}>
                {label}
            </text>
        </g>
    )
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
    return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-muted)" strokeWidth="1.5" markerEnd="url(#hp-arrow)" opacity={0.5} />
}

function ArrowDef() {
    return (
        <defs>
            <marker id="hp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-muted)" opacity={0.5} />
            </marker>
        </defs>
    )
}

function StandardDiagram() {
    return (
        <svg viewBox="0 0 200 44" className="w-full h-[36px]">
            <ArrowDef />
            <DiagramNode x={50} y={22} label="Agent" />
            <Arrow x1={82} y1={22} x2={120} y2={22} />
            <DiagramNode x={155} y={22} label="Plan" variant="output" />
        </svg>
    )
}

function EnsembleDiagram() {
    return (
        <svg viewBox="0 0 320 90" className="w-full h-[72px]">
            <ArrowDef />
            <DiagramNode x={50} y={16} label="Agent A" />
            <DiagramNode x={50} y={45} label="Agent B" />
            <DiagramNode x={50} y={74} label="Agent C" />
            <Arrow x1={90} y1={16} x2={155} y2={41} />
            <Arrow x1={90} y1={45} x2={155} y2={45} />
            <Arrow x1={90} y1={74} x2={155} y2={49} />
            <DiagramNode x={195} y={45} label="Reconcile" variant="reconciler" />
            <Arrow x1={235} y1={45} x2={262} y2={45} />
            <DiagramNode x={289} y={45} label="Plan" variant="output" />
        </svg>
    )
}

function CrossReviewDiagram() {
    return (
        <svg viewBox="0 0 410 86" className="w-full h-[68px]">
            <ArrowDef />
            <DiagramNode x={42} y={22} label="Agent A" />
            <DiagramNode x={42} y={64} label="Agent B" />
            <Arrow x1={82} y1={22} x2={132} y2={60} />
            <Arrow x1={82} y1={64} x2={132} y2={26} />
            <DiagramNode x={175} y={22} label="A reviews B" />
            <DiagramNode x={175} y={64} label="B reviews A" />
            <Arrow x1={220} y1={22} x2={270} y2={39} />
            <Arrow x1={220} y1={64} x2={270} y2={47} />
            <DiagramNode x={308} y={43} label="Reconcile" variant="reconciler" />
            <Arrow x1={348} y1={43} x2={366} y2={43} />
            <DiagramNode x={390} y={43} label="Plan" variant="output" />
        </svg>
    )
}

const STRATEGY_DIAGRAMS: Record<string, () => React.JSX.Element> = {
    standard: StandardDiagram,
    ensemble: EnsembleDiagram,
    "cross-review": CrossReviewDiagram,
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface StrategyPickerProps {
    onClose: () => void
    onRun: (strategyId: string) => void
}

// ─── Component ──────────────────────────────────────────────────────────────

export const StrategyPicker = observer(function StrategyPicker({ onClose, onRun }: StrategyPickerProps) {
    const store = useCodeStore()
    const settings = store.personalSettingsStore?.settings.get()

    // Local state
    const [selectedStrategyId, setSelectedStrategyId] = useState(settings?.hyperplanStrategyId ?? "ensemble")
    const [selectedAgents, setSelectedAgents] = useState<AgentCouplet[]>(() => {
        if (settings?.hyperplanAgents && settings.hyperplanAgents.length > 0) {
            return settings.hyperplanAgents.map((a) => ({ harnessId: a.harnessId as HarnessId, modelId: a.modelId }))
        }
        // Default: one default model per harness
        const defaults: AgentCouplet[] = []
        for (const [harnessId, config] of Object.entries(MODEL_REGISTRY)) {
            defaults.push({ harnessId: harnessId as HarnessId, modelId: config.defaultModel })
        }
        return defaults.length > 0 ? defaults : [{ harnessId: store.defaultHarnessId, modelId: store.defaultModel }]
    })
    const [reconcilerIndex, setReconcilerIndex] = useState(() => {
        if (!settings?.hyperplanReconciler) return 0
        const idx = selectedAgents.findIndex(
            (a) => a.harnessId === settings.hyperplanReconciler!.harnessId && a.modelId === settings.hyperplanReconciler!.modelId,
        )
        return idx >= 0 ? idx : 0
    })

    // Harness install status
    const [harnessStatuses, setHarnessStatuses] = useState<HarnessStatusMap>({})
    const [statusLoading, setStatusLoading] = useState(true)

    useEffect(() => {
        getHarnessStatuses().then(({ statuses }) => {
            setHarnessStatuses(statuses)
            setStatusLoading(false)
        })
    }, [])

    // Build couplet list
    const allCouplets: Array<AgentCouplet & { label: string; harnessLabel: string; available: boolean }> = []
    for (const [harnessId, config] of Object.entries(MODEL_REGISTRY)) {
        const status = harnessStatuses[harnessId] as HarnessInstallStatus | undefined
        const isAvailable = !!status?.installed && !!status?.authenticated
        const harnessLabel = getHarnessDisplayName(harnessId)
        for (const model of config.models) {
            allCouplets.push({
                harnessId: harnessId as HarnessId,
                modelId: model.id,
                label: `${harnessLabel} \u00b7 ${model.label}`,
                harnessLabel,
                available: statusLoading || isAvailable,
            })
        }
    }

    // Group couplets by harness for display
    const coupletsByHarness = new Map<string, typeof allCouplets>()
    for (const c of allCouplets) {
        const list = coupletsByHarness.get(c.harnessLabel) ?? []
        list.push(c)
        coupletsByHarness.set(c.harnessLabel, list)
    }

    const selectedPreset = STRATEGY_PRESETS.find((p) => p.id === selectedStrategyId)
    const needsMultipleAgents = (selectedPreset?.minAgents ?? 1) >= 2
    const hasEnoughAgents = selectedAgents.length >= (selectedPreset?.minAgents ?? 1)
    const availableHarnessCount = Object.values(harnessStatuses).filter((s) => s.installed && s.authenticated).length
    const canRun = selectedStrategyId === "standard" || hasEnoughAgents

    const isAgentSelected = useCallback(
        (couplet: AgentCouplet) => selectedAgents.some((a) => a.harnessId === couplet.harnessId && a.modelId === couplet.modelId),
        [selectedAgents],
    )

    const toggleAgent = useCallback(
        (couplet: AgentCouplet) => {
            if (isAgentSelected(couplet)) {
                if (selectedAgents.length <= 1) return
                const newAgents = selectedAgents.filter((a) => !(a.harnessId === couplet.harnessId && a.modelId === couplet.modelId))
                setSelectedAgents(newAgents)
                if (reconcilerIndex >= newAgents.length) setReconcilerIndex(0)
            } else {
                setSelectedAgents([...selectedAgents, couplet])
            }
        },
        [selectedAgents, reconcilerIndex, isAgentSelected],
    )

    const handleRun = useCallback(
        (strategyId: string) => {
            const reconciler = selectedAgents[reconcilerIndex] ?? selectedAgents[0]
            store.setHyperPlanPreferences(strategyId, selectedAgents, reconciler)
            onRun(strategyId)
        },
        [store, selectedAgents, reconcilerIndex, onRun],
    )

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/50"
            style={{ backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", paddingTop: "max(min(80px, 12%), 1rem)" }}
            onClick={onClose}
        >
            <div
                className="bg-base-100 border border-border shadow-2xl w-full max-w-[640px] flex flex-col"
                style={{ maxHeight: "calc(100% - max(min(80px, 12%), 1rem) - 1rem)" }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
                    <div className="flex items-center gap-2.5">
                        <Zap size={16} className="text-primary" />
                        <h2 className="text-base font-semibold text-base-content">HyperPlan</h2>
                    </div>
                    <button type="button" className="btn w-7 h-7 flex items-center justify-center text-muted hover:text-base-content hover:bg-base-200 transition-colors" onClick={onClose}>
                        <X size={15} />
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {/* Strategy cards */}
                    <div className="px-5 pt-4 pb-2">
                        <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Strategy</div>
                        <div className="space-y-2">
                            {STRATEGY_PRESETS.map((preset) => {
                                const isSelected = selectedStrategyId === preset.id
                                const Diagram = STRATEGY_DIAGRAMS[preset.id]
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() => setSelectedStrategyId(preset.id)}
                                        className={cx(
                                            "btn w-full text-left border transition-colors cursor-pointer",
                                            isSelected ? "border-primary bg-primary/5" : "border-border hover:border-base-300 hover:bg-base-200/50",
                                        )}
                                    >
                                        <div className="px-4 py-3">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className={cx("text-sm font-semibold", isSelected ? "text-primary" : "text-base-content")}>
                                                    {preset.name}
                                                </span>
                                                {preset.minAgents >= 2 && (
                                                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-base-200 text-muted">
                                                        {preset.minAgents}+ agents
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted mb-2">{preset.description}</p>
                                            {Diagram && (
                                                <div className="bg-base-200/60 border border-border/50 px-3 py-2">
                                                    <Diagram />
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Agent selection — only for multi-agent strategies */}
                    {needsMultipleAgents && (
                        <div className="px-5 pt-3 pb-4">
                            <div className="border-t border-border pt-4">
                                <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Agents</div>

                                {!statusLoading && availableHarnessCount < 2 && (
                                    <div className="flex items-start gap-2.5 p-3 mb-3 bg-warning/10 border border-warning/20 text-xs text-warning">
                                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                        <span>
                                            Multi-agent strategies work best with 2+ configured harnesses.
                                            Install and authenticate additional coding agents in Settings.
                                        </span>
                                    </div>
                                )}

                                <div className="space-y-3">
                                    {Array.from(coupletsByHarness.entries()).map(([harnessLabel, couplets]) => (
                                        <div key={harnessLabel}>
                                            <div className="text-[11px] font-semibold text-muted mb-1.5 flex items-center gap-1.5">
                                                {harnessLabel}
                                                {!couplets[0].available && !statusLoading && (
                                                    <span className="text-error font-normal">— not available</span>
                                                )}
                                            </div>
                                            <div className="space-y-0.5">
                                                {couplets.map((couplet) => {
                                                    const selected = isAgentSelected(couplet)
                                                    const isReconciler =
                                                        selected &&
                                                        selectedAgents[reconcilerIndex]?.harnessId === couplet.harnessId &&
                                                        selectedAgents[reconcilerIndex]?.modelId === couplet.modelId

                                                    return (
                                                        <div
                                                            key={`${couplet.harnessId}-${couplet.modelId}`}
                                                            className={cx(
                                                                "flex items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                                                                !couplet.available && "opacity-35",
                                                                selected ? "bg-base-200" : "hover:bg-base-200/40",
                                                            )}
                                                        >
                                                            <button
                                                                type="button"
                                                                className={cx(
                                                                    "btn w-4 h-4 border flex items-center justify-center shrink-0 transition-colors",
                                                                    selected ? "bg-primary border-primary text-primary-content" : "border-border hover:border-muted",
                                                                )}
                                                                onClick={() => couplet.available && toggleAgent(couplet)}
                                                                disabled={!couplet.available}
                                                            >
                                                                {selected && <Check size={10} strokeWidth={3} />}
                                                            </button>

                                                            <span className="flex-1 truncate font-mono text-xs">{couplet.label}</span>

                                                            {selected && (
                                                                <button
                                                                    type="button"
                                                                    className={cx(
                                                                        "btn p-1 transition-colors shrink-0",
                                                                        isReconciler ? "text-warning" : "text-muted hover:text-warning",
                                                                    )}
                                                                    onClick={() => {
                                                                        const idx = selectedAgents.findIndex(
                                                                            (a) => a.harnessId === couplet.harnessId && a.modelId === couplet.modelId,
                                                                        )
                                                                        if (idx >= 0) setReconcilerIndex(idx)
                                                                    }}
                                                                    title={isReconciler ? "Reconciler (produces final plan)" : "Set as reconciler"}
                                                                >
                                                                    <Star size={13} className={isReconciler ? "fill-current" : ""} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="flex items-center gap-1.5 mt-3 text-xs text-muted">
                                    <Star size={10} className="fill-warning text-warning" />
                                    <span>designates the reconciler — it produces the final merged plan</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border flex-shrink-0 bg-base-200/40">
                    <button
                        type="button"
                        className="btn flex items-center gap-2 px-3.5 h-9 text-sm text-muted hover:text-base-content hover:bg-base-200 transition-colors cursor-pointer"
                        onClick={() => handleRun("standard")}
                    >
                        <FileText size={14} />
                        Normal Plan
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="btn px-3.5 h-9 text-sm text-muted hover:text-base-content hover:bg-base-200 transition-colors cursor-pointer"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className={cx(
                                "btn flex items-center gap-2 px-4 h-9 text-sm font-semibold transition-all",
                                canRun
                                    ? "bg-primary text-primary-content hover:bg-primary/80 cursor-pointer active:scale-95"
                                    : "bg-primary/30 text-primary-content/40 cursor-not-allowed",
                            )}
                            onClick={() => handleRun(selectedStrategyId)}
                            disabled={!canRun}
                        >
                            <Play size={13} className="fill-current" />
                            {selectedStrategyId === "standard" ? "Plan" : "HyperPlan"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
})
