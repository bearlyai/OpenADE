import { describe, expect, it } from "vitest"
import type { RepoItem, TaskPreview } from "../../persistence/repoStore"
import { buildStatsRecap, buildStatsRecapText } from "./statsRecapUtils"

function task(overrides: Partial<TaskPreview> & Pick<TaskPreview, "id" | "title">): TaskPreview {
    return {
        slug: overrides.id,
        createdAt: "2026-05-01T12:00:00.000Z",
        ...overrides,
    }
}

function repo(id: string, name: string, tasks: TaskPreview[]): RepoItem {
    return {
        id,
        name,
        path: `/tmp/${id}`,
        createdBy: { id: "user", email: "user@example.com" },
        createdAt: "2026-05-01T12:00:00.000Z",
        updatedAt: "2026-05-01T12:00:00.000Z",
        tasks,
    }
}

describe("buildStatsRecap", () => {
    it("groups task activity by repo using lastEventAt before createdAt", () => {
        const repos = [
            repo("openade", "OpenADE", [
                task({
                    id: "older-task-touched-today",
                    title: "Add recap to stats",
                    lastEventAt: "2026-05-19T15:30:00.000Z",
                    lastEvent: {
                        type: "action",
                        status: "completed",
                        sourceType: "do",
                        sourceLabel: "Do",
                        at: "2026-05-19T15:30:00.000Z",
                    },
                    usage: {
                        inputTokens: 100,
                        outputTokens: 50,
                        totalCostUsd: 0.03,
                        eventCount: 2,
                        costByModel: { "gpt-5": 0.03 },
                        durationMs: 60_000,
                    },
                }),
                task({
                    id: "created-today-but-quiet",
                    title: "Do not include stale task",
                    createdAt: "2026-05-19T09:00:00.000Z",
                    lastEventAt: "2026-05-18T23:00:00.000Z",
                }),
            ]),
            repo("api", "API", [
                task({
                    id: "closed-task",
                    title: "Close metrics bug",
                    closed: true,
                    lastEventAt: "2026-05-19T12:00:00.000Z",
                }),
            ]),
        ]

        const recap = buildStatsRecap(repos, {
            label: "Today",
            start: new Date("2026-05-19T00:00:00.000Z"),
            end: new Date("2026-05-20T00:00:00.000Z"),
        })

        expect(recap.taskCount).toBe(2)
        expect(recap.projectCount).toBe(2)
        expect(recap.completedCount).toBe(2)
        expect(recap.totalTokens).toBe(150)
        expect(recap.repos.map((r) => r.repoName)).toEqual(["OpenADE", "API"])
        expect(recap.tasks.map((t) => t.title)).toEqual(["Add recap to stats", "Close metrics bug"])
    })

    it("builds a copyable plain-text recap", () => {
        const recap = buildStatsRecap(
            [
                repo("openade", "OpenADE", [
                    task({
                        id: "task-1",
                        title: "Add recap to stats",
                        lastEventAt: "2026-05-19T15:30:00.000Z",
                        lastEvent: {
                            type: "action",
                            status: "completed",
                            sourceType: "do",
                            sourceLabel: "Do",
                            at: "2026-05-19T15:30:00.000Z",
                        },
                    }),
                ]),
            ],
            {
                label: "Today",
                start: new Date("2026-05-19T00:00:00.000Z"),
                end: new Date("2026-05-20T00:00:00.000Z"),
            }
        )

        expect(buildStatsRecapText(recap)).toContain("Today Recap")
        expect(buildStatsRecapText(recap)).toContain("OpenADE")
        expect(buildStatsRecapText(recap)).toContain("- Add recap to stats (Done)")
    })
})
