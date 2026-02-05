/**
 * TaskMcpSelector
 *
 * Component for selecting which MCP servers to enable for a task.
 * Flat, square design following Theme V2.
 */

import NiceModal from "@ebay/nice-modal-react"
import { Plug, Settings } from "lucide-react"
import { observer } from "mobx-react"
import type { McpServerItem } from "../../persistence/mcpServerStore"
import { useCodeStore } from "../../store/context"
import { SettingsModal } from "../settings/SettingsModal"
import { McpServerIcon } from "./McpServerIcon"

interface TaskMcpSelectorProps {
    selectedServerIds: string[]
    onSelectionChange: (serverIds: string[]) => void
    /** Compact mode for inline use in bottom bar - removes borders/padding */
    compact?: boolean
    /** Icon only mode - shows only icons without text labels */
    iconOnly?: boolean
}

/**
 * Get chip style based on selection state.
 * Minimal design - always shows brand icon, only selection state changes styling.
 */
const getChipStyle = (isSelected: boolean) => {
    return isSelected ? "border-primary bg-primary/10" : "border-transparent bg-transparent hover:bg-base-200"
}

/**
 * Compact server chip for selection
 */
const ServerChip = observer(
    ({
        server,
        isSelected,
        onToggle,
        iconOnly = false,
    }: {
        server: McpServerItem
        isSelected: boolean
        onToggle: () => void
        iconOnly?: boolean
    }) => {
        const borderClass = getChipStyle(isSelected)

        return (
            <button
                type="button"
                onClick={onToggle}
                title={server.name}
                className={`btn btn-sm h-auto ${iconOnly ? "p-1.5" : "px-2 py-1.5"} border text-left transition-colors ${borderClass}`}
            >
                <div className="flex items-center gap-1.5">
                    <McpServerIcon type={server.transportType} presetId={server.presetId} size={12} />
                    {!iconOnly && <span className="text-xs font-medium text-base-content">{server.name}</span>}
                </div>
            </button>
        )
    }
)

export const TaskMcpSelector = observer(({ selectedServerIds, onSelectionChange, compact = false, iconOnly = false }: TaskMcpSelectorProps) => {
    const store = useCodeStore()

    const enabledServers = store.mcpServers.enabledServers
    const hasServers = enabledServers.length > 0

    const isServerChecking = (serverId: string) => store.mcpServers.testingServerId === serverId || store.mcpServers.isOAuthPending(serverId)

    const handleToggle = async (server: McpServerItem) => {
        const isCurrentlySelected = selectedServerIds.includes(server.id)

        // Cancel ongoing OAuth check
        if (isServerChecking(server.id)) {
            await store.mcpServers.cancelOAuth(server.id)
            return
        }

        // Deselect if already selected
        if (isCurrentlySelected) {
            onSelectionChange(selectedServerIds.filter((id) => id !== server.id))
            return
        }

        // Unhealthy connector - open settings to fix configuration
        if (server.transportType === "http" && server.healthStatus === "unhealthy") {
            handleManage()
            return
        }

        // HTTP connector - check auth and initiate OAuth if needed
        if (server.transportType === "http") {
            try {
                const result = await store.mcpServers.testConnection(server.id)
                if (result.requiresAuth) {
                    const oauthStarted = await store.mcpServers.initiateOAuth(server.id)
                    if (oauthStarted) {
                        return
                    }
                }
            } catch (err) {
                console.error("[TaskMcpSelector] Failed to check connection:", err)
            }
        }

        onSelectionChange([...selectedServerIds, server.id])
    }

    const handleManage = () => {
        NiceModal.show(SettingsModal, { store, initialTab: "connectors" })
    }

    // Empty state
    if (!hasServers) {
        return (
            <div className={compact ? "flex items-center gap-2" : "flex items-center gap-2 pt-4 mt-4 border-t border-border"}>
                <Plug size={12} className="text-muted" />
                <span className="text-xs text-muted">No connectors</span>
                <button
                    type="button"
                    onClick={handleManage}
                    className="btn btn-sm h-auto px-2 py-1 btn-ghost text-xs text-primary flex flex-row items-center gap-1"
                >
                    <Settings size={12} />
                    <span>Manage</span>
                </button>
            </div>
        )
    }

    return (
        <div className={compact ? "flex items-center gap-2 flex-wrap" : "flex items-center gap-2 flex-wrap pt-4 mt-4 border-t border-border"}>
            {!iconOnly && <span className="text-xs text-muted shrink-0">Connectors:</span>}
            {enabledServers.map((server: McpServerItem) => (
                <ServerChip
                    key={server.id}
                    server={server}
                    isSelected={selectedServerIds.includes(server.id)}
                    onToggle={() => handleToggle(server)}
                    iconOnly={iconOnly}
                />
            ))}
            <button type="button" onClick={handleManage} className="btn btn-sm h-auto px-2 py-1.5 btn-ghost text-muted hover:text-base-content">
                <Settings size={12} />
            </button>
        </div>
    )
})
