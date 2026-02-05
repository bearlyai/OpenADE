/**
 * MCP Server Module for Electron
 *
 * Provides MCP server operations via IPC to the dashboard frontend:
 * - Connection testing (real MCP JSON-RPC protocol check)
 * - OAuth flow with automatic endpoint discovery and dynamic client registration
 * - Token exchange
 */

import { ipcMain, shell, BrowserWindow, type IpcMainInvokeEvent } from "electron"
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http"
import { URL } from "url"
import { randomBytes, createHash } from "crypto"
import logger from "electron-log"
import { isDev } from "../../config"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/mcp.ts
// ============================================================================

interface McpServerConfig {
    type: "http" | "stdio"
    // HTTP config
    url?: string
    headers?: Record<string, string>
    // Stdio config (not used for connection testing here)
    command?: string
    args?: string[]
    env?: Record<string, string>
}

interface TestMcpConnectionParams {
    config: McpServerConfig
}

interface TestMcpConnectionResponse {
    success: boolean
    error?: string
    requiresAuth?: boolean
    authDetails?: {
        resourceMetadataUrl?: string
        scope?: string
    }
}

interface InitiateMcpOAuthParams {
    serverId: string
    serverUrl: string // MCP server URL - we discover OAuth endpoints from this
}

interface InitiateMcpOAuthResponse {
    success: boolean
    error?: string
}

interface CancelMcpOAuthParams {
    serverId: string
}

interface CancelMcpOAuthResponse {
    success: boolean
}

interface RefreshMcpOAuthParams {
    serverId: string
    serverUrl: string
    refreshToken: string
}

interface RefreshMcpOAuthResponse {
    success: boolean
    tokens?: McpOAuthTokens
    error?: string
}

// OAuth flow timeout (30 minutes)
const OAUTH_TIMEOUT_MS = 30 * 60 * 1000

// OAuth 2.0 Authorization Server Metadata (RFC8414)
interface OAuthMetadata {
    authorization_endpoint: string
    token_endpoint: string
    registration_endpoint?: string
    scopes_supported?: string[]
}

// Dynamic Client Registration Response (RFC7591)
interface DynamicClientRegistrationResponse {
    client_id: string
    client_secret?: string
    client_id_issued_at?: number
    client_secret_expires_at?: number
}

interface McpOAuthTokens {
    accessToken: string
    refreshToken?: string
    expiresAt?: string
    tokenType: string
}

interface OAuthCompleteResult {
    serverId: string
    tokens?: McpOAuthTokens
    error?: string
}

// ============================================================================
// State
// ============================================================================

interface PendingOAuthFlow {
    server: Server
    tokenUrl: string
    clientId: string
    redirectUri: string
    codeVerifier: string
    sender: Electron.WebContents
    timeout: NodeJS.Timeout
}

const pendingOAuthFlows = new Map<string, PendingOAuthFlow>()


// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if caller is allowed
 */
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
        logger.error("[MCP:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

/**
 * Generate PKCE code verifier (43-128 characters, URL-safe)
 */
function generateCodeVerifier(): string {
    return randomBytes(32).toString("base64url")
}

/**
 * Generate PKCE code challenge from verifier (S256 method)
 */
function generateCodeChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url")
}

/**
 * Parse WWW-Authenticate header to extract OAuth details
 */
function parseWwwAuthenticate(header: string | null): { resourceMetadataUrl?: string; scope?: string } {
    if (!header) return {}

    const result: { resourceMetadataUrl?: string; scope?: string } = {}

    // Parse resource_metadata="url"
    const resourceMatch = header.match(/resource_metadata="([^"]+)"/)
    if (resourceMatch) {
        result.resourceMetadataUrl = resourceMatch[1]
    }

    // Parse scope="scope1 scope2"
    const scopeMatch = header.match(/scope="([^"]+)"/)
    if (scopeMatch) {
        result.scope = scopeMatch[1]
    }

    return result
}

/**
 * Get authorization base URL from MCP server URL.
 * Per MCP spec: strip the path component.
 */
function getAuthBaseUrl(serverUrl: string): string {
    const url = new URL(serverUrl)
    return `${url.protocol}//${url.host}`
}

/**
 * Safely send a message to a WebContents, checking if it's still valid.
 * Returns true if the message was sent, false if the sender was destroyed.
 */
function safeSend(sender: Electron.WebContents, channel: string, ...args: unknown[]): boolean {
    try {
        if (sender.isDestroyed()) {
            logger.warn("[MCP:OAuth] Cannot send message - WebContents destroyed", JSON.stringify({ channel }))
            return false
        }
        sender.send(channel, ...args)
        return true
    } catch (error) {
        logger.warn("[MCP:OAuth] Failed to send message", JSON.stringify({ channel, error }))
        return false
    }
}

/**
 * Focus the main Electron window to bring the app to the foreground.
 */
function focusMainWindow(): void {
    const windows = BrowserWindow.getAllWindows()
    const mainWindow = windows.find((w) => !w.isDestroyed())
    if (mainWindow) {
        if (mainWindow.isMinimized()) {
            mainWindow.restore()
        }
        mainWindow.focus()
        logger.info("[MCP:OAuth] Focused main window")
    }
}

// ============================================================================
// OAuth Discovery & Registration
// ============================================================================

/**
 * Discover OAuth metadata from the server.
 * Fetches /.well-known/oauth-authorization-server per RFC8414.
 */
async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata> {
    const baseUrl = getAuthBaseUrl(serverUrl)
    const metadataUrl = `${baseUrl}/.well-known/oauth-authorization-server`

    logger.info("[MCP:OAuth] Discovering OAuth metadata", JSON.stringify({ metadataUrl }))

    const response = await fetch(metadataUrl, {
        headers: {
            Accept: "application/json",
            "MCP-Protocol-Version": "2025-03-26",
        },
    })

    if (!response.ok) {
        throw new Error(`OAuth metadata discovery failed: ${response.status} ${response.statusText}`)
    }

    const metadata = (await response.json()) as OAuthMetadata

    if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
        throw new Error("OAuth metadata missing required endpoints")
    }

    logger.info("[MCP:OAuth] OAuth metadata discovered", JSON.stringify({
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint,
        registration_endpoint: metadata.registration_endpoint,
    }))

    return metadata
}

/**
 * Perform dynamic client registration per RFC7591.
 * Registers a new client each time since we use dynamic ports for the redirect URI.
 */
async function registerClient(registrationEndpoint: string, redirectUri: string): Promise<string> {
    logger.info("[MCP:OAuth] Registering dynamic client", JSON.stringify({ registrationEndpoint, redirectUri }))

    const response = await fetch(registrationEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            client_name: "Bearly AI",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none", // Public client
        }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Dynamic client registration failed: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as DynamicClientRegistrationResponse
    logger.info("[MCP:OAuth] Client registered successfully", JSON.stringify({ client_id: data.client_id }))

    return data.client_id
}

// ============================================================================
// Connection Testing
// ============================================================================

/**
 * Test connection to an MCP server using the actual MCP protocol.
 * Makes a JSON-RPC initialize request and checks the response.
 */
async function handleTestConnection(config: McpServerConfig): Promise<TestMcpConnectionResponse> {
    const startTime = Date.now()

    if (config.type !== "http" || !config.url) {
        // For stdio servers, we can't test from here - would need to spawn the process
        return { success: true, error: "Stdio servers are validated at runtime" }
    }

    logger.info("[MCP:testConnection] Testing MCP server", JSON.stringify({ url: config.url }))

    try {
        const response = await fetch(config.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream",
                "MCP-Protocol-Version": "2025-11-25",
                ...(config.headers || {}),
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2025-11-25",
                    capabilities: {},
                    clientInfo: { name: "bearly", version: "1.0.0" },
                },
            }),
        })

        logger.info("[MCP:testConnection] Response received", JSON.stringify({
            status: response.status,
            duration: Date.now() - startTime,
        }))

        if (response.status === 401) {
            const wwwAuth = response.headers.get("WWW-Authenticate")
            const authDetails = parseWwwAuthenticate(wwwAuth)
            logger.info("[MCP:testConnection] Server requires authentication", JSON.stringify({ authDetails }))
            return {
                success: false,
                requiresAuth: true,
                authDetails,
            }
        }

        if (response.status === 403) {
            const wwwAuth = response.headers.get("WWW-Authenticate")
            if (wwwAuth?.includes("insufficient_scope")) {
                return {
                    success: false,
                    requiresAuth: true,
                    error: "Insufficient scope - need to re-authenticate with more permissions",
                }
            }
            return { success: false, error: "Forbidden - check your credentials" }
        }

        if (response.status >= 200 && response.status < 300) {
            // Try to parse the response to verify it's valid MCP
            try {
                const data = await response.json()
                if (data.jsonrpc === "2.0" && data.result) {
                    logger.info("[MCP:testConnection] Connection successful", JSON.stringify({
                        serverInfo: data.result.serverInfo,
                        duration: Date.now() - startTime,
                    }))
                    return { success: true }
                }
            } catch {
                // Response wasn't JSON, but status was OK - might be SSE
                return { success: true }
            }
            return { success: true }
        }

        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error"
        logger.error("[MCP:testConnection] Connection failed", JSON.stringify({ error: message }))
        return { success: false, error: message }
    }
}

// ============================================================================
// OAuth Flow
// ============================================================================

/**
 * Clean up a pending OAuth flow
 */
function cleanupOAuthFlow(serverId: string, reason: string): void {
    const flow = pendingOAuthFlows.get(serverId)
    if (!flow) return

    logger.info("[MCP:OAuth] Cleaning up OAuth flow", JSON.stringify({ serverId, reason }))

    clearTimeout(flow.timeout)
    flow.server.close()
    pendingOAuthFlows.delete(serverId)
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(
    tokenUrl: string,
    code: string,
    clientId: string,
    redirectUri: string,
    codeVerifier: string
): Promise<McpOAuthTokens> {
    logger.info("[MCP:OAuth] Exchanging code for tokens", JSON.stringify({ tokenUrl }))

    const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id: clientId,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
        }).toString(),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
    }

    const data = await response.json()

    // Calculate expiration time if expires_in is provided
    let expiresAt: string | undefined
    if (data.expires_in) {
        const expiresDate = new Date(Date.now() + data.expires_in * 1000)
        expiresAt = expiresDate.toISOString()
    }

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
        tokenType: data.token_type || "Bearer",
    }
}

/**
 * Handle OAuth callback from the local server
 */
async function handleOAuthCallback(
    req: IncomingMessage,
    res: ServerResponse,
    serverId: string
): Promise<void> {
    const flow = pendingOAuthFlows.get(serverId)
    if (!flow) {
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end("<html><body><h1>OAuth Error</h1><p>No pending OAuth flow found.</p></body></html>")
        return
    }

    const url = new URL(req.url || "/", `http://127.0.0.1`)
    const code = url.searchParams.get("code")
    const error = url.searchParams.get("error")
    const errorDescription = url.searchParams.get("error_description")

    if (error) {
        logger.error("[MCP:OAuth] OAuth error received", JSON.stringify({ error, errorDescription }))

        // Send error to renderer
        const result: OAuthCompleteResult = {
            serverId,
            error: errorDescription || error,
        }
        safeSend(flow.sender, "code:mcp:oauthComplete", result)

        // Show error page
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`
            <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #dc2626;">Authentication Failed</h1>
                <p>${errorDescription || error}</p>
                <p style="color: #666;">You can close this window.</p>
            </body>
            </html>
        `)

        cleanupOAuthFlow(serverId, "error")
        return
    }

    if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end("<html><body><h1>OAuth Error</h1><p>No authorization code received.</p></body></html>")
        return
    }

    try {
        logger.info("[MCP:OAuth] Authorization code received, exchanging for tokens")

        const tokens = await exchangeCodeForTokens(
            flow.tokenUrl,
            code,
            flow.clientId,
            flow.redirectUri,
            flow.codeVerifier
        )

        // Send tokens to renderer
        const result: OAuthCompleteResult = {
            serverId,
            tokens,
        }
        safeSend(flow.sender, "code:mcp:oauthComplete", result)

        // Focus the Electron app window
        focusMainWindow()

        // Show success page that auto-closes
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`
            <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #16a34a;">Authentication Successful</h1>
                <p>You have been connected successfully.</p>
                <p style="color: #666;">This window will close automatically...</p>
                <script>setTimeout(() => window.close(), 1500)</script>
            </body>
            </html>
        `)

        logger.info("[MCP:OAuth] OAuth flow completed successfully", JSON.stringify({ serverId }))
    } catch (error) {
        const message = error instanceof Error ? error.message : "Token exchange failed"
        logger.error("[MCP:OAuth] Token exchange failed", JSON.stringify({ error: message }))

        // Send error to renderer
        const result: OAuthCompleteResult = {
            serverId,
            error: message,
        }
        safeSend(flow.sender, "code:mcp:oauthComplete", result)

        // Show error page
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`
            <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #dc2626;">Authentication Failed</h1>
                <p>${message}</p>
                <p style="color: #666;">You can close this window.</p>
            </body>
            </html>
        `)
    } finally {
        cleanupOAuthFlow(serverId, "completed")
    }
}

/**
 * Initiate OAuth flow for an MCP server.
 * Automatically discovers OAuth endpoints and performs dynamic client registration.
 */
async function handleInitiateOAuth(event: IpcMainInvokeEvent, params: InitiateMcpOAuthParams): Promise<InitiateMcpOAuthResponse> {
    const { serverId, serverUrl } = params
    const startTime = Date.now()

    logger.info("[MCP:OAuth] Initiating OAuth flow", JSON.stringify({ serverId, serverUrl }))

    // Clean up any existing flow for this server
    if (pendingOAuthFlows.has(serverId)) {
        cleanupOAuthFlow(serverId, "new flow started")
    }

    try {
        // Step 1: Discover OAuth metadata
        const metadata = await discoverOAuthMetadata(serverUrl)

        // Step 2: Create local HTTP server on dynamic port (need redirect_uri for registration)
        const server = createServer((req, res) => {
            const url = new URL(req.url || "/", "http://127.0.0.1")
            if (url.pathname === "/callback") {
                handleOAuthCallback(req, res, serverId)
            } else {
                res.writeHead(404)
                res.end("Not found")
            }
        })

        await new Promise<void>((resolve, reject) => {
            server.listen(0, "127.0.0.1", () => resolve())
            server.on("error", reject)
        })

        const address = server.address()
        if (!address || typeof address === "string") {
            throw new Error("Failed to get server address")
        }

        const port = address.port
        const redirectUri = `http://127.0.0.1:${port}/callback`

        logger.info("[MCP:OAuth] Local callback server started", JSON.stringify({ port, redirectUri }))

        // Step 3: Dynamic client registration (if endpoint available)
        let clientId: string

        if (metadata.registration_endpoint) {
            try {
                clientId = await registerClient(metadata.registration_endpoint, redirectUri)
            } catch (regError) {
                logger.warn("[MCP:OAuth] Dynamic registration failed, trying without client_id", JSON.stringify({
                    error: regError instanceof Error ? regError.message : "Unknown",
                }))
                // Some servers may not require client registration - try with a default
                clientId = "bearly"
            }
        } else {
            // No registration endpoint - use default client_id
            clientId = "bearly"
        }

        // Step 4: Generate PKCE parameters
        const codeVerifier = generateCodeVerifier()
        const codeChallenge = generateCodeChallenge(codeVerifier)

        // Step 5: Set timeout (30 minutes)
        const timeout = setTimeout(() => {
            const result: OAuthCompleteResult = {
                serverId,
                error: "OAuth flow timed out",
            }
            safeSend(event.sender, "code:mcp:oauthComplete", result)
            cleanupOAuthFlow(serverId, "timeout")
        }, OAUTH_TIMEOUT_MS)

        // Store pending flow
        pendingOAuthFlows.set(serverId, {
            server,
            tokenUrl: metadata.token_endpoint,
            clientId,
            redirectUri,
            codeVerifier,
            sender: event.sender,
            timeout,
        })

        // Step 6: Build authorization URL
        const authUrl = new URL(metadata.authorization_endpoint)
        authUrl.searchParams.set("response_type", "code")
        authUrl.searchParams.set("client_id", clientId)
        authUrl.searchParams.set("redirect_uri", redirectUri)
        authUrl.searchParams.set("code_challenge", codeChallenge)
        authUrl.searchParams.set("code_challenge_method", "S256")

        // Add scopes if the server advertised them
        if (metadata.scopes_supported?.length) {
            authUrl.searchParams.set("scope", metadata.scopes_supported.join(" "))
        }

        // Step 7: Open browser
        await shell.openExternal(authUrl.toString())

        logger.info("[MCP:OAuth] Browser opened for authorization", JSON.stringify({
            duration: Date.now() - startTime,
        }))

        return { success: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to initiate OAuth"
        logger.error("[MCP:OAuth] Failed to initiate OAuth", JSON.stringify({ error: message }))
        cleanupOAuthFlow(serverId, "error during initiation")
        return { success: false, error: message }
    }
}

// ============================================================================
// Module Export
// ============================================================================

/**
 * Cancel a pending OAuth flow for an MCP server.
 */
function handleCancelOAuth(params: CancelMcpOAuthParams): CancelMcpOAuthResponse {
    const { serverId } = params

    if (pendingOAuthFlows.has(serverId)) {
        cleanupOAuthFlow(serverId, "cancelled by user")
        return { success: true }
    }

    return { success: false }
}

/**
 * Refresh OAuth tokens using the refresh token.
 * Discovers token endpoint from server URL and exchanges refresh token for new tokens.
 */
async function handleRefreshOAuth(params: RefreshMcpOAuthParams): Promise<RefreshMcpOAuthResponse> {
    const { serverUrl, refreshToken } = params

    logger.info("[MCP:OAuth] Refreshing OAuth tokens", JSON.stringify({ serverUrl }))

    try {
        // Discover OAuth metadata to get token endpoint
        const metadata = await discoverOAuthMetadata(serverUrl)

        // Exchange refresh token for new access token
        const response = await fetch(metadata.token_endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
            }).toString(),
        })

        if (!response.ok) {
            const errorText = await response.text()
            logger.error("[MCP:OAuth] Token refresh failed", JSON.stringify({ status: response.status, error: errorText }))
            return { success: false, error: `Token refresh failed: ${response.status}` }
        }

        const data = await response.json()

        // Calculate expiration time if expires_in is provided
        let expiresAt: string | undefined
        if (data.expires_in) {
            const expiresDate = new Date(Date.now() + data.expires_in * 1000)
            expiresAt = expiresDate.toISOString()
        }

        const tokens: McpOAuthTokens = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? refreshToken, // Some servers don't return new refresh token
            expiresAt,
            tokenType: data.token_type || "Bearer",
        }

        logger.info("[MCP:OAuth] Token refresh successful")
        return { success: true, tokens }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Token refresh failed"
        logger.error("[MCP:OAuth] Token refresh error", JSON.stringify({ error: message }))
        return { success: false, error: message }
    }
}

export const load = () => {
    logger.info("[MCP] Registering IPC handlers")

    ipcMain.handle("code:mcp:testConnection", async (event, params: TestMcpConnectionParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleTestConnection(params.config)
    })

    ipcMain.handle("code:mcp:initiateOAuth", async (event, params: InitiateMcpOAuthParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleInitiateOAuth(event, params)
    })

    ipcMain.handle("code:mcp:cancelOAuth", async (event, params: CancelMcpOAuthParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleCancelOAuth(params)
    })

    ipcMain.handle("code:mcp:refreshOAuth", async (event, params: RefreshMcpOAuthParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleRefreshOAuth(params)
    })

    logger.info("[MCP] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[MCP] Cleaning up active OAuth flows")

    // Close all pending OAuth servers
    for (const [serverId] of pendingOAuthFlows) {
        cleanupOAuthFlow(serverId, "app shutdown")
    }

    logger.info("[MCP] Cleanup complete")
}
