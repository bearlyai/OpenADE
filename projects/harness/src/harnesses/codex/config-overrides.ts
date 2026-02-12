import type { McpServerConfig } from "../../types.js"

export interface CodexConfigOverrideBuildResult {
    /** Repeated as: -c <key=value> */
    configArgs: string[]
    /** Ephemeral env vars for bearer tokens, etc. */
    env: Record<string, string>
}

/**
 * Builds Codex config overrides for MCP servers without writing config.toml.
 * Produces -c arguments for the codex CLI.
 */
export function buildCodexMcpConfigOverrides(servers: Record<string, McpServerConfig>): CodexConfigOverrideBuildResult {
    const configArgs: string[] = []
    const env: Record<string, string> = {}

    for (const [name, config] of Object.entries(servers)) {
        // Sanitize name for TOML keys (replace hyphens with underscores)
        const safeName = name.replace(/-/g, "_")

        if (config.type === "stdio") {
            configArgs.push(`mcp_servers.${safeName}.type="stdio"`)
            configArgs.push(`mcp_servers.${safeName}.command="${escapeToml(config.command)}"`)

            if (config.args && config.args.length > 0) {
                const argsJson = JSON.stringify(config.args)
                configArgs.push(`mcp_servers.${safeName}.args=${argsJson}`)
            }

            if (config.env) {
                for (const [key, value] of Object.entries(config.env)) {
                    configArgs.push(`mcp_servers.${safeName}.env.${key}="${escapeToml(value)}"`)
                }
            }
        } else if (config.type === "http") {
            configArgs.push(`mcp_servers.${safeName}.type="http"`)
            configArgs.push(`mcp_servers.${safeName}.url="${escapeToml(config.url)}"`)

            if (config.headers) {
                // Check for Authorization: Bearer <token> header
                const authHeader = config.headers["Authorization"] ?? config.headers["authorization"]
                const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i)

                if (bearerMatch) {
                    // Use bearer_token_env_var to keep token out of CLI args
                    const envVarName = `__HARNESS_MCP_TOKEN_${safeName.toUpperCase()}`
                    configArgs.push(`mcp_servers.${safeName}.bearer_token_env_var="${envVarName}"`)
                    env[envVarName] = bearerMatch[1]
                }

                // Add other headers (skip Authorization if it was a Bearer token)
                for (const [key, value] of Object.entries(config.headers)) {
                    const isAuthKey = key.toLowerCase() === "authorization"
                    if (isAuthKey && bearerMatch) continue // Already handled via bearer_token_env_var

                    // Codex uses http_headers with underscored keys
                    const headerKey = key.replace(/-/g, "_")
                    configArgs.push(`mcp_servers.${safeName}.http_headers.${headerKey}="${escapeToml(value)}"`)
                }
            }
        }
    }

    return { configArgs, env }
}

/**
 * Escapes a string for use in TOML quoted values.
 */
function escapeToml(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}
