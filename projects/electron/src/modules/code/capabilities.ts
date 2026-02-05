/**
 * Code Module Capabilities
 *
 * Reports whether the code module is enabled and its version.
 * Allows the dashboard to detect code module availability via IPC
 * rather than relying on raw Electron detection.
 *
 * Also manages an in-memory cache of SDK capabilities (slash commands, skills, plugins)
 * per working directory. The cache is populated from system:init messages during normal
 * queries and can be probed on demand via a lightweight empty-prompt query.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import logger from "electron-log"
import { isDev } from "../../config"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { resolve as resolveBinary, getCliJsPath } from "./binaries"

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
// SDK Capabilities Cache (in-memory, keyed by cwd)
// ============================================================================

const sdkCapabilitiesCache = new Map<string, SdkCapabilities>()

/** Get cached SDK capabilities for a working directory */
function getSdkCache(cwd: string): SdkCapabilities | null {
	return sdkCapabilitiesCache.get(cwd) ?? null
}

/** Update cached SDK capabilities for a working directory */
export function setSdkCache(cwd: string, data: SdkCapabilities): void {
	sdkCapabilitiesCache.set(cwd, data)
	logger.info("[Capabilities] SDK cache updated for", cwd, JSON.stringify({
		slash_commands: data.slash_commands.length,
		skills: data.skills.length,
		plugins: data.plugins.length,
	}))
}

// Track in-flight probes to avoid duplicate concurrent probes for the same cwd
const activeProbes = new Map<string, Promise<SdkCapabilities | null>>()

/**
 * Run a lightweight probe to discover SDK capabilities for a cwd.
 * Sends an empty prompt and aborts immediately after receiving the system:init message.
 * No API tokens are consumed — init is emitted before any LLM call.
 */
async function runProbe(cwd: string): Promise<SdkCapabilities | null> {
	// Deduplicate concurrent probes for the same cwd
	const existing = activeProbes.get(cwd)
	if (existing) return existing

	const probePromise = (async () => {
		logger.info("[Capabilities] Running SDK probe for", cwd)
		const abortController = new AbortController()

		try {
			// Use managed bun binary if available (resolved via PATH), otherwise fall back to ELECTRON_RUN_AS_NODE
		const hasManagedBun = !!resolveBinary("bun")
		logger.info("[Capabilities] Runtime selection:", hasManagedBun ? "bun (managed)" : "node (ELECTRON_RUN_AS_NODE)")
		const execConfig = hasManagedBun
			? { executable: "bun" as const, pathToClaudeCodeExecutable: getCliJsPath(), env: { ...process.env } }
			: { executable: process.execPath as "node", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }

		const response = query({
				prompt: "",
				options: {
					model: "claude-haiku-4-5-20251001",
					tools: { type: "preset", preset: "claude_code" },
					permissionMode: "bypassPermissions",
					settingSources: ["user", "project", "local"],
					cwd,
					abortController,
					...execConfig,
					stderr: (data: string) => {
						logger.error("[Capabilities] Probe stderr:", data)
					},
				},
			})

			for await (const msg of response) {
				if (msg.type === "system" && "subtype" in msg && msg.subtype === "init") {
					const initMsg = msg as Record<string, unknown>
					const capabilities: SdkCapabilities = {
						slash_commands: (initMsg.slash_commands as string[]) ?? [],
						skills: (initMsg.skills as string[]) ?? [],
						plugins: (initMsg.plugins as { name: string; path: string }[]) ?? [],
						cachedAt: Date.now(),
					}
					abortController.abort()
					setSdkCache(cwd, capabilities)
					return capabilities
				}
			}

			logger.warn("[Capabilities] Probe completed without system:init message")
			return null
		} catch (err) {
			// AbortError is expected — we abort after getting init
			if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("abort"))) {
				const cached = getSdkCache(cwd)
				if (cached) return cached
			}
			logger.error("[Capabilities] Probe failed:", err)
			return null
		} finally {
			activeProbes.delete(cwd)
		}
	})()

	activeProbes.set(cwd, probePromise)
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

	ipcMain.handle("code:sdk-capabilities", async (event, args: { cwd: string }) => {
		if (!checkAllowed(event)) throw new Error("not allowed")

		const { cwd } = args

		// Return cached if available
		const cached = getSdkCache(cwd)
		if (cached) return cached

		// Run probe to discover capabilities
		return await runProbe(cwd)
	})

	ipcMain.handle("code:invalidate-sdk-capabilities", async (event, args: { cwd: string }) => {
		if (!checkAllowed(event)) throw new Error("not allowed")
		sdkCapabilitiesCache.delete(args.cwd)
		return { ok: true }
	})

	logger.info("[Capabilities] IPC handlers registered successfully")
}

export const cleanup = () => {
	sdkCapabilitiesCache.clear()
}
