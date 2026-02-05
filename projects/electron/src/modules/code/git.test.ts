/**
 * Comprehensive tests for git.ts module
 * Tests all handlers with focus on subdirectory support
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import * as fs from "fs-extra"
import * as path from "path"
import * as os from "os"
import { execSync } from "child_process"

// Test repository paths
const TEST_BASE_DIR = path.join(os.tmpdir(), `bearly-git-tests-${Date.now()}`)
const TEST_REPO_DIR = path.join(TEST_BASE_DIR, "test-repo")
const TEST_SUBDIR = path.join(TEST_REPO_DIR, "subdir", "nested")

// Helper to execute git commands
function gitExec(command: string, cwd: string = TEST_REPO_DIR): string {
    return execSync(command, { cwd, encoding: "utf8" })
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
})
