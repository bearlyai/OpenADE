import os from "node:os"
import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { openADETaskIdForClientRequest } from "./clientRequestIds"
import {
    buildOpenADEHyperPlanStepPrompt,
    buildOpenADEReconcileStepPrompt,
    buildOpenADEReviewStepPrompt,
    buildOpenADEReviseStepPrompt,
    extractOpenADEPlanText,
    groupOpenADEHyperPlanByDepth,
    isStandardOpenADEHyperPlanStrategy,
    validateOpenADEHyperPlanStrategy,
} from "./hyperplan"
import { createOpenADEModule, publishOpenADECompanionEvent, type OpenADEModuleAdapters } from "./module"
import { buildOpenADEPrompt } from "./promptBuilder"
import { parseProcsFile } from "./procs"
import { buildOpenADEPlanReviewPrompt, buildOpenADEReviewHandoffPrompt, buildOpenADEWorkReviewPrompt } from "./review"
import {
    fuzzySearchOpenADEProjectFiles,
    listOpenADEProjectFiles,
    readOpenADEProjectFile,
    resolveOpenADETaskWorkDir,
    searchOpenADEProject,
    writeOpenADEProjectFile,
} from "./scopedProjectHost"
import {
    buildOpenADEProjectProcessDefinitions,
    openADEProjectProcessInstanceFromUnknown,
    openADEProjectProcessReconnectResultFromUnknown,
    openADEProjectProcessScopeMatches,
    openADEProjectProcessStartResponseFromUnknown,
    openADEProjectProcessStopResultFromUnknown,
    openADEProjectProcessTimeout,
    type OpenADEProjectProcessRegistration,
} from "./scopedProjectProcesses"
import {
    assertOpenADETaskTerminalId,
    encodeOpenADETaskTerminalInput,
    openADETaskTerminalId,
    openADETaskTerminalOutputChunkFromUnknown,
} from "./scopedTaskTerminal"
import { buildOpenADESnapshotPatchIndex } from "./snapshotPatchIndex"
import { readOpenADETaskSnapshotIndex, readOpenADETaskSnapshotPatch, readOpenADETaskSnapshotPatchSlice } from "./taskSnapshotPatchReads"
import { buildOpenADETaskEnvironmentSetupOutput } from "./taskEnvironment"
import { buildOpenADETaskResourceInventory } from "./taskResourceInventory"
import {
    buildOpenADETaskTitlePrompt,
    extractOpenADETaskTitleFromStreamEvent,
    fallbackOpenADETaskTitle,
    OPENADE_TASK_TITLE_OUTPUT_SCHEMA,
    OPENADE_TASK_TITLE_SYSTEM_PROMPT,
    titleFromStructuredOutput,
} from "./taskTitle"
import type {
    OpenADEActionEventCreateRequest,
    OpenADEActionEventSource,
    OpenADEHyperPlanStep,
    OpenADEHyperPlanStrategy,
    OpenADEProcsConfig,
    OpenADEProject,
    OpenADEProjectGitBranchesReadRequest,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoRequest,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadRequest,
    OpenADEProjectGitSummaryReadResult,
    OpenADEProjectProcessConfigError,
    OpenADEProjectProcessDefinition,
    OpenADEProjectProcessInstance,
    OpenADEProjectProcessListRequest,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectRequest,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartRequest,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopRequest,
    OpenADEProjectProcessStopResult,
    OpenADEReviewStartRequest,
    OpenADESnapshotPatchIndex,
    OpenADETask,
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
    OpenADETaskCreateRequest,
    OpenADETaskDiffReadRequest,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadRequest,
    OpenADETaskFilePairReadResult,
    OpenADETaskDiffStats,
    OpenADETaskGitChangedFile,
    OpenADETaskGitCommitFilePatchRequest,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesRequest,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitCommitRequest,
    OpenADETaskGitCommitResult,
    OpenADETaskGitFileAtTreeishRequest,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogEntry,
    OpenADETaskGitLogRequest,
    OpenADETaskGitLogResult,
    OpenADETaskGitBranchScope,
    OpenADETaskGitChangeStats,
    OpenADETaskGitScope,
    OpenADETaskGitScopesReadRequest,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryRequest,
    OpenADETaskGitSummaryResult,
    OpenADETaskGitWorktreeScope,
    OpenADETaskImageReadRequest,
    OpenADETaskImageReadResult,
    OpenADETaskImageReference,
    OpenADETaskEnvironmentPrepareRequest,
    OpenADETaskEnvironmentPrepareResult,
    OpenADETaskResourceInventoryReadRequest,
    OpenADETaskResourceInventoryReadResult,
    OpenADETaskTitleGenerateRequest,
    OpenADETaskTitleGenerateResult,
    OpenADETaskTerminalMutationResult,
    OpenADETaskTerminalOutputChunk,
    OpenADETaskTerminalReconnectRequest,
    OpenADETaskTerminalReconnectResult,
    OpenADETaskTerminalResizeRequest,
    OpenADETaskTerminalStartRequest,
    OpenADETaskTerminalStartResult,
    OpenADETaskTerminalStopRequest,
    OpenADETaskTerminalWriteRequest,
    OpenADETurnStartRequest,
} from "./types"
import { createOpenADEYjsWriter } from "./yjsMutation"
import { createOpenADEYjsProjection } from "./yjsProjection"
import { createOpenADENodeYjsStorage } from "./nodeYjsStorage"
import { RuntimeHandlerError, type RuntimeServer } from "../../runtime/src"
import type { RuntimeRecord } from "../../runtime-protocol/src"
import { createRuntimeNodeHarnessAgentExecutor, registerRuntimeNodeAgentModule, type RuntimeNodeAgentExecutor } from "../../runtime-node/src/agents"

export interface RuntimeNodeOpenADEOptions {
    dataDir?: string
    hostName?: string
    version?: string
    server?: RuntimeServer
    agentExecutor?: RuntimeNodeAgentExecutor
    registerAgentModule?: boolean
}

type ActiveTaskExecution = {
    executionId: string
    runtimeId: string
    repoId: string
    eventId: string
    childExecutionIds?: Set<string>
    stopping?: boolean
}

function defaultDataDir(): string {
    return path.join(os.homedir(), ".openade", "data", "yjs")
}

function now(): string {
    return new Date().toISOString()
}

type ScopedGitResult = {
    stdout: string
    stderr: string
    success: boolean
    code?: number
}

const DEFAULT_SCOPED_TASK_GIT_LOG_LIMIT = 50
const MAX_SCOPED_TASK_GIT_LOG_LIMIT = 200
const MAX_SCOPED_TASK_PATCH_SIZE = 1024 * 1024
const MAX_SCOPED_TASK_FILE_PAIR_BYTES = 1024 * 1024
const MAX_SCOPED_TASK_FILE_PAIR_LINES = 10_000
const SCOPED_TASK_GENERATED_FILE_BASENAMES = new Set([
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "composer.lock",
    "Gemfile.lock",
    "Cargo.lock",
    "poetry.lock",
    "Pipfile.lock",
    "go.sum",
    "flake.lock",
    "bun.lock",
    "bun.lockb",
])

const SCOPED_TASK_BINARY_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".bmp",
    ".tiff",
    ".tif",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".mp3",
    ".mp4",
    ".wav",
    ".ogg",
    ".webm",
    ".zip",
    ".tar",
    ".gz",
    ".rar",
    ".7z",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".sqlite",
    ".db",
])

function isScopedTaskBinaryPath(filePath: string): boolean {
    return SCOPED_TASK_BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function scopedGit(args: string[], cwd: string): Promise<ScopedGitResult> {
    return new Promise((resolve) => {
        execFile("git", args, { cwd, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({
                stdout: String(stdout),
                stderr: String(stderr),
                success: !error,
                code: typeof error?.code === "number" ? error.code : undefined,
            })
        })
    })
}

async function scopedGitRequire(args: string[], cwd: string, label: string): Promise<string> {
    const result = await scopedGit(args, cwd)
    if (!result.success) throw new Error(`${label}: ${result.stderr || result.stdout}`)
    return result.stdout
}

function parseScopedNameStatusOutput(stdout: string): OpenADETaskGitChangedFile[] {
    const files: OpenADETaskGitChangedFile[] = []
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const parts = line.split("\t")
        const statusCode = parts[0] ?? ""
        if (statusCode.startsWith("R")) {
            const oldPath = parts[1]
            const newPath = parts[2]
            if (oldPath && newPath) files.push({ path: newPath, oldPath, status: "renamed" })
            continue
        }

        const filePath = parts[1]
        if (!filePath) continue
        if (statusCode === "A") {
            files.push({ path: filePath, status: "added" })
        } else if (statusCode === "D") {
            files.push({ path: filePath, status: "deleted" })
        } else {
            files.push({ path: filePath, status: "modified" })
        }
    }
    return files
}

function parseScopedNumstatStats(stdout: string): OpenADETaskGitChangeStats {
    let filesChanged = 0
    let insertions = 0
    let deletions = 0

    for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const parts = line.split("\t")
        if (parts.length < 3) continue
        filesChanged += 1

        const additions = parts[0]
        const removals = parts[1]
        if (additions !== "-") insertions += Number.parseInt(additions ?? "0", 10) || 0
        if (removals !== "-") deletions += Number.parseInt(removals ?? "0", 10) || 0
    }

    return { filesChanged, insertions, deletions }
}

function scopedTaskSummaryFiles(stdout: string): OpenADETaskGitChangedFile[] {
    return parseScopedNameStatusOutput(stdout).map((file) => ({ ...file, binary: isScopedTaskBinaryPath(file.path) }))
}

type ScopedGitSummary = Omit<OpenADETaskGitSummaryResult, "repoId" | "taskId">

async function scopedGitSummary(workDir: string): Promise<ScopedGitSummary> {
    const branchResult = await scopedGit(["rev-parse", "--abbrev-ref", "HEAD"], workDir)
    const branchName = branchResult.success ? branchResult.stdout.trim() : ""
    const branch = branchName && branchName !== "HEAD" ? branchName : null
    const headResult = await scopedGit(["rev-parse", "--short", "HEAD"], workDir)
    const headCommit = headResult.success ? headResult.stdout.trim() : ""

    let ahead: number | null = null
    if (branch) {
        const upstreamAhead = await scopedGit(["rev-list", "--count", "@{upstream}..HEAD"], workDir)
        const fallbackAhead = upstreamAhead.success ? upstreamAhead : await scopedGit(["rev-list", "--count", "origin/HEAD..HEAD"], workDir)
        if (fallbackAhead.success) ahead = Number.parseInt(fallbackAhead.stdout.trim(), 10) || 0
    }

    const stagedNameStatus = await scopedGit(["diff", "--cached", "--name-status", "-M"], workDir)
    const unstagedNameStatus = await scopedGit(["diff", "--name-status", "-M"], workDir)
    const stagedNumstat = await scopedGit(["diff", "--cached", "--numstat", "-M"], workDir)
    const unstagedNumstat = await scopedGit(["diff", "--numstat", "-M"], workDir)
    const untrackedResult = await scopedGit(["ls-files", "--others", "--exclude-standard"], workDir)
    const stagedFiles = stagedNameStatus.success ? scopedTaskSummaryFiles(stagedNameStatus.stdout) : []
    const unstagedFiles = unstagedNameStatus.success ? scopedTaskSummaryFiles(unstagedNameStatus.stdout) : []
    const untracked = untrackedResult.success
        ? untrackedResult.stdout
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((filePath) => ({ path: filePath, status: "added" as const, binary: isScopedTaskBinaryPath(filePath) }))
        : []

    return {
        branch,
        headCommit,
        ahead,
        hasChanges: stagedFiles.length > 0 || unstagedFiles.length > 0 || untracked.length > 0,
        staged: {
            files: stagedFiles,
            stats: stagedNumstat.success ? parseScopedNumstatStats(stagedNumstat.stdout) : { filesChanged: 0, insertions: 0, deletions: 0 },
        },
        unstaged: {
            files: unstagedFiles,
            stats: unstagedNumstat.success ? parseScopedNumstatStats(unstagedNumstat.stdout) : { filesChanged: 0, insertions: 0, deletions: 0 },
        },
        untracked,
    }
}

async function scopedTaskGitSummary(
    params: OpenADETaskGitSummaryRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitSummaryResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        ...(await scopedGitSummary(workDir)),
    }
}

function normalizeScopedGitBranchName(value: string): string {
    return value.trim().replace(/^refs\/heads\//, "")
}

function scopedTaskGitBranchScopes(stdout: string, defaultBranch: string, isRemote: boolean): OpenADETaskGitBranchScope[] {
    return stdout
        .split("\n")
        .map((branch) => normalizeScopedGitBranchName(branch))
        .filter((branch) => branch.length > 0 && !branch.includes("HEAD"))
        .map((name) => ({
            id: `branch:${name}`,
            type: "branch" as const,
            name,
            ref: name,
            isDefault: name.replace(/^origin\//, "") === defaultBranch,
            isRemote,
        }))
}

function scopedTaskGitDefaultBranch(workDir: string): Promise<string> {
    return (async () => {
        const remoteHeadResult = await scopedGit(["symbolic-ref", "refs/remotes/origin/HEAD"], workDir)
        if (remoteHeadResult.success) {
            const remoteHead = remoteHeadResult.stdout.trim().replace("refs/remotes/origin/", "")
            if (remoteHead) return remoteHead
        }

        const mainResult = await scopedGit(["show-ref", "--verify", "refs/heads/main"], workDir)
        if (mainResult.success) return "main"

        const masterResult = await scopedGit(["show-ref", "--verify", "refs/heads/master"], workDir)
        if (masterResult.success) return "master"

        return "main"
    })()
}

function scopedGhAuthenticated(cwd: string): Promise<boolean> {
    return new Promise((resolve) => {
        execFile("gh", ["auth", "status"], { cwd, timeout: 5000 }, (error) => {
            resolve(!error)
        })
    })
}

async function scopedProjectGitInfo(params: OpenADEProjectGitInfoRequest & { repo: OpenADEProject }): Promise<OpenADEProjectGitInfoResult> {
    try {
        const gitInfo = await scopedGitRepositoryInfo(params.repo.path)
        return {
            repoId: params.repoId,
            isGitRepo: true,
            repoRoot: gitInfo.repoRoot,
            relativePath: gitInfo.relativePath,
            mainBranch: gitInfo.defaultBranch,
            hasGhCli: await scopedGhAuthenticated(gitInfo.repoRoot),
        }
    } catch (error) {
        return {
            repoId: params.repoId,
            isGitRepo: false,
            error: error instanceof Error ? error.message : "Repository is not a git directory",
        }
    }
}

function scopedProjectGitBranchesFromOutput(stdout: string, defaultBranch: string, isRemote: boolean): OpenADEProjectGitBranchesReadResult["branches"] {
    return stdout
        .split("\n")
        .map((branch) => normalizeScopedGitBranchName(branch))
        .filter((branch) => branch.length > 0 && !branch.includes("HEAD"))
        .map((name) => ({
            name,
            isDefault: name.replace(/^origin\//, "") === defaultBranch,
            isRemote,
        }))
}

async function scopedProjectGitBranches(
    params: OpenADEProjectGitBranchesReadRequest & { repo: OpenADEProject }
): Promise<OpenADEProjectGitBranchesReadResult> {
    const gitInfo = await scopedGitRepositoryInfo(params.repo.path)
    const localBranchesResult = await scopedGitRequire(["branch", "--format=%(refname:short)"], gitInfo.repoRoot, "Failed to list project git branches")
    const branches = scopedProjectGitBranchesFromOutput(localBranchesResult, gitInfo.defaultBranch, false)
    const localNames = new Set(branches.map((branch) => branch.name))

    if (params.includeRemote) {
        const remoteBranchesResult = await scopedGit(["branch", "-r", "--format=%(refname:short)"], gitInfo.repoRoot)
        if (remoteBranchesResult.success) {
            for (const remoteBranch of scopedProjectGitBranchesFromOutput(remoteBranchesResult.stdout, gitInfo.defaultBranch, true)) {
                const localName = remoteBranch.name.replace(/^origin\//, "")
                if (!localNames.has(localName) && !localNames.has(remoteBranch.name)) branches.push(remoteBranch)
            }
        }
    }

    branches.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1
        if (!a.isDefault && b.isDefault) return 1
        return a.name.localeCompare(b.name)
    })

    return {
        repoId: params.repoId,
        branches,
        defaultBranch: gitInfo.defaultBranch,
    }
}

async function scopedProjectGitSummary(params: OpenADEProjectGitSummaryReadRequest & { repo: OpenADEProject }): Promise<OpenADEProjectGitSummaryReadResult> {
    const gitInfo = await scopedGitRepositoryInfo(params.repo.path)
    return {
        repoId: params.repoId,
        ...(await scopedGitSummary(gitInfo.repoRoot)),
    }
}

function scopedTaskGitWorktreeEntries(stdout: string): Array<{ scope: OpenADETaskGitWorktreeScope; path: string }> {
    const entries: Array<{ scope: OpenADETaskGitWorktreeScope; path: string }> = []
    const lines = stdout.split("\n")
    let current: { path?: string; head?: string; branch?: string } = {}

    const pushCurrent = () => {
        if (!current.path || !current.head) {
            current = {}
            return
        }
        const worktreeId = path.basename(current.path)
        if (!worktreeId) {
            current = {}
            return
        }
        const branch = current.branch ? normalizeScopedGitBranchName(current.branch) : ""
        entries.push({
            path: current.path,
            scope: {
                id: `worktree:${worktreeId}`,
                type: "worktree",
                worktreeId,
                branch,
                head: current.head,
                label: worktreeId,
            },
        })
        current = {}
    }

    for (const line of lines) {
        if (line.startsWith("worktree ")) {
            if (current.path) pushCurrent()
            current.path = line.slice("worktree ".length).trim()
        } else if (line.startsWith("HEAD ")) {
            current.head = line.slice("HEAD ".length).trim()
        } else if (line.startsWith("branch ")) {
            current.branch = line.slice("branch ".length).trim()
        } else if (line === "") {
            pushCurrent()
        }
    }
    pushCurrent()

    return entries
}

function scopedTaskGitWorktreeScopes(stdout: string): OpenADETaskGitWorktreeScope[] {
    return scopedTaskGitWorktreeEntries(stdout).map((entry) => entry.scope)
}

async function scopedTaskGitWorkDirForLog(params: OpenADETaskGitLogRequest & { repo: OpenADEProject; task: OpenADETask }): Promise<string> {
    const defaultWorkDir = await scopedTaskWorkDir(params.repo, params.task)
    if (!params.scopeId?.startsWith("worktree:")) return defaultWorkDir

    const worktreeId = params.scopeId.slice("worktree:".length)
    if (!worktreeId) return defaultWorkDir

    const worktreeScopesResult = await scopedGit(["worktree", "list", "--porcelain"], defaultWorkDir)
    if (!worktreeScopesResult.success) return defaultWorkDir

    return scopedTaskGitWorktreeEntries(worktreeScopesResult.stdout).find((entry) => entry.scope.worktreeId === worktreeId)?.path ?? defaultWorkDir
}

async function scopedTaskGitScopes(
    params: OpenADETaskGitScopesReadRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitScopesReadResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const defaultBranch = await scopedTaskGitDefaultBranch(workDir)
    const localBranchesResult = await scopedGitRequire(["branch", "--format=%(refname:short)"], workDir, "Failed to list task git branches")
    const branchScopes: OpenADETaskGitScope[] = [
        {
            id: "branch:HEAD",
            type: "branch",
            name: "HEAD",
            ref: "HEAD",
            isDefault: false,
            isRemote: false,
        },
        ...scopedTaskGitBranchScopes(localBranchesResult, defaultBranch, false),
    ]

    if (params.includeRemote) {
        const remoteBranchesResult = await scopedGit(["branch", "-r", "--format=%(refname:short)"], workDir)
        if (remoteBranchesResult.success) {
            const localBranchNames = new Set(branchScopes.filter((scope): scope is OpenADETaskGitBranchScope => scope.type === "branch").map((scope) => scope.name))
            for (const remoteBranch of scopedTaskGitBranchScopes(remoteBranchesResult.stdout, defaultBranch, true)) {
                const localName = remoteBranch.name.replace(/^origin\//, "")
                if (!localBranchNames.has(localName) && !localBranchNames.has(remoteBranch.name)) {
                    branchScopes.push(remoteBranch)
                }
            }
        }
    }

    const worktreeScopesResult = await scopedGit(["worktree", "list", "--porcelain"], workDir)
    const worktreeScopes = worktreeScopesResult.success ? scopedTaskGitWorktreeScopes(worktreeScopesResult.stdout) : []

    const headScope = branchScopes[0]
    const sortableBranches = branchScopes.slice(1)
    sortableBranches.sort((a, b) => {
        if (a.type !== "branch" || b.type !== "branch") return a.id.localeCompare(b.id)
        if (a.isDefault && !b.isDefault) return -1
        if (!a.isDefault && b.isDefault) return 1
        return a.name.localeCompare(b.name)
    })

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        defaultBranch,
        scopes: headScope ? [headScope, ...sortableBranches, ...worktreeScopes] : [...sortableBranches, ...worktreeScopes],
    }
}

async function scopedTaskResourceInventory(
    params: OpenADETaskResourceInventoryReadRequest & { repo: OpenADEProject; task: OpenADETask; isRunning: boolean }
): Promise<OpenADETaskResourceInventoryReadResult> {
    let branchMerged: boolean | null = null
    if (params.task.isolationStrategy?.type === "worktree") {
        const result = await scopedGit(
            ["merge-base", "--is-ancestor", `openade/${params.task.slug}`, params.task.isolationStrategy.sourceBranch],
            params.repo.path
        ).catch(() => null)
        branchMerged = result?.success ?? null
    }

    return buildOpenADETaskResourceInventory({
        task: params.task,
        isRunning: params.isRunning,
        branchMerged,
    })
}

async function generateNodeTaskTitle(
    params: OpenADETaskTitleGenerateRequest & {
        repo: OpenADEProject
        task: OpenADETask
        agentExecutor: RuntimeNodeAgentExecutor
    }
): Promise<OpenADETaskTitleGenerateResult> {
    const description = params.task.description.trim()
    const fallback = fallbackOpenADETaskTitle(description || params.task.title || "Untitled task") || "Untitled task"
    if (!description) return { repoId: params.repoId, taskId: params.taskId, title: fallback }

    const cwd = await scopedTaskWorkDir(params.repo, params.task)
    const harnessId = params.harnessId ?? actionHarnessId(latestCompletedPlanEvent(params.task.events), "claude-code")
    const prompt = buildOpenADETaskTitlePrompt({ description, events: params.task.events })

    if (params.agentExecutor.structuredQuery) {
        try {
            const output = await params.agentExecutor.structuredQuery({
                prompt,
                options: {
                    harnessId,
                    cwd,
                    mode: "read-only",
                    appendSystemPrompt: OPENADE_TASK_TITLE_SYSTEM_PROMPT,
                    disablePlanningTools: true,
                },
                outputSchema: OPENADE_TASK_TITLE_OUTPUT_SCHEMA,
            })
            const title = titleFromStructuredOutput(output)
            if (title) return { repoId: params.repoId, taskId: params.taskId, title }
        } catch {
            // Fall through to the streaming executor path.
        }
    }

    let generatedTitle: string | null = null
    const executionId = executionIdForTask(params.taskId)

    const settled = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        let done = false
        const finish = (result: { ok: boolean; error?: string }) => {
            if (done) return
            done = true
            resolve(result)
        }

        void params.agentExecutor
            .start(
                {
                    executionId,
                    harnessId,
                    cwd,
                    prompt,
                    mode: "read-only",
                    appendSystemPrompt: OPENADE_TASK_TITLE_SYSTEM_PROMPT,
                    processLabel: `OpenADE title ${params.task.id}`,
                },
                {
                    onEvent(event) {
                        const title = extractOpenADETaskTitleFromStreamEvent(event)
                        if (title) generatedTitle = title
                    },
                    onSettled(result) {
                        finish({ ok: result.status === "completed", error: result.error })
                    },
                }
            )
            .then((result) => {
                if (!result.ok) finish(result)
            })
            .catch((error: unknown) => finish({ ok: false, error: error instanceof Error ? error.message : "Title generation failed" }))
    })

    if (!settled.ok && !generatedTitle) return { repoId: params.repoId, taskId: params.taskId, title: fallback }
    return { repoId: params.repoId, taskId: params.taskId, title: generatedTitle ?? fallback }
}

function latestTaskMergeBase(task: OpenADETask): string | undefined {
    for (let index = task.deviceEnvironments.length - 1; index >= 0; index--) {
        const environment = task.deviceEnvironments[index]
        if (environment.setupComplete && environment.mergeBaseCommit) return environment.mergeBaseCommit
    }
    for (let index = task.events.length - 1; index >= 0; index--) {
        const event = eventRecord(task.events[index])
        if (event?.type === "snapshot" && typeof event.mergeBaseCommit === "string" && event.mergeBaseCommit.length > 0) {
            return event.mergeBaseCommit
        }
    }
    return undefined
}

const HEADLESS_RUNTIME_DEVICE_ID = "headless-runtime"

function scopedTaskEnvironmentWorktreeBaseDir(): string {
    return path.join(os.homedir(), ".openade", "workspaces", "worktrees")
}

function validateScopedTaskEnvironmentSlug(slug: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(slug)) throw new Error("Task slug is invalid for environment setup")
    return slug
}

async function scopedGitRepositoryInfo(directory: string): Promise<{ repoRoot: string; relativePath: string; defaultBranch: string }> {
    const repoRoot = (await scopedGitRequire(["rev-parse", "--show-toplevel"], directory, "Failed to resolve repository root")).trim()
    const relativePath = (await scopedGitRequire(["rev-parse", "--show-prefix"], directory, "Failed to resolve repository path")).trim().replace(/\/+$/, "")
    const defaultBranch = await scopedTaskGitDefaultBranch(repoRoot)
    return { repoRoot, relativePath, defaultBranch }
}

async function scopedTaskEnvironmentMergeBase(params: { repoRoot: string; worktreeBranch: string; sourceBranch: string }): Promise<string | undefined> {
    const result = await scopedGit(["merge-base", params.worktreeBranch, params.sourceBranch], params.repoRoot)
    return result.success ? result.stdout.trim() || undefined : undefined
}

async function scopedTaskEnvironmentWorktree(params: {
    repoRoot: string
    slug: string
    sourceBranch: string
}): Promise<{ worktreeDir: string; mergeBaseCommit?: string }> {
    const slug = validateScopedTaskEnvironmentSlug(params.slug)
    const worktreeDir = path.join(scopedTaskEnvironmentWorktreeBaseDir(), slug)
    const worktreeBranch = `openade/${slug}`
    const expectedBranch = `refs/heads/${worktreeBranch}`
    await fs.mkdir(scopedTaskEnvironmentWorktreeBaseDir(), { recursive: true })

    const worktrees = await scopedGit(["worktree", "list", "--porcelain"], params.repoRoot)
    if (worktrees.success) {
        const existing = scopedTaskGitWorktreeEntries(worktrees.stdout).find((entry) => entry.path === worktreeDir)
        if (existing?.scope.branch === worktreeBranch || existing?.scope.branch === expectedBranch) {
            return {
                worktreeDir,
                mergeBaseCommit: await scopedTaskEnvironmentMergeBase({ repoRoot: params.repoRoot, worktreeBranch, sourceBranch: params.sourceBranch }),
            }
        }
        if (existing) {
            await scopedGitRequire(["worktree", "remove", worktreeDir, "--force"], params.repoRoot, "Failed to remove mismatched task worktree")
        }
    }

    let added = await scopedGit(["worktree", "add", "-b", worktreeBranch, worktreeDir, params.sourceBranch], params.repoRoot)
    if (!added.success && added.stderr.includes("already exists")) {
        added = await scopedGit(["worktree", "add", worktreeDir, worktreeBranch], params.repoRoot)
    }
    if (!added.success) throw new Error(`Failed to create task worktree: ${added.stderr || added.stdout}`)

    return {
        worktreeDir,
        mergeBaseCommit: await scopedTaskEnvironmentMergeBase({ repoRoot: params.repoRoot, worktreeBranch, sourceBranch: params.sourceBranch }),
    }
}

async function prepareScopedTaskEnvironment(
    params: OpenADETaskEnvironmentPrepareRequest & { repo: OpenADEProject; task: OpenADETask; createdAt: string }
): Promise<OpenADETaskEnvironmentPrepareResult> {
    const isolationStrategy = params.task.isolationStrategy ?? { type: "head" }
    if (isolationStrategy.type === "head") {
        return {
            repoId: params.repoId,
            taskId: params.taskId,
            deviceEnvironment: {
                id: HEADLESS_RUNTIME_DEVICE_ID,
                deviceId: HEADLESS_RUNTIME_DEVICE_ID,
                setupComplete: true,
                createdAt: params.createdAt,
                lastUsedAt: params.createdAt,
            },
            cwd: params.repo.path,
            rootPath: params.repo.path,
        }
    }

    const gitInfo = await scopedGitRepositoryInfo(params.repo.path)
    const sourceBranch = isolationStrategy.sourceBranch || gitInfo.defaultBranch || "main"
    const worktree = await scopedTaskEnvironmentWorktree({ repoRoot: gitInfo.repoRoot, slug: params.task.slug, sourceBranch })
    const workingDir = gitInfo.relativePath ? path.join(worktree.worktreeDir, gitInfo.relativePath) : worktree.worktreeDir
    if (gitInfo.relativePath) await fs.mkdir(workingDir, { recursive: true })

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        deviceEnvironment: {
            id: HEADLESS_RUNTIME_DEVICE_ID,
            deviceId: HEADLESS_RUNTIME_DEVICE_ID,
            worktreeDir: worktree.worktreeDir,
            setupComplete: true,
            mergeBaseCommit: worktree.mergeBaseCommit,
            createdAt: params.createdAt,
            lastUsedAt: params.createdAt,
        },
        setupEvent: {
            eventId: `setup-${HEADLESS_RUNTIME_DEVICE_ID}`,
            worktreeId: params.task.slug,
            deviceId: HEADLESS_RUNTIME_DEVICE_ID,
            workingDir,
            setupOutput: buildOpenADETaskEnvironmentSetupOutput({
                worktreeDir: worktree.worktreeDir,
                workingDir,
                sourceBranch,
                mergeBaseCommit: worktree.mergeBaseCommit,
            }),
            createdAt: params.createdAt,
            completedAt: params.createdAt,
        },
        cwd: workingDir,
        rootPath: worktree.worktreeDir,
    }
}

async function scopedTaskWorkDir(repo: OpenADEProject, task: OpenADETask): Promise<string> {
    return resolveOpenADETaskWorkDir(repo, task)
}

function scopedTaskFromTreeish(task: OpenADETask, fromTreeish?: string): string {
    if (fromTreeish) return fromTreeish
    const isolationStrategy = task.isolationStrategy ?? { type: "head" }
    if (isolationStrategy.type === "worktree") return latestTaskMergeBase(task) ?? "HEAD"
    return "HEAD"
}

async function scopedTaskChanges(
    params: OpenADETaskChangesReadRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskChangesReadResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const fromTreeish = scopedTaskFromTreeish(params.task, params.fromTreeish)
    const toTreeish = ""
    const output = await scopedGitRequire(["diff", "--name-status", "-M", fromTreeish], workDir, "Failed to get task changes")
    const files = parseScopedNameStatusOutput(output)
    const seenPaths = new Set(files.map((file) => file.path))

    const untracked = await scopedGit(["ls-files", "--others", "--exclude-standard"], workDir)
    if (untracked.success) {
        for (const filePath of untracked.stdout.trim().split("\n").filter(Boolean)) {
            if (!seenPaths.has(filePath)) files.push({ path: filePath, status: "added" })
        }
    }

    return { repoId: params.repoId, taskId: params.taskId, files, fromTreeish, toTreeish }
}

function createEmptyTaskDiffReadResult(params: {
    repoId: string
    taskId: string
    filePath: string
    oldPath?: string
    fromTreeish: string
    toTreeish: string
}): OpenADETaskDiffReadResult {
    return {
        ...params,
        patch: "",
        truncated: false,
        heavy: false,
        stats: {
            insertions: 0,
            deletions: 0,
            changedLines: 0,
            hunkCount: 0,
        },
    }
}

function parseScopedPatchStats(patch: string): Pick<OpenADETaskDiffStats, "insertions" | "deletions"> {
    let insertions = 0
    let deletions = 0
    for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
            insertions++
        } else if (line.startsWith("-") && !line.startsWith("---")) {
            deletions++
        }
    }
    return { insertions, deletions }
}

function countScopedPatchHunks(patch: string): number {
    let count = 0
    for (const line of patch.split("\n")) {
        if (line.startsWith("@@")) count++
    }
    return count
}

function finalizeScopedTaskDiffPatch(
    patch: string,
    allowTruncation: boolean,
    params: {
        repoId: string
        taskId: string
        filePath: string
        oldPath?: string
        fromTreeish: string
        toTreeish: string
    }
): OpenADETaskDiffReadResult {
    if (!patch) return createEmptyTaskDiffReadResult(params)

    const truncated = allowTruncation && patch.length > MAX_SCOPED_TASK_PATCH_SIZE
    const patchStats = parseScopedPatchStats(patch)
    const changedLines = patchStats.insertions + patchStats.deletions
    const hunkCount = countScopedPatchHunks(patch)
    return {
        ...params,
        patch: truncated ? patch.slice(0, MAX_SCOPED_TASK_PATCH_SIZE) : patch,
        truncated,
        heavy: truncated || patch.length > 256 * 1024 || changedLines > 4_000 || hunkCount > 50,
        stats: {
            insertions: patchStats.insertions,
            deletions: patchStats.deletions,
            changedLines,
            hunkCount,
        },
    }
}

function resolveTaskGitFilePath(workDir: string, filePath: string): { absolutePath: string; relativePath: string } {
    const root = path.resolve(workDir)
    const absolutePath = path.resolve(root, filePath)
    const relativePath = path.relative(root, absolutePath)
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("filePath is outside the task working directory")
    }
    return { absolutePath, relativePath: relativePath.split(path.sep).join("/") }
}

function taskGitDiffPathspecs(workDir: string, filePath: string, oldPath?: string): string[] {
    const normalizedPath = resolveTaskGitFilePath(workDir, filePath).relativePath
    if (oldPath && oldPath !== filePath) {
        return [resolveTaskGitFilePath(workDir, oldPath).relativePath, normalizedPath]
    }
    return [normalizedPath]
}

async function scopedUntrackedTaskFilePatch(params: {
    workDir: string
    filePath: string
    contextLines: NonNullable<OpenADETaskDiffReadRequest["contextLines"]>
    allowTruncation: boolean
    resultBase: {
        repoId: string
        taskId: string
        filePath: string
        oldPath?: string
        fromTreeish: string
        toTreeish: string
    }
}): Promise<OpenADETaskDiffReadResult> {
    const resolvedPath = resolveTaskGitFilePath(params.workDir, params.filePath)
    const stat = await fs.stat(resolvedPath.absolutePath).catch(() => null)
    if (!stat?.isFile()) return createEmptyTaskDiffReadResult(params.resultBase)

    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null"
    const result = await scopedGit(["diff", "--no-index", `-U${params.contextLines}`, "--", nullDevice, resolvedPath.relativePath], params.workDir)
    if (!result.success && result.code !== 1) {
        throw new Error(`Failed to get untracked task file patch: ${result.stderr}`)
    }
    return finalizeScopedTaskDiffPatch(result.stdout, params.allowTruncation, params.resultBase)
}

async function scopedTaskDiff(params: OpenADETaskDiffReadRequest & { repo: OpenADEProject; task: OpenADETask }): Promise<OpenADETaskDiffReadResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const fromTreeish = scopedTaskFromTreeish(params.task, params.fromTreeish)
    const toTreeish = ""
    const contextLines = params.contextLines ?? 3
    const allowTruncation = params.allowTruncation !== false
    const resultBase = {
        repoId: params.repoId,
        taskId: params.taskId,
        filePath: params.filePath,
        oldPath: params.oldPath,
        fromTreeish,
        toTreeish,
    }

    if (SCOPED_TASK_GENERATED_FILE_BASENAMES.has(path.basename(params.filePath))) {
        return createEmptyTaskDiffReadResult(resultBase)
    }

    const pathspecs = taskGitDiffPathspecs(workDir, params.filePath, params.oldPath)
    const result = await scopedGit(["diff", "-M", `-U${contextLines}`, fromTreeish, "--", ...pathspecs], workDir)
    if (!result.success) throw new Error(`Failed to get task file patch: ${result.stderr}`)

    const response = finalizeScopedTaskDiffPatch(result.stdout, allowTruncation, resultBase)
    if (!response.patch && !params.oldPath) {
        return scopedUntrackedTaskFilePatch({
            workDir,
            filePath: params.filePath,
            contextLines,
            allowTruncation,
            resultBase,
        })
    }
    return response
}

function exceedsScopedTaskFilePairLineLimit(content: string): boolean {
    let count = 0
    for (let index = 0; index < content.length; index++) {
        if (content[index] === "\n") {
            count += 1
            if (count > MAX_SCOPED_TASK_FILE_PAIR_LINES) return true
        }
    }
    return false
}

async function readScopedTaskFileAtTreeish(
    workDir: string,
    treeish: string,
    filePath: string
): Promise<{ content: string; exists: boolean; tooLarge?: boolean }> {
    const relativePath = resolveTaskGitFilePath(workDir, filePath).relativePath
    const objectSpec = `${treeish}:${relativePath}`
    const sizeResult = await scopedGit(["cat-file", "-s", objectSpec], workDir)
    if (!sizeResult.success) {
        return { content: "", exists: false }
    }

    const fileSize = Number.parseInt(sizeResult.stdout.trim(), 10)
    if (Number.isFinite(fileSize) && fileSize > MAX_SCOPED_TASK_FILE_PAIR_BYTES) {
        return { content: "", exists: true, tooLarge: true }
    }

    const result = await scopedGit(["show", objectSpec], workDir)
    if (!result.success) return { content: "", exists: false }
    return {
        content: result.stdout,
        exists: true,
    }
}

async function readScopedTaskWorkingTreeFile(workDir: string, filePath: string): Promise<{ content: string; tooLarge?: boolean }> {
    const resolvedPath = resolveTaskGitFilePath(workDir, filePath)
    const stat = await fs.stat(resolvedPath.absolutePath).catch(() => null)
    if (!stat?.isFile()) return { content: "" }
    if (stat.size > MAX_SCOPED_TASK_FILE_PAIR_BYTES) return { content: "", tooLarge: true }
    return { content: await fs.readFile(resolvedPath.absolutePath, "utf8") }
}

async function scopedTaskFilePair(params: OpenADETaskFilePairReadRequest & { repo: OpenADEProject; task: OpenADETask }): Promise<OpenADETaskFilePairReadResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const fromTreeish = scopedTaskFromTreeish(params.task, params.fromTreeish)
    const toTreeish = ""
    const resultBase = {
        repoId: params.repoId,
        taskId: params.taskId,
        filePath: params.filePath,
        oldPath: params.oldPath,
        fromTreeish,
        toTreeish,
    }

    if (SCOPED_TASK_GENERATED_FILE_BASENAMES.has(path.basename(params.filePath))) {
        return { ...resultBase, before: "", after: "", tooLarge: true }
    }

    const beforePath = params.oldPath || params.filePath
    const before = await readScopedTaskFileAtTreeish(workDir, fromTreeish, beforePath)
    const after = await readScopedTaskWorkingTreeFile(workDir, params.filePath)
    if (
        before.tooLarge ||
        after.tooLarge ||
        exceedsScopedTaskFilePairLineLimit(before.content) ||
        exceedsScopedTaskFilePairLineLimit(after.content)
    ) {
        return { ...resultBase, before: "", after: "", tooLarge: true }
    }

    return {
        ...resultBase,
        before: before.content,
        after: after.content,
    }
}

async function scopedTaskGitLog(params: OpenADETaskGitLogRequest & { repo: OpenADEProject; task: OpenADETask }): Promise<OpenADETaskGitLogResult> {
    const workDir = await scopedTaskGitWorkDirForLog(params)
    const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_SCOPED_TASK_GIT_LOG_LIMIT, MAX_SCOPED_TASK_GIT_LOG_LIMIT))
    const skip = Math.max(0, params.skip ?? 0)
    const fieldSeparator = "\x1f"
    const recordSeparator = "\x1e"
    const format = ["%H", "%h", "%s", "%an", "%aI", "%ar", "%P"].join(fieldSeparator) + recordSeparator
    const args = ["log", `--format=${format}`, `--max-count=${limit + 1}`, `--skip=${skip}`]
    if (params.ref) args.push(params.ref)

    const output = await scopedGitRequire(args, workDir, "Failed to get task git log")
    const commits = output
        .split(recordSeparator)
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record): OpenADETaskGitLogEntry => {
            const [rawSha = "", rawShortSha = "", message = "", author = "", rawDate = "", rawRelativeDate = "", rawParents = ""] =
                record.split(fieldSeparator)
            const parents = rawParents.trim()
            return {
                sha: rawSha.trim(),
                shortSha: rawShortSha.trim(),
                message,
                author,
                date: rawDate.trim(),
                relativeDate: rawRelativeDate.trim(),
                parentCount: parents ? parents.split(/\s+/).length : 0,
            }
        })

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        commits: commits.slice(0, limit),
        hasMore: commits.length > limit,
    }
}

async function scopedTaskGitCommitFiles(
    params: OpenADETaskGitCommitFilesRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitCommitFilesResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const parentOutput = await scopedGitRequire(["show", "--no-patch", "--format=%P", params.commit], workDir, "Failed to resolve commit parents")
    const parents = parentOutput.trim().split(/\s+/).filter(Boolean)
    const diffOutput =
        parents.length === 0
            ? await scopedGitRequire(
                  ["diff-tree", "--root", "-r", "--no-commit-id", "--name-status", "-M", params.commit],
                  workDir,
                  "Failed to get commit files"
              )
            : await scopedGitRequire(["diff", "--name-status", "-M", parents[0], params.commit], workDir, "Failed to get commit files")

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        commit: params.commit,
        files: parseScopedNameStatusOutput(diffOutput),
    }
}

async function scopedTaskGitFileAtTreeish(
    params: OpenADETaskGitFileAtTreeishRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitFileAtTreeishResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const result = await readScopedTaskFileAtTreeish(workDir, params.treeish, params.filePath)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        treeish: params.treeish,
        filePath: params.filePath,
        content: result.content,
        exists: result.exists,
        tooLarge: result.tooLarge,
    }
}

function createEmptyTaskGitCommitFilePatchResult(params: {
    repoId: string
    taskId: string
    commit: string
    filePath: string
    oldPath?: string
}): OpenADETaskGitCommitFilePatchResult {
    return {
        ...params,
        patch: "",
        truncated: false,
        heavy: false,
        stats: {
            insertions: 0,
            deletions: 0,
            changedLines: 0,
            hunkCount: 0,
        },
    }
}

function finalizeScopedTaskGitCommitFilePatch(
    patch: string,
    allowTruncation: boolean,
    params: {
        repoId: string
        taskId: string
        commit: string
        filePath: string
        oldPath?: string
    }
): OpenADETaskGitCommitFilePatchResult {
    if (!patch) return createEmptyTaskGitCommitFilePatchResult(params)

    const truncated = allowTruncation && patch.length > MAX_SCOPED_TASK_PATCH_SIZE
    const patchStats = parseScopedPatchStats(patch)
    const changedLines = patchStats.insertions + patchStats.deletions
    const hunkCount = countScopedPatchHunks(patch)
    return {
        ...params,
        patch: truncated ? patch.slice(0, MAX_SCOPED_TASK_PATCH_SIZE) : patch,
        truncated,
        heavy: truncated || patch.length > 256 * 1024 || changedLines > 4_000 || hunkCount > 50,
        stats: {
            insertions: patchStats.insertions,
            deletions: patchStats.deletions,
            changedLines,
            hunkCount,
        },
    }
}

async function scopedTaskGitCommitFilePatch(
    params: OpenADETaskGitCommitFilePatchRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitCommitFilePatchResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const contextLines = params.contextLines ?? 3
    const allowTruncation = params.allowTruncation !== false
    const resultBase = {
        repoId: params.repoId,
        taskId: params.taskId,
        commit: params.commit,
        filePath: params.filePath,
        oldPath: params.oldPath,
    }

    if (SCOPED_TASK_GENERATED_FILE_BASENAMES.has(path.basename(params.filePath))) {
        return createEmptyTaskGitCommitFilePatchResult(resultBase)
    }

    const parentOutput = await scopedGitRequire(["show", "--no-patch", "--format=%P", params.commit], workDir, "Failed to resolve commit parents")
    const parents = parentOutput.trim().split(/\s+/).filter(Boolean)
    const pathspecs = taskGitDiffPathspecs(workDir, params.filePath, params.oldPath)
    const result =
        parents.length === 0
            ? await scopedGit(["diff-tree", "--root", "-p", "-M", `-U${contextLines}`, params.commit, "--", ...pathspecs], workDir)
            : await scopedGit(["diff", "-M", `-U${contextLines}`, parents[0], params.commit, "--", ...pathspecs], workDir)

    if (!result.success) throw new Error(`Failed to get commit file patch: ${result.stderr || result.stdout}`)
    return finalizeScopedTaskGitCommitFilePatch(result.stdout, allowTruncation, resultBase)
}

async function scopedTaskGitCommit(
    params: OpenADETaskGitCommitRequest & { repo: OpenADEProject; task: OpenADETask }
): Promise<OpenADETaskGitCommitResult> {
    const workDir = await scopedTaskWorkDir(params.repo, params.task)
    const addResult = await scopedGit(["add", "-A"], workDir)
    if (!addResult.success) {
        return {
            repoId: params.repoId,
            taskId: params.taskId,
            committed: false,
            status: "failed",
            error: addResult.stderr || addResult.stdout || "Failed to stage task changes",
        }
    }

    const statusResult = await scopedGit(["status", "--porcelain"], workDir)
    if (!statusResult.success) {
        return {
            repoId: params.repoId,
            taskId: params.taskId,
            committed: false,
            status: "failed",
            error: statusResult.stderr || statusResult.stdout || "Failed to inspect task changes",
        }
    }
    if (!statusResult.stdout.trim()) {
        return { repoId: params.repoId, taskId: params.taskId, committed: false, status: "nothing_to_commit" }
    }

    const commitResult = await scopedGit(["commit", "-m", params.message], workDir)
    if (!commitResult.success) {
        const error = commitResult.stderr || commitResult.stdout || "Failed to commit task changes"
        if (error.includes("nothing to commit")) {
            return { repoId: params.repoId, taskId: params.taskId, committed: false, status: "nothing_to_commit" }
        }
        return { repoId: params.repoId, taskId: params.taskId, committed: false, status: "failed", error }
    }

    const shaResult = await scopedGit(["rev-parse", "HEAD"], workDir)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        committed: true,
        status: "committed",
        sha: shaResult.success ? shaResult.stdout.trim() : undefined,
    }
}

async function loadNodeSnapshotPatch(snapshotDir: string, patchFileId: string): Promise<string | null> {
    return fs.readFile(path.join(snapshotDir, `${patchFileId}.patch`), "utf8").catch(() => null)
}

async function loadNodeSnapshotIndex(snapshotDir: string, patchFileId: string): Promise<OpenADESnapshotPatchIndex | null> {
    const indexPath = path.join(snapshotDir, `${patchFileId}.json`)
    const rawIndex = await fs.readFile(indexPath, "utf8").catch(() => null)
    if (rawIndex) {
        try {
            return JSON.parse(rawIndex) as OpenADESnapshotPatchIndex
        } catch {
            return null
        }
    }
    const patch = await loadNodeSnapshotPatch(snapshotDir, patchFileId)
    return patch === null ? null : buildOpenADESnapshotPatchIndex(patch)
}

function nodeDataFilePath(baseDir: string, id: string, ext: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("imageId is invalid")
    if (!/^[a-zA-Z0-9]+$/.test(ext)) throw new Error("ext is invalid")
    const root = path.resolve(baseDir)
    const filePath = path.resolve(root, `${id}.${ext}`)
    if (filePath !== path.join(root, `${id}.${ext}`)) throw new Error("image path is invalid")
    return filePath
}

async function readNodeTaskImage(
    params: OpenADETaskImageReadRequest & { image: OpenADETaskImageReference; imageDir: string }
): Promise<OpenADETaskImageReadResult> {
    const filePath = nodeDataFilePath(params.imageDir, params.imageId, params.ext)
    const data = await fs.readFile(filePath).catch(() => null)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        imageId: params.imageId,
        ext: params.ext,
        mediaType: params.image.mediaType,
        data: data ? data.toString("base64") : null,
    }
}

type NodeProjectProcessProcsResult = {
    repoRoot: string
    searchRoot: string
    isWorktree: boolean
    worktreeRoot?: string
    configs: OpenADEProcsConfig[]
    processes: OpenADEProjectProcessDefinition[]
    errors: OpenADEProjectProcessConfigError[]
}

const NODE_PROCS_CONFIG_FILENAME = "openade.toml"
const NODE_PROCS_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "vendor", ".venv", "venv", ".cache", "coverage"])
let scopedProjectProcessRequestId = 0

async function nodeProjectProcessGitInfo(searchRoot: string): Promise<{ repoRoot: string; isWorktree: boolean; worktreeRoot?: string } | null> {
    const repoRoot = await scopedGit(["rev-parse", "--show-toplevel"], searchRoot)
    if (!repoRoot.success) return null
    const gitDir = await scopedGit(["rev-parse", "--git-dir"], searchRoot)
    const isWorktree = gitDir.success && gitDir.stdout.includes(".git/worktrees")
    return {
        repoRoot: repoRoot.stdout.trim(),
        isWorktree,
        worktreeRoot: isWorktree ? repoRoot.stdout.trim() : undefined,
    }
}

async function walkNodeOpenADEProcsFiles(root: string, files: string[] = [], depth = 0): Promise<string[]> {
    if (depth > 10) return files
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
        if (entry.isFile() && entry.name === NODE_PROCS_CONFIG_FILENAME) {
            files.push(path.join(root, entry.name))
        } else if (entry.isDirectory() && !NODE_PROCS_SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            await walkNodeOpenADEProcsFiles(path.join(root, entry.name), files, depth + 1)
        }
    }
    return files
}

async function findNodeOpenADEProcsFiles(searchRoot: string, repoRoot: string, hasGitInfo: boolean): Promise<string[]> {
    if (hasGitInfo) {
        const files = new Set<string>()
        for (const args of [
            ["ls-files", `**/${NODE_PROCS_CONFIG_FILENAME}`, NODE_PROCS_CONFIG_FILENAME],
            ["ls-files", "--others", "--exclude-standard", `**/${NODE_PROCS_CONFIG_FILENAME}`, NODE_PROCS_CONFIG_FILENAME],
        ]) {
            const result = await scopedGit(args, repoRoot)
            if (!result.success) continue
            for (const filePath of result.stdout.trim().split("\n").filter(Boolean)) {
                files.add(path.join(repoRoot, filePath))
            }
        }
        if (files.size > 0) return [...files].sort()
    }
    return walkNodeOpenADEProcsFiles(repoRoot || searchRoot)
}

async function readNodeProjectProcessDefinitions(searchRoot: string): Promise<NodeProjectProcessProcsResult> {
    const resolvedSearchRoot = path.resolve(searchRoot)
    const gitInfo = await nodeProjectProcessGitInfo(resolvedSearchRoot)
    const repoRoot = path.resolve(gitInfo?.repoRoot ?? resolvedSearchRoot)
    const configFiles = await findNodeOpenADEProcsFiles(resolvedSearchRoot, repoRoot, gitInfo !== null)
    const configs: OpenADEProcsConfig[] = []
    const errors: OpenADEProjectProcessConfigError[] = []

    for (const configFile of configFiles) {
        const relativePath = path.relative(repoRoot, configFile).split(path.sep).join("/")
        const content = await fs.readFile(configFile, "utf8").catch((error: unknown) => {
            errors.push({ relativePath, error: error instanceof Error ? error.message : "Failed to read process config" })
            return null
        })
        if (content === null) continue
        const parsed = parseProcsFile(content, relativePath)
        if ("error" in parsed) {
            errors.push(parsed.error)
            continue
        }
        configs.push(parsed.config)
    }
    const definitions = buildOpenADEProjectProcessDefinitions({ root: repoRoot, configs })

    return {
        repoRoot,
        searchRoot: resolvedSearchRoot,
        isWorktree: gitInfo?.isWorktree ?? false,
        worktreeRoot: gitInfo?.worktreeRoot,
        configs,
        processes: definitions.processes,
        errors: [...errors, ...definitions.errors],
    }
}

async function scopedProjectProcessSearchRoot(params: { repo: OpenADEProject; task?: OpenADETask }): Promise<string> {
    return params.task ? scopedTaskWorkDir(params.repo, params.task) : path.resolve(params.repo.path)
}

async function nodeRuntimeRequest(server: RuntimeServer | undefined, method: string, params?: unknown): Promise<unknown> {
    if (!server) throw new RuntimeHandlerError("host_unavailable", "Scoped project process host requires a runtime server")
    const response = await server.handleRequest(
        { id: `openade-process-${++scopedProjectProcessRequestId}`, method, params },
        { id: "openade-scoped-project-process", metadata: { clientRequestPrincipal: "openade-scoped-project-process" }, send() {} }
    )
    if (response.error) {
        const message =
            response.error.code === "method_not_found" ? "Scoped project process host requires the runtime process module" : response.error.message
        throw new RuntimeHandlerError(response.error.code, message, response.error.data)
    }
    return response.result
}

async function listNodeProjectProcesses(
    params: OpenADEProjectProcessListRequest & { repo: OpenADEProject; task?: OpenADETask; registry: Map<string, OpenADEProjectProcessRegistration>; server?: RuntimeServer }
): Promise<OpenADEProjectProcessListResult> {
    const searchRoot = await scopedProjectProcessSearchRoot(params)
    const result = await readNodeProjectProcessDefinitions(searchRoot)
    const rawList = eventRecord(await nodeRuntimeRequest(params.server, "process/list").catch(() => ({ processes: [] })))
    const rawProcesses = Array.isArray(rawList?.processes) ? rawList.processes : []
    const instances: OpenADEProjectProcessInstance[] = []

    for (const rawProcess of rawProcesses) {
        const record = eventRecord(rawProcess)
        const processId = typeof record?.processId === "string" ? record.processId : undefined
        if (!processId) continue
        const registration = params.registry.get(processId)
        if (!registration || !openADEProjectProcessScopeMatches(registration, params)) continue
        const instance = openADEProjectProcessInstanceFromUnknown(rawProcess, registration)
        if (instance) instances.push(instance)
    }

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        searchRoot: result.searchRoot,
        repoRoot: result.repoRoot,
        isWorktree: result.isWorktree,
        worktreeRoot: result.worktreeRoot,
        configs: result.configs,
        processes: result.processes,
        errors: result.errors,
        instances,
    }
}

async function startNodeProjectProcess(
    params: OpenADEProjectProcessStartRequest & { repo: OpenADEProject; task?: OpenADETask; registry: Map<string, OpenADEProjectProcessRegistration>; server?: RuntimeServer }
): Promise<OpenADEProjectProcessStartResult> {
    const searchRoot = await scopedProjectProcessSearchRoot(params)
    const result = await readNodeProjectProcessDefinitions(searchRoot)
    const processDef = result.processes.find((candidate) => candidate.id === params.definitionId)
    if (!processDef) throw new Error(`Process definition ${params.definitionId} not found`)
    const stat = await fs.stat(processDef.cwd)
    if (!stat.isDirectory()) throw new Error("process cwd is not a directory")

    const started = openADEProjectProcessStartResponseFromUnknown(
        await nodeRuntimeRequest(params.server, "process/script/start", {
            script: processDef.command,
            cwd: processDef.cwd,
            timeoutMs: openADEProjectProcessTimeout(processDef, params.timeoutMs),
        })
    )
    params.registry.set(started.processId, {
        repoId: params.repoId,
        taskId: params.taskId,
        definitionId: params.definitionId,
        cwd: processDef.cwd,
    })
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        definitionId: params.definitionId,
        processId: started.processId,
        runtimeId: started.runtimeId ?? `process:${started.processId}`,
    }
}

async function reconnectNodeProjectProcess(
    params: OpenADEProjectProcessReconnectRequest & { registry: Map<string, OpenADEProjectProcessRegistration>; server?: RuntimeServer }
): Promise<OpenADEProjectProcessReconnectResult> {
    const registration = params.registry.get(params.processId)
    if (!registration || !openADEProjectProcessScopeMatches(registration, params)) {
        return { repoId: params.repoId, taskId: params.taskId, processId: params.processId, found: false, output: [] }
    }
    return openADEProjectProcessReconnectResultFromUnknown(await nodeRuntimeRequest(params.server, "process/reconnect", { processId: params.processId }), params)
}

async function stopNodeProjectProcess(
    params: OpenADEProjectProcessStopRequest & { registry: Map<string, OpenADEProjectProcessRegistration>; server?: RuntimeServer }
): Promise<OpenADEProjectProcessStopResult> {
    const registration = params.registry.get(params.processId)
    if (!registration || !openADEProjectProcessScopeMatches(registration, params)) {
        return { repoId: params.repoId, taskId: params.taskId, processId: params.processId, ok: false, error: "Process not found" }
    }
    const result = openADEProjectProcessStopResultFromUnknown(await nodeRuntimeRequest(params.server, "process/kill", { processId: params.processId }), params)
    if (result.ok) params.registry.delete(params.processId)
    return result
}

function taskTerminalMutationResult(value: unknown, params: { repoId: string; taskId: string; terminalId: string }): OpenADETaskTerminalMutationResult {
    const record = eventRecord(value)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        terminalId: params.terminalId,
        ok: record?.ok === true,
    }
}

async function startNodeTaskTerminal(
    params: OpenADETaskTerminalStartRequest & { repo: OpenADEProject; task: OpenADETask; server?: RuntimeServer }
): Promise<OpenADETaskTerminalStartResult> {
    const cwd = await scopedTaskWorkDir(params.repo, params.task)
    const terminalId = openADETaskTerminalId(params.repoId, params.taskId)
    const result = eventRecord(
        await nodeRuntimeRequest(params.server, "pty/spawn", {
            ptyId: terminalId,
            cwd,
            cols: params.cols ?? 100,
            rows: params.rows ?? 30,
        })
    )
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        terminalId,
        runtimeId: typeof result?.runtimeId === "string" ? result.runtimeId : `pty:${terminalId}`,
        ok: result?.ok === true,
        error: typeof result?.error === "string" ? result.error : undefined,
    }
}

async function reconnectNodeTaskTerminal(
    params: OpenADETaskTerminalReconnectRequest & { repo: OpenADEProject; task: OpenADETask; server?: RuntimeServer }
): Promise<OpenADETaskTerminalReconnectResult> {
    const terminalId = params.terminalId ?? openADETaskTerminalId(params.repoId, params.taskId)
    assertOpenADETaskTerminalId({ ...params, terminalId })
    const result = eventRecord(await nodeRuntimeRequest(params.server, "pty/reconnect", { ptyId: terminalId }))
    if (!result || result.found !== true) return { repoId: params.repoId, taskId: params.taskId, terminalId, found: false, output: [] }
    const output = Array.isArray(result.output)
        ? result.output.map(openADETaskTerminalOutputChunkFromUnknown).filter((chunk): chunk is OpenADETaskTerminalOutputChunk => chunk !== null)
        : []
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        terminalId,
        found: true,
        exited: typeof result.exited === "boolean" ? result.exited : typeof result.completed === "boolean" ? result.completed : undefined,
        exitCode: typeof result.exitCode === "number" || result.exitCode === null ? result.exitCode : undefined,
        outputCount: typeof result.outputCount === "number" ? result.outputCount : output.length,
        output,
    }
}

async function writeNodeTaskTerminal(
    params: OpenADETaskTerminalWriteRequest & { repo: OpenADEProject; task: OpenADETask; server?: RuntimeServer }
): Promise<OpenADETaskTerminalMutationResult> {
    assertOpenADETaskTerminalId(params)
    const result = await nodeRuntimeRequest(params.server, "pty/write", { ptyId: params.terminalId, data: encodeOpenADETaskTerminalInput(params.data) })
    return taskTerminalMutationResult(result, params)
}

async function resizeNodeTaskTerminal(
    params: OpenADETaskTerminalResizeRequest & { repo: OpenADEProject; task: OpenADETask; server?: RuntimeServer }
): Promise<OpenADETaskTerminalMutationResult> {
    assertOpenADETaskTerminalId(params)
    const result = await nodeRuntimeRequest(params.server, "pty/resize", { ptyId: params.terminalId, cols: params.cols, rows: params.rows })
    return taskTerminalMutationResult(result, params)
}

async function stopNodeTaskTerminal(
    params: OpenADETaskTerminalStopRequest & { repo: OpenADEProject; task: OpenADETask; server?: RuntimeServer }
): Promise<OpenADETaskTerminalMutationResult> {
    assertOpenADETaskTerminalId(params)
    const result = await nodeRuntimeRequest(params.server, "pty/kill", { ptyId: params.terminalId })
    return taskTerminalMutationResult(result, params)
}

function sourceForTurn(type: OpenADETurnStartRequest["type"], label?: string): OpenADEActionEventSource {
    const userLabel = label || type
    switch (type) {
        case "plan":
            return { type: "plan", userLabel }
        case "do":
            return { type: "do", userLabel }
        case "ask":
            return { type: "ask", userLabel }
        case "revise":
            return { type: "revise", userLabel, parentEventId: "headless" }
        case "run_plan":
            return { type: "run_plan", userLabel, planEventId: "headless" }
        case "hyperplan":
            return { type: "hyperplan", userLabel, strategyId: "headless" }
    }
}

function executionIdForTask(taskId: string): string {
    return `headless-${taskId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function eventRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function latestCompletedPlanEventId(events: unknown[]): string | undefined {
    return latestCompletedPlanEvent(events)?.id as string | undefined
}

function latestCompletedPlanEvent(events: unknown[]): Record<string, unknown> | undefined {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = eventRecord(events[index])
        if (!event || event.type !== "action" || event.status !== "completed" || typeof event.id !== "string") continue
        const source = eventRecord(event.source)
        if (source?.type === "plan" || source?.type === "revise" || source?.type === "hyperplan") return event
    }
    return undefined
}

function executionEvents(event: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
    const execution = eventRecord(event?.execution)
    const events = Array.isArray(execution?.events) ? execution.events : []
    return events.filter((candidate): candidate is Record<string, unknown> => eventRecord(candidate) !== null)
}

function actionHarnessId(event: Record<string, unknown> | undefined, fallback: string): string {
    const execution = eventRecord(event?.execution)
    return typeof execution?.harnessId === "string" ? execution.harnessId : fallback
}

function taskReviewThreadXml(task: OpenADETask): string {
    const events = task.events.filter((event) => eventRecord(event)?.type !== "snapshot")
    const maxBytes = 240_000
    const included: unknown[] = []
    let byteLength = 0
    for (let index = events.length - 1; index >= 0; index--) {
        const eventText = JSON.stringify(events[index])
        const eventBytes = Buffer.byteLength(eventText, "utf8")
        if (included.length > 0 && byteLength + eventBytes > maxBytes) break
        included.unshift(events[index])
        byteLength += eventBytes
    }
    return JSON.stringify(included, null, 2)
}

function recentSnapshotFiles(task: OpenADETask, limit = 40): string[] {
    const summaries: string[] = []
    const seen = new Set<string>()

    for (let index = task.events.length - 1; index >= 0 && summaries.length < limit; index--) {
        const record = eventRecord(task.events[index])
        if (record?.type !== "snapshot") continue
        const files = Array.isArray(record.files) ? record.files : []
        for (const value of files) {
            const file = eventRecord(value)
            if (!file) continue
            const filePath = typeof file.path === "string" ? file.path : undefined
            const status = typeof file.status === "string" ? file.status : undefined
            if (!filePath || !status) continue
            const oldPath = typeof file.oldPath === "string" ? file.oldPath : undefined
            const summary = status === "renamed" && oldPath ? `renamed: ${oldPath} -> ${filePath}` : `${status}: ${filePath}`
            if (seen.has(summary)) continue
            seen.add(summary)
            summaries.push(summary)
            if (summaries.length >= limit) break
        }
    }

    return summaries
}

function notifyTaskChanged(server: RuntimeServer | undefined, repoId: string, taskId: string): void {
    if (!server) return
    publishOpenADECompanionEvent(server, {
        type: "task_changed",
        repoId,
        taskId,
        at: new Date().toISOString(),
    })
}

function notifyRepoChanged(server: RuntimeServer | undefined, repoId: string): void {
    if (!server) return
    publishOpenADECompanionEvent(server, {
        type: "repo_changed",
        repoId,
        at: new Date().toISOString(),
    })
}

function notifyRepoDeleted(server: RuntimeServer | undefined, repoId: string): void {
    if (!server) return
    publishOpenADECompanionEvent(server, {
        type: "repo_deleted",
        repoId,
        at: new Date().toISOString(),
    })
}

function notifyWorkingTasks(server: RuntimeServer | undefined): void {
    if (!server) return
    publishOpenADECompanionEvent(server, {
        type: "working_tasks",
        taskIds: server.supervisor
            .list({ ownerType: "openade-task" })
            .filter((runtime) => runtime.scope.ownerId && (runtime.status === "starting" || runtime.status === "running"))
            .map((runtime) => runtime.scope.ownerId as string),
        at: new Date().toISOString(),
    })
}

async function reconcileCheckpointedOpenADEActionEvents({
    server,
    writer,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
}): Promise<void> {
    const terminalStatuses = new Set(["completed", "failed", "stopped"])
    for (const runtime of server.supervisor.list({ ownerType: "openade-task" })) {
        if (!terminalStatuses.has(runtime.status)) continue
        const taskId = runtime.scope.ownerId
        if (!taskId) continue
        const labels = runtime.scope.labels ?? {}
        const eventId = typeof labels.eventId === "string" ? labels.eventId : undefined
        const executionId = typeof labels.executionId === "string" ? labels.executionId : runtime.nativeId
        if (!eventId && !executionId) continue

        const result = await writer.reconcileActionEventRuntime({
            taskId,
            eventId,
            executionId,
            status: runtime.status === "failed" ? "failed" : runtime.status === "stopped" ? "stopped" : "completed",
            success: runtime.status === "completed" ? true : undefined,
        }).catch(() => null)
        if (result?.changed && result.repoId) notifyTaskChanged(server, result.repoId, taskId)
    }
}

async function stopActiveOpenADERuntime({
    server,
    writer,
    agentExecutor,
    activeTaskExecutions,
    runtime,
}: {
    server: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    agentExecutor: RuntimeNodeAgentExecutor
    activeTaskExecutions: Map<string, ActiveTaskExecution>
    runtime: RuntimeRecord
}): Promise<boolean> {
    if (runtime.scope.ownerType !== "openade-task" && runtime.scope.ownerType !== "openade-turn" && runtime.scope.ownerType !== "openade-review") return false
    const activeEntry = [...activeTaskExecutions.entries()].find(([, active]) => active.runtimeId === runtime.runtimeId)
    if (!activeEntry) return false

    const [taskId, active] = activeEntry
    active.stopping = true
    const executionIds = active.childExecutionIds && active.childExecutionIds.size > 0 ? Array.from(active.childExecutionIds) : [active.executionId]
    const results = await Promise.all(executionIds.map((executionId) => agentExecutor.interrupt(executionId)))
    const failed = results.find((result) => !result.ok)
    if (failed) {
        throw new RuntimeHandlerError("stop_failed", failed.error ?? "Failed to stop OpenADE runtime", { runtimeId: runtime.runtimeId })
    }

    await writer.stoppedActionEvent({ taskId, eventId: active.eventId })
    activeTaskExecutions.delete(taskId)
    notifyWorkingTasks(server)
    notifyTaskChanged(server, active.repoId, taskId)
    return true
}

export function createRuntimeNodeOpenADEAdapters(options: RuntimeNodeOpenADEOptions = {}): OpenADEModuleAdapters {
    const dataDir = options.dataDir ?? defaultDataDir()
    const snapshotDir = path.join(path.dirname(dataDir), "snapshots")
    const imageDir = path.join(path.dirname(dataDir), "images")
    const storage = createOpenADENodeYjsStorage(dataDir)
    const projection = createOpenADEYjsProjection({
        ...storage,
        hostName: () => options.hostName,
    })
    const writer = createOpenADEYjsWriter({
        ...storage,
        hostName: () => options.hostName,
    })
    const server = options.server
    const agentExecutor = options.agentExecutor ?? createRuntimeNodeHarnessAgentExecutor()
    const activeTaskExecutions = new Map<string, ActiveTaskExecution>()
    const scopedProjectProcesses = new Map<string, OpenADEProjectProcessRegistration>()
    if (server) {
        server.registerRuntimeStopHandler((runtime) =>
            stopActiveOpenADERuntime({
                server,
                writer,
                agentExecutor,
                activeTaskExecutions,
                runtime,
            })
        )
        void reconcileCheckpointedOpenADEActionEvents({ server, writer })
    }

    async function startTurn(params: OpenADETurnStartRequest, context?: { runtimeId?: string }): Promise<{ taskId: string; eventId: string }> {
        let taskId = params.inTaskId || ""
        if (!taskId) {
            const createdAt = now()
            const request: OpenADETaskCreateRequest = {
                repoId: params.repoId,
                input: params.input,
                createdBy: { id: "headless-runtime", email: "headless@openade.local" },
                deviceId: "headless-runtime",
                title: params.title ?? fallbackOpenADETaskTitle(params.input),
                taskId: openADETaskIdForClientRequest(params.repoId, params.clientRequestId),
                createdAt,
                isolationStrategy: params.isolationStrategy,
                enabledMcpServerIds: params.enabledMcpServerIds,
            }
            const result = await writer.createTask(request)
            taskId = result.taskId
        }

        const task = await projection.readTask(params.repoId, taskId)
        const project = (await projection.readProjects()).find((candidate) => candidate.id === params.repoId)
        if (!project) throw new Error(`Repository ${params.repoId} not found`)

        if (params.type === "hyperplan") {
            const strategy = params.hyperplanStrategy
            if (!strategy) {
                return startTurn({ ...params, type: "plan", label: params.label ?? "HyperPlan", inTaskId: taskId }, context)
            }
            if (isStandardOpenADEHyperPlanStrategy(strategy)) {
                const step = strategy.steps[0]
                return startTurn(
                    {
                        ...params,
                        type: "plan",
                        harnessId: step.agent.harnessId,
                        modelId: step.agent.modelId,
                        label: params.label ?? "HyperPlan",
                        inTaskId: taskId,
                    },
                    context
                )
            }
            return startHyperPlan({ params, task, project, strategy, context })
        }

        let promptType = params.type
        let planEventId = latestCompletedPlanEventId(task.events)
        if (promptType === "revise" && !planEventId) {
            promptType = "plan"
            planEventId = undefined
        }
        if (promptType === "run_plan" && !planEventId) {
            throw new Error("Run Plan requires a completed plan event")
        }

        const prompt = buildOpenADEPrompt({
            type: promptType as "plan" | "do" | "ask" | "revise" | "run_plan",
            input: params.input,
            comments: task.comments as Parameters<typeof buildOpenADEPrompt>[0]["comments"],
            label: params.label,
            includeComments: params.includeComments,
            planEventId,
        })
        const executionId = executionIdForTask(taskId)
        const actionRequest: OpenADEActionEventCreateRequest = {
            taskId,
            userInput: params.input,
            executionId,
            harnessId: params.harnessId ?? "claude-code",
            source: prompt.source ?? sourceForTurn(params.type, params.label),
            modelId: params.modelId,
            images: params.images,
            includesCommentIds: prompt.consumedCommentIds,
            fastMode: params.fastMode,
        }
        const action = await writer.createActionEvent(actionRequest)
        const runtimeId = context?.runtimeId ?? `openade-turn:${taskId}`
        if (server) {
            const runtimePatch = {
                status: "running" as const,
                scope: {
                    ownerType: "openade-task",
                    ownerId: taskId,
                    repoPath: project.path,
                    rootPath: project.path,
                    labels: {
                        eventId: action.eventId,
                        executionId,
                    },
                },
                nativeId: executionId,
            }
            const runtime =
                server.supervisor.update(runtimeId, runtimePatch) ??
                server.supervisor.create({
                    runtimeId,
                    kind: "agent",
                    ...runtimePatch,
                })
            server.notify("runtime/updated", runtime)
        }

        activeTaskExecutions.set(taskId, { executionId, runtimeId, repoId: params.repoId, eventId: action.eventId })
        notifyWorkingTasks(server)
        notifyTaskChanged(server, params.repoId, taskId)

        void runHeadlessTurn({
            server,
            writer,
            agentExecutor,
            repoId: params.repoId,
            taskId,
            eventId: action.eventId,
            runtimeId,
            executionId,
            harnessId: actionRequest.harnessId as "claude-code" | "codex",
            cwd: project.path,
            prompt: prompt.userMessage,
            appendSystemPrompt: [prompt.systemPrompt, params.appendSystemPrompt].filter(Boolean).join("\n\n") || undefined,
            readOnly: prompt.readOnly,
            modelId: params.modelId,
            thinking: params.thinking,
            fastMode: params.fastMode,
            activeTaskExecutions,
        })

        return { taskId, eventId: action.eventId }
    }

    async function startReview(params: OpenADEReviewStartRequest, context?: { runtimeId?: string }): Promise<{ taskId: string; eventId: string }> {
        const task = await projection.readTask(params.repoId, params.taskId)
        const project = (await projection.readProjects()).find((candidate) => candidate.id === params.repoId)
        if (!project) throw new Error(`Repository ${params.repoId} not found`)

        const latestPlan = latestCompletedPlanEvent(task.events)
        const latestPlanHarnessId = actionHarnessId(latestPlan, params.harnessId)
        const planText = latestPlan ? (extractOpenADEPlanText(executionEvents(latestPlan), latestPlanHarnessId) ?? "") : ""
        const threadXml = taskReviewThreadXml(task)
        const changedFiles = recentSnapshotFiles(task)
        const reviewPrompt =
            params.reviewType === "plan"
                ? buildOpenADEPlanReviewPrompt({
                      threadXml,
                      planText,
                      changedFiles,
                      customInstructions: params.customInstructions,
                  })
                : buildOpenADEWorkReviewPrompt({
                      threadXml,
                      changedFiles,
                      customInstructions: params.customInstructions,
                  })

        const userLabel = params.reviewType === "plan" ? "Review Plan" : "Review"
        const reviewDisplayInput = params.customInstructions?.trim() ? `${userLabel}: ${params.customInstructions.trim()}` : userLabel
        const executionId = executionIdForTask(params.taskId)
        const action = await writer.createActionEvent({
            taskId: params.taskId,
            userInput: reviewDisplayInput,
            executionId,
            harnessId: params.harnessId,
            source: {
                type: "review",
                userLabel,
                reviewType: params.reviewType,
                userInstructions: params.customInstructions,
            },
            includesCommentIds: [],
            modelId: params.modelId,
        })

        const runtimeId = context?.runtimeId ?? `openade-review:${params.taskId}`
        if (server) {
            const runtimePatch = {
                status: "running" as const,
                scope: {
                    ownerType: "openade-task",
                    ownerId: params.taskId,
                    repoPath: project.path,
                    rootPath: project.path,
                    labels: {
                        eventId: action.eventId,
                        executionId,
                    },
                },
                nativeId: executionId,
            }
            const runtime =
                server.supervisor.update(runtimeId, runtimePatch) ??
                server.supervisor.create({
                    runtimeId,
                    kind: "composite",
                    ...runtimePatch,
                })
            server.notify("runtime/updated", runtime)
        }

        activeTaskExecutions.set(params.taskId, { executionId, runtimeId, repoId: params.repoId, eventId: action.eventId })
        notifyWorkingTasks(server)
        notifyTaskChanged(server, params.repoId, params.taskId)

        void runHeadlessTurn({
            server,
            writer,
            agentExecutor,
            repoId: params.repoId,
            taskId: params.taskId,
            eventId: action.eventId,
            runtimeId,
            executionId,
            harnessId: params.harnessId as "claude-code" | "codex",
            cwd: project.path,
            prompt: reviewPrompt.userMessage,
            appendSystemPrompt: reviewPrompt.systemPrompt,
            readOnly: true,
            modelId: params.modelId,
            activeTaskExecutions,
            onCompleted: async ({ events }) => {
                const reviewText = extractOpenADEPlanText(events, params.harnessId)
                if (!reviewText) return

                const followUpLabel = `${userLabel} Follow-up`
                const followUpMessage = buildOpenADEReviewHandoffPrompt({ reviewType: params.reviewType, reviewText })
                const followUpPrompt = buildOpenADEPrompt({
                    type: "ask",
                    input: followUpMessage,
                    comments: [],
                    label: followUpLabel,
                    includeComments: false,
                })
                const followUpExecutionId = executionIdForTask(params.taskId)
                const followUpAction = await writer.createActionEvent({
                    taskId: params.taskId,
                    userInput: followUpLabel,
                    executionId: followUpExecutionId,
                    harnessId: params.harnessId,
                    source: { type: "ask", userLabel: followUpLabel, origin: "review_follow_up" },
                    includesCommentIds: [],
                    modelId: params.modelId,
                })
                const runtime = server?.supervisor.update(runtimeId, {
                    status: "running",
                    scope: {
                        ownerType: "openade-task",
                        ownerId: params.taskId,
                        repoPath: project.path,
                        rootPath: project.path,
                        labels: {
                            eventId: followUpAction.eventId,
                            executionId: followUpExecutionId,
                        },
                    },
                    nativeId: followUpExecutionId,
                })
                server?.notify("runtime/updated", runtime)
                activeTaskExecutions.set(params.taskId, { executionId: followUpExecutionId, runtimeId, repoId: params.repoId, eventId: followUpAction.eventId })
                notifyWorkingTasks(server)
                notifyTaskChanged(server, params.repoId, params.taskId)

                void runHeadlessTurn({
                    server,
                    writer,
                    agentExecutor,
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: followUpAction.eventId,
                    runtimeId,
                    executionId: followUpExecutionId,
                    harnessId: params.harnessId as "claude-code" | "codex",
                    cwd: project.path,
                    prompt: followUpPrompt.userMessage,
                    appendSystemPrompt: followUpPrompt.systemPrompt,
                    readOnly: followUpPrompt.readOnly,
                    modelId: params.modelId,
                    activeTaskExecutions,
                })
            },
        })

        return { taskId: params.taskId, eventId: action.eventId }
    }

    async function startHyperPlan({
        params,
        task,
        project,
        strategy,
        context,
    }: {
        params: OpenADETurnStartRequest
        task: OpenADETask
        project: { path: string }
        strategy: OpenADEHyperPlanStrategy
        context?: { runtimeId?: string }
    }): Promise<{ taskId: string; eventId: string }> {
        const errors = validateOpenADEHyperPlanStrategy(strategy)
        if (errors.length > 0) throw new Error(`Invalid HyperPlan strategy: ${errors.join(", ")}`)
        const terminalStep = strategy.steps.find((step) => step.id === strategy.terminalStepId)
        if (!terminalStep) throw new Error(`Terminal HyperPlan step ${strategy.terminalStepId} not found`)

        const executionId = executionIdForTask(task.id)
        const action = await writer.createActionEvent({
            taskId: task.id,
            userInput: params.input,
            executionId,
            harnessId: terminalStep.agent.harnessId,
            source: { type: "hyperplan", userLabel: params.label ?? "HyperPlan", strategyId: strategy.id },
            images: params.images,
            includesCommentIds: [],
            modelId: terminalStep.agent.modelId,
            fastMode: params.fastMode,
        })

        for (const step of strategy.steps) {
            if (step.id === strategy.terminalStepId) continue
            await writer.addHyperPlanSubExecution({
                taskId: task.id,
                eventId: action.eventId,
                subExecution: {
                    stepId: step.id,
                    primitive: step.primitive,
                    harnessId: step.agent.harnessId,
                    modelId: step.agent.modelId,
                    executionId: "",
                    status: "in_progress",
                    events: [],
                },
            })
        }

        const runtimeId = context?.runtimeId ?? `openade-turn:${task.id}`
        if (server) {
            const runtimePatch = {
                status: "running" as const,
                scope: {
                    ownerType: "openade-task",
                    ownerId: task.id,
                    repoPath: project.path,
                    rootPath: project.path,
                    labels: {
                        eventId: action.eventId,
                        executionId,
                    },
                },
                nativeId: executionId,
            }
            const runtime =
                server.supervisor.update(runtimeId, runtimePatch) ??
                server.supervisor.create({
                    runtimeId,
                    kind: "composite",
                    ...runtimePatch,
                })
            server.notify("runtime/updated", runtime)
        }

        activeTaskExecutions.set(task.id, { executionId, runtimeId, repoId: params.repoId, eventId: action.eventId, childExecutionIds: new Set() })
        notifyWorkingTasks(server)
        notifyTaskChanged(server, params.repoId, task.id)

        void runHeadlessHyperPlanTurn({
            server,
            writer,
            agentExecutor,
            repoId: params.repoId,
            task,
            taskId: task.id,
            eventId: action.eventId,
            strategy,
            cwd: project.path,
            taskDescription: params.input,
            appendSystemPrompt: params.appendSystemPrompt,
            thinking: params.thinking,
            fastMode: params.fastMode,
            runtimeId,
            activeTaskExecutions,
        })

        return { taskId: task.id, eventId: action.eventId }
    }

    const snapshotPatchStore = {
        loadPatch: (patchFileId: string) => loadNodeSnapshotPatch(snapshotDir, patchFileId),
        loadIndex: (patchFileId: string) => loadNodeSnapshotIndex(snapshotDir, patchFileId),
    }

    return {
        version: () => options.version ?? "headless",
        readSnapshot: (params) => projection.readSnapshot(params),
        readProjects: (params) => projection.readProjects(params),
        readTaskList: (repoId, params) => projection.readTaskList(repoId, params),
        readTask: (repoId, taskId, params) => projection.readTask(repoId, taskId, params),
        listDataDocuments: () => projection.listDataDocuments(),
        readDataDocumentBase64: (id) => projection.readDataDocumentBase64(id),
        scopedHost: {
            listProjectFiles: listOpenADEProjectFiles,
            readProjectFile: readOpenADEProjectFile,
            writeProjectFile: writeOpenADEProjectFile,
            fuzzySearchProjectFiles: fuzzySearchOpenADEProjectFiles,
            searchProject: searchOpenADEProject,
            readProjectGitInfo: scopedProjectGitInfo,
            readProjectGitBranches: scopedProjectGitBranches,
            readProjectGitSummary: scopedProjectGitSummary,
            readTaskGitSummary: scopedTaskGitSummary,
            readTaskGitScopes: scopedTaskGitScopes,
            readTaskResourceInventory: scopedTaskResourceInventory,
            readTaskChanges: scopedTaskChanges,
            readTaskDiff: scopedTaskDiff,
            readTaskFilePair: scopedTaskFilePair,
            readTaskGitLog: scopedTaskGitLog,
            readTaskGitCommitFiles: scopedTaskGitCommitFiles,
            readTaskGitFileAtTreeish: scopedTaskGitFileAtTreeish,
            readTaskGitCommitFilePatch: scopedTaskGitCommitFilePatch,
            commitTaskGit: scopedTaskGitCommit,
            prepareTaskEnvironment: prepareScopedTaskEnvironment,
            generateTaskTitle: (params) => generateNodeTaskTitle({ ...params, agentExecutor }),
            listProjectProcesses: (params) => listNodeProjectProcesses({ ...params, registry: scopedProjectProcesses, server }),
            startProjectProcess: (params) => startNodeProjectProcess({ ...params, registry: scopedProjectProcesses, server }),
            reconnectProjectProcess: (params) => reconnectNodeProjectProcess({ ...params, registry: scopedProjectProcesses, server }),
            stopProjectProcess: (params) => stopNodeProjectProcess({ ...params, registry: scopedProjectProcesses, server }),
            startTaskTerminal: (params) => startNodeTaskTerminal({ ...params, server }),
            reconnectTaskTerminal: (params) => reconnectNodeTaskTerminal({ ...params, server }),
            writeTaskTerminal: (params) => writeNodeTaskTerminal({ ...params, server }),
            resizeTaskTerminal: (params) => resizeNodeTaskTerminal({ ...params, server }),
            stopTaskTerminal: (params) => stopNodeTaskTerminal({ ...params, server }),
            readTaskImage: (params) => readNodeTaskImage({ ...params, imageDir }),
            readTaskSnapshotPatch: (params) =>
                readOpenADETaskSnapshotPatch({
                    ...params,
                    store: snapshotPatchStore,
                }),
            readTaskSnapshotIndex: (params) =>
                readOpenADETaskSnapshotIndex({
                    ...params,
                    store: snapshotPatchStore,
                }),
            readTaskSnapshotPatchSlice: (params) =>
                readOpenADETaskSnapshotPatchSlice({
                    ...params,
                    store: snapshotPatchStore,
                }),
        },
        saveDataDocumentBase64: (id, data) => storage.saveDocumentUpdate(id, Buffer.from(data, "base64")),
        deleteDataDocument: (id) => storage.deleteDocument(id),
        createRepo: async (params) => {
            const result = await writer.createRepo(params)
            notifyRepoChanged(server, result.repoId)
            return result
        },
        updateRepo: async (params) => {
            await writer.updateRepo(params)
            notifyRepoChanged(server, params.repoId)
        },
        deleteRepo: async (params) => {
            await writer.deleteRepo(params)
            notifyRepoDeleted(server, params.repoId)
        },
        deleteTask: async (params) => {
            const result = await writer.deleteTask(params)
            if (server) {
                publishOpenADECompanionEvent(server, {
                    type: "task_deleted",
                    repoId: params.repoId,
                    taskId: params.taskId,
                    at: new Date().toISOString(),
                })
            }
            return result
        },
        startTurn,
        startReview,
        interruptTurn: async (params) => {
            const active = activeTaskExecutions.get(params.taskId)
            if (!active) return { ok: false, error: "No active headless turn is running for this task" }
            active.stopping = true
            const executionIds = active.childExecutionIds && active.childExecutionIds.size > 0 ? Array.from(active.childExecutionIds) : [active.executionId]
            const results = await Promise.all(executionIds.map((executionId) => agentExecutor.interrupt(executionId)))
            const firstError = results.find((result) => !result.ok)
            return firstError ?? { ok: true }
        },
        cancelQueuedTurn: async (params) => {
            const task = await projection.readTask(params.repoId, params.taskId)
            let cancelled = false
            const queuedTurns = (task.queuedTurns ?? []).map((turn) => {
                if (turn.id !== params.queuedTurnId) return turn
                if (turn.status !== "queued") return turn
                cancelled = true
                return { ...turn, status: "cancelled" as const, updatedAt: now() }
            })
            if (cancelled) {
                await writer.updateTaskMetadata({ taskId: params.taskId, queuedTurns })
                notifyTaskChanged(server, params.repoId, params.taskId)
            }
            return { taskId: params.taskId, queuedTurnId: params.queuedTurnId, cancelled }
        },
        setupTaskEnvironment: async (params) => {
            await writer.setupTaskEnvironment(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
        },
        createActionEvent: (params) => writer.createActionEvent(params),
        appendActionStreamEvent: (params) => writer.appendActionStreamEvent(params),
        completeActionEvent: (params) => writer.completeActionEvent(params),
        errorActionEvent: (params) => writer.errorActionEvent(params),
        stoppedActionEvent: (params) => writer.stoppedActionEvent(params),
        reconcileActionEventRuntime: async (params) => {
            const result = await writer.reconcileActionEventRuntime(params)
            if (result.changed && result.repoId) notifyTaskChanged(server, result.repoId, params.taskId)
            return result
        },
        updateActionExecution: (params) => writer.updateActionExecution(params),
        addHyperPlanSubExecution: (params) => writer.addHyperPlanSubExecution(params),
        appendHyperPlanSubExecutionStreamEvent: (params) => writer.appendHyperPlanSubExecutionStreamEvent(params),
        updateHyperPlanSubExecution: (params) => writer.updateHyperPlanSubExecution(params),
        setHyperPlanReconcileLabels: (params) => writer.setHyperPlanReconcileLabels(params),
        createSnapshotEvent: (params) => writer.createSnapshotEvent(params),
        createComment: async (params) => {
            const result = await writer.createComment(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
            return result
        },
        editComment: async (params) => {
            await writer.editComment(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
        },
        deleteComment: async (params) => {
            await writer.deleteComment(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
        },
        updateTaskMetadata: async (params) => {
            await writer.updateTaskMetadata(params)
            const project = (await projection.readProjects()).find((candidate) => candidate.tasks.some((task) => task.id === params.taskId))
            if (project) notifyTaskChanged(server, project.id, params.taskId)
        },
    }
}

export function registerRuntimeNodeOpenADEModule(server: RuntimeServer, options: RuntimeNodeOpenADEOptions = {}): void {
    const agentExecutor = options.agentExecutor ?? createRuntimeNodeHarnessAgentExecutor()
    if (options.registerAgentModule !== false) registerRuntimeNodeAgentModule(server, agentExecutor)
    server.registerModule(createOpenADEModule(createRuntimeNodeOpenADEAdapters({ ...options, server, agentExecutor })))
}

type HeadlessHyperPlanStepResult = {
    text?: string
    sessionId?: string
    status: "completed" | "error" | "stopped"
    error?: string
}

function mergeSystemPrompts(...prompts: Array<string | undefined>): string | undefined {
    const merged = prompts.filter((prompt): prompt is string => typeof prompt === "string" && prompt.trim().length > 0).join("\n\n")
    return merged.length > 0 ? merged : undefined
}

async function runHeadlessHyperPlanTurn({
    server,
    writer,
    agentExecutor,
    repoId,
    task,
    taskId,
    eventId,
    strategy,
    cwd,
    taskDescription,
    appendSystemPrompt,
    thinking,
    fastMode,
    runtimeId,
    activeTaskExecutions,
}: {
    server?: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    agentExecutor: RuntimeNodeAgentExecutor
    repoId: string
    task: OpenADETask
    taskId: string
    eventId: string
    strategy: OpenADEHyperPlanStrategy
    cwd: string
    taskDescription: string
    appendSystemPrompt?: string
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    runtimeId: string
    activeTaskExecutions: Map<string, ActiveTaskExecution>
}): Promise<void> {
    const stepResults = new Map<string, string>()
    const stepSessionIds = new Map<string, string>()
    const mainThreadContextXml = taskReviewThreadXml(task)
    let terminalSuccess = false
    let finalized = false

    const finalize = async (status: "completed" | "failed" | "stopped", error?: string) => {
        if (finalized) return
        finalized = true

        if (status === "completed") {
            await writer.completeActionEvent({ taskId, eventId, success: terminalSuccess })
            const runtime = server?.supervisor.update(runtimeId, { status: "completed" })
            server?.notify("runtime/completed", runtime)
        } else if (status === "stopped") {
            await writer.stoppedActionEvent({ taskId, eventId })
            const runtime = server?.supervisor.update(runtimeId, { status: "stopped", error })
            server?.notify("runtime/stopped", runtime)
        } else {
            await writer.errorActionEvent({ taskId, eventId })
            const runtime = server?.supervisor.update(runtimeId, { status: "failed", error })
            server?.notify("runtime/failed", runtime)
        }

        activeTaskExecutions.delete(taskId)
        notifyWorkingTasks(server)
        notifyTaskChanged(server, repoId, taskId)
    }

    try {
        for (const layer of groupOpenADEHyperPlanByDepth(strategy)) {
            if (activeTaskExecutions.get(taskId)?.stopping) {
                await finalize("stopped")
                return
            }

            const settled = await Promise.allSettled(
                layer.map((step) =>
                    runHeadlessHyperPlanStep({
                        server,
                        writer,
                        agentExecutor,
                        repoId,
                        taskId,
                        eventId,
                        strategy,
                        step,
                        cwd,
                        taskDescription,
                        appendSystemPrompt,
                        thinking,
                        fastMode,
                        stepResults,
                        stepSessionIds,
                        mainThreadContextXml,
                        runtimeId,
                        activeTaskExecutions,
                    })
                )
            )

            for (let index = 0; index < layer.length; index++) {
                const step = layer[index]
                const result = settled[index]
                const value: HeadlessHyperPlanStepResult =
                    result.status === "fulfilled"
                        ? result.value
                        : { status: "error", error: result.reason instanceof Error ? result.reason.message : "HyperPlan step failed" }
                if (value.text) stepResults.set(step.id, value.text)
                if (value.sessionId) stepSessionIds.set(step.id, value.sessionId)
                if (value.status === "stopped") {
                    await finalize("stopped", value.error)
                    return
                }
                if (step.id === strategy.terminalStepId) terminalSuccess = value.status === "completed" && Boolean(value.text)
            }
        }

        await finalize(activeTaskExecutions.get(taskId)?.stopping ? "stopped" : "completed")
    } catch (error) {
        await finalize("failed", error instanceof Error ? error.message : "HyperPlan failed")
    }
}

async function runHeadlessHyperPlanStep({
    server,
    writer,
    agentExecutor,
    repoId,
    taskId,
    eventId,
    strategy,
    step,
    cwd,
    taskDescription,
    appendSystemPrompt,
    thinking,
    fastMode,
    stepResults,
    stepSessionIds,
    mainThreadContextXml,
    runtimeId,
    activeTaskExecutions,
}: {
    server?: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    agentExecutor: RuntimeNodeAgentExecutor
    repoId: string
    taskId: string
    eventId: string
    strategy: OpenADEHyperPlanStrategy
    step: OpenADEHyperPlanStep
    cwd: string
    taskDescription: string
    appendSystemPrompt?: string
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    stepResults: Map<string, string>
    stepSessionIds: Map<string, string>
    mainThreadContextXml: string
    runtimeId: string
    activeTaskExecutions: Map<string, ActiveTaskExecution>
}): Promise<HeadlessHyperPlanStepResult> {
    const isTerminal = step.id === strategy.terminalStepId
    let prompt: { systemPrompt: string; userMessage: string }
    let resumeSessionId: string | undefined

    if (step.primitive === "plan") {
        prompt = buildOpenADEHyperPlanStepPrompt(taskDescription, { mainThreadContextXml })
    } else if (step.primitive === "review") {
        const inputStepId = step.inputs[0]
        const inputText = stepResults.get(inputStepId)
        if (!inputText) {
            const error = `Review step ${step.id} has no input text from ${inputStepId}`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        prompt = buildOpenADEReviewStepPrompt(taskDescription, inputText, inputStepId)
    } else if (step.primitive === "reconcile") {
        const inputs = step.inputs
            .map((inputId) => {
                const text = stepResults.get(inputId)
                const inputStep = strategy.steps.find((candidate) => candidate.id === inputId)
                if (!text || !inputStep || (inputStep.primitive !== "plan" && inputStep.primitive !== "review")) return null
                return {
                    stepId: inputId,
                    primitive: inputStep.primitive,
                    text,
                    reviewsStepId: inputStep.primitive === "review" ? inputStep.inputs[0] : undefined,
                }
            })
            .filter((input): input is NonNullable<typeof input> => input !== null)
        if (inputs.length === 0) {
            const error = `Reconcile step ${step.id} has no successful inputs`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        const reconciled = buildOpenADEReconcileStepPrompt(taskDescription, inputs)
        await writer.setHyperPlanReconcileLabels({ taskId, eventId, mapping: reconciled.labelMapping })
        prompt = reconciled
    } else {
        const reviewStepId = step.inputs[0]
        const reviewText = stepResults.get(reviewStepId)
        if (!reviewText || !step.resumeStepId) {
            const error = `Revise step ${step.id} is missing review input or resume target`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        resumeSessionId = stepSessionIds.get(step.resumeStepId)
        if (!resumeSessionId) {
            const error = `Cannot resume session for step ${step.resumeStepId}`
            if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, status: "error", error })
            return { status: "error", error }
        }
        prompt = buildOpenADEReviseStepPrompt(reviewText, reviewStepId)
    }

    const executionId = `hyperplan-${taskId}-${step.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const active = activeTaskExecutions.get(taskId)
    active?.childExecutionIds?.add(executionId)
    if (!isTerminal) await writer.updateHyperPlanSubExecution({ taskId, eventId, stepId: step.id, executionId, status: "in_progress" })

    const persistedWrites: Array<Promise<unknown>> = []
    const events: Array<Record<string, unknown> & { id: string }> = []
    let sessionId: string | undefined
    let settled = false
    const persist = (write: Promise<unknown>) => {
        persistedWrites.push(write.catch((error) => console.warn("[RuntimeNodeOpenADE] Failed to persist HyperPlan stream event:", error)))
    }

    return new Promise((resolve) => {
        const finish = (result: HeadlessHyperPlanStepResult) => {
            if (settled) return
            settled = true
            void (async () => {
                await Promise.all(persistedWrites)
                const text = extractOpenADEPlanText(events, step.agent.harnessId) ?? undefined
                if (!isTerminal) {
                    await writer.updateHyperPlanSubExecution({
                        taskId,
                        eventId,
                        stepId: step.id,
                        status: result.status === "completed" ? "completed" : result.status === "stopped" ? "stopped" : "error",
                        resultText: text,
                        error: result.status === "error" ? result.error ?? "Execution failed" : undefined,
                    })
                }
                resolve({
                    ...result,
                    text: result.text ?? text,
                    sessionId: result.sessionId ?? sessionId,
                })
            })()
        }

        void agentExecutor
            .start(
                {
                    executionId,
                    harnessId: step.agent.harnessId as "claude-code" | "codex",
                    prompt: prompt.userMessage,
                    cwd,
                    mode: "read-only",
                    model: step.agent.modelId,
                    thinking: thinking ?? "high",
                    fastMode,
                    appendSystemPrompt: mergeSystemPrompts(prompt.systemPrompt, appendSystemPrompt),
                    resumeSessionId,
                    forkSession: resumeSessionId ? false : undefined,
                    processLabel: `OpenADE HyperPlan ${taskId} ${step.id}`,
                },
                {
                    onSpawn(info) {
                        const runtime = server?.supervisor.update(runtimeId, {
                            pid: info.pid,
                            pgid: info.pgid,
                            processLabel: info.processLabel,
                            processStartedAt: info.processStartedAt,
                        })
                        server?.notify("runtime/updated", runtime)
                    },
                    onEvent(event) {
                        events.push(event)
                        server?.supervisor.touchByOwner("openade-task", taskId)
                        server?.notify("agent/event", event)
                        if (isTerminal) {
                            persist(writer.appendActionStreamEvent({ taskId, eventId, streamEvent: event }))
                        } else {
                            persist(writer.appendHyperPlanSubExecutionStreamEvent({ taskId, eventId, stepId: step.id, streamEvent: event }))
                        }
                        if (event.type === "session_started" && typeof event.sessionId === "string") {
                            sessionId = event.sessionId
                            if (isTerminal) {
                                persist(writer.updateActionExecution({ taskId, eventId, sessionId: event.sessionId, parentSessionId: resumeSessionId }))
                            } else {
                                persist(
                                    writer.updateHyperPlanSubExecution({
                                        taskId,
                                        eventId,
                                        stepId: step.id,
                                        sessionId: event.sessionId,
                                        parentSessionId: resumeSessionId,
                                    })
                                )
                            }
                        }
                        notifyTaskChanged(server, repoId, taskId)
                    },
                    onSettled(result) {
                        if (result.status === "completed") finish({ status: "completed", sessionId: result.sessionId })
                        else if (result.status === "stopped") finish({ status: "stopped", sessionId: result.sessionId, error: result.error })
                        else finish({ status: "error", sessionId: result.sessionId, error: result.error ?? "Execution failed" })
                    },
                }
            )
            .then((start) => {
                if (!start.ok) finish({ status: "error", error: start.error ?? "Failed to start HyperPlan step" })
            })
            .catch((error) => {
                finish({ status: "error", error: error instanceof Error ? error.message : "Failed to start HyperPlan step" })
            })
    })
}

async function runHeadlessTurn({
    server,
    writer,
    agentExecutor,
    repoId,
    taskId,
    eventId,
    runtimeId,
    executionId,
    harnessId,
    cwd,
    prompt,
    appendSystemPrompt,
    readOnly,
    modelId,
    thinking,
    fastMode,
    activeTaskExecutions,
    onCompleted,
}: {
    server?: RuntimeServer
    writer: ReturnType<typeof createOpenADEYjsWriter>
    agentExecutor: RuntimeNodeAgentExecutor
    repoId: string
    taskId: string
    eventId: string
    runtimeId: string
    executionId: string
    harnessId: "claude-code" | "codex"
    cwd: string
    prompt: string
    appendSystemPrompt?: string
    readOnly: boolean
    modelId?: string
    thinking?: OpenADETurnStartRequest["thinking"]
    fastMode?: boolean
    activeTaskExecutions: Map<string, ActiveTaskExecution>
    onCompleted?: (result: { events: Array<Record<string, unknown>>; sessionId?: string }) => Promise<void> | void
}): Promise<void> {
    const pendingWrites: Array<Promise<unknown>> = []
    const observedEvents: Array<Record<string, unknown>> = []
    let savedSessionId: string | undefined
    let finalized = false

    const enqueue = (write: Promise<unknown>) => {
        pendingWrites.push(write.catch((error) => console.warn("[RuntimeNodeOpenADE] Failed to persist stream event:", error)))
    }
    const finalize = async (status: "completed" | "failed" | "stopped", error?: string) => {
        if (finalized) return
        finalized = true
        await Promise.all(pendingWrites)

        if (status === "completed") {
            await writer.completeActionEvent({ taskId, eventId, success: true })
            const runtime = server?.supervisor.update(runtimeId, { status: "completed" })
            server?.notify("runtime/completed", runtime)
        } else if (status === "stopped") {
            await writer.stoppedActionEvent({ taskId, eventId })
            const runtime = server?.supervisor.update(runtimeId, { status: "stopped", error })
            server?.notify("runtime/stopped", runtime)
        } else {
            await writer.errorActionEvent({ taskId, eventId })
            const runtime = server?.supervisor.update(runtimeId, { status: "failed", error })
            server?.notify("runtime/failed", runtime)
        }

        activeTaskExecutions.delete(taskId)
        notifyWorkingTasks(server)
        notifyTaskChanged(server, repoId, taskId)

        if (status === "completed" && onCompleted) {
            await onCompleted({ events: observedEvents, sessionId: savedSessionId })
        }
    }

    const start = await agentExecutor.start(
        {
            executionId,
            harnessId,
            prompt,
            cwd,
            mode: readOnly ? "read-only" : "yolo",
            model: modelId,
            thinking,
            fastMode,
            appendSystemPrompt,
            processLabel: `OpenADE ${taskId}`,
        },
        {
            onSpawn(info) {
                const runtime = server?.supervisor.update(runtimeId, {
                    pid: info.pid,
                    pgid: info.pgid,
                    processLabel: info.processLabel,
                    processStartedAt: info.processStartedAt,
                })
                server?.notify("runtime/updated", runtime)
            },
            onEvent(event) {
                observedEvents.push(event)
                server?.supervisor.touchByOwner("openade-task", taskId)
                server?.notify("agent/event", event)
                enqueue(writer.appendActionStreamEvent({ taskId, eventId, streamEvent: event }))
                if (event.type === "session_started" && typeof event.sessionId === "string") {
                    savedSessionId = event.sessionId
                    enqueue(writer.updateActionExecution({ taskId, eventId, sessionId: event.sessionId }))
                }
                if (event.type === "complete") void finalize("completed")
                if (event.type === "error") void finalize(event.code === "aborted" ? "stopped" : "failed", typeof event.error === "string" ? event.error : undefined)
                notifyTaskChanged(server, repoId, taskId)
            },
            onSettled(result) {
                if (result.status === "completed") void finalize("completed")
                else if (result.status === "stopped") void finalize("stopped", result.error)
                else void finalize("failed", result.error)
            },
        }
    )

    if (!start.ok) {
        await finalize("failed", start.error ?? "Agent execution failed")
    }
}
