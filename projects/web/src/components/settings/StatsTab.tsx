import cx from "classnames"
import { Check, Copy, Loader2, RefreshCw } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useMemo, useRef, useState } from "react"
import type { OpenADETaskPreviewUsage } from "../../../../openade-module/src"
import { normalizeModelClass } from "../../constants"
import { formatDuration, needsTaskUsageBackfill } from "../../persistence/taskStatsUtils"
import type { CodeStore } from "../../store/store"
import { StatsShareCard } from "./StatsShareCard"
import { type RelativePeriodKey, getRelativePeriodRanges } from "./statsPeriodUtils"
import { type StatsRecapPeriod, type StatsRecapRepoInput, type StatsRecapTone, buildStatsRecap, buildStatsRecapText } from "./statsRecapUtils"
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
    durationMs: number
    costByModel: Record<string, number>
}

function createEmptyStats(label: string, sortKey: string): MonthStats {
    return {
        label,
        sortKey,
        taskCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCostUsd: 0,
        eventCount: 0,
        durationMs: 0,
        costByModel: {},
    }
}

function addUsage(stats: MonthStats, usage: OpenADETaskPreviewUsage): void {
    stats.taskCount++
    stats.inputTokens += usage.inputTokens
    stats.outputTokens += usage.outputTokens
    stats.totalCostUsd += usage.totalCostUsd
    stats.eventCount += usage.eventCount
    stats.durationMs += usage.durationMs ?? 0
    for (const [model, cost] of Object.entries(usage.costByModel)) {
        const cls = normalizeModelClass(model)
        stats.costByModel[cls] = (stats.costByModel[cls] ?? 0) + cost
    }
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

const BACKFILL_BATCH_SIZE = 10
const MAX_VISIBLE_RECAP_TASKS = 12

function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
            setTimeout(resolve, 0)
            return
        }

        window.requestAnimationFrame(() => resolve())
    })
}

function getMonthRange(sortKey: string): { start: Date; end: Date } | null {
    const [yearStr, monthStr] = sortKey.split("-")
    const year = Number(yearStr)
    const month = Number(monthStr)
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null
    return {
        start: new Date(year, month - 1, 1),
        end: new Date(year, month, 1),
    }
}

function getRecapPeriod(
    effectiveSelected: string | null,
    relativePeriods: ReturnType<typeof getRelativePeriodRanges>,
    monthsMap: Map<string, MonthStats>
): StatsRecapPeriod {
    if (effectiveSelected === null) return { label: "All Time" }

    const relative = relativePeriods.find((period) => period.key === effectiveSelected)
    if (relative) {
        return {
            label: relative.label,
            start: relative.start,
            end: relative.end,
        }
    }

    const month = monthsMap.get(effectiveSelected)
    const range = month ? getMonthRange(month.sortKey) : null
    return {
        label: month?.label ?? "All Time",
        start: range?.start,
        end: range?.end,
    }
}

function formatActivityTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    })
}

function statusBadgeClass(tone: StatsRecapTone): string {
    switch (tone) {
        case "success":
            return "bg-success/10 text-success border-success/20"
        case "warning":
            return "bg-warning/10 text-warning border-warning/20"
        case "error":
            return "bg-error/10 text-error border-error/20"
        case "muted":
            return "bg-base-200 text-muted border-border"
    }
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

export const StatsTab = observer(({ store }: { store: CodeStore }) => {
    const cardRef = useRef<HTMLDivElement>(null)
    const [backfillProgress, setBackfillProgress] = useState<{ loaded: number; total: number } | null>(null)
    const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle")
    const [copyRecapState, setCopyRecapState] = useState<"idle" | "copying" | "copied" | "error">("idle")
    const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
    const repos = store.getTaskPreviewReposForStats()
    const tasksNeedingBackfill = useMemo(() => {
        const tasksToBackfill: Array<{ repoId: string; taskId: string }> = []
        for (const repo of repos) {
            for (const task of repo.tasks) {
                if (needsTaskUsageBackfill(task.usage)) {
                    tasksToBackfill.push({ repoId: repo.id, taskId: task.id })
                }
            }
        }
        return tasksToBackfill
    }, [repos])

    const handleBackfillUsage = useCallback(async () => {
        if (backfillProgress || tasksNeedingBackfill.length === 0) return

        const tasksToBackfill = [...tasksNeedingBackfill]
        setBackfillProgress({ loaded: 0, total: tasksToBackfill.length })

        try {
            if (store.shouldUseRuntimeProductReads() && store.usesCleanManagedCoreRuntime()) {
                await store.backfillTaskUsagePreviews(tasksToBackfill)
                setBackfillProgress({ loaded: tasksToBackfill.length, total: tasksToBackfill.length })
                return
            }

            for (let i = 0; i < tasksToBackfill.length; i++) {
                const { repoId, taskId } = tasksToBackfill[i]
                try {
                    await store.backfillTaskUsagePreview(repoId, taskId)
                } catch (err) {
                    console.warn("[StatsTab] Failed to load task for backfill:", taskId, err)
                }
                setBackfillProgress({ loaded: i + 1, total: tasksToBackfill.length })
                if ((i + 1) % BACKFILL_BATCH_SIZE === 0 && i + 1 < tasksToBackfill.length) {
                    await yieldToBrowser()
                }
            }

            try {
                if (!store.shouldUseRuntimeProductReads()) await store.syncRepoStore()
            } catch (err) {
                console.warn("[StatsTab] Failed to sync stats backfill:", err)
            }
        } finally {
            setBackfillProgress(null)
        }
    }, [backfillProgress, store, tasksNeedingBackfill])

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
    const statRepos: StatsRecapRepoInput[] = repos
    const monthsMap = new Map<string, MonthStats>()
    let totalTasks = 0
    let totalIn = 0
    let totalOut = 0
    let totalCost = 0
    let totalEvents = 0
    let totalDurationMs = 0
    const totalByModel: Record<string, number> = {}

    const relativePeriods = getRelativePeriodRanges()
    const relativeStats = new Map<RelativePeriodKey, MonthStats>(relativePeriods.map(({ key, label }) => [key, createEmptyStats(label, key)]))

    for (const repo of statRepos) {
        for (const task of repo.tasks) {
            totalTasks++
            const u: OpenADETaskPreviewUsage = task.usage ?? { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, eventCount: 0, costByModel: {}, durationMs: 0 }
            totalIn += u.inputTokens
            totalOut += u.outputTokens
            totalCost += u.totalCostUsd
            totalEvents += u.eventCount
            totalDurationMs += u.durationMs ?? 0
            for (const [m, c] of Object.entries(u.costByModel)) {
                const cls = normalizeModelClass(m)
                totalByModel[cls] = (totalByModel[cls] ?? 0) + c
            }

            const { label, sortKey } = formatMonthLabel(task.createdAt)
            let month = monthsMap.get(sortKey)
            if (!month) {
                month = createEmptyStats(label, sortKey)
                monthsMap.set(sortKey, month)
            }
            addUsage(month, u)

            const createdAt = new Date(task.createdAt)
            if (!Number.isNaN(createdAt.getTime())) {
                for (const period of relativePeriods) {
                    if (createdAt >= period.start && createdAt < period.end) {
                        const bucket = relativeStats.get(period.key)
                        if (!bucket) continue
                        addUsage(bucket, u)
                    }
                }
            }
        }
    }

    const isRelativePeriod = (value: string | null): value is RelativePeriodKey => value === "today" || value === "this-week" || value === "last-week"

    const months = [...monthsMap.values()].sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    const effectiveSelected = isRelativePeriod(selectedPeriod) ? selectedPeriod : selectedPeriod && monthsMap.has(selectedPeriod) ? selectedPeriod : null

    // Stats for the featured section
    const featured =
        effectiveSelected && isRelativePeriod(effectiveSelected)
            ? relativeStats.get(effectiveSelected)!
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
                    durationMs: totalDurationMs,
                    costByModel: totalByModel,
                }

    const featuredTokens = featured.inputTokens + featured.outputTokens
    const recapPeriod = getRecapPeriod(effectiveSelected, relativePeriods, monthsMap)
    const recap = buildStatsRecap(statRepos, recapPeriod)
    const visibleRecapTaskIds = new Set(recap.tasks.slice(0, MAX_VISIBLE_RECAP_TASKS).map((task) => task.taskId))
    const visibleRecapRepos = recap.repos
        .map((repo) => ({
            ...repo,
            tasks: repo.tasks.filter((task) => visibleRecapTaskIds.has(task.taskId)),
        }))
        .filter((repo) => repo.tasks.length > 0)
    const hiddenRecapTaskCount = Math.max(0, recap.taskCount - MAX_VISIBLE_RECAP_TASKS)
    const recapText = buildStatsRecapText(recap)

    const handleCopyRecap = async () => {
        if (copyRecapState === "copying" || recap.taskCount === 0) return
        setCopyRecapState("copying")
        try {
            await navigator.clipboard.writeText(recapText)
            setCopyRecapState("copied")
            setTimeout(() => setCopyRecapState("idle"), 1500)
        } catch (err) {
            console.error("[StatsTab] Failed to copy recap:", err)
            setCopyRecapState("error")
            setTimeout(() => setCopyRecapState("idle"), 2000)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            {tasksNeedingBackfill.length > 0 && (
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                    <span>
                        {backfillProgress
                            ? `Loading ${backfillProgress.loaded}/${backfillProgress.total} tasks...`
                            : `${countLabel(tasksNeedingBackfill.length, "task")} missing usage`}
                    </span>
                    <button
                        type="button"
                        className="btn flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors border shrink-0 bg-base-200 text-muted hover:text-base-content border-border"
                        onClick={handleBackfillUsage}
                        disabled={backfillProgress !== null}
                    >
                        {backfillProgress ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        <span>Update</span>
                    </button>
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
                                durationMs: featured.durationMs,
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
                            {relativePeriods.map(({ key, label }) => {
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
                        <div className="grid grid-cols-5 gap-px bg-border">
                            <MiniStat label="Tasks" value={featured.taskCount.toLocaleString()} />
                            <MiniStat label="Runs" value={featured.eventCount.toLocaleString()} />
                            <MiniStat label="Time" value={formatDuration(featured.durationMs)} />
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

                    {/* Work recap */}
                    <div className="bg-base-200 border border-border p-4 flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[10px] text-muted uppercase tracking-widest font-medium">Recap</div>
                                <div className="text-sm font-semibold text-base-content mt-0.5">
                                    {recap.taskCount > 0
                                        ? `${countLabel(recap.taskCount, "task")} across ${countLabel(recap.projectCount, "project")}`
                                        : `No task activity for ${recap.periodLabel.toLowerCase()}`}
                                </div>
                                {recap.taskCount > 0 && (
                                    <div className="text-xs text-muted mt-0.5">
                                        {countLabel(recap.completedCount, "done item")} · {formatDuration(recap.durationMs)} · {formatTokens(recap.totalTokens)}{" "}
                                        tokens
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                className={cx(
                                    "btn flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors border shrink-0",
                                    copyRecapState === "copied"
                                        ? "bg-success text-success-content border-success"
                                        : "bg-base-100 text-muted hover:text-base-content border-border disabled:opacity-50"
                                )}
                                onClick={handleCopyRecap}
                                disabled={copyRecapState === "copying" || recap.taskCount === 0}
                            >
                                {copyRecapState === "copied" ? (
                                    <>
                                        <Check size={12} />
                                        <span>Copied!</span>
                                    </>
                                ) : copyRecapState === "error" ? (
                                    <span>Failed</span>
                                ) : (
                                    <>
                                        <Copy size={12} />
                                        <span>Copy Recap</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {visibleRecapRepos.length > 0 && (
                            <div className="border border-border bg-base-100">
                                {visibleRecapRepos.map((repo) => (
                                    <div key={repo.repoId} className="border-b border-border last:border-b-0">
                                        <div className="flex items-center justify-between gap-3 bg-base-200/70 px-3 py-1.5">
                                            <div className="min-w-0 truncate text-xs font-semibold text-base-content">{repo.repoName}</div>
                                            <div className="text-[10px] text-muted uppercase tracking-wide">{countLabel(repo.tasks.length, "task")}</div>
                                        </div>
                                        <div>
                                            {repo.tasks.map((task) => (
                                                <button
                                                    key={task.taskId}
                                                    type="button"
                                                    className="btn grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/40 px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-base-200/60"
                                                    onClick={() => store.config.navigateToTask(repo.repoId, task.taskId)}
                                                    title={`Open ${task.title}`}
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-xs font-medium text-base-content">{task.title}</span>
                                                        <span className="mt-0.5 block truncate text-[10px] text-muted">
                                                            {formatActivityTime(task.activityAt)}
                                                            {task.eventCount > 0 ? ` · ${countLabel(task.eventCount, "run")}` : ""}
                                                            {task.durationMs > 0 ? ` · ${formatDuration(task.durationMs)}` : ""}
                                                            {task.totalCostUsd > 0 ? ` · ${formatCost(task.totalCostUsd)}` : ""}
                                                        </span>
                                                    </span>
                                                    <span className={cx("border px-1.5 py-0.5 text-[10px] font-semibold", statusBadgeClass(task.statusTone))}>
                                                        {task.statusLabel}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {hiddenRecapTaskCount > 0 && (
                            <div className="text-xs text-muted">
                                {countLabel(hiddenRecapTaskCount, "more task")} in this period. Copy the recap for the full report.
                            </div>
                        )}
                    </div>

                    {/* Monthly table */}
                    {months.length > 0 && (
                        <div>
                            <div className="text-[10px] font-medium text-muted uppercase tracking-widest mb-2">Monthly</div>
                            <div className="border border-border">
                                {/* Header */}
                                <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-3 py-1.5 bg-base-200 border-b border-border text-[10px] text-muted uppercase tracking-wide font-medium">
                                    <span>Month</span>
                                    <span className="text-right w-10">Tasks</span>
                                    <span className="text-right w-10">Runs</span>
                                    <span className="text-right w-14">Time</span>
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
                                                "btn grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 w-full px-3 py-1.5 text-xs transition-colors border-b border-border/40 last:border-b-0",
                                                isActive ? "bg-primary/8" : "hover:bg-base-200/60"
                                            )}
                                            onClick={() => setSelectedPeriod(m.sortKey)}
                                        >
                                            <span className={cx("font-semibold text-left", isActive ? "text-primary" : "text-base-content")}>{m.label}</span>
                                            <span className="text-right text-muted w-10">{m.taskCount}</span>
                                            <span className="text-right text-muted w-10">{m.eventCount}</span>
                                            <span className="text-right text-muted w-14">{formatDuration(m.durationMs)}</span>
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
