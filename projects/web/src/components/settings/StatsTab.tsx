import { Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useState } from "react"
import type { RepoItem, TaskPreviewUsage } from "../../persistence/repoStore"
import type { CodeStore } from "../../store/store"
import { normalizeModelClass } from "../../constants"

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
    if (Number.isNaN(date.getTime())) return { label: "Unknown", sortKey: "0000-00" }
    const year = date.getFullYear()
    const month = date.getMonth()
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return {
        label: `${monthNames[month]} ${year}`,
        sortKey: `${year}-${String(month + 1).padStart(2, "0")}`,
    }
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
    const [backfillProgress, setBackfillProgress] = useState<{ loaded: number; total: number } | null>(null)

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

    // Aggregate stats across all workspaces
    const repos: RepoItem[] = store.repoStore?.repos.all() ?? []
    const monthsMap = new Map<string, MonthStats>()
    let totalTasks = 0
    let totalIn = 0
    let totalOut = 0
    let totalCost = 0
    let totalEvents = 0
    const totalByModel: Record<string, number> = {}

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
        }
    }

    const months = [...monthsMap.values()].sort((a, b) => b.sortKey.localeCompare(a.sortKey))

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

            {/* Summary grid */}
            <div className="grid grid-cols-4 gap-3">
                <StatCell label="Tasks" value={totalTasks.toLocaleString()} />
                <StatCell label="Runs" value={totalEvents.toLocaleString()} />
                <StatCell label="Tokens" value={formatTokens(totalIn + totalOut)} />
                <StatCell label="Cost" value={formatCost(totalCost)} />
            </div>

            {/* Model costs & token breakdown */}
            {(Object.keys(totalByModel).length > 0 || totalIn > 0 || totalOut > 0) && (
                <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(totalByModel)
                        .sort((a, b) => b[1] - a[1])
                        .map(([model, cost]) => (
                            <div key={model} className="bg-base-200 border border-border px-2.5 py-1 flex items-center gap-1.5">
                                <span className="text-base-content font-medium">{model}</span>
                                <span className="text-muted">{formatCost(cost)}</span>
                            </div>
                        ))}
                    {totalIn > 0 && (
                        <div className="bg-base-200 border border-border px-2.5 py-1 flex items-center gap-1.5">
                            <span className="text-base-content font-medium">{formatTokens(totalIn)}</span>
                            <span className="text-muted">in</span>
                        </div>
                    )}
                    {totalOut > 0 && (
                        <div className="bg-base-200 border border-border px-2.5 py-1 flex items-center gap-1.5">
                            <span className="text-base-content font-medium">{formatTokens(totalOut)}</span>
                            <span className="text-muted">out</span>
                        </div>
                    )}
                </div>
            )}

            {/* Monthly breakdown */}
            {months.length > 0 && (
                <div className="flex flex-col">
                    <div className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Monthly</div>
                    {months.map((m) => (
                        <MonthRow key={m.sortKey} month={m} />
                    ))}
                </div>
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

function StatCell({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-base-200 border border-border px-3 py-2">
            <div className="text-muted text-[10px] uppercase tracking-wide">{label}</div>
            <div className="text-base-content text-lg font-semibold leading-tight">{value}</div>
        </div>
    )
}

function MonthRow({ month }: { month: MonthStats }) {
    const totalTokens = month.inputTokens + month.outputTokens
    return (
        <div className="flex items-center justify-between py-1.5 px-1 text-sm border-b border-border/50 last:border-b-0">
            <span className="text-base-content font-medium text-xs">{month.label}</span>
            <div className="flex items-center gap-4 text-xs text-muted">
                <span>
                    {month.taskCount} {month.taskCount === 1 ? "task" : "tasks"}
                </span>
                <span>
                    {month.eventCount} {month.eventCount === 1 ? "run" : "runs"}
                </span>
                <span>{formatTokens(totalTokens)}</span>
                <span className="text-base-content font-medium">{formatCost(month.totalCostUsd)}</span>
            </div>
        </div>
    )
}
