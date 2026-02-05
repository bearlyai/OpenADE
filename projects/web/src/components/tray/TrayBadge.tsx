/**
 * TrayBadge - Small badge for displaying counts on tray buttons
 */

import type { ReactNode } from "react"

interface TrayBadgeProps {
    children: ReactNode
}

export function TrayBadge({ children }: TrayBadgeProps) {
    return <span className="ml-1 w-4 h-4 flex items-center justify-center text-[10px] font-medium bg-base-300 text-base-content rounded-full">{children}</span>
}
