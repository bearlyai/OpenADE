import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
    listOpenADEProjectFiles,
    readOpenADEProjectFile,
    resolveOpenADEProjectRelativePath,
    searchOpenADEProject,
    writeOpenADEProjectFile,
} from "./scopedProjectHost"
import type { OpenADEProject } from "./types"

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
    })

    it("keeps reads and writes repo-relative", async () => {
        await writeOpenADEProjectFile({ repoId: repo.id, repo, path: "generated/result.txt", content: "saved", encoding: "utf8", createDirs: true })

        await expect(fsp.readFile(path.join(projectDir, "generated", "result.txt"), "utf8")).resolves.toBe("saved")
        await expect(readOpenADEProjectFile({ repoId: repo.id, repo, path: "generated/result.txt" })).resolves.toMatchObject({
            content: "saved",
            tooLarge: false,
        })

        expect(() => resolveOpenADEProjectRelativePath(repo, "../outside.txt")).toThrow("path is outside the repository")
        await expect(readOpenADEProjectFile({ repoId: repo.id, repo, path: "../outside.txt" })).rejects.toThrow("path is outside the repository")
    })

    it("searches real files while skipping hidden and generated directories", async () => {
        const result = await searchOpenADEProject({ repoId: repo.id, repo, query: "scoped" })
        expect(result.matches.map((match) => match.path).sort()).toEqual(["src/app.ts", "src/upper.ts"])
        expect(result.matches.find((match) => match.path === "src/app.ts")).toMatchObject({ line: 1, matchStart: 15, matchEnd: 21 })

        const exactCase = await searchOpenADEProject({ repoId: repo.id, repo, query: "scoped", caseSensitive: true })
        expect(exactCase.matches.map((match) => match.path)).toEqual(["src/app.ts"])
    })
})
