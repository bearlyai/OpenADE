export type RelativePeriodKey = "today" | "this-week" | "last-week"

export interface RelativePeriodRange {
    key: RelativePeriodKey
    label: string
    start: Date
    end: Date
}

function getStartOfDay(date: Date): Date {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d
}

function getStartOfWeek(date: Date): Date {
    const d = getStartOfDay(date)
    d.setDate(d.getDate() - d.getDay()) // getDay() 0=Sunday
    return d
}

export function getRelativePeriodRanges(now = new Date()): RelativePeriodRange[] {
    const todayStart = getStartOfDay(now)
    const tomorrowStart = new Date(todayStart)
    tomorrowStart.setDate(tomorrowStart.getDate() + 1)

    const thisWeekStart = getStartOfWeek(now)
    const nextWeekStart = new Date(thisWeekStart)
    nextWeekStart.setDate(nextWeekStart.getDate() + 7)

    const lastWeekStart = new Date(thisWeekStart)
    lastWeekStart.setDate(lastWeekStart.getDate() - 7)

    return [
        {
            key: "today",
            label: "Today",
            start: todayStart,
            end: tomorrowStart,
        },
        {
            key: "this-week",
            label: "This Week",
            start: thisWeekStart,
            end: nextWeekStart,
        },
        {
            key: "last-week",
            label: "Last Week",
            start: lastWeekStart,
            end: thisWeekStart,
        },
    ]
}
