import type { OpenADETaskPreview } from "../../../../openade-module/src"

const zeroTime = new Date(0).toISOString()

export function compareTaskPreviewsByRecent(a: OpenADETaskPreview, b: OpenADETaskPreview): number {
    const aTime = a.lastEvent?.at ?? a.createdAt ?? zeroTime
    const bTime = b.lastEvent?.at ?? b.createdAt ?? zeroTime
    return bTime.localeCompare(aTime)
}

function withRunningFirst(previews: OpenADETaskPreview[], runningTaskIds: Set<string>): OpenADETaskPreview[] {
    const running = previews.filter((task) => runningTaskIds.has(task.id))
    const idle = previews.filter((task) => !runningTaskIds.has(task.id))
    return [...running, ...idle]
}

export function sortTaskPreviewsLikeSidebar(
    previews: OpenADETaskPreview[],
    options: {
        pinnedTaskIds?: Iterable<string>
        runningTaskIds?: Iterable<string>
    } = {}
): OpenADETaskPreview[] {
    const pinnedSet = new Set(options.pinnedTaskIds ?? [])
    const runningSet = new Set(options.runningTaskIds ?? [])

    const openPreviews = previews.filter((task) => !task.closed).sort(compareTaskPreviewsByRecent)
    const pinnedOpen = withRunningFirst(
        openPreviews.filter((task) => pinnedSet.has(task.id)),
        runningSet
    )
    const unpinnedOpen = withRunningFirst(
        openPreviews.filter((task) => !pinnedSet.has(task.id)),
        runningSet
    )
    const closedPreviews = previews.filter((task) => task.closed).sort(compareTaskPreviewsByRecent)
    const pinnedClosed = closedPreviews.filter((task) => pinnedSet.has(task.id))
    const unpinnedClosed = closedPreviews.filter((task) => !pinnedSet.has(task.id))

    return [...pinnedOpen, ...unpinnedOpen, ...pinnedClosed, ...unpinnedClosed]
}
