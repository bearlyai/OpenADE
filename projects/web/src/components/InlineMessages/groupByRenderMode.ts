import type { GroupWithMeta, RenderableItem } from "../events/messageGroups"

export function groupByRenderMode(groups: GroupWithMeta[]): RenderableItem[] {
    const result: RenderableItem[] = []
    let pillBuffer: GroupWithMeta[] = []

    const flushPills = () => {
        if (pillBuffer.length > 0) {
            result.push({ mode: "pill", items: [...pillBuffer] })
            pillBuffer = []
        }
    }

    for (const g of groups) {
        if (g.mode === "pill") {
            pillBuffer.push(g)
        } else {
            flushPills()
            result.push({ mode: g.mode, item: g })
        }
    }
    flushPills()

    return result
}
