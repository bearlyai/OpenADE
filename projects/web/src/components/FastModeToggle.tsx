import { Tooltip } from "@base-ui-components/react/tooltip"
import cx from "classnames"
import { Zap } from "lucide-react"
import { usePortalContainer } from "../hooks/usePortalContainer"

export function FastModeToggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
    const portalContainer = usePortalContainer()
    const button = (
        <button
            type="button"
            aria-label="Fast mode"
            aria-pressed={enabled}
            title="Fast mode"
            onClick={() => onChange(!enabled)}
            className={cx(
                "btn h-7 w-7 flex items-center justify-center border-0 bg-transparent transition-colors shrink-0",
                enabled ? "text-primary hover:bg-primary/10" : "text-muted hover:bg-base-200"
            )}
        >
            <Zap size={13} className={enabled ? "fill-current" : undefined} />
        </button>
    )

    return (
        <Tooltip.Root delay={0}>
            <Tooltip.Trigger render={button} />
            <Tooltip.Portal container={portalContainer}>
                <Tooltip.Positioner sideOffset={6} side="top">
                    <Tooltip.Popup className="bg-base-300 text-base-content text-xs px-2 py-1 shadow-lg border border-border">Fast mode</Tooltip.Popup>
                </Tooltip.Positioner>
            </Tooltip.Portal>
        </Tooltip.Root>
    )
}
