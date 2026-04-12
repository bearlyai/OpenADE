import { describe, expect, it } from "vitest"
import { getRelativePeriodRanges } from "./statsPeriodUtils"

function inRange(date: Date, start: Date, end: Date): boolean {
    return date >= start && date < end
}

describe("getRelativePeriodRanges", () => {
    it("returns today, this-week, and last-week in order", () => {
        const now = new Date(2026, 3, 9, 15, 30, 0, 0)
        const periods = getRelativePeriodRanges(now)

        expect(periods.map((p) => p.key)).toEqual(["today", "this-week", "last-week"])
        expect(periods.map((p) => p.label)).toEqual(["Today", "This Week", "Last Week"])
    })

    it("makes last-week end exactly where this-week starts", () => {
        const now = new Date(2026, 3, 9, 15, 30, 0, 0)
        const periods = getRelativePeriodRanges(now)
        const byKey = new Map(periods.map((p) => [p.key, p]))

        const lastWeek = byKey.get("last-week")
        const thisWeek = byKey.get("this-week")
        if (!lastWeek || !thisWeek) throw new Error("Missing required period")

        expect(lastWeek.end.getTime()).toBe(thisWeek.start.getTime())
    })

    it("uses inclusive start and exclusive end boundaries", () => {
        const now = new Date(2026, 3, 9, 15, 30, 0, 0)
        const periods = getRelativePeriodRanges(now)
        const byKey = new Map(periods.map((p) => [p.key, p]))
        const lastWeek = byKey.get("last-week")
        const thisWeek = byKey.get("this-week")
        const today = byKey.get("today")
        if (!lastWeek || !thisWeek || !today) throw new Error("Missing required period")

        const boundary = new Date(thisWeek.start)
        const insideLastWeek = new Date(lastWeek.start)
        insideLastWeek.setDate(insideLastWeek.getDate() + 3)
        const todayMidday = new Date(today.start)
        todayMidday.setHours(12, 0, 0, 0)

        expect(inRange(boundary, lastWeek.start, lastWeek.end)).toBe(false)
        expect(inRange(boundary, thisWeek.start, thisWeek.end)).toBe(true)
        expect(inRange(insideLastWeek, lastWeek.start, lastWeek.end)).toBe(true)
        expect(inRange(todayMidday, lastWeek.start, lastWeek.end)).toBe(false)
    })
})
