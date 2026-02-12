import { writeFile } from "node:fs/promises"
import type { McpServerConfig } from "../../types.js"

/**
 * Writes a standard MCP config JSON file compatible with Claude CLI's --mcp-config flag.
 */
export async function writeMcpConfigJson(servers: Record<string, McpServerConfig>, filePath: string): Promise<void> {
    const mcpServers: Record<string, unknown> = {}

    for (const [name, config] of Object.entries(servers)) {
        if (config.type === "stdio") {
            const entry: Record<string, unknown> = {
                command: config.command,
            }
            if (config.args && config.args.length > 0) {
                entry.args = config.args
            }
            if (config.env && Object.keys(config.env).length > 0) {
                entry.env = config.env
            }
            if (config.cwd) {
                entry.cwd = config.cwd
            }
            mcpServers[name] = entry
        } else if (config.type === "http") {
            const entry: Record<string, unknown> = {
                type: "http",
                url: config.url,
            }
            if (config.headers && Object.keys(config.headers).length > 0) {
                entry.headers = config.headers
            }
            mcpServers[name] = entry
        }
    }

    const output = JSON.stringify({ mcpServers }, null, 2)
    await writeFile(filePath, output, "utf-8")
}

/**
 * Builds the MCP config JSON object without writing to disk.
 * Useful for testing.
 */
export function buildMcpConfigObject(servers: Record<string, McpServerConfig>): { mcpServers: Record<string, unknown> } {
    const mcpServers: Record<string, unknown> = {}

    for (const [name, config] of Object.entries(servers)) {
        if (config.type === "stdio") {
            const entry: Record<string, unknown> = {
                command: config.command,
            }
            if (config.args && config.args.length > 0) {
                entry.args = config.args
            }
            if (config.env && Object.keys(config.env).length > 0) {
                entry.env = config.env
            }
            if (config.cwd) {
                entry.cwd = config.cwd
            }
            mcpServers[name] = entry
        } else if (config.type === "http") {
            const entry: Record<string, unknown> = {
                type: "http",
                url: config.url,
            }
            if (config.headers && Object.keys(config.headers).length > 0) {
                entry.headers = config.headers
            }
            mcpServers[name] = entry
        }
    }

    return { mcpServers }
}
