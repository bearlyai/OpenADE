import type { RepoItem, TaskPreview, TaskPreviewUsage } from "../../persistence/repoStore"
import { formatDuration } from "../../persistence/taskStatsUtils"

export interface StatsRecapPeriod {
    label: string
    start?: Date
    end?: Date
}

export type StatsRecapTone = "success" | "warning" | "error" | "muted"

export interface StatsRecapTask {
    taskId: string
    repoId: string
    repoName: string
    title: string
    activityAt: string
    statusLabel: string
    statusTone: StatsRecapTone
    inputTokens: number
    outputTokens: number
    totalCostUsd: number
    eventCount: number
    durationMs: number
}

export interface StatsRecapRepo {
    repoId: string
    repoName: string
    tasks: StatsRecapTask[]
    totalCostUsd: number
    durationMs: number
    totalTokens: number
    latestActivityMs: number
}

export interface StatsRecapSummary {
    periodLabel: string
    tasks: StatsRecapTask[]
    repos: StatsRecapRepo[]
    taskCount: number
    projectCount: number
    completedCount: number
    totalCostUsd: number
    durationMs: number
    totalTokens: number
}

const EMPTY_USAGE: TaskPreviewUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    eventCount: 0,
    costByModel: {},
    durationMs: 0,
}

function getActivityAt(task: TaskPreview): string {
    return task.lastEventAt ?? task.lastEvent?.at ?? task.createdAt
}

function parseTime(value: string): number {
    const time = new Date(value).getTime()
    return Number.isFinite(time) ? time : 0
}

function isInPeriod(value: string, period: StatsRecapPeriod): boolean {
    const time = parseTime(value)
    if (time === 0) return !period.start && !period.end
    if (period.start && time < period.start.getTime()) return false
    if (period.end && time >= period.end.getTime()) return false
    return true
}

function getStatus(task: TaskPreview): { label: string; tone: StatsRecapTone; completed: boolean } {
    if (task.closed) {
        return { label: "Closed", tone: "success", completed: true }
    }

    switch (task.lastEvent?.status) {
        case "completed":
            return { label: "Done", tone: "success", completed: true }
        case "in_progress":
            return { label: "Running", tone: "warning", completed: false }
        case "error":
            return { label: "Errored", tone: "error", completed: false }
        case "stopped":
            return { label: "Stopped", tone: "muted", completed: false }
        default:
            return { label: "Started", tone: "muted", completed: false }
    }
}

function getUsage(task: TaskPreview): TaskPreviewUsage {
    return task.usage ?? EMPTY_USAGE
}

function compareTasks(a: StatsRecapTask, b: StatsRecapTask): number {
    return parseTime(b.activityAt) - parseTime(a.activityAt) || a.title.localeCompare(b.title)
}

export function buildStatsRecap(repos: RepoItem[], period: StatsRecapPeriod): StatsRecapSummary {
    const tasks: StatsRecapTask[] = []
    let completedCount = 0
    let totalCostUsd = 0
    let durationMs = 0
    let totalTokens = 0

    for (const repo of repos) {
        for (const task of repo.tasks) {
            const activityAt = getActivityAt(task)
            if (!isInPeriod(activityAt, period)) continue

            const usage = getUsage(task)
            const status = getStatus(task)
            if (status.completed) completedCount++

            const taskTokens = usage.inputTokens + usage.outputTokens
            totalCostUsd += usage.totalCostUsd
            durationMs += usage.durationMs ?? 0
            totalTokens += taskTokens

            tasks.push({
                taskId: task.id,
                repoId: repo.id,
                repoName: repo.name,
                title: task.title.trim() || "Untitled task",
                activityAt,
                statusLabel: status.label,
                statusTone: status.tone,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalCostUsd: usage.totalCostUsd,
                eventCount: usage.eventCount,
                durationMs: usage.durationMs ?? 0,
            })
        }
    }

    tasks.sort(compareTasks)

    const repoMap = new Map<string, StatsRecapRepo>()
    for (const task of tasks) {
        let repo = repoMap.get(task.repoId)
        if (!repo) {
            repo = {
                repoId: task.repoId,
                repoName: task.repoName,
                tasks: [],
                totalCostUsd: 0,
                durationMs: 0,
                totalTokens: 0,
                latestActivityMs: 0,
            }
            repoMap.set(task.repoId, repo)
        }

        repo.tasks.push(task)
        repo.totalCostUsd += task.totalCostUsd
        repo.durationMs += task.durationMs
        repo.totalTokens += task.inputTokens + task.outputTokens
        repo.latestActivityMs = Math.max(repo.latestActivityMs, parseTime(task.activityAt))
    }

    const groupedRepos = [...repoMap.values()].sort((a, b) => b.latestActivityMs - a.latestActivityMs || a.repoName.localeCompare(b.repoName))

    return {
        periodLabel: period.label,
        tasks,
        repos: groupedRepos,
        taskCount: tasks.length,
        projectCount: groupedRepos.length,
        completedCount,
        totalCostUsd,
        durationMs,
        totalTokens,
    }
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

function formatCost(cost: number): string {
    if (cost <= 0) return ""
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTaskDetails(task: StatsRecapTask): string {
    const details = [task.statusLabel]
    if (task.eventCount > 0) details.push(pluralize(task.eventCount, "run"))
    if (task.durationMs > 0) details.push(formatDuration(task.durationMs))
    const cost = formatCost(task.totalCostUsd)
    if (cost) details.push(cost)
    return details.join(", ")
}

export function buildStatsRecapText(summary: StatsRecapSummary): string {
    const lines = [`${summary.periodLabel} Recap`, ""]

    if (summary.taskCount === 0) {
        lines.push("No task activity for this period.")
        return lines.join("\n")
    }

    lines.push(
        `${pluralize(summary.taskCount, "task")} across ${pluralize(summary.projectCount, "project")}. ${pluralize(summary.completedCount, "done item")}.`
    )

    for (const repo of summary.repos) {
        lines.push("", repo.repoName)
        for (const task of repo.tasks) {
            lines.push(`- ${task.title} (${formatTaskDetails(task)})`)
        }
    }

    return lines.join("\n")
}
