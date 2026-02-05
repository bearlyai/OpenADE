/**
 * File discovery for procs.toml files
 *
 * Uses git ls-files for speed when available, falls back to filesystem walk.
 * Pure Node.js, no Electron dependencies - extractable to standalone library.
 */

import { spawn } from "child_process"
import * as fs from "fs/promises"
import * as path from "path"

export interface GitInfo {
    repoRoot: string
    isWorktree: boolean
    worktreeRoot?: string
}

/**
 * Run a git command and return stdout
 */
async function runGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn("git", args, { cwd })
        let stdout = ""
        let stderr = ""
        proc.stdout.on("data", (d) => (stdout += d))
        proc.stderr.on("data", (d) => (stderr += d))
        proc.on("error", (err) => reject(err))
        proc.on("close", (code) => {
            if (code === 0) resolve(stdout.trim())
            else reject(new Error(stderr || `git exited with code ${code}`))
        })
    })
}

/**
 * Detect git repository info for a directory
 *
 * @param dir - Directory to check
 * @returns Git info or null if not a git repo
 */
export async function detectGitInfo(dir: string): Promise<GitInfo | null> {
    try {
        const repoRoot = await runGit(["rev-parse", "--show-toplevel"], dir)
        const gitDir = await runGit(["rev-parse", "--git-dir"], dir)

        // Detect worktree by checking if .git is a file (contains gitdir pointer)
        // or if git-dir contains "worktrees"
        const isWorktree = gitDir.includes(".git/worktrees")

        return {
            repoRoot,
            isWorktree,
            worktreeRoot: isWorktree ? repoRoot : undefined,
        }
    } catch {
        return null
    }
}

/**
 * Find all procs.toml files in a directory tree
 *
 * Uses git ls-files when available (fast, respects .gitignore),
 * falls back to filesystem walk. Also checks for untracked files.
 *
 * @param searchRoot - Directory to start searching from
 * @param gitInfo - Git info if available (for faster search)
 * @returns Array of absolute paths to procs.toml files
 */
export async function findProcsFiles(searchRoot: string, gitInfo: GitInfo | null): Promise<string[]> {
    const root = gitInfo?.repoRoot ?? searchRoot

    // Try git ls-files first (fast, respects .gitignore)
    if (gitInfo) {
        try {
            // Get tracked files
            const trackedOutput = await runGit(["ls-files", "**/procs.toml", "procs.toml"], root)

            // Get untracked files (not ignored)
            const untrackedOutput = await runGit(
                ["ls-files", "--others", "--exclude-standard", "**/procs.toml", "procs.toml"],
                root
            )

            const files = new Set<string>()

            if (trackedOutput) {
                for (const f of trackedOutput.split("\n").filter(Boolean)) {
                    files.add(path.join(root, f))
                }
            }

            if (untrackedOutput) {
                for (const f of untrackedOutput.split("\n").filter(Boolean)) {
                    files.add(path.join(root, f))
                }
            }

            return Array.from(files)
        } catch {
            // Fall through to filesystem search
        }
    }

    // Fallback: filesystem walk with sensible ignores
    return walkForProcsFiles(root)
}

const IGNORE_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    "coverage",
    ".turbo",
    ".output",
])

/**
 * Walk filesystem to find procs.toml files
 *
 * @param dir - Directory to walk
 * @param files - Accumulator for found files
 * @param depth - Current depth (for limiting recursion)
 * @returns Array of absolute paths to procs.toml files
 */
async function walkForProcsFiles(dir: string, files: string[] = [], depth = 0): Promise<string[]> {
    // Limit depth to avoid runaway recursion
    if (depth > 10) return files

    try {
        const entries = await fs.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
            if (entry.name === "procs.toml" && entry.isFile()) {
                files.push(path.join(dir, entry.name))
            } else if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
                await walkForProcsFiles(path.join(dir, entry.name), files, depth + 1)
            }
        }
    } catch {
        // Ignore permission errors etc
    }

    return files
}
