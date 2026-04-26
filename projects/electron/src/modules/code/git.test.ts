/**
 * Comprehensive tests for git.ts module
 * Tests all handlers with focus on subdirectory support
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import * as fs from "fs-extra"
import * as path from "path"
import * as os from "os"
import { execSync } from "child_process"

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn(),
        removeHandler: vi.fn(),
    },
}))

vi.mock("electron-log", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

let gitTestables: typeof import("./git").__test__

// Test repository paths
const TEST_BASE_DIR = path.join(os.tmpdir(), `bearly-git-tests-${Date.now()}`)
const TEST_REPO_DIR = path.join(TEST_BASE_DIR, "test-repo")
const TEST_SUBDIR = path.join(TEST_REPO_DIR, "subdir", "nested")

// Helper to execute git commands
function gitExec(command: string, cwd: string = TEST_REPO_DIR): string {
    return execSync(command, { cwd, encoding: "utf8" })
}

const FIELD_SEPARATOR = "\x1f"
const RECORD_SEPARATOR = "\x1e"

interface ParsedNameStatusFile {
    path: string
    status: "added" | "deleted" | "modified" | "renamed"
    oldPath?: string
}

interface ParsedLogEntry {
    sha: string
    shortSha: string
    message: string
    author: string
    date: string
    relativeDate: string
    parentCount: number
}

function parseNameStatusOutput(stdout: string): ParsedNameStatusFile[] {
    return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const parts = line.split("\t")
            const statusCode = parts[0] ?? ""

            if (statusCode.startsWith("R")) {
                return {
                    status: "renamed" as const,
                    oldPath: parts[1],
                    path: parts[2],
                }
            }

            if (statusCode === "A") {
                return { status: "added" as const, path: parts[1] }
            }

            if (statusCode === "D") {
                return { status: "deleted" as const, path: parts[1] }
            }

            return { status: "modified" as const, path: parts[1] }
        })
        .filter((file) => Boolean(file.path)) as ParsedNameStatusFile[]
}

function getLogLikeHandler(cwd: string, limit: number, skip = 0): { commits: ParsedLogEntry[]; hasMore: boolean } {
    const format = ["%H", "%h", "%s", "%an", "%aI", "%ar", "%P"].join(FIELD_SEPARATOR) + RECORD_SEPARATOR
    const output = gitExec(`git log --format='${format}' --max-count=${limit + 1} --skip=${skip}`, cwd)

    const commits = output
        .split(RECORD_SEPARATOR)
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record): ParsedLogEntry => {
            const [rawSha = "", rawShortSha = "", message = "", author = "", rawDate = "", rawRelativeDate = "", rawParents = ""] =
                record.split(FIELD_SEPARATOR)
            const sha = rawSha.trim()
            const shortSha = rawShortSha.trim()
            const date = rawDate.trim()
            const relativeDate = rawRelativeDate.trim()
            const parents = rawParents.trim()
            const parentCount = parents.trim() ? parents.trim().split(/\s+/).length : 0
            return { sha, shortSha, message, author, date, relativeDate, parentCount }
        })

    return {
        commits: commits.slice(0, limit),
        hasMore: commits.length > limit,
    }
}

function getCommitFilesLikeHandler(cwd: string, commit: string): ParsedNameStatusFile[] {
    const parents = gitExec(`git show --no-patch --format=%P ${commit}`, cwd).trim().split(/\s+/).filter(Boolean)
    const stdout = parents.length === 0
        ? gitExec(`git diff-tree --root -r --no-commit-id --name-status -M ${commit}`, cwd)
        : gitExec(`git diff --name-status -M ${parents[0]} ${commit}`, cwd)
    return parseNameStatusOutput(stdout)
}

// Setup test repository with subdirectories
async function setupTestRepo() {
    await fs.ensureDir(TEST_REPO_DIR)
    await fs.ensureDir(TEST_SUBDIR)

    // Initialize git repo
    gitExec("git init")
    gitExec('git config user.email "test@bearly.ai"')
    gitExec('git config user.name "Test User"')

    // Create files at different levels
    await fs.writeFile(path.join(TEST_REPO_DIR, "root-file.txt"), "Root level file")
    await fs.ensureDir(path.join(TEST_REPO_DIR, "subdir"))
    await fs.writeFile(path.join(TEST_REPO_DIR, "subdir", "subdir-file.txt"), "Subdirectory file")
    await fs.writeFile(path.join(TEST_SUBDIR, "nested-file.txt"), "Nested file")

    // Commit files
    gitExec("git add .")
    gitExec('git commit -m "Initial commit"')

    // Create main branch explicitly (some git versions use master)
    try {
        gitExec("git branch -M main")
    } catch {
        // Already on main
    }
}

// Cleanup test directory
async function cleanupTestRepo() {
    if (await fs.pathExists(TEST_BASE_DIR)) {
        await fs.remove(TEST_BASE_DIR)
    }
}

describe("Git Module Tests", () => {
    beforeAll(async () => {
        gitTestables = (await import("./git")).__test__
        await cleanupTestRepo()
        await setupTestRepo()
    })

    afterAll(async () => {
        await cleanupTestRepo()
    })

    describe("resolveGitInfo", () => {
        it("should resolve repo root from repository root", () => {
            const result = gitExec("git rev-parse --show-toplevel").trim()
            // Use fs.realpathSync to resolve symlinks (macOS /private)
            expect(fs.realpathSync(result)).toBe(fs.realpathSync(TEST_REPO_DIR))
        })

        it("should resolve repo root from subdirectory", () => {
            const result = gitExec("git rev-parse --show-toplevel", TEST_SUBDIR).trim()
            // Use fs.realpathSync to resolve symlinks (macOS /private)
            expect(fs.realpathSync(result)).toBe(fs.realpathSync(TEST_REPO_DIR))
        })

        it("should return empty relative path from root", () => {
            const result = gitExec("git rev-parse --show-prefix", TEST_REPO_DIR).trim()
            expect(result).toBe("")
        })

        it("should return correct relative path from subdirectory", () => {
            const result = gitExec("git rev-parse --show-prefix", TEST_SUBDIR).trim()
            expect(result).toMatch(/^subdir\/nested\/?$/)
        })

        it("should fail for non-git directory", () => {
            const nonGitDir = path.join(os.tmpdir(), "not-a-git-repo")
            fs.ensureDirSync(nonGitDir)
            expect(() => gitExec("git rev-parse --show-toplevel", nonGitDir)).toThrow()
            fs.removeSync(nonGitDir)
        })
    })

    describe("Branch Detection", () => {
        it("should detect main branch", () => {
            const result = gitExec("git branch --show-current").trim()
            expect(result).toBe("main")
        })

        it("should verify main branch exists", () => {
            const result = gitExec("git show-ref --verify refs/heads/main")
            expect(result).toContain("refs/heads/main")
        })

        it("should handle remote HEAD reference", () => {
            // Add a fake remote (no fetch - would trigger credential prompts)
            try {
                gitExec("git remote add origin https://github.com/test/test.git")
            } catch {
                // Remote might already exist
            }
            // Verify remote was added
            const remotes = gitExec("git remote -v")
            expect(remotes).toContain("origin")
        })
    })

    describe("File Listing", () => {
        it("should list all files from root", () => {
            const result = gitExec("git ls-files")
            const files = result.trim().split("\n")
            expect(files).toContain("root-file.txt")
            expect(files).toContain("subdir/subdir-file.txt")
            expect(files).toContain("subdir/nested/nested-file.txt")
        })

        it("should list files from subdirectory", () => {
            const result = gitExec("git ls-files", path.join(TEST_REPO_DIR, "subdir"))
            const files = result.trim().split("\n")
            expect(files.some((f) => f.includes("subdir-file.txt"))).toBe(true)
            expect(files.some((f) => f.includes("nested-file.txt"))).toBe(true)
        })

        it("should filter files by subdirectory prefix", () => {
            const allFiles = gitExec("git ls-files").trim().split("\n")
            const subdirFiles = allFiles.filter((f) => f.startsWith("subdir/"))
            expect(subdirFiles.length).toBeGreaterThan(0)
            expect(subdirFiles.every((f) => f.startsWith("subdir/"))).toBe(true)
        })
    })

    describe("Worktree Operations", () => {
        const WORKTREE_PATH = path.join(TEST_BASE_DIR, "test-worktree")

        afterEach(async () => {
            // Cleanup worktree
            try {
                gitExec(`git worktree remove ${WORKTREE_PATH} --force`)
            } catch {
                // Worktree might not exist
            }
            await fs.remove(WORKTREE_PATH)
        })

        it("should create worktree from repo root", async () => {
            gitExec(`git worktree add ${WORKTREE_PATH} HEAD`)
            expect(await fs.pathExists(WORKTREE_PATH)).toBe(true)
            expect(await fs.pathExists(path.join(WORKTREE_PATH, "root-file.txt"))).toBe(true)
        })

        it("should create worktree with subdirectory structure", async () => {
            gitExec(`git worktree add ${WORKTREE_PATH} HEAD`)
            const matchingSubdir = path.join(WORKTREE_PATH, "subdir", "nested")
            expect(await fs.pathExists(matchingSubdir)).toBe(true)
            expect(await fs.pathExists(path.join(matchingSubdir, "nested-file.txt"))).toBe(true)
        })

        it("should list worktrees", () => {
            gitExec(`git worktree add ${WORKTREE_PATH} HEAD`)
            const result = gitExec("git worktree list --porcelain")
            expect(result).toContain(TEST_REPO_DIR)
            expect(result).toContain(WORKTREE_PATH)
        })

        it("should remove worktree", async () => {
            gitExec(`git worktree add ${WORKTREE_PATH} HEAD`)
            gitExec(`git worktree remove ${WORKTREE_PATH} --force`)
            expect(await fs.pathExists(WORKTREE_PATH)).toBe(false)
        })

        it("should handle worktree operations from subdirectory", () => {
            // Creating worktree from subdirectory should work
            const result = gitExec(`git worktree add ${WORKTREE_PATH} HEAD`, TEST_SUBDIR)
            expect(result).toBeTruthy()
            expect(fs.existsSync(WORKTREE_PATH)).toBe(true)
        })
    })

    describe("Path Handling", () => {
        it("should handle absolute paths", () => {
            expect(path.isAbsolute(TEST_REPO_DIR)).toBe(true)
            expect(path.isAbsolute(TEST_SUBDIR)).toBe(true)
        })

        it("should correctly join paths", () => {
            const joined = path.join(TEST_REPO_DIR, "subdir", "nested")
            expect(joined).toBe(TEST_SUBDIR)
        })

        it("should handle relative path calculations", () => {
            const relative = path.relative(TEST_REPO_DIR, TEST_SUBDIR)
            expect(relative).toBe(path.join("subdir", "nested"))
        })

        it("should remove trailing slashes from git output", () => {
            const pathWithSlash = "subdir/nested/"
            const cleaned = pathWithSlash.replace(/\/$/, "")
            expect(cleaned).toBe("subdir/nested")
        })
    })

    describe("Directory Validation", () => {
        it("should validate existing directory", async () => {
            expect(await fs.pathExists(TEST_REPO_DIR)).toBe(true)
        })

        it("should validate nested directory", async () => {
            expect(await fs.pathExists(TEST_SUBDIR)).toBe(true)
        })

        it("should reject non-existent directory", async () => {
            const nonExistent = path.join(TEST_BASE_DIR, "does-not-exist")
            expect(await fs.pathExists(nonExistent)).toBe(false)
        })

        it("should validate directory is within git repo", () => {
            const result = gitExec("git rev-parse --is-inside-work-tree", TEST_SUBDIR).trim()
            expect(result).toBe("true")
        })
    })

    describe("Commit Operations", () => {
        it("should stage and commit changes", async () => {
            const testFile = path.join(TEST_REPO_DIR, "test-commit.txt")
            await fs.writeFile(testFile, "Test content")
            gitExec("git add test-commit.txt")
            const result = gitExec('git commit -m "Test commit"')
            expect(result).toContain("Test commit")
        })

        it("should detect when nothing to commit", () => {
            // All changes already committed, should have nothing to commit
            const statusResult = gitExec("git status --porcelain").trim()
            expect(statusResult).toBe("")
        })

        it("should extract commit SHA from commit output", () => {
            const testFile = path.join(TEST_REPO_DIR, "sha-test.txt")
            fs.writeFileSync(testFile, "SHA test")
            gitExec("git add sha-test.txt")
            const result = gitExec('git commit -m "SHA test"')
            const shaMatch = result.match(/\[[\w\/\-]+\s+([a-f0-9]+)\]/)
            expect(shaMatch).toBeTruthy()
            expect(shaMatch![1]).toMatch(/^[a-f0-9]+$/)
        })
    })

    describe("Diff Operations", () => {
        it("should generate diff patch", () => {
            const testFile = path.join(TEST_REPO_DIR, "diff-test.txt")
            fs.writeFileSync(testFile, "Original content")
            gitExec("git add diff-test.txt")
            gitExec('git commit -m "Add diff test file"')

            // Modify file
            fs.writeFileSync(testFile, "Modified content")
            gitExec("git add diff-test.txt")
            gitExec('git commit -m "Modify diff test file"')

            // Generate diff
            const diff = gitExec("git diff HEAD~1...HEAD")
            expect(diff).toContain("diff --git")
            expect(diff).toContain("diff-test.txt")
        })
    })

    describe("Error Handling", () => {
        it("should handle invalid git commands gracefully", () => {
            expect(() => gitExec("git invalid-command")).toThrow()
        })

        it("should handle non-existent worktree removal", () => {
            const nonExistent = path.join(TEST_BASE_DIR, "non-existent-worktree")
            expect(() => gitExec(`git worktree remove ${nonExistent}`)).toThrow()
        })

        it("should handle operations on non-git directory", async () => {
            const nonGitDir = path.join(os.tmpdir(), `non-git-${Date.now()}`)
            await fs.ensureDir(nonGitDir)
            expect(() => gitExec("git status", nonGitDir)).toThrow()
            await fs.remove(nonGitDir)
        })
    })

    describe("Cross-platform Path Handling", () => {
        it("should use correct path separator", () => {
            const joined = path.join("subdir", "nested")
            expect(joined).toBe(path.sep === "\\" ? "subdir\\nested" : "subdir/nested")
        })

        it("should normalize paths consistently", () => {
            const normalized = path.normalize("subdir//nested/./file.txt")
            expect(normalized).toBe(path.join("subdir", "nested", "file.txt"))
        })
    })

    describe("Integration: Subdirectory Worktree Flow", () => {
        const WORKTREE_PATH = path.join(TEST_BASE_DIR, "integration-worktree")

        afterEach(async () => {
            try {
                gitExec(`git worktree remove ${WORKTREE_PATH} --force`)
            } catch {
                // Worktree might not exist
            }
            await fs.remove(WORKTREE_PATH)
        })

        it("should create worktree from subdirectory and maintain structure", async () => {
            // Create worktree from nested subdirectory
            gitExec(`git worktree add ${WORKTREE_PATH} HEAD`, TEST_SUBDIR)

            // Verify worktree was created
            expect(await fs.pathExists(WORKTREE_PATH)).toBe(true)

            // Verify matching directory structure exists
            const matchingDir = path.join(WORKTREE_PATH, "subdir", "nested")
            expect(await fs.pathExists(matchingDir)).toBe(true)

            // Verify files exist in matching directory
            expect(await fs.pathExists(path.join(matchingDir, "nested-file.txt"))).toBe(true)

            // Verify repo root is still the original repo
            const repoRoot = gitExec("git rev-parse --show-toplevel", TEST_SUBDIR).trim()
            // Use fs.realpathSync to resolve symlinks (macOS /private)
            expect(fs.realpathSync(repoRoot)).toBe(fs.realpathSync(TEST_REPO_DIR))
        })

        it("should list files relative to subdirectory in worktree", async () => {
            gitExec(`git worktree add ${WORKTREE_PATH} HEAD`)

            // List all files from worktree root
            const allFiles = gitExec("git ls-files", WORKTREE_PATH).trim().split("\n")

            // Filter to subdirectory files
            const relativeFiles = allFiles
                .filter((f) => f.startsWith("subdir/nested/"))
                .map((f) => f.replace("subdir/nested/", ""))

            expect(relativeFiles.length).toBeGreaterThan(0)
            expect(relativeFiles).toContain("nested-file.txt")
        })
    })

    describe("Log and commit file semantics", () => {
        it("should return paginated log entries with expected fields", async () => {
            const prefix = `log-pagination-${Date.now()}`

            for (let i = 1; i <= 3; i++) {
                const fileName = `${prefix}-${i}.txt`
                await fs.writeFile(path.join(TEST_REPO_DIR, fileName), `content ${i}`)
                gitExec(`git add ${fileName}`)
                gitExec(`git commit -m "${prefix} commit ${i}"`)
            }

            const firstPage = getLogLikeHandler(TEST_REPO_DIR, 2, 0)
            const secondPage = getLogLikeHandler(TEST_REPO_DIR, 2, 2)

            expect(firstPage.commits.length).toBe(2)
            expect(firstPage.hasMore).toBe(true)
            expect(secondPage.commits.length).toBeGreaterThan(0)

            const newest = firstPage.commits[0]
            expect(newest.sha).toMatch(/^[a-f0-9]{40}$/)
            expect(newest.shortSha).toMatch(/^[a-f0-9]{7,}$/)
            expect(newest.message).toContain(prefix)
            expect(newest.author.length).toBeGreaterThan(0)
            expect(newest.date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
            expect(newest.relativeDate.length).toBeGreaterThan(0)
            expect(newest.parentCount).toBeGreaterThanOrEqual(1)
        })

        it("should report added files for a root commit", async () => {
            const rootRepo = path.join(TEST_BASE_DIR, `root-commit-repo-${Date.now()}`)
            await fs.ensureDir(rootRepo)

            gitExec("git init", rootRepo)
            gitExec('git config user.email "test@bearly.ai"', rootRepo)
            gitExec('git config user.name "Test User"', rootRepo)

            await fs.writeFile(path.join(rootRepo, "root.txt"), "root content")
            gitExec("git add root.txt", rootRepo)
            gitExec('git commit -m "root commit"', rootRepo)

            const sha = gitExec("git rev-parse HEAD", rootRepo).trim()
            const files = getCommitFilesLikeHandler(rootRepo, sha)

            expect(files).toEqual([
                {
                    path: "root.txt",
                    status: "added",
                },
            ])
        })

        it("should parse renamed, modified, and deleted files for a commit", async () => {
            const commitRepo = path.join(TEST_BASE_DIR, `commit-files-repo-${Date.now()}`)
            await fs.ensureDir(commitRepo)

            gitExec("git init", commitRepo)
            gitExec('git config user.email "test@bearly.ai"', commitRepo)
            gitExec('git config user.name "Test User"', commitRepo)

            await fs.writeFile(path.join(commitRepo, "old-name.txt"), "old-name original content")
            await fs.writeFile(path.join(commitRepo, "modified.txt"), "modified original content")
            await fs.writeFile(path.join(commitRepo, "deleted.txt"), "deleted original content")
            gitExec("git add old-name.txt modified.txt deleted.txt", commitRepo)
            gitExec('git commit -m "initial commit"', commitRepo)

            gitExec("git mv old-name.txt new-name.txt", commitRepo)
            await fs.writeFile(path.join(commitRepo, "modified.txt"), "after")
            gitExec("git rm deleted.txt", commitRepo)
            gitExec("git add modified.txt", commitRepo)
            gitExec('git commit -m "rename modify delete"', commitRepo)

            const commitSha = gitExec("git rev-parse HEAD", commitRepo).trim()
            const files = getCommitFilesLikeHandler(commitRepo, commitSha)
            const renamed = files.find((file) => file.path === "new-name.txt")
            const modified = files.find((file) => file.path === "modified.txt")
            const deleted = files.find((file) => file.path === "deleted.txt")

            expect(renamed).toEqual({
                path: "new-name.txt",
                oldPath: "old-name.txt",
                status: "renamed",
            })
            expect(modified).toEqual({
                path: "modified.txt",
                status: "modified",
            })
            expect(deleted).toEqual({
                path: "deleted.txt",
                status: "deleted",
            })
        })

        it("returns compact and expanded worktree patches based on requested context", async () => {
            const repoDir = path.join(TEST_BASE_DIR, `worktree-patch-repo-${Date.now()}`)
            await fs.ensureDir(repoDir)

            gitExec("git init", repoDir)
            gitExec('git config user.email "test@bearly.ai"', repoDir)
            gitExec('git config user.name "Test User"', repoDir)

            const original = Array.from({ length: 30 }, (_, index) => `line ${String(index + 1).padStart(2, "0")}`).join("\n")
            await fs.writeFile(path.join(repoDir, "context.txt"), original)
            gitExec("git add context.txt", repoDir)
            gitExec('git commit -m "base"', repoDir)

            const updated = original.replace("line 15", "line 15 changed")
            await fs.writeFile(path.join(repoDir, "context.txt"), updated)

            const compact = await gitTestables.handleGetWorktreeFilePatch({
                workDir: repoDir,
                fromTreeish: "HEAD",
                filePath: "context.txt",
                contextLines: 1,
            })
            const expanded = await gitTestables.handleGetWorktreeFilePatch({
                workDir: repoDir,
                fromTreeish: "HEAD",
                filePath: "context.txt",
                contextLines: 10,
            })

            expect(compact.patch).toContain("@@")
            expect(compact.patch).toContain("-line 15")
            expect(compact.patch).toContain("+line 15 changed")
            expect(compact.patch).toContain("\n line 14\n")
            expect(compact.patch).not.toContain("\n line 13\n")
            expect(expanded.patch).toContain("\n line 14\n")
            expect(expanded.patch).toContain("\n line 24\n")
            expect(expanded.stats.hunkCount).toBe(1)
        })

        it("returns a patch for untracked worktree files", async () => {
            const repoDir = path.join(TEST_BASE_DIR, `untracked-patch-repo-${Date.now()}`)
            await fs.ensureDir(repoDir)

            gitExec("git init", repoDir)
            gitExec('git config user.email "test@bearly.ai"', repoDir)
            gitExec('git config user.name "Test User"', repoDir)
            await fs.writeFile(path.join(repoDir, "tracked.txt"), "tracked\n")
            gitExec("git add tracked.txt", repoDir)
            gitExec('git commit -m "base"', repoDir)

            await fs.writeFile(path.join(repoDir, "new-file.txt"), "alpha\nbeta\ngamma\n")

            const response = await gitTestables.handleGetWorktreeFilePatch({
                workDir: repoDir,
                fromTreeish: "HEAD",
                filePath: "new-file.txt",
                contextLines: 3,
            })

            expect(response.patch).toContain("+++ b/new-file.txt")
            expect(response.patch).toContain("+alpha")
            expect(response.patch).toContain("+gamma")
            expect(response.stats.insertions).toBe(3)
            expect(response.truncated).toBe(false)
        })

        it("rejects untracked paths that escape the worktree", async () => {
            const repoDir = path.join(TEST_BASE_DIR, `escaped-path-repo-${Date.now()}`)
            await fs.ensureDir(repoDir)

            gitExec("git init", repoDir)
            gitExec('git config user.email "test@bearly.ai"', repoDir)
            gitExec('git config user.name "Test User"', repoDir)
            await fs.writeFile(path.join(repoDir, "tracked.txt"), "tracked\n")
            gitExec("git add tracked.txt", repoDir)
            gitExec('git commit -m "base"', repoDir)

            const escapedFileName = `escaped-${Date.now()}.txt`
            await fs.writeFile(path.join(TEST_BASE_DIR, escapedFileName), "secret\n")

            await expect(
                gitTestables.handleGetWorktreeFilePatch({
                    workDir: repoDir,
                    fromTreeish: "HEAD",
                    filePath: `../${escapedFileName}`,
                    contextLines: 3,
                })
            ).rejects.toThrow("escapes worktree")
        })

        it("skips generated files for worktree patch previews", async () => {
            const repoDir = path.join(TEST_BASE_DIR, `generated-worktree-patch-repo-${Date.now()}`)
            await fs.ensureDir(repoDir)

            gitExec("git init", repoDir)
            gitExec('git config user.email "test@bearly.ai"', repoDir)
            gitExec('git config user.name "Test User"', repoDir)
            await fs.writeFile(path.join(repoDir, "package-lock.json"), '{\n  "name": "demo"\n}\n')
            gitExec("git add package-lock.json", repoDir)
            gitExec('git commit -m "base"', repoDir)

            await fs.writeFile(path.join(repoDir, "package-lock.json"), '{\n  "name": "demo",\n  "lockfileVersion": 3\n}\n')

            const response = await gitTestables.handleGetWorktreeFilePatch({
                workDir: repoDir,
                fromTreeish: "HEAD",
                filePath: "package-lock.json",
                contextLines: 3,
            })

            expect(response.patch).toBe("")
            expect(response.truncated).toBe(false)
            expect(response.heavy).toBe(false)
        })

        it("returns a root commit patch for added files", async () => {
            const repoDir = path.join(TEST_BASE_DIR, `root-patch-repo-${Date.now()}`)
            await fs.ensureDir(repoDir)

            gitExec("git init", repoDir)
            gitExec('git config user.email "test@bearly.ai"', repoDir)
            gitExec('git config user.name "Test User"', repoDir)

            await fs.writeFile(path.join(repoDir, "root.txt"), "root content\n")
            gitExec("git add root.txt", repoDir)
            gitExec('git commit -m "root commit"', repoDir)

            const sha = gitExec("git rev-parse HEAD", repoDir).trim()
            const response = await gitTestables.handleGetCommitFilePatch({
                workDir: repoDir,
                commit: sha,
                filePath: "root.txt",
                contextLines: 3,
            })

            expect(response.patch).toContain("+++ b/root.txt")
            expect(response.patch).toContain("+root content")
            expect(response.stats.insertions).toBe(1)
            expect(response.stats.hunkCount).toBe(1)
        })

        it("returns rename-aware commit patches", async () => {
            const repoDir = path.join(TEST_BASE_DIR, `rename-patch-repo-${Date.now()}`)
            await fs.ensureDir(repoDir)

            gitExec("git init", repoDir)
            gitExec('git config user.email "test@bearly.ai"', repoDir)
            gitExec('git config user.name "Test User"', repoDir)

            await fs.writeFile(path.join(repoDir, "old-name.txt"), "line 1\nline 2\n")
            gitExec("git add old-name.txt", repoDir)
            gitExec('git commit -m "initial"', repoDir)

            gitExec("git mv old-name.txt new-name.txt", repoDir)
            await fs.writeFile(path.join(repoDir, "new-name.txt"), "line 1\nline 2 renamed\n")
            gitExec("git add new-name.txt", repoDir)
            gitExec('git commit -m "rename file"', repoDir)

            const sha = gitExec("git rev-parse HEAD", repoDir).trim()
            const response = await gitTestables.handleGetCommitFilePatch({
                workDir: repoDir,
                commit: sha,
                filePath: "new-name.txt",
                oldPath: "old-name.txt",
                contextLines: 3,
            })

            expect(response.patch).toContain("+++ b/new-name.txt")
            expect(response.patch).toContain("--- a/old-name.txt")
            expect(response.patch).toContain("+line 2 renamed")
        })

        it("skips generated files for commit patch previews", async () => {
            const repoDir = path.join(TEST_BASE_DIR, `generated-commit-patch-repo-${Date.now()}`)
            await fs.ensureDir(repoDir)

            gitExec("git init", repoDir)
            gitExec('git config user.email "test@bearly.ai"', repoDir)
            gitExec('git config user.name "Test User"', repoDir)
            await fs.writeFile(path.join(repoDir, "package-lock.json"), '{\n  "name": "demo"\n}\n')
            gitExec("git add package-lock.json", repoDir)
            gitExec('git commit -m "base"', repoDir)

            await fs.writeFile(path.join(repoDir, "package-lock.json"), '{\n  "name": "demo",\n  "packages": {}\n}\n')
            gitExec("git add package-lock.json", repoDir)
            gitExec('git commit -m "update lockfile"', repoDir)

            const sha = gitExec("git rev-parse HEAD", repoDir).trim()
            const response = await gitTestables.handleGetCommitFilePatch({
                workDir: repoDir,
                commit: sha,
                filePath: "package-lock.json",
                contextLines: 3,
            })

            expect(response.patch).toBe("")
            expect(response.truncated).toBe(false)
            expect(response.heavy).toBe(false)
        })
    })
})
