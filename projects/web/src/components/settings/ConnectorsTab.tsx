/**
 * ConnectorsTab
 *
 * Connectors & Skills management tab for the Settings modal.
 * Slick, compact design optimized for modal layout.
 */

import { useModal } from "@ebay/nice-modal-react"
import { Plus, Trash2, X } from "lucide-react"
import { observer } from "mobx-react"
import { MCP_PRESETS, MCP_PRESET_IDS, type McpPreset } from "../../constants"
import type { McpServerItem } from "../../persistence/mcpServerStore"
import type { CodeStore } from "../../store/store"
import { AddMcpServerModal } from "../mcp/AddMcpServerModal"
import { McpServerIcon } from "../mcp/McpServerIcon"
import { ModalConfirm } from "../ui"

interface ConnectorsTabProps {
    store: CodeStore
}

/**
 * Compact status indicator
 */
const StatusDot = ({ status }: { status: "connected" | "ready" | "disconnected" | "connecting" }) => {
    const styles = {
        connected: "bg-success",
        ready: "bg-success",
        disconnected: "bg-base-300",
        connecting: "bg-warning animate-pulse",
    }

    const titles = {
        connected: "Connected",
        ready: "Ready",
        disconnected: "Not connected",
        connecting: "Connecting...",
    }

    return <span className={`w-2 h-2 rounded-full ${styles[status]}`} title={titles[status]} />
}

/**
 * Compact installed connector row
 */
const InstalledRow = observer(
    ({
        server,
        onRemove,
        onConnect,
        isConnecting,
    }: {
        server: McpServerItem
        onRemove: () => void
        onConnect: () => void
        isConnecting: boolean
    }) => {
        const preset = server.presetId ? MCP_PRESETS[server.presetId] : null
        const isHttp = server.transportType === "http"
        const isConnected = isHttp && !!server.oauthTokens

        const status = isHttp ? (isConnecting ? "connecting" : isConnected ? "connected" : "disconnected") : "ready"

        return (
            <div className="flex items-center gap-3 p-3 bg-base-200/50 hover:bg-base-200 transition-colors group">
                <div className="w-8 h-8 bg-base-300 flex items-center justify-center shrink-0">
                    <McpServerIcon type={server.transportType} presetId={server.presetId} size={16} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-base-content truncate">{preset?.name ?? server.name}</span>
                        <StatusDot status={status} />
                    </div>
                    <div className="text-xs text-muted truncate">{preset?.description ?? (isHttp ? server.url : server.command)}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {/* Connect/Cancel button for HTTP */}
                    {isHttp && !isConnected && (
                        <button
                            type="button"
                            onClick={onConnect}
                            className={`btn btn-xs h-7 px-2 ${isConnecting ? "btn-ghost text-muted hover:text-error" : "bg-primary text-primary-content hover:bg-primary/80"}`}
                        >
                            {isConnecting ? (
                                <span className="flex items-center gap-1">
                                    <X size={12} />
                                    Cancel
                                </span>
                            ) : (
                                "Connect"
                            )}
                        </button>
                    )}

                    {/* Remove button */}
                    <button
                        type="button"
                        onClick={onRemove}
                        className="btn btn-xs btn-ghost btn-square text-muted hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>
        )
    }
)

/**
 * Compact available connector card
 */
const AvailableCard = ({ preset, onInstall }: { preset: McpPreset; onInstall: () => void }) => {
    return (
        <button
            type="button"
            onClick={onInstall}
            className="btn h-auto p-2.5 border border-border bg-base-100 hover:border-primary/50 hover:bg-base-100 transition-colors text-left w-full group"
        >
            <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-base-200 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                    <McpServerIcon type={preset.transportType} presetId={preset.id} size={14} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm text-base-content truncate">{preset.name}</span>
                        <span className="text-[10px] px-1 py-0.5 bg-base-200 text-muted group-hover:bg-primary/10 group-hover:text-primary transition-colors shrink-0">
                            {preset.transportType === "http" ? "OAuth" : "Local"}
                        </span>
                    </div>
                    <div className="text-xs text-muted truncate">{preset.description}</div>
                </div>
                <Plus size={14} className="text-muted group-hover:text-primary transition-colors shrink-0" />
            </div>
        </button>
    )
}

/**
 * Compact add custom connector button
 */
const AddCustomButton = ({ onClick }: { onClick: () => void }) => {
    return (
        <button
            type="button"
            onClick={onClick}
            className="btn h-auto p-2.5 border border-dashed border-border bg-transparent hover:border-primary/50 hover:bg-base-200/50 transition-colors text-left w-full group"
        >
            <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 border border-dashed border-border flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                    <Plus size={14} className="text-muted group-hover:text-primary transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-base-content">Add Custom Server</div>
                    <div className="text-xs text-muted">HTTP or stdio MCP server</div>
                </div>
            </div>
        </button>
    )
}

/**
 * Section label
 */
const SectionLabel = ({ title, count }: { title: string; count?: number }) => (
    <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-muted uppercase tracking-wide">{title}</span>
        {count !== undefined && count > 0 && <span className="text-xs px-1.5 py-0.5 bg-base-200 text-muted">{count}</span>}
    </div>
)

export const ConnectorsTab = observer(({ store }: ConnectorsTabProps) => {
    const addModal = useModal(AddMcpServerModal)
    const deleteConfirmModal = useModal(ModalConfirm)

    const installedServers = store.mcpServers.servers
    const installedPresetIds = new Set(installedServers.filter((s) => s.presetId).map((s) => s.presetId))
    const availablePresets = MCP_PRESET_IDS.filter((id) => !installedPresetIds.has(id)).map((id) => MCP_PRESETS[id])

    const handleInstall = (preset: McpPreset) => {
        if (preset.transportType === "http") {
            store.mcpServers.addHttpServer({
                name: preset.name,
                url: preset.url ?? "",
                presetId: preset.id,
            })
        } else {
            store.mcpServers.addStdioServer({
                name: preset.name,
                command: preset.command ?? "",
                args: preset.args,
                presetId: preset.id,
            })
        }
    }

    const handleRemove = (server: McpServerItem) => {
        deleteConfirmModal.show({
            title: "Remove Connector",
            description: `Are you sure you want to remove "${server.name}"? This will disconnect any active sessions.`,
            onConfirm: () => {
                store.mcpServers.deleteServer(server.id)
            },
            buttonText: "Remove",
        })
    }

    const handleConnect = async (server: McpServerItem) => {
        if (store.mcpServers.isOAuthPending(server.id)) {
            await store.mcpServers.cancelOAuth(server.id)
        } else {
            await store.mcpServers.initiateOAuth(server.id)
        }
    }

    const handleAddCustom = () => {
        addModal.show({ manager: store.mcpServers })
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div>
                <h3 className="text-base font-semibold text-base-content">Connectors & Skills</h3>
                <p className="text-sm text-muted mt-1">Connect external services and tools to extend Claude's capabilities.</p>
            </div>

            {/* Installed connectors */}
            {installedServers.length > 0 && (
                <section>
                    <SectionLabel title="Installed" count={installedServers.length} />
                    <div className="flex flex-col gap-1">
                        {installedServers.map((server) => (
                            <InstalledRow
                                key={server.id}
                                server={server}
                                onRemove={() => handleRemove(server)}
                                onConnect={() => handleConnect(server)}
                                isConnecting={store.mcpServers.isOAuthPending(server.id)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* Available connectors */}
            {availablePresets.length > 0 && (
                <section>
                    <SectionLabel title={installedServers.length > 0 ? "Available" : "Get Started"} />
                    <div className="grid grid-cols-1 gap-2">
                        {availablePresets.map((preset) => (
                            <AvailableCard key={preset.id} preset={preset} onInstall={() => handleInstall(preset)} />
                        ))}
                    </div>
                </section>
            )}

            {/* Custom server */}
            <section>
                <SectionLabel title="Custom" />
                <AddCustomButton onClick={handleAddCustom} />
            </section>
        </div>
    )
})
