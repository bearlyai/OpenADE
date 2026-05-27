import {
    createRuntimeNodeLocalFilesAdapter,
    registerRuntimeNodeFilesModule,
    registerRuntimeNodeFsWatchModule,
    registerRuntimeNodeGitModule,
    registerRuntimeNodeProcessModule,
    registerRuntimeNodePtyModule,
} from "../../../../runtime-node/src"
import type { RuntimeServer } from "../../../../runtime/src"
import {
    describeRuntimePath,
    fuzzySearchRuntimeFiles,
    searchRuntimeFileContent,
} from "../code/files"
import {
    checkRuntimeGhCli,
    commitRuntimeWorkTree,
    deleteRuntimeBranch,
    deleteRuntimeWorkTree,
    getRuntimeChangedFiles,
    getRuntimeCommitFilePatch,
    getRuntimeCommitFiles,
    getRuntimeFileAtTreeish,
    getRuntimeFilePair,
    getRuntimeGitLog,
    getRuntimeGitStatus,
    getRuntimeGitSummary,
    getRuntimeMergeBase,
    getRuntimeWorkTreeDiffPatch,
    getRuntimeWorktreeFilePatch,
    getOrCreateRuntimeWorkTree,
    initRuntimeGit,
    isRuntimeBranchMerged,
    isRuntimeGitInstalled,
    isRuntimeGitDirectory,
    listRuntimeBranches,
    listRuntimeGitFiles,
    listRuntimeWorkTrees,
    resolveRuntimeGitPath,
} from "../code/git"
import {
    addProcessLifecycleListener,
    killAllRuntimeProcesses,
    killRuntimeProcess,
    listRuntimeProcesses,
    reconnectRuntimeProcess,
    startRuntimeCommand,
    startRuntimeScript,
} from "../code/process"
import {
    addPtyLifecycleListener,
    killAllRuntimePtys,
    killRuntimePty,
    reconnectRuntimePty,
    resizeRuntimePty,
    spawnRuntimePty,
    writeRuntimePty,
} from "../code/pty"

let removeProcessModule: (() => void) | null = null
let removePtyModule: (() => void) | null = null
let removeFsWatchModule: (() => void) | null = null

export function registerRuntimeHostModule(server: RuntimeServer): void {
    removeProcessModule?.()
    removePtyModule?.()
    removeFsWatchModule?.()
    removeProcessModule = registerRuntimeNodeProcessModule(server, {
        addLifecycleListener: addProcessLifecycleListener,
        startCommand: startRuntimeCommand,
        startScript: startRuntimeScript,
        list: listRuntimeProcesses,
        reconnect: reconnectRuntimeProcess,
        kill: killRuntimeProcess,
        killAll: killAllRuntimeProcesses,
    })
    removePtyModule = registerRuntimeNodePtyModule(server, {
        addLifecycleListener: addPtyLifecycleListener,
        spawn: spawnRuntimePty,
        write: writeRuntimePty,
        resize: resizeRuntimePty,
        reconnect: reconnectRuntimePty,
        kill: killRuntimePty,
        killAll: killAllRuntimePtys,
    })
    removeFsWatchModule = registerRuntimeNodeFsWatchModule(server)
    const localFiles = createRuntimeNodeLocalFilesAdapter()
    registerRuntimeNodeFilesModule(server, {
        describePath: describeRuntimePath,
        readFile: localFiles.readFile,
        writeFile: localFiles.writeFile,
        createDirectory: localFiles.createDirectory,
        removePath: localFiles.removePath,
        copyPath: localFiles.copyPath,
        fuzzySearch: fuzzySearchRuntimeFiles,
        searchContent: searchRuntimeFileContent,
    })
    registerRuntimeNodeGitModule(server, {
        isInstalled: isRuntimeGitInstalled,
        isDirectory: isRuntimeGitDirectory,
        checkGhCli: checkRuntimeGhCli,
        getOrCreateWorkTree: getOrCreateRuntimeWorkTree,
        getWorkTreeDiffPatch: getRuntimeWorkTreeDiffPatch,
        getMergeBase: getRuntimeMergeBase,
        getSummary: getRuntimeGitSummary,
        getStatus: getRuntimeGitStatus,
        listFiles: listRuntimeGitFiles,
        deleteWorkTree: deleteRuntimeWorkTree,
        isBranchMerged: isRuntimeBranchMerged,
        deleteBranch: deleteRuntimeBranch,
        listWorkTrees: listRuntimeWorkTrees,
        commitWorkTree: commitRuntimeWorkTree,
        listBranches: listRuntimeBranches,
        resolvePath: resolveRuntimeGitPath,
        initRepo: initRuntimeGit,
        getLog: getRuntimeGitLog,
        getCommitFiles: getRuntimeCommitFiles,
        getChangedFiles: getRuntimeChangedFiles,
        getFileAtTreeish: getRuntimeFileAtTreeish,
        getFilePair: getRuntimeFilePair,
        getWorktreeFilePatch: getRuntimeWorktreeFilePatch,
        getCommitFilePatch: getRuntimeCommitFilePatch,
    })
}

export function cleanupRuntimeHostModule(): void {
    removeProcessModule?.()
    removeProcessModule = null
    removePtyModule?.()
    removePtyModule = null
    removeFsWatchModule?.()
    removeFsWatchModule = null
}
