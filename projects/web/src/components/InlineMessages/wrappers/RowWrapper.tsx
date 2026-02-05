import cx from "classnames"
import { Loader } from "lucide-react"
import type { ReactNode } from "react"

interface RowWrapperProps {
    icon: ReactNode
    label: string
    statusIcon?: ReactNode | null
    headerInfo?: ReactNode | null
    isError?: boolean
    isPending?: boolean
    expanded: boolean
    onToggle: () => void
    children: ReactNode
}

export function RowWrapper({ icon, label, statusIcon, headerInfo, isError, isPending, expanded, onToggle, children }: RowWrapperProps) {
    if (isPending) {
        return (
            <div className="border-t border-border">
                <div className="flex items-center gap-2 px-3 py-2 bg-base-200/50 text-muted text-sm">
                    <Loader size="1em" className="animate-spin" />
                    {icon}
                    <span className="font-medium">{label}</span>
                    {headerInfo}
                </div>
            </div>
        )
    }

    return (
        <div className="border-t border-border">
            <div
                className={cx(
                    "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer",
                    isError ? "bg-error/10 hover:bg-error/20" : "bg-base-200/50 hover:bg-base-300"
                )}
                onClick={onToggle}
            >
                {statusIcon}
                {icon}
                <span className={cx("font-medium", isError ? "text-error" : "text-base-content")}>{label}</span>
                {headerInfo}
            </div>
            {expanded && children}
        </div>
    )
}
