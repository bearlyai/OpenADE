/**
 * TraySlideOut - Slide-out animation wrapper for tray content
 */

import cx from "classnames"
import type { ReactNode } from "react"

interface TraySlideOutProps {
    open: boolean
    children: ReactNode
    noPadding?: boolean
}

export function TraySlideOut({ open, children, noPadding }: TraySlideOutProps) {
    return (
        <div
            className={cx("absolute bottom-full mb-2 overflow-hidden", !open && "pointer-events-none")}
            style={{ left: "50%", transform: "translateX(-50%)", width: "90vw", maxWidth: "1400px" }}
        >
            <div
                className={cx(
                    "bg-base-100 border border-border shadow-lg transition-transform duration-150 ease-out",
                    open ? "translate-y-0" : "translate-y-full",
                    noPadding ? "" : "p-4"
                )}
                style={{ height: "70vh" }}
            >
                {children}
            </div>
        </div>
    )
}
