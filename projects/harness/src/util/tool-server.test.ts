import { describe, it, expect, afterEach } from "vitest"
import { startToolServer, type ToolServerHandle } from "./tool-server.js"
import type { ClientToolDefinition } from "../types.js"

// Track handles for cleanup
const handles: ToolServerHandle[] = []

afterEach(async () => {
    for (const handle of handles) {
        try {
            await handle.stop()
        } catch {
            // Ignore cleanup errors
        }
    }
    handles.length = 0
})

async function startAndTrack(tools: ClientToolDefinition[], options?: { requireAuth?: boolean }): Promise<ToolServerHandle> {
    const handle = await startToolServer(tools, options)
    handles.push(handle)
    return handle
}

describe("startToolServer", () => {
    it("starts a server and returns valid handle", async () => {
        const handle = await startAndTrack([
            {
                name: "echo",
                description: "Echoes input",
                inputSchema: {
                    type: "object",
                    properties: { text: { type: "string" } },
                    required: ["text"],
                },
                handler: async (args) => ({ content: String(args.text) }),
            },
        ])

        expect(handle.serverName).toBe("__harness_client_tools")
        expect(handle.mcpServer.type).toBe("http")
        expect(handle.mcpServer.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    })

    it("serves tools via MCP protocol (using SDK client)", async () => {
        const handle = await startAndTrack(
            [
                {
                    name: "echo",
                    description: "Echoes text back",
                    inputSchema: {
                        type: "object",
                        properties: { text: { type: "string" } },
                        required: ["text"],
                    },
                    handler: async (args) => ({ content: `echo: ${args.text}` }),
                },
            ],
            { requireAuth: false }
        )

        // Use the MCP SDK client to connect and call the tool
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")

        const client = new Client({ name: "test-client", version: "1.0.0" })
        const transport = new StreamableHTTPClientTransport(new URL(handle.mcpServer.url))

        await client.connect(transport)

        // List tools
        const toolList = await client.listTools()
        expect(toolList.tools).toHaveLength(1)
        expect(toolList.tools[0].name).toBe("echo")
        expect(toolList.tools[0].description).toBe("Echoes text back")

        // Call tool
        const result = await client.callTool({ name: "echo", arguments: { text: "hello" } })
        expect(result.content).toEqual([{ type: "text", text: "echo: hello" }])
        expect(result.isError).toBeFalsy()

        await transport.close()
    })

    it("serves multiple tools", async () => {
        const handle = await startAndTrack(
            [
                {
                    name: "add",
                    description: "Adds two numbers",
                    inputSchema: {
                        type: "object",
                        properties: { a: { type: "number" }, b: { type: "number" } },
                        required: ["a", "b"],
                    },
                    handler: async (args) => ({ content: String(Number(args.a) + Number(args.b)) }),
                },
                {
                    name: "greet",
                    description: "Greets a person",
                    inputSchema: {
                        type: "object",
                        properties: { name: { type: "string" } },
                        required: ["name"],
                    },
                    handler: async (args) => ({ content: `Hello, ${args.name}!` }),
                },
            ],
            { requireAuth: false }
        )

        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")

        const client = new Client({ name: "test-client", version: "1.0.0" })
        const transport = new StreamableHTTPClientTransport(new URL(handle.mcpServer.url))
        await client.connect(transport)

        const toolList = await client.listTools()
        expect(toolList.tools).toHaveLength(2)

        const addResult = await client.callTool({ name: "add", arguments: { a: 3, b: 4 } })
        expect(addResult.content).toEqual([{ type: "text", text: "7" }])

        const greetResult = await client.callTool({ name: "greet", arguments: { name: "World" } })
        expect(greetResult.content).toEqual([{ type: "text", text: "Hello, World!" }])

        await transport.close()
    })

    it("handles handler errors gracefully", async () => {
        const handle = await startAndTrack(
            [
                {
                    name: "fail",
                    description: "Always fails",
                    inputSchema: { type: "object", properties: {} },
                    handler: async () => {
                        throw new Error("Something went wrong")
                    },
                },
            ],
            { requireAuth: false }
        )

        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")

        const client = new Client({ name: "test-client", version: "1.0.0" })
        const transport = new StreamableHTTPClientTransport(new URL(handle.mcpServer.url))
        await client.connect(transport)

        const result = await client.callTool({ name: "fail", arguments: {} })
        expect(result.isError).toBe(true)
        expect(result.content).toEqual([{ type: "text", text: "Something went wrong" }])

        await transport.close()
    })

    it("handles handler returning error in result", async () => {
        const handle = await startAndTrack(
            [
                {
                    name: "soft-fail",
                    description: "Returns error",
                    inputSchema: { type: "object", properties: {} },
                    handler: async () => ({ error: "Soft error" }),
                },
            ],
            { requireAuth: false }
        )

        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")

        const client = new Client({ name: "test-client", version: "1.0.0" })
        const transport = new StreamableHTTPClientTransport(new URL(handle.mcpServer.url))
        await client.connect(transport)

        const result = await client.callTool({ name: "soft-fail", arguments: {} })
        expect(result.isError).toBe(true)
        expect(result.content).toEqual([{ type: "text", text: "Soft error" }])

        await transport.close()
    })

    it("returns unknown tool error for missing tool", async () => {
        const handle = await startAndTrack([], { requireAuth: false })

        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")

        const client = new Client({ name: "test-client", version: "1.0.0" })
        const transport = new StreamableHTTPClientTransport(new URL(handle.mcpServer.url))
        await client.connect(transport)

        const result = await client.callTool({ name: "nonexistent", arguments: {} })
        expect(result.isError).toBe(true)
        expect(result.content).toEqual([{ type: "text", text: "Unknown tool: nonexistent" }])

        await transport.close()
    })

    it("requires auth when configured", async () => {
        const handle = await startAndTrack(
            [
                {
                    name: "echo",
                    description: "Echoes",
                    inputSchema: { type: "object", properties: {} },
                    handler: async () => ({ content: "ok" }),
                },
            ],
            { requireAuth: true }
        )

        // Verify auth header is present in config
        expect(handle.mcpServer.headers).toBeDefined()
        expect(handle.mcpServer.headers!["Authorization"]).toMatch(/^Bearer .+/)

        // Unauthenticated request should fail
        const url = handle.mcpServer.url
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
        })
        expect(response.status).toBe(401)

        // Authenticated request via MCP client should succeed
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")

        const client = new Client({ name: "test-client", version: "1.0.0" })
        const transport = new StreamableHTTPClientTransport(new URL(url), {
            requestInit: {
                headers: handle.mcpServer.headers,
            },
        })
        await client.connect(transport)

        const toolList = await client.listTools()
        expect(toolList.tools).toHaveLength(1)

        await transport.close()
    })

    it("stop() closes the HTTP listener", async () => {
        const handle = await startToolServer(
            [
                {
                    name: "echo",
                    description: "Echoes",
                    inputSchema: { type: "object", properties: {} },
                    handler: async () => ({ content: "ok" }),
                },
            ],
            { requireAuth: false }
        )

        const url = handle.mcpServer.url

        // Server should be reachable
        const res1 = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "initialize",
                id: 1,
                params: {
                    protocolVersion: "2025-03-26",
                    capabilities: {},
                    clientInfo: { name: "test", version: "1.0.0" },
                },
            }),
        })
        expect(res1.status).not.toBe(500)

        // Stop the server
        await handle.stop()

        // Server should no longer be reachable
        await expect(
            fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            })
        ).rejects.toThrow()
    })
})
