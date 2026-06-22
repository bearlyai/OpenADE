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
import { OPENADE_METHOD, type OpenADEMethod } from "../../../../openade-client/src"
import type { OpenADEMCPServer } from "../../../../openade-module/src"
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
    cwd?: string
    presetId?: string
}

function productMcpServerToLocal(server: OpenADEMCPServer): McpServerItem {
    return server
}

function localMcpServerToProduct(server: McpServerItem): OpenADEMCPServer {
    return server
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

    replaceServers(servers: McpServerItem[]): void {
        if (!this.store) return
        this.store.servers.clear()
        for (const server of servers) {
            this.store.servers.push(server)
        }
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
            cwd: input.cwd,
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
    private initialRefreshTimeout: ReturnType<typeof setTimeout> | null = null

    private readonly TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000 // Refresh 5 minutes before expiry
    private readonly TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // Check every 5 minutes
    /** Delay initial refresh to allow YJS store to sync after app startup */
    private readonly INITIAL_REFRESH_DELAY_MS = 5000

    constructor(
        private repo: McpServerRepository,
        private onPendingChange: (serverId: string | null) => void,
        private onTokensReceived: (serverId: string, tokens: McpOAuthTokens) => void,
        private onServerChanged: (serverId: string) => void,
        private canMutateTokens: () => boolean | Promise<boolean>,
        private canRunBackgroundRefresh: () => boolean
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
        if (!(await this.canMutateTokens())) return false
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
        if (!(await this.canMutateTokens())) {
            this.onPendingChange(null)
            return
        }
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
        if (!(await this.canMutateTokens())) return false
        const server = this.repo.getServer(id)
        if (!server || server.transportType !== "http") return false
        if (!server.oauthTokens?.accessToken) return false
        if (!server.oauthTokens.refreshToken) return this.hasValidTokens(id)

        // Check if token expires within buffer period
        if (server.oauthTokens.expiresAt) {
            const expiresAt = new Date(server.oauthTokens.expiresAt)
            const bufferTime = new Date(Date.now() + this.TOKEN_REFRESH_BUFFER_MS)
            if (expiresAt > bufferTime) return true // Still valid
        } else {
            return true
        }

        if (!server.oauthTokens.clientId) return false
        if (!isMcpApiAvailable()) return false

        const result = await refreshMcpOAuthToken({
            serverId: id,
            serverUrl: server.url,
            refreshToken: server.oauthTokens.refreshToken,
            clientId: server.oauthTokens.clientId,
        })

        if (result.success && result.tokens) {
            this.repo.updateServer(id, { oauthTokens: result.tokens })
            this.onServerChanged(id)
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
        this.initialRefreshTimeout = setTimeout(() => {
            this.initialRefreshTimeout = null
            this.refreshAllTokens()
        }, this.INITIAL_REFRESH_DELAY_MS)
    }

    private stopTokenRefreshInterval(): void {
        if (this.initialRefreshTimeout) {
            clearTimeout(this.initialRefreshTimeout)
            this.initialRefreshTimeout = null
        }
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval)
            this.tokenRefreshInterval = null
        }
    }

    private async refreshAllTokens(): Promise<void> {
        if (!this.canRunBackgroundRefresh()) return
        if (!isMcpApiAvailable()) return

        const httpServersWithTokens = this.repo
            .getAllServers()
            .filter((s) => s.transportType === "http" && s.oauthTokens?.refreshToken && s.oauthTokens.clientId && s.oauthTokens.expiresAt)

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
        private canTestConnection: () => boolean | Promise<boolean>,
        private onTestingChange: (serverId: string | null) => void
    ) {}

    /**
     * Test connection to an MCP server.
     * Updates health status and returns result.
     */
    async testConnection(id: string): Promise<{ success: boolean; requiresAuth?: boolean }> {
        if (!(await this.canTestConnection())) return { success: false }

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
    productSettingsError: string | null = null

    // Internal components
    private readonly repo: McpServerRepository
    private readonly oauth: McpOAuthManager
    private readonly health: McpHealthChecker
    private productSettingsProjectionLoaded = false
    private productSettingsProjectionInFlight: Promise<void> | null = null

    constructor(private store: CodeStore) {
        // Create components with callbacks for state updates
        this.repo = new McpServerRepository(() => this.store.mcpServerStore)

        this.oauth = new McpOAuthManager(
            this.repo,
            (serverId) =>
                runInAction(() => {
                    this.oauthPendingServerId = serverId
                }),
            (serverId, tokens) => this.completeOAuth(serverId, tokens),
            (serverId) => {
                this.persistServerToProductStore(serverId).catch((err) => this.recordProductSettingsError("persist refreshed OAuth tokens", err))
            },
            () => this.canMutateOAuthTokensAfterConnect(),
            () => this.canRunBackgroundOAuthRefresh()
        )

        this.health = new McpHealthChecker(
            this.repo,
            () => this.store.mcpServerStore,
            () => this.canTestServersAfterConnect(),
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

    get canUpsertServers(): boolean {
        return this.store.canUseProductMethod(OPENADE_METHOD.settingsMcpServersUpsert)
    }

    get canDeleteServers(): boolean {
        return this.store.canUseProductMethod(OPENADE_METHOD.settingsMcpServersDelete)
    }

    get canTestServers(): boolean {
        if (!this.productRuntimeOwnsSettings()) return true
        return this.canReadProductSettings() && this.canUpsertServers
    }

    // ==================== Runtime Product Settings Projection ====================

    private productRuntimeOwnsSettings(): boolean {
        return this.store.shouldUseRuntimeProductAPI() || this.store.usesCoreOwnedProductRuntime()
    }

    private canUseProductSettings(): boolean {
        return this.store.shouldUseRuntimeProductAPI()
    }

    private async canUseProductSettingsMethodAfterConnect(method: OpenADEMethod): Promise<boolean> {
        if (!this.productRuntimeOwnsSettings()) return this.store.canUseProductMethod(method)
        if (this.store.usesCoreOwnedProductRuntime()) return this.store.canUseProductMethodAfterConnect(method)
        if (this.store.shouldUseRuntimeProductAPI()) return this.store.canUseProductMethod(method)
        return this.store.canUseProductMethodAfterConnect(method)
    }

    private canReadProductSettings(): boolean {
        return this.canUseProductSettings() && this.store.canUseProductMethod(OPENADE_METHOD.settingsMcpServersRead)
    }

    private canMutateOAuthTokens(): boolean {
        if (!this.productRuntimeOwnsSettings()) return true
        return this.canReadProductSettings() && this.canUpsertServers
    }

    private async canReadProductSettingsAfterConnect(): Promise<boolean> {
        if (!this.productRuntimeOwnsSettings()) return true
        return this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersRead)
    }

    private async canMutateOAuthTokensAfterConnect(): Promise<boolean> {
        if (!this.productRuntimeOwnsSettings()) return true
        const [canRead, canUpsert] = await Promise.all([
            this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersRead),
            this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersUpsert),
        ])
        return canRead && canUpsert
    }

    private async canTestServersAfterConnect(): Promise<boolean> {
        if (!this.productRuntimeOwnsSettings()) return true
        const [canRead, canUpsert] = await Promise.all([
            this.canReadProductSettingsAfterConnect(),
            this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersUpsert),
        ])
        return canRead && canUpsert
    }

    private canRunBackgroundOAuthRefresh(): boolean {
        return !this.productRuntimeOwnsSettings()
    }

    private recordProductSettingsError(action: string, err: unknown): void {
        const message = err instanceof Error ? err.message : String(err)
        runInAction(() => {
            this.productSettingsError = message
        })
        console.warn(`[McpServerManager] Failed to ${action}:`, err)
    }

    private async persistServerToProductStore(serverId: string): Promise<void> {
        if (!this.productRuntimeOwnsSettings()) return
        if (!(await this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersUpsert))) return
        const server = this.repo.getServer(serverId)
        if (!server) return
        await this.store.upsertProductMcpServer({ server: localMcpServerToProduct(server) })
        runInAction(() => {
            this.productSettingsError = null
        })
    }

    async initializeProductSettingsProjection(): Promise<void> {
        if (this.productSettingsProjectionLoaded) return
        if (this.productSettingsProjectionInFlight) return this.productSettingsProjectionInFlight
        const projection = this.loadProductSettingsProjection()
        this.productSettingsProjectionInFlight = projection
        try {
            await projection
        } finally {
            runInAction(() => {
                this.productSettingsProjectionInFlight = null
            })
        }
    }

    private async loadProductSettingsProjection(): Promise<void> {
        if (!this.productRuntimeOwnsSettings()) return
        if (!(await this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersRead))) {
            runInAction(() => {
                this.productSettingsProjectionLoaded = true
            })
            return
        }
        await this.store.ensureRuntimeMcpServerProjectionStore()

        runInAction(() => {
            this.serversLoading = true
            this.productSettingsError = null
        })

        try {
            const productServers = await this.store.readProductMcpServers()
            const localServers = this.repo.getAllServers()
            const canReplace = await this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersReplace)
            const projectedServers =
                productServers.servers.length === 0 && localServers.length > 0 && canReplace
                    ? (await this.store.replaceProductMcpServers({ servers: localServers.map(localMcpServerToProduct) })).servers
                    : productServers.servers

            this.repo.replaceServers(projectedServers.map(productMcpServerToLocal))
            runInAction(() => {
                this.productSettingsError = null
                this.productSettingsProjectionLoaded = true
            })
        } catch (err) {
            this.recordProductSettingsError("initialize product settings projection", err)
        } finally {
            runInAction(() => {
                this.serversLoading = false
            })
        }
    }

    // ==================== CRUD Operations (delegated to repo) ====================

    getServer(id: string): McpServerItem | undefined {
        return this.repo.getServer(id)
    }

    getServersByIds(ids: string[]): McpServerItem[] {
        return this.repo.getServersByIds(ids)
    }

    async addHttpServer(input: AddHttpMcpServerInput): Promise<string | null> {
        if (!(await this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersUpsert))) return null
        const id = this.repo.addHttpServer(input)
        if (id) {
            track("mcp_server_added", { transportType: "http", isPreset: !!input.presetId })
            await this.persistServerToProductStore(id)
        }
        return id
    }

    async addStdioServer(input: AddStdioMcpServerInput): Promise<string | null> {
        if (!(await this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersUpsert))) return null
        const id = this.repo.addStdioServer(input)
        if (id) {
            track("mcp_server_added", { transportType: "stdio", isPreset: !!input.presetId })
            await this.persistServerToProductStore(id)
        }
        return id
    }

    async updateServer(id: string, updates: McpServerUpdate): Promise<void> {
        if (!(await this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersUpsert))) return
        this.repo.updateServer(id, updates)
        await this.persistServerToProductStore(id)
    }

    async deleteServer(id: string): Promise<void> {
        if (!(await this.canUseProductSettingsMethodAfterConnect(OPENADE_METHOD.settingsMcpServersDelete))) return
        if (this.productRuntimeOwnsSettings()) {
            await this.store.deleteProductMcpServer({ serverId: id })
            runInAction(() => {
                this.productSettingsError = null
            })
        }
        this.repo.deleteServer(id)
        track("mcp_server_removed")
    }

    async toggleServerEnabled(id: string): Promise<void> {
        const server = this.getServer(id)
        if (server) {
            await this.updateServer(id, { enabled: !server.enabled })
        }
    }

    // ==================== Connection Testing (delegated to health) ====================

    async testConnection(id: string): Promise<{ success: boolean; requiresAuth?: boolean }> {
        const result = await this.health.testConnection(id)
        await this.persistServerToProductStore(id)
        return result
    }

    // ==================== OAuth Flow (delegated to oauth) ====================

    async initiateOAuth(id: string): Promise<boolean> {
        return this.oauth.initiateOAuth(id)
    }

    private completeOAuth(id: string, tokens: McpOAuthTokens): void {
        if (!this.canMutateOAuthTokens()) {
            runInAction(() => {
                if (this.oauthPendingServerId === id) {
                    this.oauthPendingServerId = null
                }
            })
            return
        }
        this.updateServer(id, {
            oauthTokens: tokens,
            healthStatus: "unknown", // Reset so user can re-test
        }).catch((err) => this.recordProductSettingsError("persist OAuth tokens", err))

        runInAction(() => {
            if (this.oauthPendingServerId === id) {
                this.oauthPendingServerId = null
            }
        })
    }

    async cancelOAuth(id?: string): Promise<void> {
        await this.oauth.cancelOAuth(id ?? this.oauthPendingServerId)
    }

    async disconnectOAuth(id: string): Promise<void> {
        await this.updateServer(id, {
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
