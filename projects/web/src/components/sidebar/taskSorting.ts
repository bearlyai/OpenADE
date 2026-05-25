import type { TaskPreview } from "@/persistence/repoStore"

const zeroTime = new Date(0).toISOString()

export function compareTaskPreviewsByRecent(a: TaskPreview, b: TaskPreview): number {
    const aTime = a.lastEvent?.at ?? a.createdAt ?? zeroTime
    const bTime = b.lastEvent?.at ?? b.createdAt ?? zeroTime
    return bTime.localeCompare(aTime)
}

function withRunningFirst(previews: TaskPreview[], workingTaskIds: Set<string>): TaskPreview[] {
    const running = previews.filter((task) => workingTaskIds.has(task.id))
    const idle = previews.filter((task) => !workingTaskIds.has(task.id))
    return [...running, ...idle]
}

export function sortTaskPreviewsLikeSidebar(
    previews: TaskPreview[],
    options: {
        pinnedTaskIds?: Iterable<string>
        workingTaskIds?: Iterable<string>
    } = {}
): TaskPreview[] {
    const pinnedSet = new Set(options.pinnedTaskIds ?? [])
    const workingSet = new Set(options.workingTaskIds ?? [])

    const openPreviews = previews.filter((task) => !task.closed).sort(compareTaskPreviewsByRecent)
    const pinnedOpen = withRunningFirst(
        openPreviews.filter((task) => pinnedSet.has(task.id)),
        workingSet
    )
    const unpinnedOpen = withRunningFirst(
        openPreviews.filter((task) => !pinnedSet.has(task.id)),
        workingSet
    )
    const closedPreviews = previews.filter((task) => task.closed).sort(compareTaskPreviewsByRecent)
    const pinnedClosed = closedPreviews.filter((task) => pinnedSet.has(task.id))
    const unpinnedClosed = closedPreviews.filter((task) => !pinnedSet.has(task.id))

    return [...pinnedOpen, ...unpinnedOpen, ...pinnedClosed, ...unpinnedClosed]
}
