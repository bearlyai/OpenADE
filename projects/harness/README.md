# @openade/harness

Unified TypeScript library for driving AI coding CLIs as child processes. Write one query, stream events from any supported harness.

**Supported harnesses:**
- **Claude Code** (`claude`) — Anthropic
- **Codex** (`codex`) — OpenAI

## Install

```bash
yarn add @openade/harness @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is a peer dependency, required only if you use client tools.

## Quick Start

```typescript
import { ClaudeCodeHarness, type HarnessQuery, type HarnessEvent } from "@openade/harness"

const harness = new ClaudeCodeHarness()

const ac = new AbortController()

const query: HarnessQuery = {
    prompt: "List the files in the current directory",
    cwd: process.cwd(),
    mode: "read-only",
    signal: ac.signal,
}

for await (const event of harness.query(query)) {
    switch (event.type) {
        case "session_started":
            console.log("Session:", event.sessionId)
            break
        case "message":
            console.log("Event:", event.message)
            break
        case "complete":
            console.log("Done!", event.usage)
            break
        case "error":
            console.error("Error:", event.error)
            break
    }
}
```

## API Reference

### `Harness<M>`

The core interface every harness implements. `M` is the harness-specific raw event type.

```typescript
interface Harness<M = unknown> {
    readonly id: HarnessId

    meta(): HarnessMeta
    models(): HarnessModel[]
    capabilities(): HarnessCapabilities

    checkInstallStatus(): Promise<HarnessInstallStatus>
    discoverSlashCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]>
    query(q: HarnessQuery): AsyncGenerator<HarnessEvent<M>>
}
```

### `HarnessQuery`

Normalized input accepted by every harness.

| Field | Type | Description |
|---|---|---|
| `prompt` | `string \| PromptPart[]` | The user prompt (text or multimodal parts) |
| `cwd` | `string` | Working directory |
| `mode` | `"read-only" \| "yolo"` | Permission mode |
| `signal` | `AbortSignal` | Cancellation signal |
| `systemPrompt?` | `string` | System prompt (prepended) |
| `appendSystemPrompt?` | `string` | System prompt (appended) |
| `model?` | `string` | Model ID override |
| `thinking?` | `"low" \| "med" \| "high"` | Thinking/reasoning effort |
| `resumeSessionId?` | `string` | Resume a previous session |
| `forkSession?` | `boolean` | Fork instead of resume |
| `additionalDirectories?` | `string[]` | Extra directories to include |
| `env?` | `Record<string, string>` | Extra env vars for the CLI process |
| `allowedTools?` | `string[]` | Tool allow-list (Claude Code only) |
| `disallowedTools?` | `string[]` | Tool deny-list (Claude Code only) |
| `mcpServers?` | `Record<string, McpServerConfig>` | MCP servers to connect |
| `clientTools?` | `ClientToolDefinition[]` | In-process tools exposed via MCP |

### `HarnessEvent<M>`

Stream envelope yielded by `query()`.

```typescript
type HarnessEvent<M> =
    | { type: "message"; message: M }        // Raw harness-specific event
    | { type: "session_started"; sessionId: string }
    | { type: "complete"; usage?: HarnessUsage }
    | { type: "error"; error: string; code?: HarnessErrorCode }
    | { type: "stderr"; data: string }
```

### `HarnessUsage`

Token and cost tracking returned in `complete` events.

```typescript
interface HarnessUsage {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    costUsd?: number       // Claude Code only
    durationMs?: number
}
```

### `HarnessCapabilities`

Describes what a harness supports. Check before using optional features.

```typescript
interface HarnessCapabilities {
    supportsSystemPrompt: boolean
    supportsAppendSystemPrompt: boolean
    supportsReadOnly: boolean
    supportsMcp: boolean
    supportsResume: boolean
    supportsFork: boolean
    supportsClientTools: boolean
    supportsStreamingTokens: boolean
    supportsCostTracking: boolean
    supportsNamedTools: boolean
    supportsImages: boolean
}
```

### `HarnessInstallStatus`

Returned by `checkInstallStatus()`.

```typescript
interface HarnessInstallStatus {
    installed: boolean
    version?: string
    authType: "api-key" | "account" | "none"
    authenticated: boolean
    authInstructions?: string
}
```

---

## Harnesses

### ClaudeCodeHarness

```typescript
import { ClaudeCodeHarness } from "@openade/harness"

const harness = new ClaudeCodeHarness({
    binaryPath?: string,          // Override binary location (default: auto-detect)
    disableTelemetry?: boolean,   // Default: true
    forceSubagentModel?: boolean, // Force subagents to use same model (default: true)
    settingSources?: string[],    // Default: ["user", "project", "local"]
})
```

**Raw event type:** `ClaudeEvent` — a 14-variant discriminated union covering all `--output-format stream-json --verbose` line types:

| Event | Description |
|---|---|
| `system` / `init` | Session initialized (model, tools, session_id, slash_commands) |
| `system` / `status` | Status change (e.g. "compacting") |
| `system` / `compact_boundary` | Context compaction occurred |
| `system` / `hook_started` | Hook execution started |
| `system` / `hook_progress` | Hook progress output |
| `system` / `hook_response` | Hook completed (approved/denied) |
| `system` / `task_notification` | Task notification |
| `system` / `files_persisted` | Files saved |
| `assistant` | Model response (text, thinking, tool_use blocks) |
| `user` | Tool results returned |
| `result` | Final result (success, error, cost, duration) |
| `tool_progress` | Streaming tool output |
| `tool_use_summary` | Tool use summary |
| `auth_status` | Authentication status |

### CodexHarness

```typescript
import { CodexHarness } from "@openade/harness"

const harness = new CodexHarness({
    binaryPath?: string,  // Override binary location (default: auto-detect)
    tempDir?: string,     // Temp directory for intermediate files
})
```

**Raw event type:** `CodexEvent` — a 7-variant discriminated union covering all `--json` JSONL line types:

| Event | Description |
|---|---|
| `thread.started` | Session started (thread_id) |
| `turn.started` | New turn began |
| `turn.completed` | Turn finished (with token usage) |
| `turn.failed` | Turn failed (error details) |
| `item.started` | Item started (reasoning, message, or command) |
| `item.completed` | Item finished (with output for commands) |
| `error` | Top-level error |

---

## HarnessRegistry

Manage multiple harnesses by ID.

```typescript
import { HarnessRegistry, ClaudeCodeHarness, CodexHarness } from "@openade/harness"

const registry = new HarnessRegistry()
registry.register(new ClaudeCodeHarness())
registry.register(new CodexHarness())

// Get by ID
const harness = registry.getOrThrow("claude-code")

// List all
const all = registry.getAll()

// Check install status of all harnesses in parallel
const statuses = await registry.checkAllInstallStatus()
for (const [id, status] of statuses) {
    console.log(`${id}: installed=${status.installed} auth=${status.authenticated}`)
}
```

---

## Client Tools

Expose in-process functions as tools the CLI can call, via a local MCP server.

```typescript
const query: HarnessQuery = {
    prompt: "What time is it in Tokyo?",
    cwd: process.cwd(),
    mode: "read-only",
    signal: ac.signal,
    clientTools: [
        {
            name: "get_time",
            description: "Get the current time in a timezone",
            inputSchema: {
                type: "object",
                properties: {
                    timezone: { type: "string", description: "IANA timezone" },
                },
                required: ["timezone"],
            },
            handler: async (args) => {
                const time = new Date().toLocaleString("en-US", { timeZone: args.timezone as string })
                return { content: time }
            },
        },
    ],
}
```

Under the hood, `clientTools` are served via a local HTTP MCP server that the CLI connects to automatically.

---

## MCP Servers

Pass external MCP servers for the CLI to connect to.

```typescript
const query: HarnessQuery = {
    prompt: "Search for recent issues",
    cwd: process.cwd(),
    mode: "read-only",
    signal: ac.signal,
    mcpServers: {
        "github": {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
        },
        "my-api": {
            type: "http",
            url: "https://my-server.example.com/mcp",
            headers: { Authorization: "Bearer sk-..." },
        },
    },
}
```

---

## Utilities

### `resolveExecutable(name)`

Finds a binary on PATH, checking common fallback locations (`/usr/local/bin`, `~/.local/bin`, etc.).

```typescript
import { resolveExecutable } from "@openade/harness"

const claudePath = await resolveExecutable("claude")
// "/usr/local/bin/claude" or undefined
```

### `detectShellEnvironment()`

Captures the real shell PATH by spawning a login shell. Solves the macOS GUI app problem where `process.env.PATH` is incomplete.

```typescript
import { detectShellEnvironment } from "@openade/harness"

const env = await detectShellEnvironment()
// { PATH: "/opt/homebrew/bin:/usr/local/bin:...", HOME: "...", ... }
```

### `startToolServer(tools)`

Starts a local MCP HTTP server exposing tool definitions. Used internally by harnesses but also available for direct use.

```typescript
import { startToolServer } from "@openade/harness"

const handle = await startToolServer(tools, { port: 0, requireAuth: true })
console.log(handle.mcpServer.url)    // "http://127.0.0.1:54321/mcp"
console.log(handle.mcpServer.headers) // { Authorization: "Bearer <token>" }
await handle.stop()
```

---

## Error Handling

```typescript
import { HarnessError, HarnessNotInstalledError, HarnessAuthError } from "@openade/harness"

try {
    for await (const event of harness.query(query)) { ... }
} catch (err) {
    if (err instanceof HarnessNotInstalledError) {
        console.log(err.instructions) // "Install Claude Code: npm install -g @anthropic-ai/claude-code"
    } else if (err instanceof HarnessAuthError) {
        console.log(err.authInstructions) // "Run `claude login` to authenticate"
    } else if (err instanceof HarnessError) {
        console.log(err.code, err.harnessId)
    }
}
```

`HarnessErrorCode` values: `auth_failed`, `not_installed`, `rate_limited`, `context_overflow`, `process_crashed`, `aborted`, `timeout`, `unknown`.
