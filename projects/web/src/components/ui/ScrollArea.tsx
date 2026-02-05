import { ScrollArea as ScrollAreaBase } from "@base-ui-components/react/scroll-area"
import type * as React from "react"
import { twMerge } from "tailwind-merge"

interface ScrollAreaProps {
    viewPortId?: string
    children: React.ReactNode
    className?: string
    viewportClassName?: string
    viewportRef?: React.RefObject<HTMLDivElement>
    orientation?: "vertical" | "horizontal"
}

export const ScrollArea: React.FC<ScrollAreaProps> = ({ viewPortId, children, className, viewportClassName, viewportRef, orientation = "vertical" }) => (
    <ScrollAreaBase.Root className={twMerge("relative overflow-hidden w-full h-full", className)}>
        <ScrollAreaBase.Viewport
            id={viewPortId}
            ref={viewportRef}
            className={twMerge("w-full h-full rounded-[inherit] overscroll-contain overflow-auto", viewportClassName)}
        >
            {children}
        </ScrollAreaBase.Viewport>
        <ScrollAreaBase.Scrollbar
            className={twMerge(
                "flex select-none touch-none p-0.5 bg-transparent transition-colors duration-150",
                "hover:bg-base-300",
                orientation === "vertical" ? "w-2.5" : "flex-col h-2.5"
            )}
            orientation={orientation}
        >
            <ScrollAreaBase.Thumb
                className={twMerge(
                    "flex-1 bg-base-100 rounded-full relative",
                    "before:content-[''] before:absolute before:top-1/2 before:left-1/2",
                    "before:-translate-x-1/2 before:-translate-y-1/2",
                    "before:w-full before:h-full before:min-w-[44px] before:min-h-[44px]"
                )}
            />
        </ScrollAreaBase.Scrollbar>
        <ScrollAreaBase.Corner className="bg-base-300" />
    </ScrollAreaBase.Root>
)
