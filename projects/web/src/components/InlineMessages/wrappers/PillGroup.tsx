import cx from "classnames"
import { AlertCircle } from "lucide-react"
import type { ReactNode } from "react"

interface PillItem {
    id: string
    icon: ReactNode
    label: string
    isError?: boolean
    content: ReactNode
}

interface PillGroupProps {
    items: PillItem[]
    expandedId: string | null
    onToggle: (id: string) => void
}

function Pill({
    icon,
    label,
    isExpanded,
    isError,
    onClick,
}: {
    icon: ReactNode
    label: string
    isExpanded: boolean
    isError?: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            className={cx(
                "btn flex items-center gap-1.5 px-2 py-1 text-xs rounded-sm transition-colors",
                isExpanded ? "bg-primary/20 text-primary" : "bg-base-100 text-muted hover:bg-base-200 hover:text-base-content"
            )}
            onClick={onClick}
        >
            {icon}
            <span className="font-medium truncate max-w-[200px]">{label}</span>
            {isError && <AlertCircle size="0.85em" className="text-error flex-shrink-0" />}
        </button>
    )
}

export function PillGroup({ items, expandedId, onToggle }: PillGroupProps) {
    const expandedItem = items.find((item) => item.id === expandedId)

    return (
        <div className="border-t border-border">
            <div className="flex flex-wrap gap-1 px-2 py-1.5 bg-base-200/50">
                {items.map((item) => (
                    <Pill
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        isExpanded={expandedId === item.id}
                        isError={item.isError}
                        onClick={() => onToggle(item.id)}
                    />
                ))}
            </div>
            {expandedItem && <div className="border-t border-border bg-base-100">{expandedItem.content}</div>}
        </div>
    )
}
