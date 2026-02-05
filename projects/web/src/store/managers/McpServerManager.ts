/**
 * McpServerManager
 *
 * Facade that coordinates MCP server operations across three specialized components:
 * - McpServerRepository: CRUD operations on MCP server configurations
 * - McpOAuthManager: OAuth flow management and token refresh
 * - McpHealthChecker: Connection testing and health status
 *
 * Observable state and computed properties remain on this class for MobX reactivity.
 */

import { computed, makeAutoObservable, runInAction } from "mobx"
import { track } from "../../analytics"
import {
    buildMcpServerConfigs,
    cancelMcpOAuth,
    initiateMcpOAuth,
    isMcpApiAvailable,
    onMcpOAuthComplete,
    refreshMcpOAuthToken,
    testMcpConnection,
} from "../../electronAPI/mcp"
import type { McpOAuthTokens, McpServerItem, McpServerStore, McpServerUpdate } from "../../persistence/mcpServerStore"
import { ulid } from "../../utils/ulid"
import type { CodeStore } from "../store"

// ============================================================================
// Input Types
// ============================================================================

export interface AddHttpMcpServerInput {
    name: string
    url: string
    headers?: Record<string, string>
    presetId?: string
}

export interface AddStdioMcpServerInput {
    name: string
    command: string
    args?: string[]
    envVars?: Record<string, string>
    presetId?: string
}

// ============================================================================
// McpServerRepository - CRUD Operations
// ============================================================================

class McpServerRepository {
    constructor(private getStore: () => McpServerStore | null) {}

    private get store(): McpServerStore | null {
        return this.getStore()
    }

    getServer(id: string): McpServerItem | undefined {
        return this.store?.servers.get(id)
    }

    getServersByIds(ids: string[]): McpServerItem[] {
        return ids.map((id) => this.getServer(id)).filter((s): s is McpServerItem => s !== undefined)
    }

    getAllServers(): McpServerItem[] {
        return this.store?.servers.all() ?? []
    }

    addHttpServer(input: AddHttpMcpServerInput): string | null {
        if (!this.store) return null
        const now = new Date().toISOString()
        const id = ulid()

        this.store.servers.push({
            id,
            name: input.name,
            transportType: "http",
            enabled: true,
            url: input.url,
            headers: input.headers,
            presetId: input.presetId,
            healthStatus: "unknown",
            createdAt: now,
            updatedAt: now,
        })

        return id
    }

    addStdioServer(input: AddStdioMcpServerInput): string | null {
        if (!this.store) return null
        const now = new Date().toISOString()
        const id = ulid()

        this.store.servers.push({
            id,
            name: input.name,
            transportType: "stdio",
            enabled: true,
            command: input.command,
            args: input.args,
            envVars: input.envVars,
            presetId: input.presetId,
            healthStatus: "unknown",
            createdAt: now,
            updatedAt: now,
        })

        return id
    }

    updateServer(id: string, updates: McpServerUpdate): void {
        this.store?.servers.update(id, (draft) => {
            Object.assign(draft, updates, { updatedAt: new Date().toISOString() })
        })
    }

    deleteServer(id: string): void {
        this.store?.servers.delete(id)
    }
}

// ============================================================================
// McpOAuthManager - OAuth Flow and Token Refresh
// ============================================================================

class McpOAuthManager {
    private oauthCleanup: (() => void) | null = null
    private tokenRefreshInterval: ReturnType<typeof setInterval> | null = null

    private readonly TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000 // Refresh 5 minutes before expiry
    private readonly TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // Check every 5 minutes
    /** Delay initial refresh to allow YJS store to sync after app startup */
    private readonly INITIAL_REFRESH_DELAY_MS = 5000

    constructor(
        private repo: McpServerRepository,
        private onPendingChange: (serverId: string | null) => void,
        private onTokensReceived: (serverId: string, tokens: McpOAuthTokens) => void
    ) {}

    /**
     * Start OAuth listener and background token refresh.
     * Call once after construction.
     */
    start(): void {
        // Register OAuth completion listener (works across all pages)
        this.oauthCleanup = onMcpOAuthComplete((result) => {
            if ("tokens" in result && result.tokens) {
                this.onTokensReceived(result.serverId, result.tokens)
                this.onPendingChange(null)
            } else if ("error" in result) {
                console.error("[McpOAuthManager] OAuth failed:", result.serverId, result.error)
                this.onPendingChange(null)
            }
        })

        // Start background token refresh
        this.startTokenRefreshInterval()
    }

    /**
     * Cleanup resources.
     */
    dispose(): void {
        this.oauthCleanup?.()
        this.oauthCleanup = null
        this.stopTokenRefreshInterval()
    }

    /**
     * Initiate OAuth flow for a server.
     * Returns true if flow was started successfully.
     */
    async initiateOAuth(id: string): Promise<boolean> {
        const server = this.repo.getServer(id)
        if (!server || server.transportType !== "http" || !server.url) return false

        if (!isMcpApiAvailable()) {
            console.error("[McpOAuthManager] Cannot initiate OAuth - not running in Electron")
            return false
        }

        this.onPendingChange(id)

        const result = await initiateMcpOAuth({
            serverId: id,
            serverUrl: server.url,
        })

        if (!result.success) {
            console.error("[McpOAuthManager] Failed to initiate OAuth:", result.error)
            this.onPendingChange(null)
            return false
        }

        return true
    }

    /**
     * Cancel a pending OAuth flow.
     */
    async cancelOAuth(serverId: string | null): Promise<void> {
        if (serverId && isMcpApiAvailable()) {
            await cancelMcpOAuth({ serverId })
        }
        this.onPendingChange(null)
    }

    /**
     * Check if a server has valid (non-expired) OAuth tokens.
     */
    hasValidTokens(id: string): boolean {
        const server = this.repo.getServer(id)
        if (!server || server.transportType !== "http") return false
        if (!server.oauthTokens?.accessToken) return false

        if (server.oauthTokens.expiresAt) {
            const expiresAt = new Date(server.oauthTokens.expiresAt)
            if (expiresAt <= new Date()) return false
        }

        return true
    }

    /**
     * Refresh token if expired or about to expire.
     * Returns true if token is valid (refreshed or not expired).
     */
    async refreshTokenIfNeeded(id: string): Promise<boolean> {
        const server = this.repo.getServer(id)
        if (!server || server.transportType !== "http") return false
        if (!server.oauthTokens?.accessToken) return false
        if (!server.oauthTokens.refreshToken) return this.hasValidTokens(id)

        // Check if token expires within buffer period
        if (server.oauthTokens.expiresAt) {
            const expiresAt = new Date(server.oauthTokens.expiresAt)
            const bufferTime = new Date(Date.now() + this.TOKEN_REFRESH_BUFFER_MS)
            if (expiresAt > bufferTime) return true // Still valid
        }

        if (!isMcpApiAvailable()) return false

        const result = await refreshMcpOAuthToken({
            serverId: id,
            serverUrl: server.url,
            refreshToken: server.oauthTokens.refreshToken,
        })

        if (result.success && result.tokens) {
            this.repo.updateServer(id, { oauthTokens: result.tokens })
            return true
        }

        return false
    }

    private startTokenRefreshInterval(): void {
        this.stopTokenRefreshInterval()

        this.tokenRefreshInterval = setInterval(() => {
            this.refreshAllTokens()
        }, this.TOKEN_REFRESH_INTERVAL_MS)

        // Run initial refresh after store sync delay
        setTimeout(() => this.refreshAllTokens(), this.INITIAL_REFRESH_DELAY_MS)
    }

    private stopTokenRefreshInterval(): void {
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval)
            this.tokenRefreshInterval = null
        }
    }

    private async refreshAllTokens(): Promise<void> {
        if (!isMcpApiAvailable()) return

        const httpServersWithTokens = this.repo.getAllServers().filter((s) => s.transportType === "http" && s.oauthTokens?.refreshToken)

        if (httpServersWithTokens.length === 0) return

        console.log(`[McpOAuthManager] Background token refresh: checking ${httpServersWithTokens.length} servers`)

        for (const server of httpServersWithTokens) {
            try {
                await this.refreshTokenIfNeeded(server.id)
            } catch (err) {
                console.error(`[McpOAuthManager] Failed to refresh token for ${server.name}:`, err)
            }
        }
    }
}

// ============================================================================
// McpHealthChecker - Connection Testing
// ============================================================================

class McpHealthChecker {
    constructor(
        private repo: McpServerRepository,
        private getStore: () => McpServerStore | null,
        private onTestingChange: (serverId: string | null) => void
    ) {}

    /**
     * Test connection to an MCP server.
     * Updates health status and returns result.
     */
    async testConnection(id: string): Promise<{ success: boolean; requiresAuth?: boolean }> {
        const server = this.repo.getServer(id)
        const store = this.getStore()
        if (!server || !store) return { success: false }

        this.onTestingChange(id)

        try {
            // Stdio servers: validate command exists
            if (server.transportType === "stdio") {
                const isHealthy = !!server.command?.trim()
                store.servers.update(id, (draft) => {
                    draft.healthStatus = isHealthy ? "healthy" : "unhealthy"
                    draft.lastTested = new Date().toISOString()
                    draft.updatedAt = new Date().toISOString()
                })
                return { success: isHealthy }
            }

            // HTTP servers: use real MCP protocol check via Electron
            if (!isMcpApiAvailable()) {
                // Not in Electron - do basic URL validation
                try {
                    const url = new URL(server.url || "")
                    const isValid = url.protocol === "https:" || url.protocol === "http:"
                    store.servers.update(id, (draft) => {
                        draft.healthStatus = isValid ? "unknown" : "unhealthy"
                        draft.lastTested = new Date().toISOString()
                        draft.updatedAt = new Date().toISOString()
                    })
                    return { success: isValid }
                } catch {
                    store.servers.update(id, (draft) => {
                        draft.healthStatus = "unhealthy"
                        draft.lastTested = new Date().toISOString()
                        draft.updatedAt = new Date().toISOString()
                    })
                    return { success: false }
                }
            }

            // Build config (includes OAuth tokens)
            const configs = buildMcpServerConfigs([server])
            const config = configs[server.name]
            if (!config || config.type !== "http") return { success: false }

            // JSON round-trip strips MobX proxy (can't be cloned through IPC)
            const result = await testMcpConnection(JSON.parse(JSON.stringify(config)))

            store.servers.update(id, (draft) => {
                if (result.success) {
                    draft.healthStatus = "healthy"
                } else if (result.requiresAuth) {
                    draft.healthStatus = "needs_auth"
                } else {
                    draft.healthStatus = "unhealthy"
                }
                draft.lastTested = new Date().toISOString()
                draft.updatedAt = new Date().toISOString()
            })

            return { success: result.success, requiresAuth: result.requiresAuth }
        } catch (err) {
            console.error(`[McpHealthChecker] Failed to test connection for ${id}:`, err)
            store.servers.update(id, (draft) => {
                draft.healthStatus = "unhealthy"
                draft.lastTested = new Date().toISOString()
                draft.updatedAt = new Date().toISOString()
            })
            return { success: false }
        } finally {
            this.onTestingChange(null)
        }
    }
}

// ============================================================================
// McpServerManager - Public Facade
// ============================================================================

export class McpServerManager {
    // Observable UI state
    serversLoading = false
    testingServerId: string | null = null
    oauthPendingServerId: string | null = null

    // Internal components
    private readonly repo: McpServerRepository
    private readonly oauth: McpOAuthManager
    private readonly health: McpHealthChecker

    constructor(private store: CodeStore) {
        // Create components with callbacks for state updates
        this.repo = new McpServerRepository(() => this.store.mcpServerStore)

        this.oauth = new McpOAuthManager(
            this.repo,
            (serverId) =>
                runInAction(() => {
                    this.oauthPendingServerId = serverId
                }),
            (serverId, tokens) => this.completeOAuth(serverId, tokens)
        )

        this.health = new McpHealthChecker(
            this.repo,
            () => this.store.mcpServerStore,
            (serverId) =>
                runInAction(() => {
                    this.testingServerId = serverId
                })
        )

        makeAutoObservable(this, {
            servers: computed,
            enabledServers: computed,
        })

        // Start OAuth listener and background refresh
        this.oauth.start()
    }

    /**
     * Cleanup resources (call on store disconnect).
     */
    dispose(): void {
        this.oauth.dispose()
    }

    // ==================== Computed Properties ====================

    get servers(): McpServerItem[] {
        return this.repo.getAllServers()
    }

    get enabledServers(): McpServerItem[] {
        return this.servers.filter((s) => s.enabled)
    }

    // ==================== CRUD Operations (delegated to repo) ====================

    getServer(id: string): McpServerItem | undefined {
        return this.repo.getServer(id)
    }

    getServersByIds(ids: string[]): McpServerItem[] {
        return this.repo.getServersByIds(ids)
    }

    addHttpServer(input: AddHttpMcpServerInput): string | null {
        const id = this.repo.addHttpServer(input)
        if (id) {
            track("mcp_server_added", { transportType: "http", isPreset: !!input.presetId })
        }
        return id
    }

    addStdioServer(input: AddStdioMcpServerInput): string | null {
        const id = this.repo.addStdioServer(input)
        if (id) {
            track("mcp_server_added", { transportType: "stdio", isPreset: !!input.presetId })
        }
        return id
    }

    updateServer(id: string, updates: McpServerUpdate): void {
        this.repo.updateServer(id, updates)
    }

    deleteServer(id: string): void {
        this.repo.deleteServer(id)
        track("mcp_server_removed")
    }

    toggleServerEnabled(id: string): void {
        const server = this.getServer(id)
        if (server) {
            this.updateServer(id, { enabled: !server.enabled })
        }
    }

    // ==================== Connection Testing (delegated to health) ====================

    async testConnection(id: string): Promise<{ success: boolean; requiresAuth?: boolean }> {
        return this.health.testConnection(id)
    }

    // ==================== OAuth Flow (delegated to oauth) ====================

    async initiateOAuth(id: string): Promise<boolean> {
        return this.oauth.initiateOAuth(id)
    }

    private completeOAuth(id: string, tokens: McpOAuthTokens): void {
        this.updateServer(id, {
            oauthTokens: tokens,
            healthStatus: "unknown", // Reset so user can re-test
        })

        runInAction(() => {
            if (this.oauthPendingServerId === id) {
                this.oauthPendingServerId = null
            }
        })
    }

    async cancelOAuth(id?: string): Promise<void> {
        await this.oauth.cancelOAuth(id ?? this.oauthPendingServerId)
    }

    disconnectOAuth(id: string): void {
        this.updateServer(id, {
            oauthTokens: undefined,
            healthStatus: "needs_auth",
        })
    }

    hasValidOAuthTokens(id: string): boolean {
        return this.oauth.hasValidTokens(id)
    }

    async refreshTokenIfNeeded(id: string): Promise<boolean> {
        return this.oauth.refreshTokenIfNeeded(id)
    }

    isOAuthPending(id: string): boolean {
        return this.oauthPendingServerId === id
    }
}
