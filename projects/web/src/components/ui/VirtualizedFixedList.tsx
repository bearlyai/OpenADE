import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react"

interface VirtualizedFixedListProps<T> {
    items: T[]
    rowHeight: number
    renderRow: (item: T, index: number) => ReactNode
    className?: string
    overscan?: number
}

export function VirtualizedFixedList<T>({ items, rowHeight, renderRow, className, overscan = 6 }: VirtualizedFixedListProps<T>) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)
    const [containerHeight, setContainerHeight] = useState(0)

    useLayoutEffect(() => {
        const node = containerRef.current
        if (!node) return

        const updateHeight = () => setContainerHeight(node.clientHeight)
        updateHeight()

        const observer = new ResizeObserver(updateHeight)
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    const { startIndex, endIndex, totalHeight } = useMemo(() => {
        const visibleCount = containerHeight > 0 ? Math.ceil(containerHeight / rowHeight) + overscan * 2 : Math.min(items.length, 60)
        const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
        const end = Math.min(items.length, start + visibleCount)

        return {
            startIndex: start,
            endIndex: end,
            totalHeight: items.length * rowHeight,
        }
    }, [containerHeight, items.length, overscan, rowHeight, scrollTop])

    return (
        <div ref={containerRef} className={className} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
            <div style={{ height: totalHeight, position: "relative" }}>
                {items.slice(startIndex, endIndex).map((item, offset) => {
                    const index = startIndex + offset
                    return (
                        <div
                            key={index}
                            style={{
                                position: "absolute",
                                top: index * rowHeight,
                                left: 0,
                                right: 0,
                                height: rowHeight,
                            }}
                        >
                            {renderRow(item, index)}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
