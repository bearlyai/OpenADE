# Harness Library — projects/harness

Unified TypeScript interface for driving AI coding CLIs (Claude Code, Codex) as child processes.

## Stack

- **Language**: TypeScript (ESM, `"type": "module"`)
- **Typecheck**: `tsgo --noEmit` (`@typescript/native-preview`)
- **Build**: `tsc` (produces `dist/` with declarations + source maps)
- **Test**: vitest v4 (Node environment)
- **Lint/Format**: Biome (4-space indent, semicolons as-needed)
- **Peer dep**: `@modelcontextprotocol/sdk` (for the client tool server)

## Commands

```bash
yarn install          # install deps
yarn typecheck        # tsgo --noEmit
yarn build            # tsc → dist/
yarn test             # unit tests (excludes *.integration.test.ts)
yarn test:watch       # vitest watch mode
yarn test:integration # integration tests (need real CLIs + auth)
yarn test:all         # everything
npx @biomejs/biome format --write src/   # format
npx @biomejs/biome lint --write --diagnostic-level=error src/  # lint
```

## Code Style

- No JSDoc comments — code should be self-documenting
- No trivial getters
- Destructured params for 3+ args
- Remove unused methods after refactors
- Forward-compatible parsers: unknown event types return `null`, never throw
- All CLI output types use discriminated unions on `type` (and `subtype` for Claude system events)

## Architecture

```
src/
├── types.ts                    # All shared types (HarnessQuery, HarnessEvent, ModelEntry, etc.)
├── harness.ts                  # Harness<M> interface — the unified contract
├── structured.ts               # runStructuredQuery() — shared structured output orchestration
├── models.ts                   # Model catalog — pure data, browser-safe (MODEL_REGISTRY, helpers, single source of truth for model version bumps)
├── errors.ts                   # HarnessError, HarnessNotInstalledError, HarnessAuthError
├── registry.ts                 # HarnessRegistry — register/get/getAll harnesses
├── index.ts                    # Public barrel export
├── browser.ts                  # Browser-safe barrel (types only, no Node deps)
├── util/
│   ├── spawn.ts                # spawnJsonl() — spawn child, read JSONL stdout, yield events
│   ├── spawn.test.ts
│   ├── env.ts                  # detectShellEnvironment() — capture real shell PATH
│   ├── env.test.ts
│   ├── which.ts                # resolveExecutable() — find binaries on PATH
│   └── tool-server.ts          # startToolServer() — local HTTP MCP server for client tools
│   └── tool-server.test.ts
├── harnesses/
│   ├── claude-code/
│   │   ├── types.ts            # ClaudeEvent union (14 variants) + parseClaudeEvent()
│   │   ├── types.test.ts
│   │   ├── args.ts             # buildClaudeArgs() — HarnessQuery → CLI flags
│   │   ├── args.test.ts
│   │   ├── mcp-config.ts       # writeMcpConfigJson() — write --mcp-config temp file
│   │   ├── mcp-config.test.ts
│   │   ├── sessions.ts         # Session read/write/delete/list for ~/.claude on-disk format
│   │   ├── sessions.test.ts
│   │   └── index.ts            # ClaudeCodeHarness class
│   └── codex/
│       ├── types.ts            # CodexEvent union (7 variants) + parseCodexEvent()
│       ├── types.test.ts
│       ├── args.ts             # buildCodexArgs() — HarnessQuery → CLI flags
│       ├── args.test.ts
│       ├── config-overrides.ts # buildCodexMcpConfigOverrides() — -c flag generation
│       ├── config-overrides.test.ts
│       ├── pricing.ts          # calculateCostUsd() — token-based cost for Codex models
│       ├── pricing.test.ts
│       ├── sessions.ts         # Session read/write/delete/list for ~/.codex on-disk format
│       ├── sessions.test.ts
│       └── index.ts            # CodexHarness class
```

## Key Concepts

| Concept | Description |
|---|---|
| `Harness<M>` | Interface every harness implements. `M` is the harness-specific event type. Includes `models()` for declaring supported models |
| `HarnessQuery` | Normalized input: prompt, model, mode, MCP servers, client tools, processLabel, signal |
| `structuredQuery()` | High-level harness method for schema-constrained output |
| `HarnessEvent<M>` | Stream envelope: `message`, `session_started`, `complete`, `error`, `stderr` |
| `ClaudeEvent` | Discriminated union of all Claude CLI `--output-format stream-json` line types |
| `CodexEvent` | Discriminated union of all Codex CLI `--json` line types |
| `HarnessRegistry` | Container to register harnesses by ID and check install status in bulk |
| Client tools | `ClientToolDefinition[]` → spun up as a local MCP HTTP server, injected via config |

When vendor model versions change, update `src/models.ts` first. Harness implementations should return the shared model config from that file rather than re-declaring model metadata inline.

## How Query Execution Works

1. Caller builds a `HarnessQuery` and calls `harness.query(q)` (or `harness.structuredQuery(q)` for schema-constrained final output)
2. If `clientTools` are present, a local HTTP MCP server starts (`tool-server.ts`)
3. The MCP server config is merged with any user-provided `mcpServers`
4. Harness-specific arg builder translates `HarnessQuery` → CLI flags
5. `spawnJsonl()` launches the CLI (supports stdin text/lines + optional argv0 label), reads JSONL from stdout line-by-line
6. Each line is parsed by the harness-specific parser (`parseClaudeEvent` / `parseCodexEvent`)
7. Parsed events are wrapped in `HarnessEvent<M>` and yielded to the caller
8. For structured queries, `complete.structuredOutput` is normalized and parsed by `structured.ts`
9. On process exit, cleanup runs (temp files, tool server shutdown)

## Session Management

The `Harness<M>` interface includes methods for reading, writing, and deleting session data from each CLI's on-disk storage. This enables session reload after disconnect, unloading/reloading event data, bidirectional sync, and session continuation.

| Method | Description |
|---|---|
| `listSessions(options?)` | List sessions from disk, sorted newest-first |
| `getSessionEvents(sessionId, options?)` | Read session JSONL → `HarnessEvent<M>[]` (same type as live streaming) |
| `writeSessionEvents(sessionId, events, options)` | Append events to an existing session |
| `deleteSession(sessionId, options?)` | Remove session files from disk |
| `isSessionActive(sessionId)` | Check if a CLI process is currently serving the session |

Check `capabilities().supportsSessionReplay` before using.

### On-disk formats

**Claude Code** (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`):
- Each line is a JSON object with `type` ("assistant" / "user" / "queue-operation"), `uuid`, `parentUuid` forming a linked list
- Active sessions tracked via PID files at `~/.claude/sessions/<pid>.json`
- Write appends chain from the current leaf UUID
- Written entries include `userType: "external"`, `version: "harness"` metadata

**Codex** (`~/.codex/sessions/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl`):
- Line types: `session_meta`, `event_msg` (turn lifecycle, token counts), `response_item` (messages, function calls, reasoning)
- Read does two-pass: pass 1 collects `function_call_output` by `call_id`, pass 2 parses all lines with correlation
- `session_meta` → `thread.started`, `event_msg` turn lifecycle → `turn.started`/`turn.completed`
- Write wraps appended events in `turn_started`/`turn_complete` lifecycle
- No PID-based active detection (always returns false)

### Windows compatibility

- `encodeProjectPath` handles both `/` and `\` separators
- Codex rollout file filtering uses `path.basename()` (cross-platform)
- All path construction uses `path.join`

## Adding a New Harness

1. Create `src/harnesses/<name>/types.ts` — define the event union + parser
2. Create `src/harnesses/<name>/args.ts` — translate `HarnessQuery` → CLI flags
3. Create `src/harnesses/<name>/index.ts` — implement `Harness<M>` interface
4. Add to `src/index.ts` exports
5. Write colocated tests as `<module>.test.ts` siblings

## MCP Config Injection

**Claude Code**: Writes a temp JSON file matching `--mcp-config` schema, passes `--mcp-config <path> --strict-mcp-config`. Supports both stdio and HTTP MCP servers directly.

**Codex**: No config file. Uses `-c mcp_servers.<name>.url=<url>` override flags. Bearer tokens in HTTP headers are extracted to env vars (`__MCP_AUTH_<NAME>`) and injected via `-c mcp_servers.<name>.headers.Authorization=Bearer ${__MCP_AUTH_<NAME>}`.

## Client Tool Server

`startToolServer(tools)` spins up a local `http://127.0.0.1:<port>/mcp` server that speaks MCP protocol (streamable HTTP transport). Each tool's `handler` function is called when the CLI invokes it. Auth is via a random bearer token included in the MCP config headers.

## Testing Notes

- Tests are colocated next to their source files as `<module>.test.ts` siblings
- Unit tests mock no external binaries — they test arg building, event parsing, MCP config generation, registry logic, and the tool server (using the real MCP SDK client)
- Integration tests (`*.integration.test.ts`) require real CLI binaries and auth — excluded from `yarn test`
- The tool server tests are the most interesting — they start a real HTTP server and connect with an MCP client

This document should evolve with the codebase.
