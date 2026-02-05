/**
 * TrayButtons - Renders all tray toggle buttons from configuration
 */

import cx from "classnames"
import { observer } from "mobx-react"
import type { TrayManager } from "../../store/managers/TrayManager"
import { TrayBadge } from "./TrayBadge"
import { TRAY_CONFIGS } from "./trayConfigs"

interface TrayButtonsProps {
    tray: TrayManager
}

export const TrayButtons = observer(function TrayButtons({ tray }: TrayButtonsProps) {
    const visibleConfigs = TRAY_CONFIGS.filter((config) => config.isVisible?.(tray) !== false)

    // Auto-close tray if the currently open tray becomes hidden
    if (tray.openTray && !visibleConfigs.some((c) => c.id === tray.openTray)) {
        tray.close()
    }

    return (
        <>
            {visibleConfigs.map((config) => {
                const badge = config.renderBadge?.(tray)
                const isOpen = tray.openTray === config.id
                const Icon = config.icon

                return (
                    <button
                        key={config.id}
                        type="button"
                        onClick={() => tray.toggle(config.id)}
                        className={cx(
                            "btn flex items-center gap-1.5 px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap rounded cursor-pointer",
                            isOpen ? "bg-primary/20 text-primary" : "text-muted hover:text-base-content hover:bg-base-200"
                        )}
                    >
                        <Icon size={12} />
                        {config.label}
                        {badge !== null && badge !== undefined && <TrayBadge>{badge}</TrayBadge>}
                    </button>
                )
            })}
        </>
    )
})
