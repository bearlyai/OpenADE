import cx from "classnames"
import { ArrowBigUp, ArrowDown, ArrowUp, Command, Option, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export type ShortcutBadgeVariant = "corner" | "bottomCorner" | "row" | "floating"

const VARIANT_CLASSES: Record<ShortcutBadgeVariant, string> = {
    corner: "absolute right-0 top-0 h-4 min-w-4 -translate-y-1/2 translate-x-1/2 px-1",
    bottomCorner: "absolute bottom-0 right-0 h-4 min-w-4 translate-x-1/2 translate-y-1/2 px-1",
    row: "absolute right-7 top-1/2 h-4 min-w-4 -translate-y-1/2 px-1",
    floating: "h-6 min-w-9 px-2 shadow-lg",
}

const SHORTCUT_ICONS: Record<string, LucideIcon> = {
    "⌘": Command,
    "⌥": Option,
    "⇧": ArrowBigUp,
    "↑": ArrowUp,
    "↓": ArrowDown,
}

export function ShortcutBadge({
    label,
    visible,
    variant = "corner",
    className,
}: {
    label: string | undefined
    visible: boolean
    variant?: ShortcutBadgeVariant
    className?: string
}) {
    if (!visible || !label) return null

    return (
        <kbd
            className={cx(
                "pointer-events-none z-10 inline-flex select-none items-center justify-center gap-px rounded-[3px] border border-current/20 bg-base-100/95 font-mono text-[9px] font-normal leading-none text-current tabular-nums opacity-95 shadow-sm",
                VARIANT_CLASSES[variant],
                className
            )}
        >
            {Array.from(label).map((token, index) => {
                const Icon = SHORTCUT_ICONS[token]
                if (Icon) {
                    return (
                        <span key={`${token}-${index}`} className="inline-flex h-2.5 min-w-2.5 items-center justify-center">
                            <Icon size={8} strokeWidth={1.35} className="shrink-0" />
                        </span>
                    )
                }

                return (
                    <span key={`${token}-${index}`} className="inline-flex h-2.5 min-w-2.5 items-center justify-center font-mono tabular-nums">
                        {token}
                    </span>
                )
            })}
        </kbd>
    )
}

export function ShortcutHint({
    children,
    label,
    visible,
    variant = "corner",
    className,
    badgeClassName,
}: {
    children: ReactNode
    label: string | undefined
    visible: boolean
    variant?: ShortcutBadgeVariant
    className?: string
    badgeClassName?: string
}) {
    return (
        <span className={cx("relative inline-flex min-w-0", className)}>
            {children}
            <ShortcutBadge label={label} visible={visible} variant={variant} className={badgeClassName} />
        </span>
    )
}
