/**
 * McpServerIcon
 *
 * Shared icon component for MCP servers.
 * Shows brand icon for presets, or Globe/Terminal for generic servers.
 */

import { Globe, Terminal } from "lucide-react"
import { MCP_PRESETS } from "../../constants"

interface McpServerIconProps {
    type: "http" | "stdio"
    presetId?: string
    size?: number
    className?: string
}

export const McpServerIcon = ({ type, presetId, size = 20, className }: McpServerIconProps) => {
    // If we have a preset ID with an icon, show the brand icon
    const preset = presetId ? MCP_PRESETS[presetId] : null
    if (preset?.icon) {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className ?? "text-base-content"}>
                <path d={preset.icon.path} />
            </svg>
        )
    }

    // Otherwise show transport-based icon
    return type === "http" ? <Globe size={size} className={className ?? "text-primary"} /> : <Terminal size={size} className={className ?? "text-warning"} />
}
