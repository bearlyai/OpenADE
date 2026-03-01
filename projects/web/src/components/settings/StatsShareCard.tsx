/**
 * StatsShareCard
 *
 * A social-media-optimised card rendered off-screen and captured as a PNG
 * when the user clicks "Copy Image". Uses the app's active theme tokens
 * so the card matches whatever vibe the user has chosen.
 *
 * Fixed at 600×380 — captured at 2× (1200×760) for retina / social sharing.
 */

import type { Ref } from "react"

export interface ShareStats {
    periodLabel: string
    totalCostUsd: number
    totalTokens: number
    inputTokens: number
    outputTokens: number
    taskCount: number
    eventCount: number
    costByModel: Record<string, number>
}

interface StatsShareCardProps {
    cardRef: Ref<HTMLDivElement>
    stats: ShareStats
}

function formatCost(cost: number): string {
    if (cost === 0) return "$0.00"
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

export function StatsShareCard({ cardRef, stats }: StatsShareCardProps) {
    const models = Object.entries(stats.costByModel).sort((a, b) => b[1] - a[1])
    const topModels = models.slice(0, 3)

    return (
        <div
            ref={cardRef}
            className="bg-base-100 text-base-content"
            style={{
                width: 600,
                height: 380,
                fontFamily: '"Clash Grotesk", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
                position: "relative",
                overflow: "hidden",
            }}
        >
            {/* Primary accent stripe at top */}
            <div className="bg-primary" style={{ height: 4, width: "100%" }} />

            {/* Background grid pattern for texture */}
            <div
                className="absolute inset-0 pointer-events-none opacity-[0.03]"
                style={{
                    backgroundImage:
                        "linear-gradient(var(--color-base-content) 1px, transparent 1px), linear-gradient(90deg, var(--color-base-content) 1px, transparent 1px)",
                    backgroundSize: "32px 32px",
                }}
            />

            <div className="relative flex flex-col justify-between" style={{ padding: "28px 32px 24px", height: 376 }}>
                {/* Header: branding */}
                <div className="flex items-start justify-between">
                    <div>
                        <div className="text-2xl font-bold text-base-content tracking-tight leading-none">OpenADE</div>
                        <div className="text-[11px] text-muted tracking-wide mt-1">The Agentic Dev Environment</div>
                    </div>
                    <div className="text-[11px] text-muted font-medium tracking-wide">openade.ai</div>
                </div>

                {/* Title + hero task count */}
                <div>
                    <div className="text-xs text-muted uppercase tracking-widest font-medium mb-2">{stats.periodLabel}</div>
                    <div className="flex items-baseline gap-3">
                        <span className="font-bold text-primary leading-none tracking-tight" style={{ fontSize: 64 }}>
                            {stats.taskCount.toLocaleString()}
                        </span>
                        <span className="text-base-content/60 text-lg font-semibold">{stats.taskCount === 1 ? "task" : "tasks"} completed</span>
                    </div>
                    <div className="text-xl font-bold text-base-content/80 mt-2 tracking-tight">{formatCost(stats.totalCostUsd)} spent</div>
                </div>

                {/* Bottom stats row */}
                <div className="flex items-end justify-between">
                    {/* Stat pills */}
                    <div className="flex gap-6">
                        <BottomStat label="Runs" value={stats.eventCount.toLocaleString()} />
                        <BottomStat label="Tokens" value={formatTokens(stats.totalTokens)} />
                        <BottomStat label="In" value={formatTokens(stats.inputTokens)} />
                        <BottomStat label="Out" value={formatTokens(stats.outputTokens)} />
                    </div>

                    {/* Top models */}
                    {topModels.length > 0 && (
                        <div className="flex flex-col items-end gap-0.5">
                            {topModels.map(([model, cost]) => (
                                <div key={model} className="text-[10px] text-muted">
                                    <span className="text-base-content font-medium">{model}</span> <span>{formatCost(cost)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function BottomStat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-base-content text-lg font-bold leading-none">{value}</div>
            <div className="text-muted text-[9px] uppercase tracking-wide font-medium mt-1">{label}</div>
        </div>
    )
}
