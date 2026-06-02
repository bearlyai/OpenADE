import { describe, expect, it } from "vitest"
import type { OpenADETaskPreview } from "../../../../openade-module/src"
import { sortTaskPreviewsLikeSidebar } from "./taskSorting"

function task(id: string, overrides: Partial<OpenADETaskPreview> = {}): OpenADETaskPreview {
    return {
        id,
        slug: id,
        title: id,
        createdAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    }
}

describe("sortTaskPreviewsLikeSidebar", () => {
    it("matches sidebar ordering for pinned, running, open, closed, and recent tasks", () => {
        const previews = [
            task("closed-unpinned-new", {
                closed: true,
                lastEvent: { type: "action", status: "completed", sourceLabel: "Do", at: "2026-01-08T00:00:00.000Z" },
            }),
            task("open-unpinned-old", { lastEvent: { type: "action", status: "completed", sourceLabel: "Do", at: "2026-01-02T00:00:00.000Z" } }),
            task("open-pinned-idle", { lastEvent: { type: "action", status: "completed", sourceLabel: "Do", at: "2026-01-03T00:00:00.000Z" } }),
            task("open-unpinned-running", { lastEvent: { type: "action", status: "in_progress", sourceLabel: "Do", at: "2026-01-01T00:00:00.000Z" } }),
            task("closed-pinned-old", { closed: true, lastEvent: { type: "action", status: "completed", sourceLabel: "Do", at: "2026-01-04T00:00:00.000Z" } }),
            task("open-unpinned-new", { lastEvent: { type: "action", status: "completed", sourceLabel: "Do", at: "2026-01-06T00:00:00.000Z" } }),
        ]

        const sorted = sortTaskPreviewsLikeSidebar(previews, {
            pinnedTaskIds: ["open-pinned-idle", "closed-pinned-old"],
            runningTaskIds: ["open-unpinned-running"],
        })

        expect(sorted.map((preview) => preview.id)).toEqual([
            "open-pinned-idle",
            "open-unpinned-running",
            "open-unpinned-new",
            "open-unpinned-old",
            "closed-pinned-old",
            "closed-unpinned-new",
        ])
    })
})
