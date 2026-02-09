/**
 * Unified Data Folder Storage Module for Electron
 *
 * Generic file storage at ~/.openade/data/{folder}/{id}.{ext}
 * Used by images, snapshots, and any future data types.
 *
 * IPC channels (folder is a parameter, not part of the channel name):
 * - code:data:save   { folder, id, data, ext }
 * - code:data:load   { folder, id, ext }
 * - code:data:delete { folder, id, ext }
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import logger from "electron-log"
import { isDev } from "../../config"

// ============================================================================
// Constants
// ============================================================================

const DATA_BASE_DIR = path.join(os.homedir(), ".openade", "data")

/** Allowed folder names — validated on every request */
const ALLOWED_FOLDERS = ["images", "snapshots"]

// ============================================================================
// Type Definitions
// ============================================================================

interface SaveParams {
	folder: string
	id: string
	data: string | Buffer | ArrayBuffer
	ext: string
}

interface LoadParams {
	folder: string
	id: string
	ext: string
}

interface DeleteParams {
	folder: string
	id: string
	ext: string
}

// ============================================================================
// Helper Functions
// ============================================================================

function checkAllowed(e: IpcMainInvokeEvent): boolean {
	const origin = e.sender.getURL()
	try {
		const url = new URL(origin)
		if (isDev) {
			return url.hostname.endsWith("localhost")
		} else {
			return url.hostname.endsWith("localhost") || url.protocol === "file:"
		}
	} catch (error) {
		logger.error("[DataFolder:checkAllowed] Failed to parse origin:", error)
		return false
	}
}

function validateFolder(folder: string): boolean {
	return ALLOWED_FOLDERS.includes(folder)
}

function sanitizeId(id: string): string | null {
	if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
		logger.error("[DataFolder] Invalid ID:", id)
		return null
	}
	return id
}

function sanitizeExt(ext: string): string | null {
	if (!/^[a-zA-Z0-9]+$/.test(ext)) {
		logger.error("[DataFolder] Invalid extension:", ext)
		return null
	}
	return ext
}

function getFilePath(folder: string, id: string, ext: string): string | null {
	if (!validateFolder(folder)) {
		logger.error("[DataFolder] Invalid folder:", folder)
		return null
	}
	const sanitizedId = sanitizeId(id)
	if (!sanitizedId) return null
	const sanitizedExt = sanitizeExt(ext)
	if (!sanitizedExt) return null
	return path.join(DATA_BASE_DIR, folder, `${sanitizedId}.${sanitizedExt}`)
}

function ensureFolderDir(folder: string): void {
	const dir = path.join(DATA_BASE_DIR, folder)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
		logger.info("[DataFolder] Created directory:", dir)
	}
}

// ============================================================================
// IPC Handlers
// ============================================================================

async function handleSave(params: SaveParams): Promise<void> {
	const { folder, id, data, ext } = params

	const filePath = getFilePath(folder, id, ext)
	if (!filePath) {
		throw new Error(`Invalid params: folder=${folder}, id=${id}, ext=${ext}`)
	}

	ensureFolderDir(folder)

	const tempPath = `${filePath}.tmp`

	try {
		if (Buffer.isBuffer(data)) {
			fs.writeFileSync(tempPath, data)
		} else if (data instanceof ArrayBuffer) {
			fs.writeFileSync(tempPath, Buffer.from(data))
		} else {
			fs.writeFileSync(tempPath, data, "utf8")
		}
		fs.renameSync(tempPath, filePath)
		logger.info("[DataFolder] Saved", { folder, id, ext, size: typeof data === "string" ? data.length : data.byteLength })
	} catch (error) {
		try {
			if (fs.existsSync(tempPath)) {
				fs.unlinkSync(tempPath)
			}
		} catch {
			// Ignore cleanup errors
		}
		throw error
	}
}

async function handleLoad(params: LoadParams): Promise<string | Buffer | null> {
	const { folder, id, ext } = params

	const filePath = getFilePath(folder, id, ext)
	if (!filePath) {
		logger.warn("[DataFolder] Invalid params for load:", { folder, id, ext })
		return null
	}

	if (!fs.existsSync(filePath)) {
		logger.debug("[DataFolder] File not found:", filePath)
		return null
	}

	try {
		const data = fs.readFileSync(filePath)
		logger.debug("[DataFolder] Loaded", { folder, id, ext, size: data.byteLength })
		return data
	} catch (error) {
		logger.error("[DataFolder] Failed to read file:", error)
		return null
	}
}

async function handleDelete(params: DeleteParams): Promise<void> {
	const { folder, id, ext } = params

	const filePath = getFilePath(folder, id, ext)
	if (!filePath) {
		logger.warn("[DataFolder] Invalid params for delete:", { folder, id, ext })
		return
	}

	if (!fs.existsSync(filePath)) {
		logger.debug("[DataFolder] File already deleted:", filePath)
		return
	}

	try {
		fs.unlinkSync(filePath)
		logger.info("[DataFolder] Deleted", { folder, id, ext })
	} catch (error) {
		logger.error("[DataFolder] Failed to delete file:", error)
	}
}

// ============================================================================
// Snapshot Migration
// TODO: Delete after 2025-02-16 (one week from implementation)
// ============================================================================

function migrateSnapshots(): void {
	const oldDir = path.join(os.homedir(), ".openade", "snapshots")
	const newDir = path.join(DATA_BASE_DIR, "snapshots")

	if (!fs.existsSync(oldDir)) {
		return
	}

	logger.info("[DataFolder] Migrating snapshots from", oldDir, "to", newDir)

	try {
		if (!fs.existsSync(newDir)) {
			fs.mkdirSync(newDir, { recursive: true })
		}

		const files = fs.readdirSync(oldDir).filter((f) => f.endsWith(".patch"))
		let migrated = 0

		for (const file of files) {
			const oldPath = path.join(oldDir, file)
			const newPath = path.join(newDir, file)

			try {
				// Don't overwrite if already exists in new location
				if (!fs.existsSync(newPath)) {
					fs.renameSync(oldPath, newPath)
					migrated++
				} else {
					// Already migrated, remove old copy
					fs.unlinkSync(oldPath)
				}
			} catch (error) {
				logger.error("[DataFolder] Failed to migrate file:", file, error)
			}
		}

		// Remove old directory if empty
		try {
			const remaining = fs.readdirSync(oldDir)
			if (remaining.length === 0) {
				fs.rmdirSync(oldDir)
				logger.info("[DataFolder] Removed old snapshots directory")
			}
		} catch {
			// Ignore - directory may not be empty
		}

		logger.info("[DataFolder] Snapshot migration complete:", { migrated, total: files.length })
	} catch (error) {
		logger.error("[DataFolder] Snapshot migration failed:", error)
	}
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
	logger.info("[DataFolder] Registering IPC handlers")

	ipcMain.handle("code:data:save", async (event, params: SaveParams) => {
		if (!checkAllowed(event)) throw new Error("not allowed")
		return handleSave(params)
	})

	ipcMain.handle("code:data:load", async (event, params: LoadParams) => {
		if (!checkAllowed(event)) throw new Error("not allowed")
		return handleLoad(params)
	})

	ipcMain.handle("code:data:delete", async (event, params: DeleteParams) => {
		if (!checkAllowed(event)) throw new Error("not allowed")
		return handleDelete(params)
	})

	// Run snapshot migration
	migrateSnapshots()

	logger.info("[DataFolder] IPC handlers registered successfully")
}

export const cleanup = () => {
	logger.info("[DataFolder] Cleanup called")
}
