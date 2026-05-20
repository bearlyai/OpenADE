/**
 * TrayButtons - Renders all tray toggle buttons from configuration
 */

import cx from "classnames"
import { observer } from "mobx-react"
import { useShortcutHintsVisible } from "../../hooks/useShortcutHintsVisible"
import type { TrayManager } from "../../store/managers/TrayManager"
import { ShortcutBadge } from "../ui"
import { TrayBadge } from "./TrayBadge"
import { TRAY_CONFIGS } from "./trayConfigs"

interface TrayButtonsProps {
    tray: TrayManager
}

export const TrayButtons = observer(function TrayButtons({ tray }: TrayButtonsProps) {
    const visibleConfigs = TRAY_CONFIGS.filter((config) => config.isVisible?.(tray) !== false)
    const showKeyboardHints = useShortcutHintsVisible()

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
                const shortcutHint = config.shortcut?.display.replace(/^⌘/, "")

                return (
                    <button
                        key={config.id}
                        type="button"
                        onClick={() => tray.toggle(config.id)}
                        title={`${config.label}${config.shortcut ? ` (${config.shortcut.display})` : ""}`}
                        className={cx(
                            "btn relative flex items-center justify-center w-7 h-7 text-xs transition-colors rounded cursor-pointer",
                            isOpen ? "bg-primary/20 text-primary" : "text-muted hover:text-base-content hover:bg-base-200"
                        )}
                    >
                        <Icon size={14} />
                        <ShortcutBadge label={shortcutHint} visible={showKeyboardHints} variant="bottomCorner" />
                        {badge !== null && badge !== undefined && (
                            <span className="absolute -top-1 -right-1">
                                <TrayBadge>{badge}</TrayBadge>
                            </span>
                        )}
                    </button>
                )
            })}
        </>
    )
})
