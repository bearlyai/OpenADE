import { Loader2, Plug } from "lucide-react"
import type { OpenADEMCPServer } from "../../../../openade-module/src"
import { McpServerIcon } from "../../components/mcp/McpServerIcon"

export function TaskMcpPicker({
    servers,
    selectedServerIds,
    disabled = false,
    loaded = true,
    loading = false,
    onLoad,
    onSelectionChange,
}: {
    servers: OpenADEMCPServer[]
    selectedServerIds: string[]
    disabled?: boolean
    loaded?: boolean
    loading?: boolean
    onLoad?: () => void
    onSelectionChange: (serverIds: string[]) => void
}) {
    const enabledServers = servers.filter((server) => server.enabled)
    if (enabledServers.length === 0) {
        if (loaded || !onLoad) return null

        return (
            <button
                type="button"
                title="Load MCP connectors"
                disabled={disabled || loading}
                onClick={onLoad}
                className="btn flex h-8 shrink-0 items-center gap-1.5 border border-border bg-base-200 px-2 text-xs text-base-content"
            >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                <span>MCP</span>
            </button>
        )
    }

    const selectedSet = new Set(selectedServerIds)

    return (
        <div className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto overscroll-x-contain">
            <span className="flex h-8 shrink-0 items-center gap-1 border border-border bg-base-200 px-2 text-xs text-muted">
                <Plug size={12} />
                {selectedServerIds.length > 0 && <span>{selectedServerIds.length}</span>}
            </span>
            {enabledServers.map((server) => {
                const selected = selectedSet.has(server.id)
                return (
                    <button
                        key={server.id}
                        type="button"
                        title={server.name}
                        aria-pressed={selected}
                        disabled={disabled}
                        onClick={() => {
                            onSelectionChange(selected ? selectedServerIds.filter((id) => id !== server.id) : [...selectedServerIds, server.id])
                        }}
                        className={`btn flex h-8 shrink-0 items-center gap-1.5 border px-2 text-xs ${
                            selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-base-200 text-base-content"
                        }`}
                    >
                        <McpServerIcon type={server.transportType} presetId={server.presetId} size={12} />
                        <span>{server.name}</span>
                    </button>
                )
            })}
        </div>
    )
}
