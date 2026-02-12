import { describe, it, expect } from "vitest"
import { buildCodexMcpConfigOverrides } from "../../harnesses/codex/config-overrides.js"
import type { McpServerConfig } from "../../types.js"

describe("buildCodexMcpConfigOverrides", () => {
    it("produces -c overrides for stdio server", () => {
        const servers: Record<string, McpServerConfig> = {
            "my-server": {
                type: "stdio",
                command: "npx",
                args: ["my-mcp-server"],
                env: { API_KEY: "xxx" },
            },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        expect(result.configArgs).toContain('mcp_servers.my_server.type="stdio"')
        expect(result.configArgs).toContain('mcp_servers.my_server.command="npx"')
        expect(result.configArgs).toContain('mcp_servers.my_server.args=["my-mcp-server"]')
        expect(result.configArgs).toContain('mcp_servers.my_server.env.API_KEY="xxx"')
    })

    it("produces -c overrides for HTTP server", () => {
        const servers: Record<string, McpServerConfig> = {
            "http-server": {
                type: "http",
                url: "https://mcp.example.com/sse",
                headers: { "X-Test": "1" },
            },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        expect(result.configArgs).toContain('mcp_servers.http_server.type="http"')
        expect(result.configArgs).toContain('mcp_servers.http_server.url="https://mcp.example.com/sse"')
        expect(result.configArgs).toContain('mcp_servers.http_server.http_headers.X_Test="1"')
    })

    it("translates Bearer token to bearer_token_env_var + ephemeral env var", () => {
        const servers: Record<string, McpServerConfig> = {
            "auth-server": {
                type: "http",
                url: "https://example.com",
                headers: { Authorization: "Bearer my-secret-token" },
            },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        // Should have bearer_token_env_var override
        expect(result.configArgs).toContain('mcp_servers.auth_server.bearer_token_env_var="__HARNESS_MCP_TOKEN_AUTH_SERVER"')

        // Token should be in env vars
        expect(result.env.__HARNESS_MCP_TOKEN_AUTH_SERVER).toBe("my-secret-token")
    })

    it("authorization token is not present in emitted -c args", () => {
        const servers: Record<string, McpServerConfig> = {
            secure: {
                type: "http",
                url: "https://example.com",
                headers: { Authorization: "Bearer secret123" },
            },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        // No -c arg should contain the actual token
        for (const arg of result.configArgs) {
            expect(arg).not.toContain("secret123")
        }

        // No Authorization header override (it was converted to bearer_token_env_var)
        const hasAuthHeader = result.configArgs.some((a) => a.includes("http_headers.Authorization") || a.includes("http_headers.authorization"))
        expect(hasAuthHeader).toBe(false)
    })

    it("non-bearer Authorization header is passed through", () => {
        const servers: Record<string, McpServerConfig> = {
            basic: {
                type: "http",
                url: "https://example.com",
                headers: { Authorization: "Basic abc123" },
            },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        // Should have http_headers override (not bearer_token_env_var)
        expect(result.configArgs).toContain('mcp_servers.basic.http_headers.Authorization="Basic abc123"')
        expect(result.env).toEqual({})
    })

    it("handles multiple headers on HTTP server", () => {
        const servers: Record<string, McpServerConfig> = {
            multi: {
                type: "http",
                url: "https://example.com",
                headers: {
                    Authorization: "Bearer tok",
                    "X-Custom": "value",
                    "X-Another": "test",
                },
            },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        // Bearer should be in env
        expect(result.env.__HARNESS_MCP_TOKEN_MULTI).toBe("tok")

        // Other headers should be in -c args
        expect(result.configArgs).toContain('mcp_servers.multi.http_headers.X_Custom="value"')
        expect(result.configArgs).toContain('mcp_servers.multi.http_headers.X_Another="test"')
    })

    it("replaces hyphens with underscores in server names", () => {
        const servers: Record<string, McpServerConfig> = {
            "my-cool-server": {
                type: "stdio",
                command: "node",
            },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        // Should use underscored name
        expect(result.configArgs).toContain('mcp_servers.my_cool_server.type="stdio"')
        expect(result.configArgs).toContain('mcp_servers.my_cool_server.command="node"')
    })

    it("escapes special characters in TOML values", () => {
        const servers: Record<string, McpServerConfig> = {
            test: {
                type: "stdio",
                command: 'path/to/"my binary"',
            },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        const commandArg = result.configArgs.find((a) => a.includes("command="))
        expect(commandArg).toBeDefined()
        expect(commandArg).toContain('\\"my binary\\"')
    })

    it("no CODEX_HOME env mutation", () => {
        const servers: Record<string, McpServerConfig> = {
            test: { type: "stdio", command: "node" },
        }

        const result = buildCodexMcpConfigOverrides(servers)

        expect(result.env.CODEX_HOME).toBeUndefined()
    })
})
