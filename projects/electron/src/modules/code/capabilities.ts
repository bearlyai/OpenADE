/**
 * Code Module Capabilities
 *
 * Reports whether the code module is enabled and its version.
 * Allows the dashboard to detect code module availability via IPC
 * rather than relying on raw Electron detection.
 *
 * Also manages an in-memory cache of SDK capabilities (slash commands, skills, plugins)
 * per (harnessId, cwd). The cache is populated from system:init messages during normal
 * queries and can be probed on demand via the harness's discoverSlashCommands().
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import { isDev } from "../../config"
import { registry } from "./harness"
import type { HarnessId } from "@openade/harness"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/capabilities.ts
// ============================================================================

interface CodeModuleCapabilities {
	enabled: boolean
	version: string
}

export interface SdkCapabilities {
	slash_commands: string[]
	skills: string[]
	plugins: { name: string; path: string }[]
	cachedAt: number
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
		logger.error("[Capabilities:checkAllowed] Failed to parse origin:", error)
		return false
	}
}

// ============================================================================
// SDK Capabilities Cache (in-memory, keyed by "harnessId:cwd")
// ============================================================================

const sdkCapabilitiesCache = new Map<string, SdkCapabilities>()

function cacheKey(harnessId: HarnessId, cwd: string): string {
	return `${harnessId}:${cwd}`
}

/** Get cached SDK capabilities for a (harnessId, cwd) pair */
function getSdkCache(cwd: string, harnessId: HarnessId = "claude-code"): SdkCapabilities | null {
	return sdkCapabilitiesCache.get(cacheKey(harnessId, cwd)) ?? null
}

/** Update cached SDK capabilities for a working directory (backward compat: default to claude-code) */
export function setSdkCache(cwd: string, data: SdkCapabilities, harnessId: HarnessId = "claude-code"): void {
	sdkCapabilitiesCache.set(cacheKey(harnessId, cwd), data)
	logger.info("[Capabilities] SDK cache updated for", harnessId, cwd, JSON.stringify({
		slash_commands: data.slash_commands.length,
		skills: data.skills.length,
		plugins: data.plugins.length,
	}))
}

// Track in-flight probes to avoid duplicate concurrent probes for the same (harnessId, cwd)
const activeProbes = new Map<string, Promise<SdkCapabilities | null>>()

/**
 * Run a lightweight probe to discover SDK capabilities for a (harnessId, cwd).
 * Uses harness.discoverSlashCommands() which runs a short-lived CLI invocation
 * and aborts after receiving initial config. No API tokens are consumed.
 */
async function runProbe(cwd: string, harnessId: HarnessId = "claude-code"): Promise<SdkCapabilities | null> {
	const key = cacheKey(harnessId, cwd)

	// Deduplicate concurrent probes for the same (harnessId, cwd)
	const existing = activeProbes.get(key)
	if (existing) return existing

	const probePromise = (async () => {
		logger.info("[Capabilities] Running harness probe for", harnessId, cwd)

		try {
			const harness = registry.getOrThrow(harnessId)
			const abortController = new AbortController()
			const timeout = setTimeout(() => abortController.abort(), 15000)

			const slashCommands = await harness.discoverSlashCommands(cwd, abortController.signal)
			clearTimeout(timeout)

			const capabilities: SdkCapabilities = {
				slash_commands: slashCommands
					.filter((c) => c.type === "slash_command")
					.map((c) => c.name),
				skills: slashCommands
					.filter((c) => c.type === "skill")
					.map((c) => c.name),
				plugins: [], // Plugins are extracted from init in streaming; not available via probe
				cachedAt: Date.now(),
			}

			setSdkCache(cwd, capabilities, harnessId)
			return capabilities
		} catch (err) {
			// AbortError is expected if we time out
			if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("abort"))) {
				const cached = getSdkCache(cwd, harnessId)
				if (cached) return cached
			}
			logger.error("[Capabilities] Probe failed:", err)
			return null
		} finally {
			activeProbes.delete(key)
		}
	})()

	activeProbes.set(key, probePromise)
	return probePromise
}

// ============================================================================
// Module Export
// ============================================================================

const CODE_MODULE_VERSION = "1.0.0"

export const load = () => {
	logger.info("[Capabilities] Registering IPC handlers")

	ipcMain.handle("code:capabilities", async (event) => {
		if (!checkAllowed(event)) throw new Error("not allowed")
		return {
			enabled: true,
			version: CODE_MODULE_VERSION,
		} satisfies CodeModuleCapabilities
	})

	ipcMain.handle("code:sdk-capabilities", async (event, args: { cwd: string; harnessId?: HarnessId }) => {
		if (!checkAllowed(event)) throw new Error("not allowed")

		const { cwd, harnessId = "claude-code" } = args

		// Return cached if available
		const cached = getSdkCache(cwd, harnessId)
		if (cached) return cached

		// Run probe to discover capabilities
		return await runProbe(cwd, harnessId)
	})

	ipcMain.handle("code:invalidate-sdk-capabilities", async (event, args: { cwd: string; harnessId?: HarnessId }) => {
		if (!checkAllowed(event)) throw new Error("not allowed")
		const harnessId = args.harnessId ?? "claude-code"
		sdkCapabilitiesCache.delete(cacheKey(harnessId, args.cwd))
		return { ok: true }
	})

	// New handler: check install status for all registered harnesses
	ipcMain.handle("harness:check-status", async (event) => {
		if (!checkAllowed(event)) throw new Error("not allowed")
		const statusMap = await registry.checkAllInstallStatus()
		// Convert Map to plain object for IPC serialization
		const result: Record<string, unknown> = {}
		for (const [id, status] of statusMap) {
			result[id] = status
		}
		return result
	})

	logger.info("[Capabilities] IPC handlers registered successfully")
}

export const cleanup = () => {
	sdkCapabilitiesCache.clear()
}
