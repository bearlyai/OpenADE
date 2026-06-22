/**
 * Unified Data Folder Storage Module for Electron
 *
 * Generic file storage at ~/.openade/data/{folder}/{id}.{ext}
 * Used by images, snapshots, and any future data types.
 */

import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import logger from "electron-log"
import { AsyncLocalStorage } from "node:async_hooks"

// ============================================================================
// Constants
// ============================================================================

const DATA_BASE_DIR = path.join(os.homedir(), ".openade", "data")
const SLOW_DATA_FOLDER_OPERATION_MS = 250

/** Allowed folder names — validated on every request */
const ALLOWED_FOLDERS = ["images", "snapshots", "cron"]

// ============================================================================
// Type Definitions
// ============================================================================

export interface SaveDataFileParams {
	folder: string
	id: string
	data: string | Buffer | ArrayBuffer
	ext: string
}

export interface LoadDataFileParams {
	folder: string
	id: string
	ext: string
}

export interface DeleteDataFileParams {
	folder: string
	id: string
	ext: string
}

export interface ListDataFilesParams {
	folder: string
	ext: string
}

export interface DataFolderOperationContext {
	runtimeMethod?: string
	runtimeRequestId?: string
	operation?: string
}

const operationContext = new AsyncLocalStorage<DataFolderOperationContext>()

// ============================================================================
// Helper Functions
// ============================================================================

function validateFolder(folder: string): boolean {
	return ALLOWED_FOLDERS.includes(folder)
}

function isValidId(id: string): boolean {
	return /^[a-zA-Z0-9_-]+$/.test(id)
}

function sanitizeId(id: string): string | null {
	if (!isValidId(id)) {
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

function getFolderPath(folder: string): string | null {
	if (!validateFolder(folder)) {
		logger.error("[DataFolder] Invalid folder:", folder)
		return null
	}
	return path.join(DATA_BASE_DIR, folder)
}

function sanitizeLogLabel(value: string | undefined): string | undefined {
	const trimmed = value?.trim()
	if (!trimmed) return undefined
	const printable = trimmed.replace(/[^\x20-\x7E]/g, "?")
	return printable.length > 120 ? `${printable.slice(0, 120)}...` : printable
}

function currentOperationContext(options: DataFolderOperationContext = {}): DataFolderOperationContext {
	const stored = operationContext.getStore()
	return {
		runtimeMethod: sanitizeLogLabel(options.runtimeMethod ?? stored?.runtimeMethod),
		runtimeRequestId: sanitizeLogLabel(options.runtimeRequestId ?? stored?.runtimeRequestId),
		operation: sanitizeLogLabel(options.operation ?? stored?.operation),
	}
}

function operationContextFields(context: DataFolderOperationContext): Record<string, string> {
	return {
		...(context.runtimeMethod ? { runtimeMethod: context.runtimeMethod } : {}),
		...(context.runtimeRequestId ? { runtimeRequestId: context.runtimeRequestId } : {}),
		...(context.operation ? { operation: context.operation } : {}),
	}
}

function recordSlowDataFolderOperation(
	params: { folder: string; id?: string; ext: string; size?: number },
	context: DataFolderOperationContext,
	startedAt: number
): void {
	const durationMs = Date.now() - startedAt
	if (durationMs < SLOW_DATA_FOLDER_OPERATION_MS) return
	logger.warn("[DataFolder] Slow operation", {
		folder: params.folder,
		...(params.id ? { id: params.id } : {}),
		ext: params.ext,
		...(params.size !== undefined ? { size: params.size } : {}),
		durationMs,
		...operationContextFields(context),
	})
}

export function runWithDataFolderOperationContext<T>(context: DataFolderOperationContext, run: () => T): T {
	return operationContext.run(currentOperationContext(context), run)
}

// ============================================================================
// IPC Handlers
// ============================================================================

async function handleSave(params: SaveDataFileParams): Promise<void> {
	const { folder, id, data, ext } = params
	const startedAt = Date.now()
	const logContext = currentOperationContext({ operation: "save" })

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
		recordSlowDataFolderOperation({ folder, id, ext, size: typeof data === "string" ? data.length : data.byteLength }, logContext, startedAt)
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

async function handleLoad(params: LoadDataFileParams): Promise<string | Buffer | null> {
	const { folder, id, ext } = params
	const startedAt = Date.now()
	const logContext = currentOperationContext({ operation: "load" })

	const filePath = getFilePath(folder, id, ext)
	if (!filePath) {
		logger.warn("[DataFolder] Invalid params for load:", { folder, id, ext })
		return null
	}

	if (!fs.existsSync(filePath)) {
		return null
	}

	try {
		const data = fs.readFileSync(filePath)
		recordSlowDataFolderOperation({ folder, id, ext, size: data.byteLength }, logContext, startedAt)
		logger.debug("[DataFolder] Loaded", { folder, id, ext, size: data.byteLength })
		return data
	} catch (error) {
		logger.error("[DataFolder] Failed to read file:", error)
		return null
	}
}

async function handleDelete(params: DeleteDataFileParams): Promise<void> {
	const { folder, id, ext } = params
	const startedAt = Date.now()
	const logContext = currentOperationContext({ operation: "delete" })

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
		recordSlowDataFolderOperation({ folder, id, ext }, logContext, startedAt)
		logger.info("[DataFolder] Deleted", { folder, id, ext })
	} catch (error) {
		logger.error("[DataFolder] Failed to delete file:", error)
	}
}

async function handleList(params: ListDataFilesParams): Promise<string[]> {
	const { folder, ext } = params
	const startedAt = Date.now()
	const logContext = currentOperationContext({ operation: "list" })
	const dir = getFolderPath(folder)
	const sanitizedExt = sanitizeExt(ext)
	if (!dir || !sanitizedExt) {
		logger.warn("[DataFolder] Invalid params for list:", { folder, ext })
		return []
	}

	if (!fs.existsSync(dir)) return []

	try {
		const suffix = `.${sanitizedExt}`
		const entries = fs.readdirSync(dir, { withFileTypes: true })
		const ids = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
			.map((entry) => entry.name.slice(0, -suffix.length))
			.filter(isValidId)
			.sort()
		recordSlowDataFolderOperation({ folder, ext, size: ids.length }, logContext, startedAt)
		return ids
	} catch (error) {
		logger.error("[DataFolder] Failed to list files:", error)
		return []
	}
}

export async function saveRuntimeDataFile(params: SaveDataFileParams): Promise<void> {
	return handleSave(params)
}

export async function loadRuntimeDataFile(params: LoadDataFileParams): Promise<string | Buffer | null> {
	return handleLoad(params)
}

export async function deleteRuntimeDataFile(params: DeleteDataFileParams): Promise<void> {
	return handleDelete(params)
}

export async function listRuntimeDataFileIds(params: ListDataFilesParams): Promise<string[]> {
	return handleList(params)
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
	// Run snapshot migration
	migrateSnapshots()

	logger.info("[DataFolder] Storage ready")
}

export const cleanup = () => {
	logger.info("[DataFolder] Cleanup called")
}
