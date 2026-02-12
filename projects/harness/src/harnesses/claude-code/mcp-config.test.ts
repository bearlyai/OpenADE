import { describe, it, expect } from "vitest"
import { buildMcpConfigObject } from "./mcp-config.js"
import type { McpServerConfig } from "../../types.js"

describe("buildMcpConfigObject", () => {
    it("produces correct structure for stdio server", () => {
        const servers: Record<string, McpServerConfig> = {
            "my-server": {
                type: "stdio",
                command: "npx",
                args: ["my-mcp-server"],
                env: { API_KEY: "xxx" },
            },
        }

        const result = buildMcpConfigObject(servers)

        expect(result).toEqual({
            mcpServers: {
                "my-server": {
                    command: "npx",
                    args: ["my-mcp-server"],
                    env: { API_KEY: "xxx" },
                },
            },
        })
    })

    it("produces correct structure for HTTP server with headers", () => {
        const servers: Record<string, McpServerConfig> = {
            "http-server": {
                type: "http",
                url: "https://mcp.example.com/sse",
                headers: { Authorization: "Bearer xxx" },
            },
        }

        const result = buildMcpConfigObject(servers)

        expect(result).toEqual({
            mcpServers: {
                "http-server": {
                    type: "http",
                    url: "https://mcp.example.com/sse",
                    headers: { Authorization: "Bearer xxx" },
                },
            },
        })
    })

    it("produces correct combined JSON for multiple servers", () => {
        const servers: Record<string, McpServerConfig> = {
            "stdio-server": {
                type: "stdio",
                command: "node",
                args: ["server.js"],
            },
            "http-server": {
                type: "http",
                url: "https://example.com/mcp",
            },
        }

        const result = buildMcpConfigObject(servers)

        expect(Object.keys(result.mcpServers)).toHaveLength(2)
        expect(result.mcpServers["stdio-server"]).toEqual({
            command: "node",
            args: ["server.js"],
        })
        expect(result.mcpServers["http-server"]).toEqual({
            type: "http",
            url: "https://example.com/mcp",
        })
    })

    it("output is valid JSON (serializable)", () => {
        const servers: Record<string, McpServerConfig> = {
            test: {
                type: "stdio",
                command: "echo",
                args: ["hello"],
                env: { KEY: "val" },
                cwd: "/tmp",
            },
        }

        const result = buildMcpConfigObject(servers)
        const json = JSON.stringify(result)
        const parsed = JSON.parse(json)

        expect(parsed).toEqual(result)
    })

    it("omits empty args array", () => {
        const servers: Record<string, McpServerConfig> = {
            test: { type: "stdio", command: "my-binary" },
        }

        const result = buildMcpConfigObject(servers)
        const entry = result.mcpServers["test"] as Record<string, unknown>

        expect(entry.command).toBe("my-binary")
        expect(entry.args).toBeUndefined()
    })

    it("omits empty env object", () => {
        const servers: Record<string, McpServerConfig> = {
            test: { type: "stdio", command: "my-binary", env: {} },
        }

        const result = buildMcpConfigObject(servers)
        const entry = result.mcpServers["test"] as Record<string, unknown>

        expect(entry.env).toBeUndefined()
    })

    it("omits empty headers", () => {
        const servers: Record<string, McpServerConfig> = {
            test: { type: "http", url: "https://example.com", headers: {} },
        }

        const result = buildMcpConfigObject(servers)
        const entry = result.mcpServers["test"] as Record<string, unknown>

        expect(entry.headers).toBeUndefined()
    })

    it("includes cwd for stdio server", () => {
        const servers: Record<string, McpServerConfig> = {
            test: { type: "stdio", command: "node", cwd: "/opt/app" },
        }

        const result = buildMcpConfigObject(servers)
        const entry = result.mcpServers["test"] as Record<string, unknown>

        expect(entry.cwd).toBe("/opt/app")
    })
})
