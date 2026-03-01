import { describe, expect, it } from "vitest"
import type { CodeEvent, SetupEnvironmentEvent } from "../../types"
import { resolveTaskCopyPath } from "./sidebarPathUtils"

function makeSetupEvent({ id, workingDir }: { id: string; workingDir: string }): SetupEnvironmentEvent {
    return {
        id,
        type: "setup_environment",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.000Z",
        userInput: "setup",
        worktreeId: "worktree-id",
        deviceId: "device-id",
        workingDir,
    }
}

describe("resolveTaskCopyPath", () => {
    it("prefers environmentPath when present", () => {
        const path = resolveTaskCopyPath({
            repoPath: "/repo",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            environmentPath: "/env/worktree/repo",
            events: [makeSetupEvent({ id: "setup-1", workingDir: "/event/worktree/repo" })],
        })

        expect(path).toBe("/env/worktree/repo")
    })

    it("returns repoPath for head tasks", () => {
        const path = resolveTaskCopyPath({
            repoPath: "/repo",
            isolationStrategy: { type: "head" },
            events: [],
        })

        expect(path).toBe("/repo")
    })

    it("returns latest setup_environment workingDir for worktree fallback", () => {
        const events: CodeEvent[] = [
            makeSetupEvent({ id: "setup-1", workingDir: "/tmp/worktree-old/repo" }),
            {
                id: "action-1",
                type: "action",
                status: "completed",
                createdAt: "2026-01-01T01:00:00.000Z",
                completedAt: "2026-01-01T01:00:00.000Z",
                userInput: "Plan",
                execution: { harnessId: "claude-code", executionId: "exec-1", events: [] },
                source: { type: "plan", userLabel: "Plan" },
                includesCommentIds: [],
            },
            makeSetupEvent({ id: "setup-2", workingDir: "/tmp/worktree-new/repo" }),
        ]

        const path = resolveTaskCopyPath({
            repoPath: "/repo",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            events,
        })

        expect(path).toBe("/tmp/worktree-new/repo")
    })

    it("returns null for worktree when environment and setup event are unavailable", () => {
        const path = resolveTaskCopyPath({
            repoPath: "/repo",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            events: [],
        })

        expect(path).toBeNull()
    })
})
