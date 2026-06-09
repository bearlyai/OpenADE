import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    fuzzySearchOpenADEProjectFiles,
    listOpenADEProjectFiles,
    readOpenADEProjectFile,
    resolveOpenADETaskWorkDir,
    resolveOpenADEProjectRelativePath,
    searchOpenADEProject,
    writeOpenADEProjectFile,
} from "./scopedProjectHost"
import type { OpenADEProject, OpenADETask } from "./types"

describe("OpenADE scoped project host helpers", () => {
    let projectDir: string
    let repo: OpenADEProject

    beforeEach(async () => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-scoped-project-host-"))
        repo = { id: "repo-1", name: "Repo", path: projectDir, tasks: [] }

        await fsp.mkdir(path.join(projectDir, "src"), { recursive: true })
        await fsp.mkdir(path.join(projectDir, "node_modules", "pkg"), { recursive: true })
        await fsp.mkdir(path.join(projectDir, ".git"), { recursive: true })
        await fsp.mkdir(path.join(projectDir, ".hidden"), { recursive: true })
        await fsp.writeFile(path.join(projectDir, "src", "app.ts"), "const value = 'scoped search'\n")
        await fsp.writeFile(path.join(projectDir, "src", "upper.ts"), "SCOPEd search\n")
        await fsp.writeFile(path.join(projectDir, "node_modules", "pkg", "index.js"), "scoped search\n")
        await fsp.writeFile(path.join(projectDir, ".git", "config"), "scoped search\n")
        await fsp.writeFile(path.join(projectDir, ".hidden", "secret.txt"), "scoped search\n")
        await fsp.writeFile(path.join(projectDir, ".env"), "VISIBLE_WHEN_INCLUDED=1\n")
    })

    afterEach(() => {
        fs.rmSync(projectDir, { recursive: true, force: true })
    })

    it("lists project files with shared hidden and generated directory filtering", async () => {
        const defaultTree = await listOpenADEProjectFiles({ repoId: repo.id, repo, maxDepth: 2 })
        expect(defaultTree.entries.map((entry) => entry.path).sort()).toEqual(["src", "src/app.ts", "src/upper.ts"])

        const hiddenTree = await listOpenADEProjectFiles({ repoId: repo.id, repo, maxDepth: 2, includeHidden: true })
        expect(hiddenTree.entries.map((entry) => entry.path).sort()).toEqual([".env", ".hidden", ".hidden/secret.txt", "src", "src/app.ts", "src/upper.ts"])

        const generatedTree = await listOpenADEProjectFiles({ repoId: repo.id, repo, maxDepth: 2, includeGenerated: true })
        expect(generatedTree.entries.map((entry) => entry.path).sort()).toEqual([
            "node_modules",
            "node_modules/pkg",
            "node_modules/pkg/index.js",
            "src",
            "src/app.ts",
            "src/upper.ts",
        ])
    })

    it("keeps reads and writes scoped-root-relative", async () => {
        await writeOpenADEProjectFile({ repoId: repo.id, repo, path: "generated/result.txt", content: "saved", encoding: "utf8", createDirs: true })

        await expect(fsp.readFile(path.join(projectDir, "generated", "result.txt"), "utf8")).resolves.toBe("saved")
        await expect(readOpenADEProjectFile({ repoId: repo.id, repo, path: "generated/result.txt" })).resolves.toMatchObject({
            content: "saved",
            tooLarge: false,
            isReadable: true,
            isBinary: false,
        })

        expect(() => resolveOpenADEProjectRelativePath(repo, "../outside.txt")).toThrow("path is outside the repository")
        await expect(readOpenADEProjectFile({ repoId: repo.id, repo, path: "../outside.txt" })).rejects.toThrow("path is outside the repository")
    })

    it("fuzzy-searches real scoped file paths", async () => {
        const root = await fuzzySearchOpenADEProjectFiles({ repoId: repo.id, repo, query: "", limit: 5 })
        expect(root.treeMatch).toEqual({
            path: "",
            children: [{ name: "src", isDir: true, fullPath: "src" }],
        })

        const result = await fuzzySearchOpenADEProjectFiles({ repoId: repo.id, repo, query: "upper", limit: 5 })
        expect(result.results).toEqual(["src/upper.ts"])

        const dirs = await fuzzySearchOpenADEProjectFiles({ repoId: repo.id, repo, query: "src", matchDirs: true, limit: 5 })
        expect(dirs.results).toContain("src")
        expect(dirs.treeMatch).toEqual({
            path: "src",
            children: [
                { name: "app.ts", isDir: false, fullPath: "src/app.ts" },
                { name: "upper.ts", isDir: false, fullPath: "src/upper.ts" },
            ],
        })
    })

    it("reuses scoped fuzzy search path walks and invalidates them after scoped writes", async () => {
        const readdirSpy = vi.spyOn(fsp, "readdir")
        const originalPath = process.env.PATH
        process.env.PATH = ""
        try {
            await expect(fuzzySearchOpenADEProjectFiles({ repoId: repo.id, repo, query: "app", limit: 5 })).resolves.toMatchObject({
                results: ["src/app.ts"],
            })
            const callsAfterFirstSearch = readdirSpy.mock.calls.length

            await expect(fuzzySearchOpenADEProjectFiles({ repoId: repo.id, repo, query: "upper", limit: 5 })).resolves.toMatchObject({
                results: ["src/upper.ts"],
            })
            expect(readdirSpy.mock.calls.length).toBe(callsAfterFirstSearch)

            await writeOpenADEProjectFile({ repoId: repo.id, repo, path: "src/generated.ts", content: "generated", encoding: "utf8", createDirs: true })
            await expect(fuzzySearchOpenADEProjectFiles({ repoId: repo.id, repo, query: "generated", limit: 5 })).resolves.toMatchObject({
                results: ["src/generated.ts"],
            })
            expect(readdirSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstSearch)
        } finally {
            process.env.PATH = originalPath
            readdirSpy.mockRestore()
        }
    })

    it("searches real files while skipping hidden and generated directories", async () => {
        const result = await searchOpenADEProject({ repoId: repo.id, repo, query: "scoped" })
        expect(result.matches.map((match) => match.path).sort()).toEqual(["src/app.ts", "src/upper.ts"])
        expect(result.matches.find((match) => match.path === "src/app.ts")).toMatchObject({ line: 1, matchStart: 15, matchEnd: 21 })

        const exactCase = await searchOpenADEProject({ repoId: repo.id, repo, query: "scoped", caseSensitive: true })
        expect(exactCase.matches.map((match) => match.path)).toEqual(["src/app.ts"])
    })

    it("resolves optional task scopes to the task worktree root", async () => {
        const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-scoped-project-worktree-"))
        const task: OpenADETask = {
            id: "task-1",
            repoId: repo.id,
            slug: "task",
            title: "Task",
            description: "",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            deviceEnvironments: [
                {
                    id: "env-1",
                    deviceId: "device-1",
                    worktreeDir,
                    setupComplete: true,
                    createdAt: "2026-06-01T00:00:00.000Z",
                    lastUsedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
            events: [],
            comments: [],
        }
        await fsp.mkdir(path.join(worktreeDir, "src"), { recursive: true })
        await fsp.writeFile(path.join(worktreeDir, "src", "task-only.ts"), "task scoped search\n")

        await expect(resolveOpenADETaskWorkDir(repo, task)).resolves.toBe(worktreeDir)
        const taskTree = await listOpenADEProjectFiles({ repoId: repo.id, taskId: task.id, repo, task, maxDepth: 2 })
        expect(taskTree.taskId).toBe(task.id)
        expect(taskTree.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: "src/task-only.ts", name: "task-only.ts", type: "file", size: "task scoped search\n".length }),
            ])
        )
        await expect(searchOpenADEProject({ repoId: repo.id, taskId: task.id, repo, task, query: "task scoped" })).resolves.toMatchObject({
            taskId: task.id,
            matches: [expect.objectContaining({ path: "src/task-only.ts" })],
        })

        fs.rmSync(worktreeDir, { recursive: true, force: true })
    })
})
