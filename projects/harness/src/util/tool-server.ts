import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID, randomBytes } from "node:crypto"
import type { ClientToolDefinition, McpHttpServerConfig } from "../types.js"

// Use dynamic imports for the MCP SDK to keep it as a peer dependency
async function loadMcpSdk() {
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js")
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js")
    const types = await import("@modelcontextprotocol/sdk/types.js")
    return { Server, StreamableHTTPServerTransport, types }
}

export interface ToolServerHandle {
    /** Name used when injecting into mcpServers map */
    serverName: string

    /** MCP server registration info (for adding to MCP config) */
    mcpServer: McpHttpServerConfig

    /** Optional env vars that callers should merge into child env */
    env?: Record<string, string>

    /** Stops HTTP listener and MCP transport */
    stop(): Promise<void>
}

export interface ToolServerOptions {
    host?: string
    port?: number
    requireAuth?: boolean
}

/**
 * Starts a local in-process HTTP MCP server that exposes the given tools.
 * The server speaks MCP over streamable HTTP and dispatches tool calls
 * directly to the provided handlers.
 */
export async function startToolServer(tools: ClientToolDefinition[], options?: ToolServerOptions): Promise<ToolServerHandle> {
    const host = options?.host ?? "127.0.0.1"
    const port = options?.port ?? 0
    const requireAuth = options?.requireAuth ?? true

    const { Server, StreamableHTTPServerTransport, types } = await loadMcpSdk()

    // Generate auth token if required
    const authToken = requireAuth ? randomBytes(32).toString("hex") : null

    // Store transports by session ID
    const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>()

    function createMcpServer() {
        const server = new Server(
            { name: "__harness_client_tools", version: "1.0.0" },
            {
                capabilities: {
                    tools: {},
                },
            }
        )

        // Register tools/list handler
        server.setRequestHandler(types.ListToolsRequestSchema, async () => {
            return {
                tools: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema,
                })),
            }
        })

        // Register tools/call handler
        server.setRequestHandler(types.CallToolRequestSchema, async (request) => {
            const toolName = request.params.name
            const toolArgs = (request.params.arguments ?? {}) as Record<string, unknown>

            const tool = tools.find((t) => t.name === toolName)
            if (!tool) {
                return {
                    content: [{ type: "text" as const, text: `Unknown tool: ${toolName}` }],
                    isError: true,
                }
            }

            try {
                const result = await tool.handler(toolArgs)
                if (result.error) {
                    return {
                        content: [{ type: "text" as const, text: result.error }],
                        isError: true,
                    }
                }
                return {
                    content: [{ type: "text" as const, text: result.content ?? "" }],
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                return {
                    content: [{ type: "text" as const, text: message }],
                    isError: true,
                }
            }
        })

        return server
    }

    // Read request body
    function readBody(req: IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = []
            req.on("data", (chunk: Buffer) => chunks.push(chunk))
            req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
            req.on("error", reject)
        })
    }

    // Check auth
    function checkAuth(req: IncomingMessage): boolean {
        if (!authToken) return true
        const authHeader = req.headers.authorization
        return authHeader === `Bearer ${authToken}`
    }

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // Check authentication
        if (!checkAuth(req)) {
            res.writeHead(401, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" }, id: null }))
            return
        }

        const method = req.method?.toUpperCase()

        if (method === "POST") {
            const body = await readBody(req)
            let parsedBody: unknown
            try {
                parsedBody = JSON.parse(body)
            } catch {
                res.writeHead(400, { "Content-Type": "application/json" })
                res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }))
                return
            }

            const sessionId = req.headers["mcp-session-id"] as string | undefined

            if (sessionId && transports.has(sessionId)) {
                // Existing session
                const transport = transports.get(sessionId)!
                await transport.handleRequest(req, res, parsedBody)
            } else if (!sessionId && types.isInitializeRequest(parsedBody)) {
                // New initialization request
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (sid: string) => {
                        transports.set(sid, transport)
                    },
                })

                transport.onclose = () => {
                    const sid = transport.sessionId
                    if (sid) transports.delete(sid)
                }

                const server = createMcpServer()
                await server.connect(transport)
                await transport.handleRequest(req, res, parsedBody)
            } else {
                res.writeHead(400, { "Content-Type": "application/json" })
                res.end(
                    JSON.stringify({
                        jsonrpc: "2.0",
                        error: { code: -32000, message: "Bad Request: missing session ID or not an init request" },
                        id: null,
                    })
                )
            }
        } else if (method === "GET") {
            const sessionId = req.headers["mcp-session-id"] as string | undefined
            if (sessionId && transports.has(sessionId)) {
                await transports.get(sessionId)!.handleRequest(req, res)
            } else {
                res.writeHead(400, { "Content-Type": "text/plain" })
                res.end("Invalid or missing session ID")
            }
        } else if (method === "DELETE") {
            const sessionId = req.headers["mcp-session-id"] as string | undefined
            if (sessionId && transports.has(sessionId)) {
                await transports.get(sessionId)!.handleRequest(req, res)
            } else {
                res.writeHead(400, { "Content-Type": "text/plain" })
                res.end("Invalid or missing session ID")
            }
        } else {
            res.writeHead(405, { "Content-Type": "text/plain" })
            res.end("Method Not Allowed")
        }
    })

    // Start listening
    await new Promise<void>((resolve) => {
        httpServer.listen(port, host, () => resolve())
    })

    const addr = httpServer.address()
    if (!addr || typeof addr === "string") {
        throw new Error("Failed to get server address")
    }

    const url = `http://${host}:${addr.port}/mcp`

    const headers: Record<string, string> = {}
    const env: Record<string, string> = {}

    if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`
    }

    return {
        serverName: "__harness_client_tools",
        mcpServer: {
            type: "http",
            url,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
        },
        env: Object.keys(env).length > 0 ? env : undefined,
        async stop() {
            // Close all transports
            for (const transport of transports.values()) {
                try {
                    await transport.close?.()
                } catch {
                    // Ignore cleanup errors
                }
            }
            transports.clear()

            // Close HTTP server
            await new Promise<void>((resolve, reject) => {
                httpServer.close((err: Error | undefined) => {
                    if (err) reject(err)
                    else resolve()
                })
            })
        },
    }
}
