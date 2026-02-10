/**
 * UpdateBanner
 *
 * Displays a notification when a new app update has been downloaded
 * and is ready to be installed. Shows in the Electron frame's center area.
 */

import { observer } from "mobx-react"
import { applyUpdate, retryUpdateCheck } from "../electronAPI/app"

export const UpdateBanner = observer(() => {
    const handleRestart = async () => {
        await applyUpdate()
    }

    return (
        <button
            type="button"
            onClick={handleRestart}
            className="btn flex items-center gap-1.5 text-xs bg-primary text-primary-content rounded-full px-3 py-1 select-none hover:bg-primary/90 transition-colors cursor-pointer"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
            <span>An update is ready</span>
            <span className="opacity-50">·</span>
            <span className="opacity-80">Restart</span>
        </button>
    )
})

export const UpdateErrorBanner = observer(() => {
    const handleRetry = async () => {
        await retryUpdateCheck()
    }

    return (
        <button
            type="button"
            onClick={handleRetry}
            className="btn flex items-center gap-1.5 text-xs bg-error text-error-content rounded-full px-3 py-1 select-none hover:bg-error/90 transition-colors cursor-pointer"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
            <span>Update failed</span>
            <span className="opacity-50">·</span>
            <span className="opacity-80">Retry</span>
        </button>
    )
})
