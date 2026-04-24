export interface SnapshotPatchFile {
    id: string
    path: string
    oldPath?: string
    status: "added" | "deleted" | "modified" | "renamed"
    binary: boolean
    insertions: number
    deletions: number
    changedLines: number
    hunkCount: number
    patchStart: number
    patchEnd: number
}

export interface SnapshotPatchIndex {
    version: 1
    patchSize: number
    files: SnapshotPatchFile[]
}

interface MutableSnapshotPatchFile {
    path: string
    oldPath?: string
    status: "added" | "deleted" | "modified" | "renamed"
    binary: boolean
    insertions: number
    deletions: number
    hunkCount: number
    patchStart: number
}

function parseDiffHeader(line: string): { oldPath?: string; path: string } | null {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (!match) return null
    return {
        oldPath: match[1],
        path: match[2],
    }
}

function finalizeSnapshotPatchFile(files: SnapshotPatchFile[], current: MutableSnapshotPatchFile | null, patchEnd: number): void {
    if (!current) return

    files.push({
        id: String(files.length),
        path: current.path,
        oldPath: current.oldPath && current.oldPath !== current.path ? current.oldPath : undefined,
        status: current.status,
        binary: current.binary,
        insertions: current.insertions,
        deletions: current.deletions,
        changedLines: current.insertions + current.deletions,
        hunkCount: current.hunkCount,
        patchStart: current.patchStart,
        patchEnd,
    })
}

export function buildSnapshotPatchIndex(patch: string): SnapshotPatchIndex {
    const files: SnapshotPatchFile[] = []
    if (!patch) {
        return {
            version: 1,
            patchSize: 0,
            files,
        }
    }

    const lines = patch.split("\n")
    let current: MutableSnapshotPatchFile | null = null
    let byteOffset = 0

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineByteLength = Buffer.byteLength(i < lines.length - 1 ? `${line}\n` : line, "utf8")

        if (line.startsWith("diff --git ")) {
            finalizeSnapshotPatchFile(files, current, byteOffset)

            const header = parseDiffHeader(line)
            current = {
                path: header?.path ?? "unknown",
                oldPath: header?.oldPath,
                status: "modified",
                binary: false,
                insertions: 0,
                deletions: 0,
                hunkCount: 0,
                patchStart: byteOffset,
            }
        } else if (current) {
            if (line.startsWith("rename from ")) {
                current.oldPath = line.slice("rename from ".length)
                current.status = "renamed"
            } else if (line.startsWith("rename to ")) {
                current.path = line.slice("rename to ".length)
                current.status = "renamed"
            } else if (line.startsWith("new file mode ")) {
                current.status = "added"
            } else if (line.startsWith("deleted file mode ")) {
                current.status = "deleted"
            } else if (line === "--- /dev/null") {
                current.status = "added"
            } else if (line === "+++ /dev/null") {
                current.status = "deleted"
            } else if (line.startsWith("--- a/")) {
                current.oldPath = line.slice(6)
            } else if (line.startsWith("+++ b/")) {
                current.path = line.slice(6)
            } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
                current.binary = true
            } else if (line.startsWith("@@")) {
                current.hunkCount += 1
            } else if (line.startsWith("+") && !line.startsWith("+++")) {
                current.insertions += 1
            } else if (line.startsWith("-") && !line.startsWith("---")) {
                current.deletions += 1
            }
        }

        byteOffset += lineByteLength
    }

    finalizeSnapshotPatchFile(files, current, byteOffset)

    return {
        version: 1,
        patchSize: Buffer.byteLength(patch, "utf8"),
        files,
    }
}

export function sliceSnapshotPatchBytes(patch: string | Buffer, start: number, end: number): string {
    const buffer = typeof patch === "string" ? Buffer.from(patch, "utf8") : patch
    return buffer.subarray(start, end).toString("utf8")
}
