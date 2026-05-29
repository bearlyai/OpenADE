import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { RuntimeNodeGitAdapter } from "./git"

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 50 * 1024 * 1024
const MAX_PATCH_BYTES = 512 * 1024

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function str(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string" || !value) throw new Error(`${key} is required`)
    return value
}

function optionalStr(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" && value ? value : undefined
}

function intValue(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

async function git(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
    try {
        const result = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER })
        return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), success: true }
    } catch (error) {
        const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
        return {
            stdout: err.stdout?.toString() ?? "",
            stderr: err.stderr?.toString() ?? err.message ?? "",
            success: false,
        }
    }
}

async function commandExists(command: string, args: string[]): Promise<boolean> {
    try {
        await execFileAsync(command, args, { maxBuffer: 1024 * 1024 })
        return true
    } catch {
        return false
    }
}

async function repoRoot(dir: string): Promise<string | null> {
    const result = await git(["rev-parse", "--show-toplevel"], dir)
    return result.success ? result.stdout.trim() : null
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
    const result = await git(args, cwd)
    if (!result.success) throw new Error(result.stderr || `git ${args.join(" ")} failed`)
    return result.stdout
}

async function defaultBranch(cwd: string): Promise<string> {
    const origin = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd)
    if (origin.success && origin.stdout.trim()) return origin.stdout.trim().replace(/^origin\//, "")
    const main = await git(["rev-parse", "--verify", "main"], cwd)
    if (main.success) return "main"
    const master = await git(["rev-parse", "--verify", "master"], cwd)
    if (master.success) return "master"
    return "main"
}

async function worktreePath(repoDir: string, id: string): Promise<string> {
    const root = (await repoRoot(repoDir)) ?? repoDir
    const worktrees = await listWorkTreesFor(root)
    return worktrees.find((item) => item.id === id || path.basename(item.path) === id)?.path ?? path.join(path.dirname(root), `${path.basename(root)}-${id}`)
}

async function resolveWorkDir(repoDir: string, workTreeId?: string): Promise<string> {
    return workTreeId ? worktreePath(repoDir, workTreeId) : repoDir
}

function parseNumstat(raw: string): { filesChanged: number; insertions: number; deletions: number } {
    let insertions = 0
    let deletions = 0
    let filesChanged = 0
    for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue
        const [added, removed] = line.split(/\s+/)
        filesChanged += 1
        insertions += Number(added) || 0
        deletions += Number(removed) || 0
    }
    return { filesChanged, insertions, deletions }
}

function parseNameStatus(raw: string): Array<{ path: string; status: "added" | "deleted" | "modified" | "renamed"; oldPath?: string }> {
    return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
            const [status, first, second] = line.split(/\t/)
            const kind = status.startsWith("A") ? "added" : status.startsWith("D") ? "deleted" : status.startsWith("R") ? "renamed" : "modified"
            return kind === "renamed" ? { path: second, oldPath: first, status: kind } : { path: first, status: kind }
        })
        .filter((item): item is { path: string; status: "added" | "deleted" | "modified" | "renamed"; oldPath?: string } => Boolean(item.path))
}

async function summary(workDir: string) {
    const branch = (await git(["branch", "--show-current"], workDir)).stdout.trim() || null
    const headCommit = (await git(["rev-parse", "--short", "HEAD"], workDir)).stdout.trim()
    const stagedNameStatus = parseNameStatus(await gitOutput(["diff", "--cached", "--name-status"], workDir))
    const unstagedNameStatus = parseNameStatus(await gitOutput(["diff", "--name-status"], workDir))
    const untracked = (await gitOutput(["ls-files", "--others", "--exclude-standard"], workDir))
        .split(/\r?\n/)
        .filter(Boolean)
        .map((file) => ({ path: file, binary: false, status: "added" as const }))
    const stagedStats = parseNumstat(await gitOutput(["diff", "--cached", "--numstat"], workDir))
    const unstagedStats = parseNumstat(await gitOutput(["diff", "--numstat"], workDir))
    return {
        branch,
        headCommit,
        ahead: null,
        hasChanges: stagedNameStatus.length > 0 || unstagedNameStatus.length > 0 || untracked.length > 0,
        staged: { files: stagedNameStatus.map((file) => ({ ...file, binary: false })), stats: stagedStats },
        unstaged: { files: unstagedNameStatus.map((file) => ({ ...file, binary: false })), stats: unstagedStats },
        untracked,
    }
}

async function listWorkTreesFor(repoDir: string): Promise<Array<{ id: string; path: string; branch: string; head: string }>> {
    const raw = await gitOutput(["worktree", "list", "--porcelain"], repoDir)
    const result: Array<{ id: string; path: string; branch: string; head: string }> = []
    let current: Partial<{ path: string; branch: string; head: string }> = {}
    for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) {
            if (current.path) result.push({ id: path.basename(current.path), path: current.path, branch: current.branch ?? "", head: current.head ?? "" })
            current = {}
            continue
        }
        const [key, ...rest] = line.split(" ")
        const value = rest.join(" ")
        if (key === "worktree") current.path = value
        if (key === "HEAD") current.head = value
        if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "")
    }
    if (current.path) result.push({ id: path.basename(current.path), path: current.path, branch: current.branch ?? "", head: current.head ?? "" })
    return result
}

function maybeTruncate(patch: string, allowTruncation: unknown): string {
    if (allowTruncation === false || Buffer.byteLength(patch) <= MAX_PATCH_BYTES) return patch
    return `${patch.slice(0, MAX_PATCH_BYTES)}\n\n[patch truncated]\n`
}

export function createRuntimeNodeLocalGitAdapter(): RuntimeNodeGitAdapter {
    return {
        async isInstalled() {
            const result = await git(["--version"])
            return { installed: result.success, version: result.success ? result.stdout.trim() : undefined }
        },
        async isDirectory(params) {
            const directory = str(asRecord(params), "directory")
            const root = await repoRoot(directory)
            if (!root) return { isGitDirectory: false, error: "not a git directory" }
            const prefix = await git(["rev-parse", "--show-prefix"], directory)
            return {
                isGitDirectory: true,
                repoRoot: root,
                relativePath: prefix.success ? prefix.stdout.trim().replace(/\/$/, "") : "",
                mainBranch: await defaultBranch(directory),
                hasGhCli: await commandExists("gh", ["--version"]),
            }
        },
        async checkGhCli() {
            return { hasGhCli: await commandExists("gh", ["--version"]) }
        },
        async getOrCreateWorkTree(params) {
            const record = asRecord(params)
            const repoDir = str(record, "repoDir")
            const id = str(record, "id")
            const worktreeDir = await worktreePath(repoDir, id)
            try {
                const stat = await fs.stat(worktreeDir)
                if (stat.isDirectory()) return { worktreeDir, matchingDir: worktreeDir, created: false }
            } catch {
                // Create below.
            }
            await gitOutput(["worktree", "add", "--detach", worktreeDir, optionalStr(record, "sourceTreeish") ?? "HEAD"], repoDir)
            return { worktreeDir, matchingDir: worktreeDir, created: true }
        },
        async getWorkTreeDiffPatch(params) {
            const record = asRecord(params)
            const workDir = await worktreePath(str(record, "repoDir"), str(record, "workTreeId"))
            return { patch: await gitOutput(["diff", str(record, "compareToCommit")], workDir) }
        },
        async getMergeBase(params) {
            const record = asRecord(params)
            const workDir = await worktreePath(str(record, "repoDir"), str(record, "workTreeId"))
            return { mergeBaseCommit: (await gitOutput(["merge-base", "HEAD", str(record, "targetBranch")], workDir)).trim() }
        },
        async getSummary(params) {
            const record = asRecord(params)
            return summary(await resolveWorkDir(str(record, "repoDir"), optionalStr(record, "workTreeId")))
        },
        async getStatus(params) {
            const record = asRecord(params)
            const workDir = await resolveWorkDir(str(record, "repoDir"), optionalStr(record, "workTreeId"))
            const base = await summary(workDir)
            return {
                ...base,
                staged: { ...base.staged, patch: await gitOutput(["diff", "--cached"], workDir) },
                unstaged: { ...base.unstaged, patch: await gitOutput(["diff"], workDir) },
            }
        },
        async listFiles(params) {
            const record = asRecord(params)
            const workDir = await resolveWorkDir(str(record, "repoDir"), optionalStr(record, "workTreeId"))
            const query = optionalStr(record, "query")?.toLowerCase()
            const limit = intValue(record.limit, 500)
            const files = (await gitOutput(["ls-files"], workDir)).split(/\r?\n/).filter(Boolean)
            const filtered = query ? files.filter((file) => file.toLowerCase().includes(query)) : files
            return { files: filtered.slice(0, limit), truncated: filtered.length > limit }
        },
        async deleteWorkTree(params) {
            const record = asRecord(params)
            const worktreeDir = await worktreePath(str(record, "repoDir"), str(record, "id"))
            const result = await git(["worktree", "remove", "--force", worktreeDir], str(record, "repoDir"))
            if (!result.success) await fs.rm(worktreeDir, { recursive: true, force: true })
            return { deleted: true }
        },
        async isBranchMerged(params) {
            const record = asRecord(params)
            const result = await git(["merge-base", "--is-ancestor", str(record, "branchName"), str(record, "targetBranch")], str(record, "repoDir"))
            return { merged: result.success }
        },
        async deleteBranch(params) {
            const record = asRecord(params)
            const result = await git(["branch", "-D", str(record, "branchName")], str(record, "repoDir"))
            return { deleted: result.success, error: result.success ? undefined : result.stderr }
        },
        async listWorkTrees(params) {
            return { worktrees: await listWorkTreesFor(str(asRecord(params), "repoDir")) }
        },
        async commitWorkTree(params) {
            const record = asRecord(params)
            const workDir = await worktreePath(str(record, "repoDir"), str(record, "workTreeId"))
            await gitOutput(["add", "-A"], workDir)
            const status = await gitOutput(["status", "--porcelain"], workDir)
            if (!status.trim()) return { committed: false }
            const result = await git(["commit", "-m", str(record, "message")], workDir)
            if (!result.success) return { committed: false, error: result.stderr }
            return { committed: true, sha: (await gitOutput(["rev-parse", "HEAD"], workDir)).trim() }
        },
        async listBranches(params) {
            const record = asRecord(params)
            const includeRemote = record.includeRemote === true
            const raw = await gitOutput(["branch", includeRemote ? "-a" : "", "--format=%(refname:short)"].filter(Boolean), str(record, "repoDir"))
            const defaultName = await defaultBranch(str(record, "repoDir"))
            return {
                branches: raw.split(/\r?\n/).filter(Boolean).map((name) => ({ name, isDefault: name === defaultName, isRemote: name.startsWith("remotes/") })),
                defaultBranch: defaultName,
            }
        },
        async resolvePath(params) {
            const resolvedPath = path.resolve(str(asRecord(params), "path"))
            const stat = await fs.stat(resolvedPath).catch(() => null)
            return { resolvedPath, exists: Boolean(stat), isDirectory: Boolean(stat?.isDirectory()) }
        },
        async initRepo(params) {
            const directory = str(asRecord(params), "directory")
            await fs.mkdir(directory, { recursive: true })
            const result = await git(["init"], directory)
            return { success: result.success, error: result.success ? undefined : result.stderr }
        },
        async getLog(params) {
            const record = asRecord(params)
            const args = ["log", `--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s`, `--max-count=${intValue(record.limit, 50)}`, `--skip=${intValue(record.skip, 0)}`]
            const ref = optionalStr(record, "ref")
            if (ref) args.push(ref)
            const raw = await gitOutput(args, str(record, "workDir"))
            return {
                commits: raw.split(/\r?\n/).filter(Boolean).map((line) => {
                    const [sha, shortSha, authorName, authorEmail, timestamp, subject] = line.split("\0")
                    return { sha, shortSha, authorName, authorEmail, timestamp: Number(timestamp), subject }
                }),
            }
        },
        async getCommitFiles(params) {
            const record = asRecord(params)
            return { files: parseNameStatus(await gitOutput(["diff-tree", "--no-commit-id", "--name-status", "-r", str(record, "commit")], str(record, "workDir"))) }
        },
        async getChangedFiles(params) {
            const record = asRecord(params)
            return { files: parseNameStatus(await gitOutput(["diff", "--name-status", str(record, "fromTreeish"), str(record, "toTreeish")], str(record, "workDir"))) }
        },
        async getFileAtTreeish(params) {
            const record = asRecord(params)
            const result = await git(["show", `${str(record, "treeish")}:${str(record, "filePath")}`], str(record, "workDir"))
            return { content: result.stdout, exists: result.success, tooLarge: Buffer.byteLength(result.stdout) > MAX_PATCH_BYTES }
        },
        async getFilePair(params) {
            const record = asRecord(params)
            const workDir = str(record, "workDir")
            const oldPath = optionalStr(record, "oldPath") ?? str(record, "filePath")
            const before = await git(["show", `${str(record, "fromTreeish")}:${oldPath}`], workDir)
            const after = await git(["show", `${str(record, "toTreeish")}:${str(record, "filePath")}`], workDir)
            return { before: { content: before.stdout, exists: before.success }, after: { content: after.stdout, exists: after.success } }
        },
        async getWorktreeFilePatch(params) {
            const record = asRecord(params)
            const patch = await gitOutput(["diff", `--unified=${intValue(record.contextLines, 3)}`, str(record, "fromTreeish"), "--", str(record, "filePath")], str(record, "workDir"))
            return { patch: maybeTruncate(patch, record.allowTruncation) }
        },
        async getCommitFilePatch(params) {
            const record = asRecord(params)
            const patch = await gitOutput(["show", "--format=", `--unified=${intValue(record.contextLines, 3)}`, str(record, "commit"), "--", str(record, "filePath")], str(record, "workDir"))
            return { patch: maybeTruncate(patch, record.allowTruncation) }
        },
    }
}
