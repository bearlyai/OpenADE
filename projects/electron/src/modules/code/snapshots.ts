import { ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { isDev } from "../../config"
import { buildSnapshotPatchIndex, type SnapshotPatchIndex } from "./snapshotsIndex"

const SNAPSHOTS_DIR = path.join(os.homedir(), ".openade", "data", "snapshots")

interface SaveBundleParams {
    id: string
    patch: string
    index: SnapshotPatchIndex
}

interface LoadSnapshotParams {
    id: string
}

interface LoadSnapshotSliceParams {
    id: string
    start: number
    end: number
}

function checkAllowed(event: IpcMainInvokeEvent): boolean {
    const origin = event.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        }
        return url.hostname.endsWith("localhost") || url.protocol === "file:"
    } catch (error) {
        logger.error("[Snapshots:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

function sanitizeId(id: string): string | null {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        logger.error("[Snapshots] Invalid snapshot ID:", id)
        return null
    }
    return id
}

function ensureSnapshotsDir(): void {
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
        fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    }
}

function getPatchPath(id: string): string {
    return path.join(SNAPSHOTS_DIR, `${id}.patch`)
}

function getIndexPath(id: string): string {
    return path.join(SNAPSHOTS_DIR, `${id}.json`)
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

export const load = () => {
    ipcMain.handle("snapshots:saveBundle", async (event, params: SaveBundleParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleSaveBundle(params)
    })

    ipcMain.handle("snapshots:loadPatch", async (event, params: LoadSnapshotParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleLoadPatch(params)
    })

    ipcMain.handle("snapshots:loadIndex", async (event, params: LoadSnapshotParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleLoadIndex(params)
    })

    ipcMain.handle("snapshots:loadPatchSlice", async (event, params: LoadSnapshotSliceParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleLoadPatchSlice(params)
    })

    ipcMain.handle("snapshots:deleteBundle", async (event, params: LoadSnapshotParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleDeleteBundle(params)
    })
}

export const cleanup = () => {}
