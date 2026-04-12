import { makeAutoObservable, reaction, runInAction } from "mobx"
import { type ChangedFileInfo, type GetFilePairResponse, type GitStatusResponse, gitApi } from "../../electronAPI/git"
import { buildFileTree, collectAllDirPaths, flattenFileTree, type FileTreeNode, type FlatTreeEntry } from "../../components/utils/changesTree"
import type { TaskModel } from "../TaskModel"

type DiffSource = "uncommitted" | "from-base"

function deriveUncommittedFiles(status: GitStatusResponse): ChangedFileInfo[] {
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
    fileLoading = false

    fromBaseFiles: ChangedFileInfo[] | null = null
    fromBaseLoading = false

    private filePairLoadId = 0
    private disposers: Array<() => void> = []

    constructor(private taskModel: TaskModel) {
        makeAutoObservable<this, "taskModel" | "filePairLoadId" | "disposers">(this, {
            taskModel: false,
            filePairLoadId: false,
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
        this.loadFilePair()
    }

    setDiffSource(source: DiffSource): void {
        if (this.diffSource === source) return
        this.diffSource = source
        if (source === "from-base" && this.fromBaseFiles === null) {
            this.loadFromBaseFiles()
        }
    }

    toggleExpanded(path: string): void {
        if (this.expandedPaths.has(path)) {
            this.expandedPaths.delete(path)
        } else {
            this.expandedPaths.add(path)
        }
    }

    refresh(): void {
        this.taskModel.refreshGitState()
    }

    // === Internal ===

    private onGitStatusChanged(): void {
        // Reset from-base cache (new commits may exist)
        this.fromBaseFiles = null

        if (this.diffSource === "from-base") {
            this.loadFromBaseFiles()
        }

        // Update expanded paths for new file tree
        const tree = this.fileTree
        this.expandedPaths = collectAllDirPaths(tree)

        // Validate selection still exists
        if (this.selectedFilePath && !this.files.some((f) => f.path === this.selectedFilePath)) {
            this.selectedFilePath = this.files[0]?.path ?? null
        }

        // Silently refetch file pair (don't clear existing — keeps CommentForm alive)
        if (this.selectedFile) {
            this.loadFilePair()
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
                this.fileLoading = false
            })
            return
        }

        if (file.binary) {
            runInAction(() => {
                this.filePair = null
                this.fileLoading = false
            })
            return
        }

        const loadId = ++this.filePairLoadId
        const isInitialLoad = this.filePair === null
        if (isInitialLoad) {
            this.fileLoading = true
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
                // Skip update if content hasn't changed — prevents unnecessary
                // re-renders that would destroy open CommentForms
                const prev = this.filePair
                if (!prev || prev.before !== result.before || prev.after !== result.after || prev.tooLarge !== result.tooLarge) {
                    this.filePair = result
                }
                this.fileLoading = false
            })
        } catch (err) {
            console.error("[ChangesManager] Failed to load file pair:", err)
            runInAction(() => {
                if (loadId !== this.filePairLoadId) return
                this.filePair = null
                this.fileLoading = false
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
                // Update tree expansion and selection
                this.expandedPaths = collectAllDirPaths(this.fileTree)
                if (!this.selectedFilePath || !this.files.some((f) => f.path === this.selectedFilePath)) {
                    this.selectedFilePath = this.files[0]?.path ?? null
                }
                this.loadFilePair()
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
        // Expand all directories on first open
        this.expandedPaths = collectAllDirPaths(this.fileTree)

        // Select first file if none selected
        if (!this.selectedFilePath && this.files.length > 0) {
            this.selectedFilePath = this.files[0].path
        }

        this.loadFilePair()
    }
}
