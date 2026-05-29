import { AlertTriangle, Info, ListChecks, Minimize2, Play, Webhook } from "lucide-react"
import type { ReactNode } from "react"
import type { CommentContext, GroupRenderer, SystemGroup } from "../../events/messageGroups"

const SYSTEM_DISPLAY_NAMES: Record<SystemGroup["subtype"], string> = {
    compact_boundary: "Compaction",
    status: "Status",
    init: "Session",
    hook_started: "Hook started",
    hook_progress: "Hook progress",
    hook_response: "Hook",
    api_retry: "API retry",
    task_started: "Task",
    task_progress: "Task",
    task_notification: "Task",
    task_updated: "Task",
}

function getSystemIcon(group: SystemGroup): ReactNode {
    switch (group.subtype) {
        case "compact_boundary":
            return <Minimize2 size="0.85em" className="text-warning flex-shrink-0" />
        case "status":
            return <Info size="0.85em" className="text-primary flex-shrink-0" />
        case "init":
            return <Play size="0.85em" className="text-success flex-shrink-0" />
        case "hook_started":
        case "hook_progress":
        case "hook_response":
            return <Webhook size="0.85em" className="text-muted flex-shrink-0" />
        case "api_retry":
            return <AlertTriangle size="0.85em" className={`${isFinalApiRetry(group.metadata) ? "text-error" : "text-warning"} flex-shrink-0`} />
        case "task_started":
        case "task_progress":
        case "task_notification":
        case "task_updated":
            return <ListChecks size="0.85em" className="text-info flex-shrink-0" />
    }
}

function formatMetadataValue(value: unknown): string {
    if (typeof value === "number") return value.toLocaleString()
    if (typeof value === "string") return value
    return JSON.stringify(value)
}

function getNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isFinalApiRetry(metadata: Record<string, unknown>): boolean {
    const attempt = getNumber(metadata.attempt)
    const maxRetries = getNumber(metadata.max_retries)
    return attempt !== undefined && maxRetries !== undefined && attempt >= maxRetries
}

function formatApiRetryError(metadata: Record<string, unknown>): string | undefined {
    const error = typeof metadata.error === "string" ? metadata.error.replaceAll("_", " ") : undefined
    const status = getNumber(metadata.error_status)
    if (error && status !== undefined) return `${error} (${status})`
    return error ?? (status !== undefined ? `HTTP ${status}` : undefined)
}

function formatRetryDelay(metadata: Record<string, unknown>): string | undefined {
    const retryDelayMs = getNumber(metadata.retry_delay_ms)
    if (retryDelayMs === undefined) return undefined
    return `${(retryDelayMs / 1000).toFixed(1)}s`
}

function formatApiRetryLabel(metadata: Record<string, unknown>): string {
    const attempt = getNumber(metadata.attempt)
    const maxRetries = getNumber(metadata.max_retries)
    const base =
        attempt !== undefined && maxRetries !== undefined
            ? `${isFinalApiRetry(metadata) ? "Final API retry" : "API retry"} ${attempt}/${maxRetries}`
            : "API retry"
    const parts = [base, formatApiRetryError(metadata), formatRetryDelay(metadata)].filter((part): part is string => Boolean(part))
    return parts.join(" - ")
}

function getString(metadata: Record<string, unknown>, key: string): string | undefined {
    const value = metadata[key]
    return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getPatch(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
    const patch = metadata.patch
    return patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : undefined
}

function formatStatus(value: string): string {
    return `${value[0].toUpperCase()}${value.slice(1)}`
}

function formatTaskLabel(group: SystemGroup): string {
    if (group.subtype === "task_started") {
        return `Task: ${getString(group.metadata, "description") ?? "started"}`
    }
    if (group.subtype === "task_progress") {
        return `Task: ${getString(group.metadata, "description") ?? getString(group.metadata, "last_tool_name") ?? "working"}`
    }
    if (group.subtype === "task_updated") {
        const patch = getPatch(group.metadata)
        const status = patch ? getString(patch, "status") : undefined
        return status ? `Task ${formatStatus(status)}` : "Task Updated"
    }

    const status = getString(group.metadata, "status")
    const summary = getString(group.metadata, "summary")
    if (status && summary) return `Task ${formatStatus(status)}: ${summary}`
    if (summary) return `Task: ${summary}`
    if (status) return `Task ${formatStatus(status)}`
    return "Task"
}

function SystemContent({ group }: { group: SystemGroup; ctx: CommentContext }) {
    if (Object.keys(group.metadata).length === 0) {
        return <div className="px-3 py-2 text-xs text-muted">No metadata</div>
    }

    return (
        <div className="px-3 py-2 bg-base-100">
            <div className="space-y-1">
                {Object.entries(group.metadata).map(([key, value]) => (
                    <div key={key} className="flex gap-2 text-xs">
                        <span className="text-muted font-medium">{key}:</span>
                        <span className="text-base-content font-mono">{formatMetadataValue(value)}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export const systemRenderer: GroupRenderer<SystemGroup> = {
    getLabel: (group) => {
        const displayName = SYSTEM_DISPLAY_NAMES[group.subtype]

        if (group.subtype === "compact_boundary") {
            const compact = group.metadata.compact_metadata as { trigger?: string; pre_tokens?: number } | undefined
            if (compact?.pre_tokens) return `${displayName}: ${compact.pre_tokens.toLocaleString()} tokens`
        }
        if (group.subtype === "status") {
            const status = group.metadata.status as string | undefined
            if (status) return `${displayName}: ${status}`
        }
        if (group.subtype === "init") {
            const sessionId = group.metadata.session_id as string | undefined
            if (sessionId) return `Session ${sessionId.slice(0, 8)}`
        }
        if (group.subtype === "api_retry") {
            return formatApiRetryLabel(group.metadata)
        }
        if (
            group.subtype === "task_started" ||
            group.subtype === "task_progress" ||
            group.subtype === "task_notification" ||
            group.subtype === "task_updated"
        ) {
            return formatTaskLabel(group)
        }

        return displayName
    },
    getIcon: (group) => getSystemIcon(group),
    getStatusIcon: () => null,
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <SystemContent group={group} ctx={ctx} />,
}
