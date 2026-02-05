import { Menu as MenuBase } from "@base-ui-components/react/menu"
import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { twMerge } from "tailwind-merge"
import { usePortalContainer } from "../../hooks/usePortalContainer"

export interface MenuItem {
    id: string
    label: ReactNode
    disabled?: boolean
    onSelect?: () => void | Promise<void>
    submenu?: MenuItem[]
}

interface MenuSection {
    items: MenuItem[]
}

interface MenuProps {
    trigger: ReactNode
    sections: MenuSection[]
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    disabled?: boolean
    openOnHover?: boolean
    hoverDelay?: number
    side?: "top" | "bottom" | "left" | "right"
    align?: "start" | "center" | "end"
    sideOffset?: number
    tabIndex?: number
    className?: {
        trigger?: string
        popup?: string
        item?: string
        separator?: string
    }
}

const itemClassName =
    "flex cursor-pointer items-center justify-between py-2 pr-3 pl-3 text-sm leading-4 outline-none select-none data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-white data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-0.5 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-[2px] data-[highlighted]:before:bg-primary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"

function MenuItems({ items, className, portalContainer }: { items: MenuItem[]; className?: string; portalContainer: HTMLElement | null }) {
    return (
        <>
            {items.map((item) => {
                if (item.submenu) {
                    return (
                        <MenuBase.SubmenuRoot key={item.id}>
                            <MenuBase.SubmenuTrigger
                                className={twMerge(itemClassName, item.disabled && "opacity-50 cursor-not-allowed pointer-events-none", className)}
                            >
                                <span>{item.label}</span>
                                <ChevronRight className="w-4 h-4 ml-2" />
                            </MenuBase.SubmenuTrigger>
                            <MenuBase.Portal container={portalContainer}>
                                <MenuBase.Positioner className="outline-none" sideOffset={4}>
                                    <MenuBase.Popup className="origin-[var(--transform-origin)] rounded-md bg-base-200 py-0.5 text-base-content shadow-lg outline outline-1 outline-border transition-[transform,scale,opacity] data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:scale-90 data-[starting-style]:opacity-0">
                                        <MenuItems items={item.submenu} className={className} portalContainer={portalContainer} />
                                    </MenuBase.Popup>
                                </MenuBase.Positioner>
                            </MenuBase.Portal>
                        </MenuBase.SubmenuRoot>
                    )
                }

                return (
                    <MenuBase.Item key={item.id} className={twMerge(itemClassName, className)} disabled={item.disabled} onClick={item.onSelect}>
                        {item.label}
                    </MenuBase.Item>
                )
            })}
        </>
    )
}

export function Menu({
    trigger,
    sections,
    open,
    defaultOpen,
    onOpenChange,
    disabled = false,
    openOnHover = false,
    hoverDelay,
    side = "bottom",
    align = "start",
    sideOffset = 8,
    tabIndex,
    className = {},
}: MenuProps) {
    const portalContainer = usePortalContainer()

    return (
        <MenuBase.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} openOnHover={openOnHover} delay={hoverDelay}>
            <MenuBase.Trigger
                className={twMerge(
                    "btn flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-input px-3.5 text-base font-medium text-base-content select-none hover:bg-input/80 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary active:bg-input/80 data-[popup-open]:bg-input/80",
                    "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:pointer-events-none",
                    className.trigger
                )}
                disabled={disabled}
                tabIndex={tabIndex}
            >
                {trigger}
            </MenuBase.Trigger>
            <MenuBase.Portal container={portalContainer}>
                <MenuBase.Positioner
                    className="outline-none z-50"
                    sideOffset={sideOffset}
                    side={side}
                    align={align}
                    collisionAvoidance={{ side: "shift", align: "shift" }}
                >
                    <MenuBase.Popup
                        className={twMerge(
                            "origin-[var(--transform-origin)] rounded-md bg-base-200 py-0.5 text-base-content shadow-lg outline outline-1 outline-border transition-[transform,scale,opacity] data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:scale-90 data-[starting-style]:opacity-0",
                            className.popup
                        )}
                    >
                        {sections.map((section, index) => (
                            <div key={index}>
                                {index > 0 && <MenuBase.Separator className={twMerge("mx-3 my-1 h-px bg-border", className.separator)} />}
                                <MenuItems items={section.items} className={className.item} portalContainer={portalContainer} />
                            </div>
                        ))}
                    </MenuBase.Popup>
                </MenuBase.Positioner>
            </MenuBase.Portal>
        </MenuBase.Root>
    )
}
