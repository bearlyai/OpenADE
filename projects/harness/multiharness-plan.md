# Multi-Harness Implementation Plan

> **Goal**: Build `projects/harness/` — a standalone TypeScript library that wraps AI coding CLIs (Claude Code, OpenAI Codex) behind a unified `Harness<M>` interface. Both harnesses are pure CLI wrappers (no SDK dependencies). OpenADE will consume this library from its Electron and Web projects.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Setup](#2-project-setup)
3. [Core Types (src/types.ts)](#3-core-types)
4. [Harness Interface (src/harness.ts)](#4-harness-interface)
5. [Shared CLI Utilities (src/util/)](#5-shared-cli-utilities)
6. [Claude Code Harness (src/harnesses/claude-code/)](#6-claude-code-harness)
7. [Codex Harness (src/harnesses/codex/)](#7-codex-harness)
8. [Client Tools — Dynamic MCP Server (src/util/tool-server.ts)](#8-client-tools-dynamic-mcp-server)
9. [Registry (src/registry.ts)](#9-registry)
10. [Errors (src/errors.ts)](#10-errors)
11. [Testing Strategy](#11-testing-strategy)
12. [Integration Into OpenADE](#12-integration-into-openade)
13. [Implementation Order](#13-implementation-order)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────┐
│                HarnessQuery                  │  ← Normalized input (same for both)
└──────────┬───────────────────┬───────────────┘
           │                   │
    ┌──────▼──────────┐  ┌────▼────────────┐
    │ ClaudeCodeHarness│  │  CodexHarness   │   ← Translate query → CLI args
    │ claude -p ...    │  │  codex exec ... │
    │ --stream-json    │  │  --json         │
    └──────┬──────────┘  └────┬────────────┘
           │                   │
    ┌──────▼──────────┐  ┌────▼────────────┐
    │  stdout JSONL   │  │  stdout JSONL   │   ← Parse line → HarnessEvent<M>
    │  (ClaudeEvent)  │  │  (CodexEvent)   │
    └──────┬──────────┘  └────┬────────────┘
           │                   │
    HarnessEvent<ClaudeEvent>  HarnessEvent<CodexEvent>
```

**Key design decisions:**

- **No SDK dependency.** Both harnesses spawn the CLI binary as a child process and parse JSONL from stdout. The `@anthropic-ai/claude-agent-sdk` npm package is not used.
- **No event normalization.** Each harness emits its own native message type (`ClaudeEvent` or `CodexEvent`). The consumer (OpenADE) writes per-harness renderers. No lossy unification layer.
- **Client tools via dynamic MCP server.** Both harnesses use the same mechanism: the lib starts a local HTTP MCP server in-process that exposes client-defined tools. This server is registered per invocation for whichever CLI is being invoked.
- **Per-invocation MCP registration with no persistent writes.** Claude uses `--mcp-config <file>` (temp file). Codex uses repeated `-c mcp_servers.*=...` overrides on the command line. Both approaches avoid mutating user-global config.

---

## 2. Project Setup

### 2.1 Directory Structure

```
projects/harness/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                          # Public API exports
│   ├── types.ts                          # HarnessQuery, HarnessEvent, PromptPart, etc.
│   ├── harness.ts                        # Harness<M> interface
│   ├── registry.ts                       # HarnessRegistry class
│   ├── errors.ts                         # HarnessError hierarchy
│   │
│   ├── harnesses/
│   │   ├── claude-code/
│   │   │   ├── index.ts                  # ClaudeCodeHarness class
│   │   │   ├── types.ts                  # ClaudeEvent union type
│   │   │   ├── args.ts                   # buildClaudeArgs(query) → string[]
│   │   │   └── mcp-config.ts             # writeMcpConfigJson()
│   │   │
│   │   └── codex/
│   │       ├── index.ts                  # CodexHarness class
│   │       ├── types.ts                  # CodexEvent, CodexItem types
│   │       ├── args.ts                   # buildCodexArgs(query) → string[]
│   │       └── config-overrides.ts       # buildCodexMcpConfigOverrides()
│   │
│   └── util/
│       ├── spawn.ts                      # spawnJsonl() — shared process + JSONL streaming
│       ├── env.ts                        # detectShellEnvironment()
│       ├── which.ts                      # resolveExecutable()
│       └── tool-server.ts               # startToolServer() — local HTTP MCP server for client tools
│
└── src/__tests__/
    ├── spawn.test.ts                     # Unit tests for JSONL spawner
    ├── claude-code/
    │   ├── args.test.ts                  # Unit tests for CLI arg building
    │   ├── mcp-config.test.ts            # Unit tests for MCP JSON generation
    │   ├── harness.integration.test.ts   # Integration: real claude CLI calls
    │   └── types.test.ts                 # Verify type parsing against real CLI output
    ├── codex/
    │   ├── args.test.ts                  # Unit tests for CLI arg building
    │   ├── config-overrides.test.ts      # Unit tests for -c override generation
    │   ├── harness.integration.test.ts   # Integration: real codex CLI calls
    │   └── types.test.ts                 # Verify type parsing against real CLI output
    ├── tool-server.test.ts               # Integration: start server, call tools via MCP
    ├── registry.test.ts                  # Unit tests for HarnessRegistry
    └── env.test.ts                       # Integration: shell env detection
```

### 2.2 package.json

```json
{
  "name": "@openade/harness",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --exclude src/**/*.integration.test.ts",
    "test:watch": "vitest --exclude src/**/*.integration.test.ts",
    "test:integration": "vitest run src/**/*.integration.test.ts",
    "test:all": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^4.0.16",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "peerDependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

**Dependencies explained:**
- `@modelcontextprotocol/sdk`: Peer dependency. Used by `tool-server.ts` to create the local in-process HTTP MCP server for client tools. It's a peer dep because the consumer (OpenADE) may also use it and we want a single version.

**No other runtime dependencies.** The lib uses only Node.js builtins (`child_process`, `fs`, `path`, `os`, `readline`, `crypto`) and the above.

### 2.3 tsconfig.json

```json
{
  "compilerOptions": {
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "lib": ["es2022"],
    "target": "ES2022",
    "module": "ESNext",
    "strict": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/__tests__"]
}
```

### 2.4 vitest.config.ts

```typescript
import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    watch: false,
    include: ["src/**/*.test.ts"],
    testTimeout: 60_000,        // Integration tests call real CLIs
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "src/**/*.test.ts", "dist/"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

---

## 3. Core Types

### File: `src/types.ts`

All types shared across harnesses. This is the main public type surface.

```typescript
// ============================================================================
// Identifiers
// ============================================================================

export type HarnessId = string  // "claude-code" | "codex" | future harnesses

// ============================================================================
// Prompt Content
// ============================================================================

export type PromptPart =
  | { type: "text"; text: string }
  | { type: "image"; source: ImageSource }

export type ImageSource =
  | { kind: "path"; path: string; mediaType: string }
  | { kind: "base64"; data: string; mediaType: string }
```

**Implementation note on images:**
- Claude CLI: Images must be base64-encoded content blocks. If `kind: "path"`, the harness reads the file and base64-encodes it. If `kind: "base64"`, passed directly.
- Codex CLI: Images are passed via `-i <path>`. If `kind: "base64"`, the harness writes to a temp file first. If `kind: "path"`, passed directly.

```typescript
// ============================================================================
// MCP Server Config
// ============================================================================

export type McpServerConfig =
  | McpStdioServerConfig
  | McpHttpServerConfig

export interface McpStdioServerConfig {
  type: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpHttpServerConfig {
  type: "http"
  url: string
  headers?: Record<string, string>
}

// ============================================================================
// Client Tool Definitions
// ============================================================================

export type JsonSchema = Record<string, unknown>

export interface ClientToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema       // JSON Schema object
  handler: (args: Record<string, unknown>) => Promise<ClientToolResult>
}

export interface ClientToolResult {
  content?: string
  error?: string
}

// ============================================================================
// HarnessQuery — the normalized input to every harness
// ============================================================================

export interface HarnessQuery {
  // ── Content ──
  prompt: string | PromptPart[]
  systemPrompt?: string               // Replace default system prompt entirely.
                                        // Claude: --system-prompt <text>
                                        // Codex: prepended to prompt in XML wrapper
  appendSystemPrompt?: string          // Append to default system prompt.
                                        // Claude: --append-system-prompt <text>
                                        // Codex: prepended to prompt in XML wrapper

  // ── Context ──
  cwd: string
  additionalDirectories?: string[]     // Claude: --add-dir <dir> per entry.
                                        // Codex: --add-dir <dir> per entry.
  env?: Record<string, string>         // Merged into child process environment.

  // ── Model ──
  model?: string                       // Harness-specific model ID.
                                        // Claude: "opus" | "sonnet" | "haiku" etc.
                                        // Codex: "gpt-5.3-codex" | "o3" | "o4-mini" etc.
                                        // Falls back to harness default if not set.
  thinking?: "low" | "med" | "high"    // Thinking effort / reasoning budget.
                                        // Claude: --effort low|medium|high
                                        //         + maxThinkingTokens: low=3000, med=5000, high=10000
                                        // Codex: -c model_reasoning_effort=low|medium|xhigh

  // ── Session ──
  resumeSessionId?: string             // Resume a previous session.
                                        // Claude: --resume <id>
                                        // Codex: `codex <mode flags> exec resume --json <id>`
  forkSession?: boolean                // Fork from the resume session instead of continuing it.
                                        // Claude: --fork-session (used with --resume)
                                        // Codex: NOT SUPPORTED in --json mode (fork is interactive only)

  // ── Permissions ──
  mode: "read-only" | "yolo"           // REQUIRED. Controls sandbox/permission level.
                                        // "read-only":
                                        //   Claude: --permission-mode plan
                                        //   Codex: codex -a on-request exec --sandbox read-only ...
                                        // "yolo":
                                        //   Claude: --dangerously-skip-permissions
                                        //   Codex: --full-auto
  allowedTools?: string[]              // Claude: --allowed-tools (comma-separated).
                                        // Codex: ignored (no named tools).
  disallowedTools?: string[]           // Claude: --disallowed-tools (comma-separated).
                                        // Codex: ignored (no named tools).

  // ── Integrations ──
  mcpServers?: Record<string, McpServerConfig>
  clientTools?: ClientToolDefinition[]

  // ── Control ──
  signal: AbortSignal                  // REQUIRED. Consumer creates AbortController,
                                        // passes signal. Harness listens and SIGTERMs child.
}

// ============================================================================
// HarnessEvent — the stream output envelope
// ============================================================================

export type HarnessEvent<M> =
  | { type: "message"; message: M }
  | { type: "session_started"; sessionId: string }
  | { type: "complete"; usage?: HarnessUsage }
  | { type: "error"; error: string; code?: HarnessErrorCode }
  | { type: "stderr"; data: string }

export interface HarnessUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: number                     // Claude: from result.total_cost_usd.
                                        // Codex: null (not provided).
  durationMs?: number                  // Claude: from result.duration_ms.
                                        // Codex: computed from wall clock.
}

export type HarnessErrorCode =
  | "auth_failed"
  | "not_installed"
  | "rate_limited"
  | "context_overflow"
  | "process_crashed"
  | "aborted"
  | "timeout"
  | "unknown"

// ============================================================================
// Meta & Capabilities
// ============================================================================

export interface HarnessMeta {
  id: HarnessId
  name: string                         // "Claude Code", "Codex"
  vendor: string                       // "Anthropic", "OpenAI"
  website: string
}

export interface HarnessModel {
  id: string                           // "opus", "gpt-5.3-codex"
  label: string                        // "Opus 4.6", "GPT-5.3 Codex"
  isDefault?: boolean
}

export interface HarnessInstallStatus {
  installed: boolean
  version?: string
  authType: "api-key" | "account" | "none"
  authenticated: boolean
  authInstructions?: string            // "Run `claude login` to authenticate"
}

export interface HarnessCapabilities {
  supportsSystemPrompt: boolean        // Can replace/append system prompt natively.
  supportsAppendSystemPrompt: boolean  // Can append without replacing.
  supportsReadOnly: boolean
  supportsMcp: boolean
  supportsResume: boolean
  supportsFork: boolean                // Claude: yes. Codex: no (interactive only).
  supportsClientTools: boolean         // Via dynamic MCP server.
  supportsStreamingTokens: boolean     // Partial message streaming.
  supportsCostTracking: boolean
  supportsNamedTools: boolean          // Edit, Write, Bash etc (Claude-specific).
  supportsImages: boolean
}

export interface SlashCommand {
  name: string
  type: "skill" | "slash_command"
}
```

---

## 4. Harness Interface

### File: `src/harness.ts`

```typescript
import type {
  HarnessId, HarnessMeta, HarnessModel, HarnessCapabilities,
  HarnessInstallStatus, SlashCommand, HarnessQuery, HarnessEvent,
} from "./types.js"

export interface Harness<M = unknown> {
  readonly id: HarnessId

  // ── Discovery (sync, cheap, no I/O) ──
  meta(): HarnessMeta
  models(): HarnessModel[]
  capabilities(): HarnessCapabilities

  // ── Status (async, may shell out to run `claude --version` / `codex --version`) ──
  checkInstallStatus(): Promise<HarnessInstallStatus>

  // ── Probing (async, may run the CLI briefly) ──
  // Claude: sends a tiny probe prompt with --print --output-format stream-json, reads
  //         system:init, then aborts. (Do not use an empty prompt; CLI rejects it.)
  //         In practice this is near-zero cost because init arrives before model output.
  // Codex: returns [] (no slash command / skill system).
  discoverSlashCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]>

  // ── Execution ──
  // Spawns the CLI, streams JSONL from stdout, yields HarnessEvent<M>.
  //
  // Pre-flight errors (binary not found, bad auth): throws HarnessError.
  // Runtime errors (process crash, timeout): yields { type: "error" }.
  // On abort (signal fires): kills child process, generator returns.
  // Cleanup (temp files, tool server listeners): runs in finally{}.
  query(q: HarnessQuery): AsyncGenerator<HarnessEvent<M>>
}
```

---

## 5. Shared CLI Utilities

### 5.1 `src/util/spawn.ts` — JSONL process streaming

This is the core shared infrastructure both harnesses use.

```typescript
export interface SpawnJsonlOptions<M> {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  signal: AbortSignal

  // Called for each line of stdout. Return event(s) to yield, or null to skip.
  parseLine: (line: string) => HarnessEvent<M> | HarnessEvent<M>[] | null

  // Called when the process exits. Return final event(s) or null.
  onExit?: (code: number | null, stderrAccumulated: string) => HarnessEvent<M> | HarnessEvent<M>[] | null
}

export async function* spawnJsonl<M>(options: SpawnJsonlOptions<M>): AsyncGenerator<HarnessEvent<M>>
```

**Implementation details:**
- Spawns via `child_process.spawn()` with `{ stdio: ["pipe", "pipe", "pipe"] }`.
- Reads stdout line-by-line using `readline.createInterface({ input: proc.stdout })`.
- Each non-empty line is passed to `parseLine()`. The return value(s) are yielded.
- stderr is accumulated into a buffer. Lines are also yielded as `{ type: "stderr" }` events in real-time.
- On `signal` abort: sends `SIGTERM` to the child process. If still alive after 5 seconds, sends `SIGKILL`.
- On process exit: calls `onExit()` with exit code and accumulated stderr. Yields any returned events.
- In `finally {}`: ensures child process is killed, cleans up readline interface.

**Why this is shared and not per-harness:**
Both Claude and Codex follow the exact same pattern: spawn binary, read JSONL from stdout, handle stderr, manage lifecycle. The only difference is `parseLine()` (which is harness-specific). Extracting this avoids duplicating ~100 lines of process management, signal handling, and stream plumbing.

### 5.2 `src/util/env.ts` — Shell environment detection

```typescript
// Captures the user's real shell environment (PATH, etc.)
// This solves the macOS Dock/Electron launch problem where PATH is minimal.
// Spawns the user's login shell, runs `env`, parses output.
export async function detectShellEnvironment(
  shell?: string   // Default: process.env.SHELL or "/bin/zsh"
): Promise<Record<string, string>>
```

**Implementation:** Spawn `$SHELL -lic "env"`, parse `KEY=VALUE` lines. Cache the result for the process lifetime. This is identical to what `subprocess.ts` does in the electron project today — we extract it here so both harnesses benefit.

### 5.3 `src/util/which.ts` — Binary resolution

```typescript
// Finds a binary on PATH. Returns absolute path or undefined.
// Checks common install locations if not on PATH.
export async function resolveExecutable(
  name: string,
  extraPaths?: string[]
): Promise<string | undefined>
```

**Implementation:** Tries `which <name>` via `execFileSync`. Falls back to checking `extraPaths` (e.g., `~/.local/bin`, `/usr/local/bin`). Returns the first found path or `undefined`.

---

## 6. Claude Code Harness

### 6.1 `src/harnesses/claude-code/types.ts` — ClaudeEvent

These types are defined by us (no SDK import). They mirror the `--output-format stream-json --verbose` output of the `claude` CLI exactly.

```typescript
// Top-level discriminated union on `type` (and `subtype` for system events)
export type ClaudeEvent =
  | ClaudeSystemInitEvent
  | ClaudeSystemStatusEvent
  | ClaudeSystemCompactBoundaryEvent
  | ClaudeSystemHookStartedEvent
  | ClaudeSystemHookProgressEvent
  | ClaudeSystemHookResponseEvent
  | ClaudeSystemTaskNotificationEvent
  | ClaudeSystemFilesPersistedEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeResultEvent
  | ClaudeToolProgressEvent
  | ClaudeToolUseSummaryEvent
  | ClaudeAuthStatusEvent

// ── system:init ──
export interface ClaudeSystemInitEvent {
  type: "system"
  subtype: "init"
  model: string
  tools: string[]
  mcp_servers: { name: string; status: string }[]
  session_id: string
  slash_commands: string[]
  skills: string[]
  plugins: { name: string; path: string }[]
}

// ── system:status ──
export interface ClaudeSystemStatusEvent {
  type: "system"
  subtype: "status"
  status: string | null       // "compacting" | null
}

// ── system:compact_boundary ──
export interface ClaudeSystemCompactBoundaryEvent {
  type: "system"
  subtype: "compact_boundary"
  compact_metadata: { trigger: string; pre_tokens: number }
}

// ── system:hook_* ──
export interface ClaudeSystemHookStartedEvent {
  type: "system"
  subtype: "hook_started"
  hook_name: string
  hook_event: string
}

export interface ClaudeSystemHookProgressEvent {
  type: "system"
  subtype: "hook_progress"
  hook_name: string
  content: string
}

export interface ClaudeSystemHookResponseEvent {
  type: "system"
  subtype: "hook_response"
  hook_name: string
  hook_event: string
  outcome: string
}

// ── system:task_notification ──
export interface ClaudeSystemTaskNotificationEvent {
  type: "system"
  subtype: "task_notification"
  [key: string]: unknown
}

// ── system:files_persisted ──
export interface ClaudeSystemFilesPersistedEvent {
  type: "system"
  subtype: "files_persisted"
  [key: string]: unknown
}

// ── assistant ──
export interface ClaudeAssistantEvent {
  type: "assistant"
  message: {
    id: string
    type: "message"
    role: "assistant"
    content: ClaudeContentBlock[]
    model: string
    stop_reason: string | null
    usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  }
  uuid: string
  session_id: string
  parent_tool_use_id: string | null
}

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }

// ── user (tool results) ──
export interface ClaudeUserEvent {
  type: "user"
  message: {
    role: "user"
    content: ClaudeUserContentBlock[]
  }
  parent_tool_use_id?: string
}

export type ClaudeUserContentBlock =
  | { type: "tool_result"; tool_use_id: string; content: string | unknown[]; is_error?: boolean }

// ── result ──
export interface ClaudeResultEvent {
  type: "result"
  subtype: "success" | "error_during_execution" | "error_max_turns" | "error_tool_use"
  is_error: boolean
  result?: string
  duration_ms: number
  duration_api_ms: number
  total_cost_usd: number
  num_turns: number
  session_id: string
  usage: Record<string, unknown>
  structured_output?: unknown
}

// ── tool_progress ──
export interface ClaudeToolProgressEvent {
  type: "tool_progress"
  tool_use_id: string
  [key: string]: unknown
}

// ── tool_use_summary ──
export interface ClaudeToolUseSummaryEvent {
  type: "tool_use_summary"
  [key: string]: unknown
}

// ── auth_status ──
export interface ClaudeAuthStatusEvent {
  type: "auth_status"
  [key: string]: unknown
}
```

**Implementation note:** Some event types have `[key: string]: unknown` escape hatches for fields we haven't fully mapped. This lets the harness forward the raw JSON even if the CLI adds new fields. The types are refined as we encounter and need specific fields.

**Validation approach:** The types file also exports a `parseClaudeEvent(json: unknown): ClaudeEvent` function that validates the `type` (and `subtype` for system events) field and returns a typed event. Unknown event types are logged and skipped (forward-compatible).

### 6.2 `src/harnesses/claude-code/args.ts` — CLI arg builder

```typescript
export interface ClaudeArgBuildResult {
  args: string[]
  env: Record<string, string>
  cwd: string
  // Temp files/dirs that need cleanup after the process exits
  cleanup: Array<{ path: string; type: "file" | "dir" }>
}

export function buildClaudeArgs(
  query: HarnessQuery,
  config: ClaudeCodeHarnessConfig
): ClaudeArgBuildResult
```

**Translation table (implemented by this function):**

| HarnessQuery field | Claude CLI flag |
|---|---|
| `prompt` (string) | `-p "<prompt>"` |
| `prompt` (PromptPart[]) | Text parts joined. Image parts: base64 content piped via stdin, or flag TBD |
| `systemPrompt` | `--system-prompt "<text>"` |
| `appendSystemPrompt` | `--append-system-prompt "<text>"` |
| `cwd` | Set as child process `cwd` |
| `additionalDirectories[i]` | `--add-dir <dir>` per entry |
| `env` | Merged into child process env |
| `model` | `--model <id>` |
| `thinking: "low"` | `--effort low` |
| `thinking: "med"` | `--effort medium` |
| `thinking: "high"` | `--effort high` |
| `resumeSessionId` | `--resume <id>` |
| `forkSession` | `--fork-session` (combined with `--resume`) |
| `mode: "read-only"` | `--permission-mode plan` |
| `mode: "yolo"` | `--dangerously-skip-permissions` |
| `allowedTools` | `--allowed-tools "Tool1,Tool2"` |
| `disallowedTools` | `--disallowed-tools "Tool1,Tool2"` |
| `mcpServers` | Write JSON file → `--mcp-config <path>` + `--strict-mcp-config` |
| `clientTools` | Added to MCP config as `__harness_client_tools` HTTP server |
| `signal` | Not a CLI arg. Handled by `spawnJsonl`. |

**Always-present flags:**
- `--output-format stream-json` — JSONL streaming output
- `--verbose` — include all event types (init, tool results, etc.)
- `--setting-sources user,project,local` — load settings from all levels (configurable)

**Always-present env vars (when `config.disableTelemetry` is true, which is the default):**
- `DISABLE_TELEMETRY=1`
- `DISABLE_ERROR_REPORTING=1`

**Subagent model forcing (when `config.forceSubagentModel` is true, which is the default):**
If `query.model` is set, also set these env vars to force all nested agents to the same model:
- `ANTHROPIC_DEFAULT_OPUS_MODEL=<model>`
- `ANTHROPIC_DEFAULT_SONNET_MODEL=<model>`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL=<model>`
- `CLAUDE_CODE_SUBAGENT_MODEL=<model>`

**Thinking → maxThinkingTokens mapping:**
In addition to `--effort`, also determine the `maxThinkingTokens` value:
- `"low"` → 3000
- `"med"` → 5000
- `"high"` → 10000

This is passed via `--max-thinking-tokens <n>` if the CLI supports it, or via the appropriate env var.

### 6.3 `src/harnesses/claude-code/mcp-config.ts` — MCP config writer

```typescript
// Writes a standard MCP config JSON file compatible with Claude CLI's --mcp-config flag.
export async function writeMcpConfigJson(
  servers: Record<string, McpServerConfig>,
  filePath: string
): Promise<void>
```

**Output format:**
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["my-mcp-server"],
      "env": { "API_KEY": "xxx" }
    },
    "http-server": {
      "type": "http",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer xxx" }
    }
  }
}
```

### 6.4 `src/harnesses/claude-code/index.ts` — ClaudeCodeHarness class

```typescript
export interface ClaudeCodeHarnessConfig {
  // Path to the `claude` binary. Auto-detected via PATH if not set.
  binaryPath?: string

  // Disable telemetry env vars. Default: true.
  disableTelemetry?: boolean

  // Force all subagents to use the selected model. Default: true.
  forceSubagentModel?: boolean

  // Setting sources to load. Default: ["user", "project", "local"].
  settingSources?: string[]
}

export class ClaudeCodeHarness implements Harness<ClaudeEvent> {
  readonly id = "claude-code"

  constructor(config?: ClaudeCodeHarnessConfig)

  meta(): HarnessMeta
  // Returns: { id: "claude-code", name: "Claude Code", vendor: "Anthropic",
  //            website: "https://docs.anthropic.com/en/docs/claude-code" }

  models(): HarnessModel[]
  // Returns:
  // [
  //   { id: "opus",   label: "Opus 4.6",   isDefault: false },
  //   { id: "sonnet", label: "Sonnet 4.5",  isDefault: true },
  //   { id: "haiku",  label: "Haiku 4.5",   isDefault: false },
  // ]
  // NOTE: model IDs are the short form ("opus", "sonnet", "haiku").
  // The CLI resolves them to full model IDs internally.

  capabilities(): HarnessCapabilities
  // Returns:
  // {
  //   supportsSystemPrompt: true,
  //   supportsAppendSystemPrompt: true,
  //   supportsReadOnly: true,
  //   supportsMcp: true,
  //   supportsResume: true,
  //   supportsFork: true,
  //   supportsClientTools: true,
  //   supportsStreamingTokens: false,  // stream-json gives complete messages, not partial tokens
  //   supportsCostTracking: true,
  //   supportsNamedTools: true,
  //   supportsImages: true,
  // }

  async checkInstallStatus(): Promise<HarnessInstallStatus>
  // 1. Resolve binary path (config.binaryPath or `which claude`)
  // 2. Run `claude --version`, parse version string
  // 3. Run `claude --print "__harness_probe__" --output-format stream-json --verbose`
  //    with immediate abort after system:init
  //    - If HOME is not writable in the current environment, run the probe with a temp HOME
  //      so install/auth checks don't fail on filesystem permission issues.
  //    - If stream contains auth failure markers (`error: "authentication_failed"`, or
  //      "Not logged in" result text): authenticated: false
  //    - Otherwise, if init arrives and no auth failure markers are seen: authenticated: true
  // 4. Return { installed: true/false, version, authType: "account", authenticated, authInstructions }

  async discoverSlashCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]>
  // Same zero-cost probe as checkInstallStatus, but extracts slash_commands + skills
  // from the system:init event.

  async *query(q: HarnessQuery): AsyncGenerator<HarnessEvent<ClaudeEvent>>
  // 1. Resolve binary path. Throw HarnessNotInstalledError if not found.
  // 2. Call buildClaudeArgs(q, this.config) to get args, env, cleanup list.
  // 3. If q.clientTools is non-empty:
  //    a. Start local HTTP MCP tool server via startToolServer(q.clientTools)
  //    b. Add handle.mcpServer to the mcpServers map as __harness_client_tools
  //    c. Merge handle.env into child env (if token env vars are used)
  // 4. If q.mcpServers or clientTools:
  //    a. Write MCP config JSON to temp file
  //    b. Add --mcp-config and --strict-mcp-config to args
  // 5. Yield* spawnJsonl({ command, args, cwd, env, signal, parseLine, onExit })
  // 6. In finally{}: clean up temp files/dirs, stop tool server if started.
  //
  // parseLine implementation:
  //   - JSON.parse the line into a ClaudeEvent
  //   - If type is "system" and subtype is "init": yield session_started + message
  //   - If type is "result": yield message + complete (with usage extracted)
  //   - All other types: yield { type: "message", message: claudeEvent }
}
```

---

## 7. Codex Harness

### 7.1 `src/harnesses/codex/types.ts` — CodexEvent

```typescript
export type CodexEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexTurnCompletedEvent
  | CodexTurnFailedEvent
  | CodexItemStartedEvent
  | CodexItemCompletedEvent
  | CodexErrorEvent

export interface CodexThreadStartedEvent {
  type: "thread.started"
  thread_id: string
}

export interface CodexTurnStartedEvent {
  type: "turn.started"
}

export interface CodexTurnCompletedEvent {
  type: "turn.completed"
  usage: CodexUsage
}

export interface CodexTurnFailedEvent {
  type: "turn.failed"
  error: { message?: string; [key: string]: unknown }
}

export interface CodexItemStartedEvent {
  type: "item.started"
  item: CodexItem
}

export interface CodexItemCompletedEvent {
  type: "item.completed"
  item: CodexItem
}

export interface CodexErrorEvent {
  type: "error"
  message: string
}

export interface CodexUsage {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
}

export type CodexItem =
  | CodexReasoningItem
  | CodexAgentMessageItem
  | CodexCommandExecutionItem

export interface CodexReasoningItem {
  id: string
  type: "reasoning"
  text: string
}

export interface CodexAgentMessageItem {
  id: string
  type: "agent_message"
  text: string
}

export interface CodexCommandExecutionItem {
  id: string
  type: "command_execution"
  command: string
  aggregated_output: string
  exit_code: number | null
  status: "in_progress" | "completed"
}
```

**Implementation note:** There may be additional item types and top-level event types we haven't observed yet (e.g., MCP tool calls, file operations, new failure events). The parser should handle unknown shapes gracefully — log a warning and yield them as-is with a `Record<string, unknown>` fallback. Integration tests will help discover the full vocabulary.

Also export `parseCodexEvent(json: unknown): CodexEvent` for validated parsing.

### 7.2 `src/harnesses/codex/args.ts` — CLI arg builder

```typescript
export interface CodexArgBuildResult {
  command: string               // "codex"
  args: string[]
  env: Record<string, string>
  cwd?: string
  // Temp files/dirs that need cleanup (e.g. base64 image temp files)
  cleanup: Array<{ path: string; type: "file" | "dir" }>
}

export function buildCodexArgs(
  query: HarnessQuery,
  config: CodexHarnessConfig
): CodexArgBuildResult
```

**Translation table:**

| HarnessQuery field | Codex CLI flag/env |
|---|---|
| `prompt` (string) | Final positional arg to `exec` |
| `prompt` (PromptPart[]) | Text joined. Images: `-i <path>` per image. Base64 images written to temp files first. |
| `systemPrompt` | Prepended to prompt: `<system-instructions>\n{text}\n</system-instructions>\n\n{original prompt}` |
| `appendSystemPrompt` | Same as `systemPrompt` (Codex has no append mechanism) |
| `cwd` | `-C <dir>` |
| `additionalDirectories[i]` | `--add-dir <dir>` per entry |
| `env` | Merged into child process env |
| `model` | `-m <id>` |
| `thinking: "low"` | `-c model_reasoning_effort=low` |
| `thinking: "med"` | `-c model_reasoning_effort=medium` |
| `thinking: "high"` | `-c model_reasoning_effort=xhigh` |
| `resumeSessionId` (no fork) | Subcommand changes to: `exec resume --json <id> "<prompt>"` |
| `forkSession` | **Not supported.** Log a warning. Capabilities reports `supportsFork: false`. |
| `mode: "read-only"` | Root flags: `-a on-request`; subcommand flag: `--sandbox read-only` |
| `mode: "yolo"` | Root flag: `--full-auto` |
| `allowedTools` | Ignored (Codex has no named tools) |
| `disallowedTools` | Ignored |
| `mcpServers` / `clientTools` | Converted to repeated `-c mcp_servers.*=...` overrides |
| `signal` | Not a CLI arg. Handled by `spawnJsonl`. |

**Always-present flags:**
- `--json` — JSONL output

**Command shape by mode:**
- `mode: "read-only"`: `codex -a on-request exec --json --sandbox read-only ...`
- `mode: "yolo"`: `codex --full-auto exec --json ...`
- `resumeSessionId` uses the same root flags with `exec resume --json ...`

**MCP via `-c` overrides (idempotent / crash-safe):**
When `mcpServers` or `clientTools` is non-empty:
1. Build an effective MCP server map (including `__harness_client_tools` if client tools are enabled)
2. Convert each server field into command-line overrides, e.g.:
   - `-c 'mcp_servers.my_stdio.type="stdio"'`
   - `-c 'mcp_servers.my_stdio.command="npx"'`
   - `-c 'mcp_servers.my_stdio.args=["my-mcp-server"]'`
   - `-c 'mcp_servers.my_http.type="http"'`
   - `-c 'mcp_servers.my_http.url="https://mcp.example.com/sse"'`
3. Append those `-c` args to the Codex command
4. Do not set `CODEX_HOME`, and do not write/copy any `config.toml` files

### 7.3 `src/harnesses/codex/config-overrides.ts` — `-c` override builder

```typescript
export interface CodexConfigOverrideBuildResult {
  // Repeated as: -c <key=value>
  configArgs: string[]
  // Ephemeral env vars for bearer tokens, etc.
  env: Record<string, string>
}

// Builds Codex config overrides for MCP servers without writing config.toml.
export function buildCodexMcpConfigOverrides(
  servers: Record<string, McpServerConfig>
): CodexConfigOverrideBuildResult
```

**Output format (`-c` arguments):**

For stdio servers:
```bash
-c 'mcp_servers.server-name.type="stdio"'
-c 'mcp_servers.server-name.command="npx"'
-c 'mcp_servers.server-name.args=["my-mcp-server"]'
-c 'mcp_servers.server-name.env.API_KEY="xxx"'
```

For HTTP servers:
```bash
-c 'mcp_servers.http-server.type="http"'
-c 'mcp_servers.http-server.url="https://mcp.example.com/sse"'
-c 'mcp_servers.http-server.http_headers.X_Test="1"'
```

**Handling Authorization headers for Codex:**
Codex has a special `bearer_token_env_var` field for bearer tokens. When a header `Authorization: "Bearer <token>"` is detected:
1. Generate an ephemeral env var name: `__HARNESS_MCP_TOKEN_<server_name_uppercased>`
2. Add override: `-c 'mcp_servers.<name>.bearer_token_env_var="__HARNESS_MCP_TOKEN_<name>"'`
3. Add the env var with the token value to the child process environment
4. Do not emit the `Authorization` header override (token stays out of args)

This avoids writing bearer tokens to disk and keeps bearer secrets out of command-line args.

### 7.4 `src/harnesses/codex/index.ts` — CodexHarness class

```typescript
export interface CodexHarnessConfig {
  // Path to the `codex` binary. Auto-detected via PATH if not set.
  binaryPath?: string

  // Directory for temporary artifacts (e.g. base64 image files). Default: os.tmpdir().
  tempDir?: string
}

export class CodexHarness implements Harness<CodexEvent> {
  readonly id = "codex"

  constructor(config?: CodexHarnessConfig)

  meta(): HarnessMeta
  // Returns: { id: "codex", name: "Codex", vendor: "OpenAI",
  //            website: "https://openai.com/index/introducing-codex/" }

  models(): HarnessModel[]
  // Returns:
  // [
  //   { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", isDefault: true },
  //   { id: "o3",            label: "o3",              isDefault: false },
  //   { id: "o4-mini",       label: "o4-mini",         isDefault: false },
  // ]

  capabilities(): HarnessCapabilities
  // Returns:
  // {
  //   supportsSystemPrompt: false,
  //   supportsAppendSystemPrompt: false,
  //   supportsReadOnly: true,
  //   supportsMcp: true,
  //   supportsResume: true,
  //   supportsFork: false,
  //   supportsClientTools: true,
  //   supportsStreamingTokens: false,
  //   supportsCostTracking: false,
  //   supportsNamedTools: false,
  //   supportsImages: true,
  // }

  async checkInstallStatus(): Promise<HarnessInstallStatus>
  // 1. Resolve binary path
  // 2. Run `codex --version`, parse version string
  // 3. Run `codex login status` and parse output/exit code
  // 4. authType: "account" (Codex uses OpenAI account login)
  // 5. authenticated: true when login status reports logged in, otherwise false

  async discoverSlashCommands(_cwd: string): Promise<SlashCommand[]>
  // Returns []. Codex has no slash command system.

  async *query(q: HarnessQuery): AsyncGenerator<HarnessEvent<CodexEvent>>
  // 1. Resolve binary path. Throw HarnessNotInstalledError if not found.
  // 2. Build effective MCP server map from q.mcpServers.
  // 3. If q.clientTools is non-empty:
  //    a. Start local HTTP MCP tool server via startToolServer(q.clientTools)
  //    b. Add handle.mcpServer to the MCP map as __harness_client_tools
  //    c. Merge handle.env into child env (if token env vars are used)
  // 4. Call buildCodexArgs({ ...q, mcpServers: effectiveMcpServers }, this.config)
  //    to get command, args, env, cleanup list (includes generated `-c mcp_servers.*=...` overrides).
  // 5. Track wall-clock start time (for durationMs computation)
  // 6. Yield* spawnJsonl({ command, args, cwd, env, signal, parseLine, onExit })
  // 7. In finally{}: clean up temp files and stop tool server if started.
  //
  // parseLine implementation:
  //   - JSON.parse the line into a CodexEvent
  //   - If type is "thread.started": yield session_started + message
  //   - If type is "turn.completed": stash usage for final complete event, yield message
  //   - If type is "turn.failed" or "error": yield message and map to HarnessEvent.error
  //   - All other types: yield { type: "message", message: codexEvent }
  //
  // onExit implementation:
  //   - Exit code 0: yield { type: "complete", usage: { from stashed turn.completed, durationMs from wall clock } }
  //   - Exit code non-0: yield { type: "error", error: stderr, code: "process_crashed" }
}
```

---

## 8. Client Tools — Dynamic MCP Server

### File: `src/util/tool-server.ts`

Both harnesses use the same mechanism to expose client-defined tools to the CLI.

```typescript
export interface ToolServerHandle {
  // Name used when injecting into mcpServers map
  serverName: string          // "__harness_client_tools"

  // MCP server registration info (for adding to MCP config)
  mcpServer: McpHttpServerConfig

  // Optional env vars that callers should merge into child env
  env?: Record<string, string>

  // Lifecycle
  stop(): Promise<void>       // Stops HTTP listener and MCP transport
}

// Starts a local in-process HTTP MCP server that exposes the given tools.
// The server speaks MCP over streamable HTTP and dispatches tool calls
// directly to the provided handlers.
//
// Returns a handle with the server config needed to register the server
// in the target CLI (Claude `--mcp-config` or Codex `-c mcp_servers.*`),
// and a stop() function for cleanup.
export async function startToolServer(
  tools: ClientToolDefinition[],
  options?: {
    host?: string             // Default: 127.0.0.1
    port?: number             // Default: 0 (ephemeral)
    requireAuth?: boolean     // Default: true (Bearer token required)
  }
): Promise<ToolServerHandle>
```

**Implementation:**

1. **Create MCP server in-process** using `@modelcontextprotocol/sdk` `Server`.
2. **Register each tool** with name, description, and input schema.
3. **Bind streamable HTTP transport** on `127.0.0.1` with an ephemeral port.
4. **(Default) require bearer auth** with a random per-invocation token.
   - Expose server config as `{ type: "http", url, headers: { Authorization: "Bearer ..." } }`.
   - For Codex, the config writer already translates this header to `bearer_token_env_var` to avoid writing secrets to disk.
5. **Return handle** containing `mcpServer` and `stop()`.

**Why HTTP (not stdio) for client tools:**
The tool handlers are JavaScript functions that live in the harness process. An HTTP server lets the CLI call those handlers directly without serializing executable code into a child script.

**Key concern: handler execution context.**
The `handler` functions in `ClientToolDefinition` run in the same Node.js process as the harness library. If the consumer (OpenADE) needs handlers to run in a different process (e.g., the Electron renderer), the consumer wraps the handler with IPC bridging before passing it to `clientTools`. This is the consumer's responsibility, not the lib's.

---

## 9. Registry

### File: `src/registry.ts`

```typescript
export class HarnessRegistry {
  private harnesses = new Map<HarnessId, Harness>()

  register(harness: Harness): void
  // Stores by harness.id. Throws if duplicate.

  get(id: HarnessId): Harness | undefined

  getOrThrow(id: HarnessId): Harness
  // Throws HarnessError if not found.

  getAll(): Harness[]

  has(id: HarnessId): boolean

  async checkAllInstallStatus(): Promise<Map<HarnessId, HarnessInstallStatus>>
  // Calls checkInstallStatus() on all registered harnesses in parallel.
}
```

---

## 10. Errors

### File: `src/errors.ts`

```typescript
export class HarnessError extends Error {
  constructor(
    message: string,
    public code: HarnessErrorCode,
    public harnessId: HarnessId,
    public cause?: Error
  ) {
    super(message)
    this.name = "HarnessError"
  }
}

export class HarnessNotInstalledError extends HarnessError {
  instructions?: string
  constructor(harnessId: HarnessId, instructions?: string) {
    super(
      `${harnessId} CLI is not installed${instructions ? `. ${instructions}` : ""}`,
      "not_installed",
      harnessId
    )
    this.instructions = instructions
  }
}

export class HarnessAuthError extends HarnessError {
  authInstructions: string
  constructor(harnessId: HarnessId, authInstructions: string) {
    super(
      `${harnessId} is not authenticated. ${authInstructions}`,
      "auth_failed",
      harnessId
    )
    this.authInstructions = authInstructions
  }
}
```

---

## 11. Testing Strategy

### Philosophy

- **Integration tests are the priority.** This library wraps real CLI binaries. If the tests don't call the real CLIs, they're testing our imagination of how the CLIs work, not reality.
- **No bullshit mocking.** Don't mock `child_process.spawn`. Don't mock file I/O. Don't mock the CLI output format. The only things worth mocking are `ClientToolDefinition.handler` functions (because those are consumer-provided callbacks) and network-dependent MCP servers (because we can't control external services in tests).
- **Use vitest.** Match the existing project conventions. `vitest run` for CI, `vitest` for watch mode.
- **Split defaults for reliability.** `pnpm test` runs fast unit tests by default; integration tests run with `pnpm test:integration` (or `pnpm test:all`) when CLIs/auth are available.
- **Test timeout: 60s.** Real CLI invocations take a few seconds. Set `testTimeout: 60_000` globally.

### Test Files and What They Cover

#### `src/__tests__/spawn.test.ts` — JSONL spawner (unit + integration)

**Unit tests:**
- Spawns a simple script that emits JSONL lines, verifies they're parsed and yielded correctly.
- Tests stderr capture.
- Tests abort signal: start a long-running process, abort it, verify the generator returns.
- Tests process crash (non-zero exit): verify error event is yielded.
- Tests malformed JSON lines: verify they're skipped (not thrown).
- Tests empty stdout: verify generator yields nothing and completes.

**How to test without mocking:** Write tiny inline Node.js scripts that emit known JSONL to stdout: `spawn("node", ["-e", "console.log(JSON.stringify({type:'test',data:1}))"])`.

#### `src/__tests__/claude-code/args.test.ts` — Claude arg building (unit)

**Tests:**
- Default args include `--output-format stream-json`, `--verbose`.
- `mode: "yolo"` produces `--dangerously-skip-permissions`.
- `mode: "read-only"` produces `--permission-mode plan`.
- `model: "opus"` produces `--model opus`.
- `thinking: "low"` → `--effort low`. `"med"` → `--effort medium`. `"high"` → `--effort high`.
- `resumeSessionId` produces `--resume <id>`.
- `forkSession: true` adds `--fork-session`.
- `allowedTools: ["Read", "Bash"]` → `--allowed-tools "Read,Bash"`.
- `additionalDirectories: ["/a", "/b"]` → `--add-dir /a --add-dir /b`.
- `appendSystemPrompt: "..."` → `--append-system-prompt "..."`.
- `disableTelemetry: true` (default) sets `DISABLE_TELEMETRY=1` in env.
- `forceSubagentModel: true` with `model: "opus"` sets all `ANTHROPIC_DEFAULT_*_MODEL` env vars.
- MCP servers cause a temp file to be created with the right JSON content and `--mcp-config` + `--strict-mcp-config` flags to be added.

#### `src/__tests__/claude-code/mcp-config.test.ts` — MCP JSON generation (unit)

**Tests:**
- Stdio server produces correct JSON structure.
- HTTP server with headers produces correct JSON structure.
- Multiple servers produce correct combined JSON.
- Output is valid JSON (parse it back, compare).

#### `src/__tests__/claude-code/types.test.ts` — Type parsing (unit)

**Tests:**
- `parseClaudeEvent()` correctly parses each known event type from raw JSON.
- Unknown event types return a fallback/are skipped gracefully.
- Real captured CLI output (stored as fixtures) parses without errors.

#### `src/__tests__/claude-code/harness.integration.test.ts` — Real CLI calls

**Prerequisites:** `claude` CLI must be installed and authenticated. Tests are skipped if not installed (check `which claude` in `beforeAll`).

**Tests:**
- **Simple query:** Run a trivial prompt ("Say hello"), verify the stream yields at least: `session_started`, one `message` with `type: "assistant"`, and `complete` with usage.
- **System init extraction:** Verify `system:init` event is emitted with model name and tools list.
- **Read-only mode:** Run with `mode: "read-only"`, verify no Edit/Write tool calls in the response.
- **Resume:** Run a query, capture session ID, run another query with `resumeSessionId`, verify `session_id` matches.
- **Abort:** Start a query, immediately abort, verify the generator returns without error and the process is killed.
- **Cost tracking:** Verify `complete` event has `costUsd` > 0 and `durationMs` > 0.
- **MCP server (stdio):** Register a trivial stdio MCP server (e.g., one that returns a fixed string), run a query that references it, verify the tool is available in the `system:init` tools list.
- **Client tools (HTTP MCP):** Pass a `clientTools` echo tool, run a query that invokes it, verify tool use/result events flow through.
- **Slash commands:** Call `discoverSlashCommands()`, verify it returns a non-empty array.
- **Install status:** Call `checkInstallStatus()`, verify `installed: true`, `authenticated: true`.

#### `src/__tests__/codex/args.test.ts` — Codex arg building (unit)

**Tests:**
- `mode: "yolo"` includes `--full-auto` and `--json`.
- `mode: "read-only"` produces root flags `-a on-request` and subcommand flag `--sandbox read-only`.
- `model: "o3"` produces `-m o3`.
- `thinking: "high"` → `-c model_reasoning_effort=xhigh`.
- `resumeSessionId: "abc"` changes subcommand to `exec resume --json abc` while preserving root mode flags.
- `forkSession: true` logs a warning (not supported).
- `cwd: "/home/user"` → `-C /home/user`.
- `additionalDirectories` → `--add-dir` per entry.
- MCP servers produce repeated `-c mcp_servers.*=...` overrides (no `CODEX_HOME`).
- `allowedTools` and `disallowedTools` are ignored (no args produced).
- System prompt is prepended to the prompt text.

#### `src/__tests__/codex/config-overrides.test.ts` — MCP `-c` override generation (unit)

**Tests:**
- Stdio server produces expected `-c mcp_servers.*=...` entries.
- HTTP server with headers produces expected `-c ...http_headers.*=...` entries.
- Bearer token header is translated to `bearer_token_env_var` + ephemeral env var.
- Authorization token is not present in emitted `-c` args.
- No `CODEX_HOME` env mutation is required.

#### `src/__tests__/codex/types.test.ts` — Type parsing (unit)

**Tests:**
- `parseCodexEvent()` handles all known event types.
- `parseCodexEvent()` correctly parses top-level failure events (`error`, `turn.failed`).
- Real captured CLI output fixtures parse correctly.
- Unknown item types are handled gracefully.

#### `src/__tests__/codex/harness.integration.test.ts` — Real CLI calls

**Prerequisites:** `codex` CLI must be installed and authenticated. Tests are skipped if not.

**Tests:**
- **Simple query:** Run a trivial prompt, verify `session_started`, `message` with `agent_message`, and `complete`.
- **Command execution:** Run a prompt that triggers a shell command (e.g., "list the files in the current directory"), verify `item.started(command_execution)` and `item.completed(command_execution)` appear.
- **Reasoning:** Verify `reasoning` items appear in the stream.
- **Read-only mode:** Run with `mode: "read-only"`, verify sandbox read-only behavior.
- **Resume:** Run a query, capture thread_id, resume with that ID, verify same thread_id.
- **Abort:** Start a query, immediately abort, verify cleanup (temp files + tool server listener).
- **Usage tracking:** Verify `turn.completed` has token counts.
- **MCP server (stdio):** Register a trivial stdio MCP server, verify the tool is accessible via `-c` overrides.
- **Failure events:** Force a failing run and verify `error` and `turn.failed` events are parsed and surfaced.
- **Install status:** Call `checkInstallStatus()`, verify results.

#### `src/__tests__/tool-server.test.ts` — Dynamic HTTP MCP server (integration)

**Tests:**
- Start a tool server with a simple tool (`{ name: "echo", handler: async (args) => ({ content: args.text }) }`).
- Verify the handle includes an HTTP MCP config (`type: "http"`, `url`, optional auth headers).
- Use `@modelcontextprotocol/sdk` Client + HTTP transport to connect and call the tool. Verify the result.
- Test with multiple tools.
- Test error handling: handler throws → tool returns error.
- Test stop(): verify the HTTP listener is closed.

#### `src/__tests__/registry.test.ts` — Registry (unit)

**Tests:**
- Register and retrieve harnesses.
- `getOrThrow()` throws for unknown ID.
- `has()` returns correct boolean.
- `getAll()` returns all registered harnesses.
- Duplicate registration throws.
- `checkAllInstallStatus()` calls all harnesses in parallel.

#### `src/__tests__/env.test.ts` — Environment detection (integration)

**Tests:**
- `detectShellEnvironment()` returns an object with `PATH` key.
- The returned PATH contains more entries than the minimal Electron PATH.
- `HOME` is set correctly.
- Handles invalid shell gracefully (returns empty or throws).

### Test Fixtures

Create `src/__tests__/fixtures/` with:
- `claude-simple-response.jsonl` — Captured output from `claude --print "Say hello" --output-format stream-json --verbose`
- `claude-with-tools.jsonl` — Captured output from a query that uses tools (Bash, Edit, etc.)
- `codex-simple-response.jsonl` — Captured output from `codex exec --json --full-auto "Say hello"`
- `codex-with-commands.jsonl` — Captured output from a query that runs shell commands

These fixtures are used by `types.test.ts` to verify parsing against real CLI output. They serve as regression tests — if the CLI changes its output format, the fixtures and types need updating.

**How to capture fixtures:**
```bash
claude --print "Say hello" --output-format stream-json --verbose 2>/dev/null > fixtures/claude-simple-response.jsonl
codex exec --json --full-auto -m o4-mini "Say hello" 2>/dev/null > fixtures/codex-simple-response.jsonl
```

### Test Configuration

In vitest.config.ts, use `testTimeout: 60_000` for all tests (CLI calls can take time). For unit-only tests, the timeout is generous but harmless.

Integration tests should check for CLI availability in `beforeAll`:
```typescript
import { resolveExecutable } from "../../util/which.js"

let claudePath: string | undefined
beforeAll(async () => {
  claudePath = await resolveExecutable("claude")
  if (!claudePath) {
    console.warn("claude CLI not found, skipping integration tests")
  }
})

// In each test:
it("runs a simple query", async () => {
  if (!claudePath) return // skip
  // ...
})
```

Or use vitest's `describe.skipIf`:
```typescript
const hasClaude = !!(await resolveExecutable("claude"))
describe.skipIf(!hasClaude)("ClaudeCodeHarness integration", () => { ... })
```

---

## 12. Integration Into OpenADE

This section describes how OpenADE will consume `@openade/harness`. This is NOT part of the harness library itself — it's context for future work.

### 12.1 Electron Main Process Changes

**Current state:** `projects/electron/src/modules/code/claude.ts` imports `query` from `@anthropic-ai/claude-agent-sdk` and calls it directly.

**New state:** Import `ClaudeCodeHarness` and `CodexHarness` from `@openade/harness`. The IPC handler (`claude:query` → renamed to `harness:query`) reads the harness ID from the request, gets the harness from a registry, and calls `harness.query()`.

**Key changes:**
- `claude.ts` → `execution.ts` (harness-agnostic dispatcher)
- Remove `@anthropic-ai/claude-agent-sdk` from dependencies
- Remove `asarUnpack` for the SDK in `package.json`
- Remove `getCliJsPath()`, `jsonSchemaToZodShape()`, and all SDK-specific code
- Remove managed bun binary (no longer needed — we spawn `claude` CLI directly, not `bun cli.js`)
- Client tool proxying is now handled by the harness lib's tool server, not by custom IPC plumbing

**IPC event type changes:**
- `ClaudeStreamEvent` → `HarnessStreamEvent` (or keep the name for backward compat)
- `ClaudeExecutionEvent.type: "sdk_message"` → the message payload is now `ClaudeEvent` (our own type) or `CodexEvent`, not `SDKMessage`
- The `tool_call` / `tool_response` IPC events for client tools are no longer needed — tool calls are handled internally by the harness lib's MCP tool server

### 12.2 Web Project Changes

**Execution type (`types.ts`):**
```typescript
// Current:
type Execution = ClaudeCodeExecution

// New:
type Execution = ClaudeCodeExecution | CodexExecution

interface CodexExecution {
  type: "codex"
  executionId: string
  sessionId?: string           // thread_id from Codex
  parentSessionId?: string
  modelId?: string
  events: HarnessStreamEvent<CodexEvent>[]  // or a neutral envelope type
  gitRefsBefore?: GitRefs
  gitRefsAfter?: GitRefs
}
```

**Renderer dispatch:**
```typescript
// In the component that renders execution events:
function ExecutionRenderer({ execution }: { execution: Execution }) {
  switch (execution.type) {
    case "claude-code":
      return <ClaudeEventRenderer events={execution.events} />
    case "codex":
      return <CodexEventRenderer events={execution.events} />
  }
}
```

**Claude renderer:** Reuses existing `messageGroups.ts` grouping and all 10 renderers (TextGroup, ThinkingGroup, BashGroup, EditGroup, WriteGroup, ToolGroup, TodoWriteGroup, SystemGroup, ResultGroup, StderrGroup). The ClaudeEvent types are structurally identical to SDKMessage — just different import paths. May need light adaptation.

**Codex renderer:** New, much simpler. Groups CodexEvents into:
- `TextGroup` ← `item.completed(agent_message)`
- `ThinkingGroup` ← `item.completed(reasoning)`
- `CommandGroup` ← `item.started/completed(command_execution)`
- `ResultGroup` ← `turn.completed` (usage only, no cost)
- `StderrGroup` ← stderr events

Shares low-level UI components with Claude renderer: `FileViewer` (markdown), terminal output display, etc.

### 12.3 Settings & UI

- **Backend selector:** Add a harness picker to task creation (dropdown: "Claude Code" / "Codex")
- **Model selector:** Populated from `harness.models()`, filtered by selected harness
- **MCP server config:** Unchanged — MCP config is harness-agnostic (both support stdio + HTTP)
- **Capabilities-driven UI:** Hide features the selected harness doesn't support (e.g., hide fork button for Codex, hide cost display for Codex)

---

## 13. Implementation Order

### Step 1: Scaffold and core types
- Create `projects/harness/` with package.json, tsconfig.json, vitest.config.ts
- Implement `src/types.ts` (all shared types)
- Implement `src/harness.ts` (interface)
- Implement `src/errors.ts`
- Implement `src/registry.ts`
- Write `src/__tests__/registry.test.ts`

### Step 2: Shared utilities
- Implement `src/util/spawn.ts` (spawnJsonl)
- Implement `src/util/env.ts` (detectShellEnvironment)
- Implement `src/util/which.ts` (resolveExecutable)
- Write `src/__tests__/spawn.test.ts`
- Write `src/__tests__/env.test.ts`

### Step 3: Client tool server
- Implement `src/util/tool-server.ts` (local in-process HTTP MCP server)
- Write `src/__tests__/tool-server.test.ts` (integration — start server and call tools)
- Verify generated MCP server config is consumable by both harnesses

### Step 4: Claude Code harness
- Implement `src/harnesses/claude-code/types.ts` (ClaudeEvent types + parser)
- Implement `src/harnesses/claude-code/mcp-config.ts`
- Implement `src/harnesses/claude-code/args.ts`
- Implement `src/harnesses/claude-code/index.ts` (ClaudeCodeHarness class)
- Write all Claude tests:
  - `args.test.ts` (unit)
  - `mcp-config.test.ts` (unit)
  - `types.test.ts` (unit with fixtures)
  - `harness.integration.test.ts` (real CLI)
- Capture test fixtures from real CLI output

### Step 5: Codex harness
- Implement `src/harnesses/codex/types.ts` (CodexEvent types + parser)
- Implement `src/harnesses/codex/config-overrides.ts`
- Implement `src/harnesses/codex/args.ts`
- Implement `src/harnesses/codex/index.ts` (CodexHarness class)
- Write all Codex tests:
  - `args.test.ts` (unit)
  - `config-overrides.test.ts` (unit)
  - `types.test.ts` (unit with fixtures)
  - `harness.integration.test.ts` (real CLI)
- Capture test fixtures from real CLI output

### Step 6: Public API and packaging
- Implement `src/index.ts` (re-export everything)
- Verify TypeScript declarations are correct
- Run full test suite
- Add the package to the monorepo workspace

### Step 7: OpenADE integration (separate from lib)
- Replace SDK imports in electron project
- Add harness registry initialization
- Update IPC handlers
- Build Codex renderer components
- Update execution types
- Add backend selection UI

---

## Appendix A: CLI Reference Quick-Sheet

### Claude Code CLI

```
claude --print "<prompt>"
  --output-format stream-json    # JSONL output (one JSON per line)
  --verbose                      # Include all event types
  --model <id>                   # opus | sonnet | haiku
  --effort <level>               # low | medium | high
  --system-prompt "<text>"       # Replace system prompt
  --append-system-prompt "<text>"# Append to system prompt
  --permission-mode plan         # Read-only
  --dangerously-skip-permissions # Full access
  --allowed-tools "A,B,C"       # Tool allow list
  --disallowed-tools "X,Y"      # Tool deny list
  --mcp-config <path>           # MCP server config JSON
  --strict-mcp-config           # Only use provided MCP servers
  --add-dir <dir>               # Additional directory
  --resume <session-id>         # Resume session
  --fork-session                # Fork instead of continue
  --setting-sources user,project,local
  --max-budget-usd <n>          # Cost limit
  --json-schema <path>          # Structured output
```

### Codex CLI

```
codex -a on-request exec --json --sandbox read-only "<prompt>"
  # Read-only mode used by HarnessQuery.mode = "read-only"

codex --full-auto exec --json "<prompt>"
  # "yolo" mode used by HarnessQuery.mode = "yolo"

codex ... exec ...
  -m <model>                     # gpt-5.3-codex | o3 | o4-mini
  -C <dir>                       # Working directory
  --add-dir <dir>                # Additional directory
  -i <image-path>                # Attach image
  -c <key=value>                 # Config override
  --ephemeral                    # Don't persist session
  --search                       # Enable web search

codex -a on-request exec resume --json <session-id> "<prompt>"   # Resume session (read-only)
codex fork <session-id>                             # Fork (interactive only, no --json)
codex mcp add/remove/list/login/logout              # MCP management
codex --version                                     # Version check

# Env vars:
# CODEX_HOME=/path/to/dir  — Override config directory (contains config.toml)
# (Harness intentionally does not set this; it uses per-invocation `-c` overrides.)
```

## Appendix B: Known Limitations

| Limitation | Harness | Workaround |
|---|---|---|
| No token streaming | Codex | Responses appear all-at-once per item. No partial token UX. |
| No cost tracking | Codex | `turn.completed` has token counts but no cost. Could embed pricing table. |
| No fork in JSON mode | Codex | `codex fork` is interactive only. Use resume instead. |
| No system prompt | Codex | Prepended to user prompt in XML wrapper. Not a true system prompt. |
| No named tools | Codex | All tool use is `command_execution`. No diff views for file edits. |
| No slash commands | Codex | `discoverSlashCommands()` returns `[]`. |
| Allowed/disallowed tools | Codex | Ignored. Codex has no fine-grained tool control. |
| MCP HTTP bearer tokens | Codex | Translated to `bearer_token_env_var` + ephemeral env var (not written to disk). |
| Large system prompts | Codex | Prepending 50+ line instructions to prompt consumes context. Less effective than native system prompt. |
