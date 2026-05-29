import type { RuntimeServer } from "../../runtime/src"
import { optionalBoolean, optionalFiniteNumber, optionalString, requiredPositiveInteger, requiredString, validateParams } from "./validation"

export interface RuntimeNodeGitAdapter {
    isInstalled(): Promise<unknown> | unknown
    isDirectory(params: unknown): Promise<unknown> | unknown
    checkGhCli(): Promise<unknown> | unknown
    getOrCreateWorkTree(params: unknown): Promise<unknown> | unknown
    getWorkTreeDiffPatch(params: unknown): Promise<unknown> | unknown
    getMergeBase(params: unknown): Promise<unknown> | unknown
    getSummary(params: unknown): Promise<unknown> | unknown
    getStatus(params: unknown): Promise<unknown> | unknown
    listFiles(params: unknown): Promise<unknown> | unknown
    deleteWorkTree(params: unknown): Promise<unknown> | unknown
    isBranchMerged(params: unknown): Promise<unknown> | unknown
    deleteBranch(params: unknown): Promise<unknown> | unknown
    listWorkTrees(params: unknown): Promise<unknown> | unknown
    commitWorkTree(params: unknown): Promise<unknown> | unknown
    listBranches(params: unknown): Promise<unknown> | unknown
    resolvePath(params: unknown): Promise<unknown> | unknown
    initRepo(params: unknown): Promise<unknown> | unknown
    getLog(params: unknown): Promise<unknown> | unknown
    getCommitFiles(params: unknown): Promise<unknown> | unknown
    getChangedFiles(params: unknown): Promise<unknown> | unknown
    getFileAtTreeish(params: unknown): Promise<unknown> | unknown
    getFilePair(params: unknown): Promise<unknown> | unknown
    getWorktreeFilePatch(params: unknown): Promise<unknown> | unknown
    getCommitFilePatch(params: unknown): Promise<unknown> | unknown
}

export function registerRuntimeNodeGitModule(server: RuntimeServer, adapter: RuntimeNodeGitAdapter): void {
    server.register("git/installed/read", () => adapter.isInstalled())
    server.register("git/directory/read", (params) => adapter.isDirectory(params), {
        validateParams: validateParams(requiredString("directory")),
    })
    server.register("git/gh/read", () => adapter.checkGhCli())
    server.register("git/worktree/getOrCreate", (params) => adapter.getOrCreateWorkTree(params), {
        validateParams: validateParams(requiredString("repoDir"), requiredString("id"), optionalString("sourceTreeish")),
    })
    server.register("git/worktree/diffPatch", (params) => adapter.getWorkTreeDiffPatch(params), {
        validateParams: validateParams(requiredString("repoDir"), requiredString("workTreeId"), requiredString("compareToCommit")),
    })
    server.register("git/mergeBase/read", (params) => adapter.getMergeBase(params), {
        validateParams: validateParams(requiredString("repoDir"), requiredString("workTreeId"), requiredString("targetBranch")),
    })
    server.register("git/summary/read", (params) => adapter.getSummary(params), {
        validateParams: validateParams(requiredString("repoDir"), optionalString("workTreeId")),
    })
    server.register("git/status/read", (params) => adapter.getStatus(params), {
        validateParams: validateParams(requiredString("repoDir"), optionalString("workTreeId")),
    })
    server.register("git/file/list", (params) => adapter.listFiles(params), {
        validateParams: validateParams(requiredString("repoDir"), optionalString("workTreeId"), optionalString("query"), optionalFiniteNumber("limit")),
    })
    server.register("git/worktree/delete", (params) => adapter.deleteWorkTree(params), {
        validateParams: validateParams(requiredString("repoDir"), requiredString("id")),
    })
    server.register("git/branch/merged/read", (params) => adapter.isBranchMerged(params), {
        validateParams: validateParams(requiredString("repoDir"), requiredString("branchName"), requiredString("targetBranch")),
    })
    server.register("git/branch/delete", (params) => adapter.deleteBranch(params), {
        validateParams: validateParams(requiredString("repoDir"), requiredString("branchName")),
    })
    server.register("git/worktree/list", (params) => adapter.listWorkTrees(params), {
        validateParams: validateParams(requiredString("repoDir")),
    })
    server.register("git/worktree/commit", (params) => adapter.commitWorkTree(params), {
        validateParams: validateParams(requiredString("repoDir"), requiredString("workTreeId"), requiredString("message")),
    })
    server.register("git/branch/list", (params) => adapter.listBranches(params), {
        validateParams: validateParams(requiredString("repoDir"), optionalBoolean("includeRemote")),
    })
    server.register("git/path/resolve", (params) => adapter.resolvePath(params), {
        validateParams: validateParams(requiredString("path")),
    })
    server.register("git/repo/init", (params) => adapter.initRepo(params), {
        validateParams: validateParams(requiredString("directory")),
    })
    server.register("git/log/read", (params) => adapter.getLog(params), {
        validateParams: validateParams(requiredString("workDir"), optionalString("ref"), optionalFiniteNumber("limit"), optionalFiniteNumber("skip")),
    })
    server.register("git/commit/files/read", (params) => adapter.getCommitFiles(params), {
        validateParams: validateParams(requiredString("workDir"), requiredString("commit")),
    })
    server.register("git/changedFiles/read", (params) => adapter.getChangedFiles(params), {
        validateParams: validateParams(requiredString("workDir"), requiredString("fromTreeish"), requiredString("toTreeish")),
    })
    server.register("git/fileAtTreeish/read", (params) => adapter.getFileAtTreeish(params), {
        validateParams: validateParams(requiredString("workDir"), requiredString("treeish"), requiredString("filePath")),
    })
    server.register("git/filePair/read", (params) => adapter.getFilePair(params), {
        validateParams: validateParams(requiredString("workDir"), requiredString("fromTreeish"), requiredString("toTreeish"), requiredString("filePath"), optionalString("oldPath")),
    })
    server.register("git/worktree/filePatch/read", (params) => adapter.getWorktreeFilePatch(params), {
        validateParams: validateParams(
            requiredString("workDir"),
            requiredString("fromTreeish"),
            requiredString("filePath"),
            optionalString("oldPath"),
            requiredPositiveInteger("contextLines"),
            optionalBoolean("allowTruncation")
        ),
    })
    server.register("git/commit/filePatch/read", (params) => adapter.getCommitFilePatch(params), {
        validateParams: validateParams(
            requiredString("workDir"),
            requiredString("commit"),
            requiredString("filePath"),
            optionalString("oldPath"),
            requiredPositiveInteger("contextLines"),
            optionalBoolean("allowTruncation")
        ),
    })
}
