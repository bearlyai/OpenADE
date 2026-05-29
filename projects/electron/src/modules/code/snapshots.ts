import logger from "electron-log"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { buildSnapshotPatchIndex, type SnapshotPatchIndex } from "./snapshotsIndex"

function getSnapshotsDir(): string {
    return path.join(os.homedir(), ".openade", "data", "snapshots")
}

export interface SaveBundleParams {
    id: string
    patch: string
    index: SnapshotPatchIndex
}

export interface LoadSnapshotParams {
    id: string
}

export interface LoadSnapshotSliceParams {
    id: string
    start: number
    end: number
}

function sanitizeId(id: string): string | null {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        logger.error("[Snapshots] Invalid snapshot ID:", id)
        return null
    }
    return id
}

function ensureSnapshotsDir(): void {
    const snapshotsDir = getSnapshotsDir()
    if (!fs.existsSync(snapshotsDir)) {
        fs.mkdirSync(snapshotsDir, { recursive: true })
    }
}

function getPatchPath(id: string): string {
    return path.join(getSnapshotsDir(), `${id}.patch`)
}

function getIndexPath(id: string): string {
    return path.join(getSnapshotsDir(), `${id}.json`)
}

function writeFileAtomically(filePath: string, content: string): void {
    const tempPath = `${filePath}.tmp`
    try {
        fs.writeFileSync(tempPath, content, "utf8")
        fs.renameSync(tempPath, filePath)
    } catch (error) {
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath)
        }
        throw error
    }
}

function deleteIfExists(filePath: string): void {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
    }
}

async function handleSaveBundle(params: SaveBundleParams): Promise<void> {
    const id = sanitizeId(params.id)
    if (!id) {
        throw new Error("Invalid snapshot ID")
    }

    ensureSnapshotsDir()

    const patchPath = getPatchPath(id)
    const indexPath = getIndexPath(id)

    try {
        writeFileAtomically(patchPath, params.patch)
        writeFileAtomically(indexPath, JSON.stringify(params.index))
        logger.info("[Snapshots] Saved snapshot bundle", {
            id,
            patchSize: Buffer.byteLength(params.patch, "utf8"),
            files: params.index.files.length,
        })
    } catch (error) {
        deleteIfExists(patchPath)
        deleteIfExists(indexPath)
        throw error
    }
}

async function handleLoadPatch(params: LoadSnapshotParams): Promise<string | null> {
    const id = sanitizeId(params.id)
    if (!id) return null

    const patchPath = getPatchPath(id)
    if (!fs.existsSync(patchPath)) {
        return null
    }

    return fs.readFileSync(patchPath, "utf8")
}

async function handleLoadIndex(params: LoadSnapshotParams): Promise<SnapshotPatchIndex | null> {
    const id = sanitizeId(params.id)
    if (!id) return null

    const indexPath = getIndexPath(id)
    if (fs.existsSync(indexPath)) {
        try {
            return JSON.parse(fs.readFileSync(indexPath, "utf8")) as SnapshotPatchIndex
        } catch (error) {
            logger.warn("[Snapshots] Failed to parse saved index, rebuilding", { id, error })
        }
    }

    const patch = await handleLoadPatch({ id })
    if (patch === null) {
        return null
    }

    const index = buildSnapshotPatchIndex(patch)
    writeFileAtomically(indexPath, JSON.stringify(index))
    logger.info("[Snapshots] Rebuilt legacy snapshot index", { id, files: index.files.length })
    return index
}

async function handleLoadPatchSlice(params: LoadSnapshotSliceParams): Promise<string | null> {
    const id = sanitizeId(params.id)
    if (!id) return null

    if (!Number.isInteger(params.start) || !Number.isInteger(params.end) || params.start < 0 || params.end < params.start) {
        throw new Error("Invalid patch slice range")
    }

    const patchPath = getPatchPath(id)
    if (!fs.existsSync(patchPath)) {
        return null
    }

    const stat = fs.statSync(patchPath)
    if (params.end > stat.size) {
        throw new Error("Patch slice exceeds file size")
    }

    const length = params.end - params.start
    if (length === 0) {
        return ""
    }

    const fileHandle = fs.openSync(patchPath, "r")
    try {
        const buffer = Buffer.alloc(length)
        fs.readSync(fileHandle, buffer, 0, length, params.start)
        return buffer.toString("utf8")
    } finally {
        fs.closeSync(fileHandle)
    }
}

async function handleDeleteBundle(params: LoadSnapshotParams): Promise<void> {
    const id = sanitizeId(params.id)
    if (!id) return

    deleteIfExists(getPatchPath(id))
    deleteIfExists(getIndexPath(id))
}

export async function saveRuntimeSnapshotBundle(params: SaveBundleParams): Promise<void> {
    return handleSaveBundle(params)
}

export async function loadRuntimeSnapshotPatch(params: LoadSnapshotParams): Promise<string | null> {
    return handleLoadPatch(params)
}

export async function loadRuntimeSnapshotIndex(params: LoadSnapshotParams): Promise<SnapshotPatchIndex | null> {
    return handleLoadIndex(params)
}

export async function loadRuntimeSnapshotPatchSlice(params: LoadSnapshotSliceParams): Promise<string | null> {
    return handleLoadPatchSlice(params)
}

export async function deleteRuntimeSnapshotBundle(params: LoadSnapshotParams): Promise<void> {
    return handleDeleteBundle(params)
}
