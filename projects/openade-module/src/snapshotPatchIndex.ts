import type { OpenADESnapshotPatchFile, OpenADESnapshotPatchIndex } from "./types"

interface MutableOpenADESnapshotPatchFile {
    path: string
    oldPath?: string
    status: "added" | "deleted" | "modified" | "renamed"
    binary: boolean
    insertions: number
    deletions: number
    hunkCount: number
    patchStart: number
}

function parseSnapshotDiffHeader(line: string): { oldPath?: string; path: string } | null {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (!match) return null
    return { oldPath: match[1], path: match[2] }
}

function finalizeSnapshotPatchFile(files: OpenADESnapshotPatchFile[], current: MutableOpenADESnapshotPatchFile | null, patchEnd: number): void {
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

export function buildOpenADESnapshotPatchIndex(patch: string): OpenADESnapshotPatchIndex {
    const files: OpenADESnapshotPatchFile[] = []
    if (!patch) return { version: 1, patchSize: 0, files }

    const lines = patch.split("\n")
    let current: MutableOpenADESnapshotPatchFile | null = null
    let byteOffset = 0

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]
        const lineByteLength = Buffer.byteLength(index < lines.length - 1 ? `${line}\n` : line, "utf8")

        if (line.startsWith("diff --git ")) {
            finalizeSnapshotPatchFile(files, current, byteOffset)
            const header = parseSnapshotDiffHeader(line)
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
            } else if (line.startsWith("new file mode ") || line === "--- /dev/null") {
                current.status = "added"
            } else if (line.startsWith("deleted file mode ") || line === "+++ /dev/null") {
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
    return { version: 1, patchSize: Buffer.byteLength(patch, "utf8"), files }
}

export function sliceOpenADESnapshotPatchBytes(patch: string | Buffer, start: number, end: number): string {
    const buffer = typeof patch === "string" ? Buffer.from(patch, "utf8") : patch
    if (end > buffer.byteLength) throw new Error("Patch slice exceeds patch size")
    return buffer.subarray(start, end).toString("utf8")
}
