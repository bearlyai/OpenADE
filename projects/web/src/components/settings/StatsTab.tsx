import cx from "classnames"
import { Check, Copy, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { normalizeModelClass } from "../../constants"
import type { RepoItem, TaskPreviewUsage } from "../../persistence/repoStore"
import type { CodeStore } from "../../store/store"
import { StatsShareCard } from "./StatsShareCard"
import { copyCardToClipboard } from "./statsShare"

/** The earliest real month in the project — legacy "Unknown" dates get folded into this. */
const FALLBACK_SORT_KEY = "2026-01"
const FALLBACK_LABEL = "Jan 2026"

interface MonthStats {
    label: string
    sortKey: string
    taskCount: number
    inputTokens: number
    outputTokens: number
    totalCostUsd: number
    eventCount: number
    costByModel: Record<string, number>
}

function formatMonthLabel(dateStr: string): { label: string; sortKey: string } {
    const date = new Date(dateStr)
    if (Number.isNaN(date.getTime())) return { label: FALLBACK_LABEL, sortKey: FALLBACK_SORT_KEY }
    const year = date.getFullYear()
    const month = date.getMonth()
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return {
        label: `${monthNames[month]} ${year}`,
        sortKey: `${year}-${String(month + 1).padStart(2, "0")}`,
    }
}

const FULL_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** Expand "Feb 2026" → "February 2026 Stats" for the share card title. */
function expandPeriodLabel(label: string): string {
    const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    for (let i = 0; i < SHORT_MONTHS.length; i++) {
        if (label.startsWith(SHORT_MONTHS[i])) {
            return `${FULL_MONTH_NAMES[i]}${label.slice(SHORT_MONTHS[i].length)} Stats`
        }
    }
    return `${label} Stats`
}

function getStartOfToday(): Date {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
}

function getStartOfWeek(): Date {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - d.getDay()) // getDay() 0=Sunday
    return d
}

function formatCost(cost: number): string {
    if (cost === 0) return "$0.00"
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(2)}`
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

export const StatsTab = observer(({ store }: { store: CodeStore }) => {
    const cardRef = useRef<HTMLDivElement>(null)
    const [backfillProgress, setBackfillProgress] = useState<{ loaded: number; total: number } | null>(null)
    const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle")
    const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)

    // Backfill task stores missing usage data
    useEffect(() => {
        if (!store.repoStore) return

        const tasksToBackfill: Array<{ repoId: string; taskId: string }> = []
        for (const repo of store.repoStore.repos.all()) {
            for (const task of repo.tasks) {
                if (!task.usage) {
                    tasksToBackfill.push({ repoId: repo.id, taskId: task.id })
                }
            }
        }

        if (tasksToBackfill.length === 0) return

        let cancelled = false
        setBackfillProgress({ loaded: 0, total: tasksToBackfill.length })

        const run = async () => {
            for (let i = 0; i < tasksToBackfill.length; i++) {
                if (cancelled) break
                const { repoId, taskId } = tasksToBackfill[i]
                try {
                    await store.getTaskStore(repoId, taskId)
                } catch (err) {
                    console.warn("[StatsTab] Failed to load task for backfill:", taskId, err)
                }
                if (!cancelled) setBackfillProgress({ loaded: i + 1, total: tasksToBackfill.length })
            }
            if (!cancelled) setBackfillProgress(null)
        }

        run()
        return () => {
            cancelled = true
        }
    }, [store, store.repoStore])

    const handleCopy = useCallback(async () => {
        if (!cardRef.current || copyState === "copying") return
        setCopyState("copying")
        try {
            await copyCardToClipboard(cardRef.current)
            setCopyState("copied")
            setTimeout(() => setCopyState("idle"), 1500)
        } catch (err) {
            console.error("[StatsTab] Failed to copy card:", err)
            setCopyState("error")
            setTimeout(() => setCopyState("idle"), 2000)
        }
    }, [copyState])

    // Aggregate stats across all workspaces
    const repos: RepoItem[] = store.repoStore?.repos.all() ?? []
    const monthsMap = new Map<string, MonthStats>()
    let totalTasks = 0
    let totalIn = 0
    let totalOut = 0
    let totalCost = 0
    let totalEvents = 0
    const totalByModel: Record<string, number> = {}

    const todayStart = getStartOfToday()
    const todayEnd = new Date(todayStart)
    todayEnd.setDate(todayEnd.getDate() + 1)

    const weekStart = getStartOfWeek()
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const todayStats: MonthStats = { label: "Today", sortKey: "today", taskCount: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, eventCount: 0, costByModel: {} }
    const weekStats: MonthStats = { label: "This Week", sortKey: "this-week", taskCount: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, eventCount: 0, costByModel: {} }

    for (const repo of repos) {
        for (const task of repo.tasks) {
            totalTasks++
            const u: TaskPreviewUsage = task.usage ?? { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, eventCount: 0, costByModel: {} }
            totalIn += u.inputTokens
            totalOut += u.outputTokens
            totalCost += u.totalCostUsd
            totalEvents += u.eventCount
            for (const [m, c] of Object.entries(u.costByModel)) {
                const cls = normalizeModelClass(m)
                totalByModel[cls] = (totalByModel[cls] ?? 0) + c
            }

            const { label, sortKey } = formatMonthLabel(task.createdAt)
            let month = monthsMap.get(sortKey)
            if (!month) {
                month = { label, sortKey, taskCount: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, eventCount: 0, costByModel: {} }
                monthsMap.set(sortKey, month)
            }
            month.taskCount++
            month.inputTokens += u.inputTokens
            month.outputTokens += u.outputTokens
            month.totalCostUsd += u.totalCostUsd
            month.eventCount += u.eventCount
            for (const [m, c] of Object.entries(u.costByModel)) {
                const cls = normalizeModelClass(m)
                month.costByModel[cls] = (month.costByModel[cls] ?? 0) + c
            }

            const createdAt = new Date(task.createdAt)
            if (!Number.isNaN(createdAt.getTime())) {
                const buckets: MonthStats[] = []
                if (createdAt >= todayStart && createdAt < todayEnd) buckets.push(todayStats)
                if (createdAt >= weekStart && createdAt < weekEnd) buckets.push(weekStats)
                for (const bucket of buckets) {
                    bucket.taskCount++
                    bucket.inputTokens += u.inputTokens
                    bucket.outputTokens += u.outputTokens
                    bucket.totalCostUsd += u.totalCostUsd
                    bucket.eventCount += u.eventCount
                    for (const [m, c] of Object.entries(u.costByModel)) {
                        const cls = normalizeModelClass(m)
                        bucket.costByModel[cls] = (bucket.costByModel[cls] ?? 0) + c
                    }
                }
            }
        }
    }

    const months = [...monthsMap.values()].sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    const effectiveSelected =
        selectedPeriod === "today"
            ? "today"
            : selectedPeriod === "this-week"
              ? "this-week"
              : selectedPeriod && monthsMap.has(selectedPeriod)
                ? selectedPeriod
                : null

    // Stats for the featured section
    const featured =
        effectiveSelected === "today"
            ? todayStats
            : effectiveSelected === "this-week"
              ? weekStats
              : effectiveSelected
                ? monthsMap.get(effectiveSelected)!
                : {
                      label: "All Time",
                      sortKey: "",
                      taskCount: totalTasks,
                      inputTokens: totalIn,
                      outputTokens: totalOut,
                      totalCostUsd: totalCost,
                      eventCount: totalEvents,
                      costByModel: totalByModel,
                  }

    const featuredTokens = featured.inputTokens + featured.outputTokens

    return (
        <div className="flex flex-col gap-4">
            {/* Backfill indicator */}
            {backfillProgress && (
                <div className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 size={12} className="animate-spin" />
                    <span>
                        Loading {backfillProgress.loaded}/{backfillProgress.total} tasks...
                    </span>
                </div>
            )}

            {totalTasks > 0 && (
                <>
                    {/* Hidden share card — rendered off-screen for image capture */}
                    <div style={{ position: "fixed", top: -9999, left: -9999, pointerEvents: "none" }} aria-hidden>
                        <StatsShareCard
                            cardRef={cardRef}
                            stats={{
                                periodLabel: effectiveSelected ? expandPeriodLabel(featured.label) : "All Time Stats",
                                totalCostUsd: featured.totalCostUsd,
                                totalTokens: featuredTokens,
                                inputTokens: featured.inputTokens,
                                outputTokens: featured.outputTokens,
                                taskCount: featured.taskCount,
                                eventCount: featured.eventCount,
                                costByModel: featured.costByModel,
                            }}
                        />
                    </div>

                    {/* Month selector + copy button */}
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-wrap gap-1.5">
                            <button
                                type="button"
                                className={cx(
                                    "btn px-2.5 py-1 text-xs font-medium transition-colors border",
                                    !effectiveSelected
                                        ? "bg-primary text-primary-content border-primary"
                                        : "bg-base-200 text-muted hover:text-base-content border-border"
                                )}
                                onClick={() => setSelectedPeriod(null)}
                            >
                                All
                            </button>
                            {(["today", "this-week"] as const).map((key) => {
                                const label = key === "today" ? "Today" : "This Week"
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={cx(
                                            "btn px-2.5 py-1 text-xs font-medium transition-colors border",
                                            effectiveSelected === key
                                                ? "bg-primary text-primary-content border-primary"
                                                : "bg-base-200 text-muted hover:text-base-content border-border"
                                        )}
                                        onClick={() => setSelectedPeriod(key)}
                                    >
                                        {label}
                                    </button>
                                )
                            })}
                            {months.map((m) => (
                                <button
                                    key={m.sortKey}
                                    type="button"
                                    className={cx(
                                        "btn px-2.5 py-1 text-xs font-medium transition-colors border",
                                        effectiveSelected === m.sortKey
                                            ? "bg-primary text-primary-content border-primary"
                                            : "bg-base-200 text-muted hover:text-base-content border-border"
                                    )}
                                    onClick={() => setSelectedPeriod(m.sortKey)}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            className={cx(
                                "btn flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors border shrink-0",
                                copyState === "copied"
                                    ? "bg-success text-success-content border-success"
                                    : "bg-base-200 text-muted hover:text-base-content border-border"
                            )}
                            onClick={handleCopy}
                            disabled={copyState === "copying"}
                        >
                            {copyState === "copied" ? (
                                <>
                                    <Check size={12} />
                                    <span>Copied!</span>
                                </>
                            ) : copyState === "error" ? (
                                <span>Failed</span>
                            ) : (
                                <>
                                    <Copy size={12} />
                                    <span>Copy Image</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* Featured stats card */}
                    <div className="bg-base-200 border border-border p-4 flex flex-col gap-3">
                        <div className="text-[10px] text-muted uppercase tracking-widest font-medium">{effectiveSelected ? featured.label : "All Time"}</div>

                        {/* Big cost + tokens */}
                        <div className="flex items-baseline gap-3">
                            <span className="text-3xl font-bold text-primary leading-none tracking-tight">{formatCost(featured.totalCostUsd)}</span>
                            <span className="text-base-content/50 text-sm font-medium">{formatTokens(featuredTokens)} tokens</span>
                        </div>

                        {/* Stat grid */}
                        <div className="grid grid-cols-4 gap-px bg-border">
                            <MiniStat label="Tasks" value={featured.taskCount.toLocaleString()} />
                            <MiniStat label="Runs" value={featured.eventCount.toLocaleString()} />
                            <MiniStat label="Input" value={formatTokens(featured.inputTokens)} />
                            <MiniStat label="Output" value={formatTokens(featured.outputTokens)} />
                        </div>

                        {/* Model breakdown — inside the card */}
                        {Object.keys(featured.costByModel).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                                {Object.entries(featured.costByModel)
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([model, cost]) => (
                                        <div key={model} className="bg-base-100 border border-border px-2 py-0.5 flex items-center gap-1.5 text-xs">
                                            <span className="text-base-content font-semibold">{model}</span>
                                            <span className="text-muted">{formatCost(cost)}</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>

                    {/* Monthly table */}
                    {months.length > 0 && (
                        <div>
                            <div className="text-[10px] font-medium text-muted uppercase tracking-widest mb-2">Monthly</div>
                            <div className="border border-border">
                                {/* Header */}
                                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-3 py-1.5 bg-base-200 border-b border-border text-[10px] text-muted uppercase tracking-wide font-medium">
                                    <span>Month</span>
                                    <span className="text-right w-10">Tasks</span>
                                    <span className="text-right w-10">Runs</span>
                                    <span className="text-right w-14">Tokens</span>
                                    <span className="text-right w-14">Cost</span>
                                </div>
                                {months.map((m) => {
                                    const tokens = m.inputTokens + m.outputTokens
                                    const isActive = effectiveSelected === m.sortKey
                                    return (
                                        <button
                                            key={m.sortKey}
                                            type="button"
                                            className={cx(
                                                "btn grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 w-full px-3 py-1.5 text-xs transition-colors border-b border-border/40 last:border-b-0",
                                                isActive ? "bg-primary/8" : "hover:bg-base-200/60"
                                            )}
                                            onClick={() => setSelectedPeriod(m.sortKey)}
                                        >
                                            <span className={cx("font-semibold text-left", isActive ? "text-primary" : "text-base-content")}>{m.label}</span>
                                            <span className="text-right text-muted w-10">{m.taskCount}</span>
                                            <span className="text-right text-muted w-10">{m.eventCount}</span>
                                            <span className="text-right text-muted w-14">{formatTokens(tokens)}</span>
                                            <span className={cx("text-right font-semibold w-14", isActive ? "text-primary" : "text-base-content")}>
                                                {formatCost(m.totalCostUsd)}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Empty state */}
            {totalTasks === 0 && !backfillProgress && (
                <div className="flex flex-col items-center justify-center py-8 text-muted">
                    <div className="text-sm font-medium mb-1">No usage data</div>
                    <div className="text-xs">Run some tasks to see stats here.</div>
                </div>
            )}
        </div>
    )
})

function MiniStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-base-100 px-3 py-2">
            <div className="text-muted text-[9px] uppercase tracking-wide font-medium">{label}</div>
            <div className="text-base-content text-sm font-bold leading-tight mt-0.5">{value}</div>
        </div>
    )
}
