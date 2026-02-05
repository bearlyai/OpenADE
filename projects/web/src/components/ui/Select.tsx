import { Select as SelectBase } from "@base-ui-components/react/select"
import { Check, ChevronDown } from "lucide-react"
import type { ReactNode } from "react"
import { twMerge } from "tailwind-merge"
import { usePortalContainer } from "../../hooks/usePortalContainer"

interface SelectProps<K, T extends { id: K; content: ReactNode }> {
    selectedId: K
    entries: T[]
    onSelect: (entry: T) => void | Promise<void>
    placeholder?: string
    disabled?: boolean
    noArrow?: boolean
    side?: "top" | "bottom" | "left" | "right"
    align?: "start" | "center" | "end"
    className?: {
        trigger?: string
        popup?: string
        item?: string
        value?: string
        icon?: string
    }
}

export function Select<K, T extends { id: K; content: ReactNode }>({
    selectedId,
    entries,
    onSelect,
    disabled = false,
    noArrow = false,
    side = "bottom",
    align = "start",
    className = {},
}: SelectProps<K, T>) {
    const portalContainer = usePortalContainer()
    const items = entries.map((entry) => ({
        label: entry.content,
        value: String(entry.id),
        entry,
    }))

    const handleValueChange = (value: string | null) => {
        if (disabled || value === null) return
        const item = items.find((item) => item.value === value)
        if (item) {
            onSelect(item.entry)
        }
    }

    return (
        <SelectBase.Root items={items} value={String(selectedId)} onValueChange={handleValueChange} disabled={disabled}>
            <SelectBase.Trigger
                className={twMerge(
                    "btn flex h-10 items-center justify-between gap-3 border border-border pr-3 pl-3.5 text-base text-base-content select-none",
                    "hover:bg-input focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary",
                    "data-[popup-open]:bg-input cursor-default",
                    "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:pointer-events-none",
                    className.trigger
                )}
            >
                <SelectBase.Value className={className.value} />
                {!noArrow && (
                    <SelectBase.Icon className={twMerge("flex", className.icon)}>
                        <ChevronDown fontSize="1em" className="w-4 h-4" />
                    </SelectBase.Icon>
                )}
            </SelectBase.Trigger>
            <SelectBase.Portal container={portalContainer}>
                <SelectBase.Positioner className="outline-none select-none" sideOffset={8} side={side} align={align}>
                    <SelectBase.Popup
                        className={twMerge(
                            "group origin-[var(--transform-origin)] bg-clip-padding bg-base-200 text-base-content shadow-lg outline outline-1 outline-border",
                            "transition-[transform,scale,opacity]",
                            "data-[ending-style]:scale-90 data-[ending-style]:opacity-0",
                            "data-[starting-style]:scale-90 data-[starting-style]:opacity-0",
                            className.popup
                        )}
                    >
                        <SelectBase.ScrollUpArrow className="top-0 z-[1] flex h-4 w-full cursor-default items-center justify-center bg-base-200 text-center text-xs before:absolute before:left-0 before:h-full before:w-full before:content-['']" />
                        <SelectBase.List className="relative py-1 scroll-py-6 overflow-y-auto max-h-[var(--available-height)]">
                            {items.map(({ label, value }) => (
                                <SelectBase.Item
                                    key={value}
                                    value={value}
                                    className={twMerge(
                                        "grid min-w-[var(--anchor-width)] cursor-default grid-cols-[0.75rem_1fr] items-center gap-2 py-2 pr-4 pl-2.5 text-sm leading-4 outline-none select-none",
                                        "data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-primary-content",
                                        "data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:bg-primary",
                                        className.item
                                    )}
                                >
                                    <SelectBase.ItemIndicator className="col-start-1">
                                        <Check className="w-3 h-3" />
                                    </SelectBase.ItemIndicator>
                                    <SelectBase.ItemText className="col-start-2">{label}</SelectBase.ItemText>
                                </SelectBase.Item>
                            ))}
                        </SelectBase.List>
                        <SelectBase.ScrollDownArrow className="bottom-0 z-[1] flex h-4 w-full cursor-default items-center justify-center bg-base-200 text-center text-xs before:absolute before:left-0 before:h-full before:w-full before:content-['']" />
                    </SelectBase.Popup>
                </SelectBase.Positioner>
            </SelectBase.Portal>
        </SelectBase.Root>
    )
}
