import { makeAutoObservable, reaction, runInAction } from "mobx"
import { type FileTreeNode, type FlatTreeEntry, buildFileTree, collectAllDirPaths, flattenFileTree } from "../../components/utils/changesTree"
import { type ChangedFileInfo, type GetFilePairResponse, type GetFilePatchResponse, type GitSummaryResponse, gitApi } from "../../electronAPI/git"
import type { PatchContextLines } from "../../utils/gitDiffContext"
import type { TaskModel } from "../TaskModel"

type DiffSource = "uncommitted" | "from-base"
type ChangesViewMode = "current" | "split" | "unified"

function deriveUncommittedFiles(status: GitSummaryResponse): ChangedFileInfo[] {
    const files: ChangedFileInfo[] = []
    const seen = new Set<string>()

    for (const file of [...status.staged.files, ...status.unstaged.files]) {
        if (!seen.has(file.path)) {
            seen.add(file.path)
            files.push({ path: file.path, status: file.status ?? "modified", binary: file.binary })
        }
    }

    for (const file of status.untracked) {
        files.push({ path: file.path, status: "added", binary: file.binary })
    }

    return files
}

export class ChangesManager {
    selectedFilePath: string | null = null
    diffSource: DiffSource = "uncommitted"
    expandedPaths: Set<string> = new Set()

    filePair: GetFilePairResponse | null = null
    filePatch: GetFilePatchResponse | null = null
    filePairLoading = false
    filePatchLoading = false

    fromBaseFiles: ChangedFileInfo[] | null = null
    fromBaseLoading = false

    private filePairLoadId = 0
    private filePatchLoadId = 0
    private filePatchContextLines: PatchContextLines = 3
    private filePairCache = new Map<string, GetFilePairResponse>()
    private filePatchCache = new Map<string, GetFilePatchResponse>()
    private disposers: Array<() => void> = []

    constructor(private taskModel: TaskModel) {
        makeAutoObservable<
            this,
            "taskModel" | "filePairLoadId" | "filePatchLoadId" | "filePatchContextLines" | "filePairCache" | "filePatchCache" | "disposers"
        >(this, {
            taskModel: false,
            filePairLoadId: false,
            filePatchLoadId: false,
            filePatchContextLines: false,
            filePairCache: false,
            filePatchCache: false,
            disposers: false,
        })

        this.disposers.push(
            reaction(
                () => this.taskModel.gitStatus,
                () => this.onGitStatusChanged()
            )
        )
    }

    dispose(): void {
        for (const d of this.disposers) d()
        this.disposers = []
    }

    // === Computed ===

    get uncommittedFiles(): ChangedFileInfo[] {
        const status = this.taskModel.gitStatus
        if (!status) return []
        return deriveUncommittedFiles(status)
    }

    get files(): ChangedFileInfo[] {
        return this.diffSource === "uncommitted" ? this.uncommittedFiles : (this.fromBaseFiles ?? [])
    }

    get fileTree(): FileTreeNode[] {
        return buildFileTree(this.files)
    }

    get flatEntries(): FlatTreeEntry[] {
        return flattenFileTree(this.fileTree, this.expandedPaths)
    }

    get fileLoading(): boolean {
        return this.filePairLoading || this.filePatchLoading
    }

    get isLoading(): boolean {
        return this.diffSource === "uncommitted" ? this.taskModel.gitStatus === null : this.fromBaseLoading
    }

    get selectedFile(): ChangedFileInfo | null {
        if (this.files.length === 0) return null
        if (this.selectedFilePath) {
            return this.files.find((f) => f.path === this.selectedFilePath) ?? this.files[0]
        }
        return this.files[0]
    }

    // === Actions ===

    selectFile(path: string): void {
        if (this.selectedFilePath === path) return
        this.selectedFilePath = path
        this.filePair = null
        this.filePatch = null
    }

    setDiffSource(source: DiffSource): void {
        if (this.diffSource === source) return
        this.diffSource = source
        this.clearLoadedFiles()
        this.clearCaches()
        if (source === "from-base" && this.fromBaseFiles === null) {
            this.loadFromBaseFiles()
        }
    }

    toggleExpanded(_path: string): void {
        this.expandedPaths = this.buildExpandedPaths(this.fileTree)
    }

    refresh(): void {
        this.taskModel.refreshGitState()
    }

    beginPatchContextTransition(contextLines: PatchContextLines): void {
        this.filePatchContextLines = contextLines
        this.filePatchLoading = true
    }

    ensureSelectedFileLoaded(mode: ChangesViewMode, patchContextLines?: PatchContextLines): void {
        if (mode === "current") {
            void this.loadFilePair()
        } else {
            const nextContextLines = patchContextLines ?? this.filePatchContextLines
            if (this.filePatchContextLines !== nextContextLines) {
                this.filePatchContextLines = nextContextLines
                this.filePatch = null
            }
            void this.loadFilePatch(nextContextLines)
        }
    }

    // === Internal ===

    private onGitStatusChanged(): void {
        // Reset from-base cache (new commits may exist)
        this.fromBaseFiles = null
        this.clearCaches()

        if (this.diffSource === "from-base") {
            void this.loadFromBaseFiles()
        }

        const tree = this.fileTree
        this.expandedPaths = this.buildExpandedPaths(tree)

        // Validate selection still exists
        if (this.selectedFilePath && !this.files.some((f) => f.path === this.selectedFilePath)) {
            this.selectedFilePath = this.files[0]?.path ?? null
            this.clearLoadedFiles()
        }

        if (this.selectedFile) {
            if (this.filePair !== null) {
                void this.loadFilePair()
            }
            if (this.filePatch !== null) {
                void this.loadFilePatch(this.filePatchContextLines)
            }
        }
    }

    private get workDir(): string | undefined {
        return this.taskModel.environment?.taskWorkingDir
    }

    private get fromTreeish(): string {
        return this.diffSource === "uncommitted" ? "HEAD" : (this.taskModel.environment?.mergeBaseCommit ?? "HEAD")
    }

    private get toTreeish(): string {
        return this.diffSource === "uncommitted" ? "" : "HEAD"
    }

    private async loadFilePair(): Promise<void> {
        const file = this.selectedFile
        const dir = this.workDir
        if (!file || !dir) {
            runInAction(() => {
                this.filePair = null
                this.filePairLoading = false
            })
            return
        }

        if (file.binary) {
            runInAction(() => {
                this.filePair = null
                this.filePairLoading = false
            })
            return
        }

        const cacheKey = this.getFilePairCacheKey(file)
        const cached = this.filePairCache.get(cacheKey)
        if (cached) {
            runInAction(() => {
                this.filePair = cached
                this.filePairLoading = false
            })
            return
        }

        const loadId = ++this.filePairLoadId
        const isInitialLoad = this.filePair === null
        if (isInitialLoad) {
            this.filePairLoading = true
        }

        try {
            const result = await gitApi.getFilePair({
                workDir: dir,
                fromTreeish: this.fromTreeish,
                toTreeish: this.toTreeish,
                filePath: file.path,
                oldPath: file.oldPath,
            })
            runInAction(() => {
                if (loadId !== this.filePairLoadId) return
                this.filePairCache.set(cacheKey, result)
                // Skip update if content hasn't changed — prevents unnecessary
                // re-renders that would destroy open CommentForms
                const prev = this.filePair
                if (!prev || prev.before !== result.before || prev.after !== result.after || prev.tooLarge !== result.tooLarge) {
                    this.filePair = result
                }
                this.filePairLoading = false
            })
        } catch (err) {
            console.error("[ChangesManager] Failed to load file pair:", err)
            runInAction(() => {
                if (loadId !== this.filePairLoadId) return
                this.filePair = null
                this.filePairLoading = false
            })
        }
    }

    private async loadFilePatch(contextLines: PatchContextLines = this.filePatchContextLines): Promise<void> {
        const file = this.selectedFile
        const dir = this.workDir
        if (!file || !dir) {
            runInAction(() => {
                this.filePatch = null
                this.filePatchLoading = false
            })
            return
        }

        if (file.binary) {
            runInAction(() => {
                this.filePatch = null
                this.filePatchLoading = false
            })
            return
        }

        this.filePatchContextLines = contextLines

        const cacheKey = this.getFilePatchCacheKey(file, contextLines)
        const cached = this.filePatchCache.get(cacheKey)
        if (cached) {
            runInAction(() => {
                this.filePatch = cached
                this.filePatchLoading = false
            })
            return
        }

        const loadId = ++this.filePatchLoadId
        this.filePatchLoading = true

        try {
            const result = await gitApi.getWorktreeFilePatch({
                workDir: dir,
                fromTreeish: this.fromTreeish,
                filePath: file.path,
                oldPath: file.oldPath,
                contextLines,
            })

            runInAction(() => {
                if (loadId !== this.filePatchLoadId) return
                this.filePatchCache.set(cacheKey, result)
                const prev = this.filePatch
                if (
                    !prev ||
                    prev.patch !== result.patch ||
                    prev.truncated !== result.truncated ||
                    prev.heavy !== result.heavy ||
                    prev.stats.insertions !== result.stats.insertions ||
                    prev.stats.deletions !== result.stats.deletions ||
                    prev.stats.changedLines !== result.stats.changedLines ||
                    prev.stats.hunkCount !== result.stats.hunkCount
                ) {
                    this.filePatch = result
                }
                this.filePatchLoading = false
            })
        } catch (err) {
            console.error("[ChangesManager] Failed to load file patch:", err)
            runInAction(() => {
                if (loadId !== this.filePatchLoadId) return
                this.filePatch = null
                this.filePatchLoading = false
            })
        }
    }

    private async loadFromBaseFiles(): Promise<void> {
        const dir = this.workDir
        const mergeBase = this.taskModel.environment?.mergeBaseCommit
        if (!dir || !mergeBase) return

        this.fromBaseLoading = true

        try {
            const result = await gitApi.getChangedFiles({
                workDir: dir,
                fromTreeish: mergeBase,
                toTreeish: "HEAD",
            })
            runInAction(() => {
                this.fromBaseFiles = result.files
                this.fromBaseLoading = false
                this.expandedPaths = this.buildExpandedPaths(this.fileTree)
                if (!this.selectedFilePath || !this.files.some((f) => f.path === this.selectedFilePath)) {
                    this.selectedFilePath = this.files[0]?.path ?? null
                }
                this.clearLoadedFiles()
            })
        } catch (err) {
            console.error("[ChangesManager] Failed to load from-base files:", err)
            runInAction(() => {
                this.fromBaseFiles = []
                this.fromBaseLoading = false
            })
        }
    }

    initializeForTray(): void {
        this.expandedPaths = this.buildExpandedPaths(this.fileTree)

        if (!this.selectedFilePath && this.files.length > 0) {
            this.selectedFilePath = this.files[0].path
        }
    }

    private buildExpandedPaths(tree: FileTreeNode[]): Set<string> {
        return collectAllDirPaths(tree)
    }

    private clearLoadedFiles(): void {
        this.filePair = null
        this.filePatch = null
        this.filePairLoading = false
        this.filePatchLoading = false
    }

    private clearCaches(): void {
        this.filePairCache.clear()
        this.filePatchCache.clear()
    }

    private getFilePairCacheKey(file: ChangedFileInfo): string {
        return [this.diffSource, this.fromTreeish, this.toTreeish, file.path, file.oldPath ?? ""].join("::")
    }

    private getFilePatchCacheKey(file: ChangedFileInfo, contextLines: PatchContextLines): string {
        return [this.diffSource, this.fromTreeish, this.toTreeish, file.path, file.oldPath ?? "", `U${contextLines}`].join("::")
    }
}
