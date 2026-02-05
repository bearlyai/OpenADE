import { Info, Minimize2, Play, Webhook } from "lucide-react"
import type { ReactNode } from "react"
import type { CommentContext, GroupRenderer, SystemGroup } from "../../events/messageGroups"

const SYSTEM_DISPLAY_NAMES: Record<SystemGroup["subtype"], string> = {
    compact_boundary: "Compaction",
    status: "Status",
    init: "Session",
    hook_response: "Hook",
}

function getSystemIcon(subtype: SystemGroup["subtype"]): ReactNode {
    switch (subtype) {
        case "compact_boundary":
            return <Minimize2 size="0.85em" className="text-warning flex-shrink-0" />
        case "status":
            return <Info size="0.85em" className="text-primary flex-shrink-0" />
        case "init":
            return <Play size="0.85em" className="text-success flex-shrink-0" />
        case "hook_response":
            return <Webhook size="0.85em" className="text-muted flex-shrink-0" />
    }
}

function formatMetadataValue(value: unknown): string {
    if (typeof value === "number") return value.toLocaleString()
    if (typeof value === "string") return value
    return JSON.stringify(value)
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

        return displayName
    },
    getIcon: (group) => getSystemIcon(group.subtype),
    getStatusIcon: () => null,
    getHeaderInfo: () => null,
    renderContent: (group, ctx) => <SystemContent group={group} ctx={ctx} />,
}
