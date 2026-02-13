# Integration Test Plan

> **Scope**: End-to-end tests against real `claude` and `codex` CLIs.
> Assumes both binaries are installed and authenticated on the test machine.
> Excluded from `yarn test`; run via `yarn test:integration` or `yarn test:all`.

---

## Conventions

- Each test file uses a `beforeAll` that calls both `resolveExecutable()` and `harness.checkInstallStatus()`. The entire suite is skipped (`describe.skip` or vitest `ctx.skip()`) if the binary is missing **or** `authenticated` is `false`. This prevents misleading failures on machines where the CLI is installed but not logged in.
- Timeouts are tiered per-test complexity, not global:
  - **Trivial** (deterministic prompt, no tools): `AbortSignal.timeout(30_000)`
  - **Standard** (tool use, MCP, session resume): `AbortSignal.timeout(60_000)`
  - **Heavy** (thinking:"high", abort/cancellation, multi-step): `AbortSignal.timeout(120_000)`
  - Vitest's own test-level timeout is set to match: `{ timeout: 30_000 | 60_000 | 120_000 }`.
- Prompts are trivial and deterministic where possible (e.g. "Reply with exactly: hello") to keep cost and latency low.
- Every test collects all events into an array for assertions rather than asserting mid-stream, unless testing abort behavior.
- Temp directories created per-test are cleaned up in `afterEach`.
- Assertions about model output avoid natural-language interpretation. When testing system prompts, use highly constrained prompts like "Reply with exactly the word PINEAPPLE" rather than "respond like a pirate". See §6 and §9 for details.

---

## Execution strategy

- **Sequential execution is required.** Running ~38 real-CLI tests in parallel risks rate limits, interleaved stdout, and OOM from multiple model processes. Configure vitest for integration tests with:
  ```ts
  // vitest.integration.config.ts
  export default defineConfig({
      test: {
          include: ["src/**/*.integration.test.ts"],
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 120_000,
          hookTimeout: 30_000,
          sequence: { concurrent: false },
      },
  })
  ```
- Within each file, tests run serially (`describe.sequential` or default non-concurrent mode). Tests that depend on a previous result (e.g. resume needing a sessionId from a prior query) are grouped in a nested `describe` block to make the dependency explicit.
- **CI considerations**: these tests are expensive and slow (~5–10 minutes total). They should run on a dedicated schedule or manual trigger, not on every PR.

---

## File: `src/__tests__/claude-code/harness.integration.test.ts`

### 1. Install status and discovery

**1a. `checkInstallStatus` reports installed and authenticated**
- Call `harness.checkInstallStatus()`.
- Assert `installed: true`, `version` is a non-empty string, `authType` is `"account"`, `authenticated: true`.
- (This is also called in `beforeAll` to gate the suite — see Conventions.)

**1b. `discoverSlashCommands` returns commands and skills**
- Call `harness.discoverSlashCommands(cwd)` with a real directory.
- Assert result is a non-empty array.
- Assert each entry has `name` (non-empty string) and `type` (`"skill"` or `"slash_command"`).

### 2. Basic query lifecycle

**2a. Simple prompt yields session_started, at least one assistant message, and complete**
- Query: `{ prompt: "Reply with exactly: hello", cwd: tmpDir, mode: "yolo", signal }`.
- Timeout tier: trivial.
- Collect all events.
- Assert at least one `session_started` event with a non-empty `sessionId`.
- Assert at least one `message` event where `message.type === "assistant"`.
- Assert exactly one `complete` event, and it appears last (or after all message events).

**2b. Complete event includes usage with token counts and cost**
- From the same (or similar) query, inspect the `complete` event's `usage`.
- Assert `inputTokens > 0`, `outputTokens > 0`.
- Assert `costUsd` is a number > 0.
- Assert `durationMs` is a number > 0.

**2c. System init event is emitted as a message**
- Collect all `message` events from a simple query.
- Assert at least one has `message.type === "system"` and `message.subtype === "init"`.
- Assert it contains `model` (string), `tools` (array), `session_id` (string).

### 3. Modes and permissions

**3a. Read-only mode completes successfully**
- Query: `{ prompt: "What is 2 + 2?", cwd: tmpDir, mode: "read-only", signal }`.
- Timeout tier: trivial.
- Collect all events. Assert the query completes with a `complete` event and no `error` events.
- *(Rationale: the harness's responsibility is translating `mode: "read-only"` to `--permission-mode plan`. Enforcement of what "plan" mode allows is the CLI's concern, not ours. The unit tests already verify the flag mapping.)*

**3b. Yolo mode allows tool execution**
- Create a temp directory.
- Query: `{ prompt: "Create a file called test.txt containing 'hello' in the current directory. Do nothing else.", cwd: tmpDir, mode: "yolo", signal }`.
- Timeout tier: standard.
- After completion, assert the file `test.txt` exists in `tmpDir`.

### 4. Session management

**4a. Session ID is stable across the query**
- Run a simple query, extract `sessionId` from `session_started`.
- Assert it matches the `session_id` field in the `result` event.

**4b. Resume continues an existing session**
- Run query A, capture `sessionId`.
- Run query B with `resumeSessionId: sessionId`, a new prompt ("Reply with exactly: resumed").
- Timeout tier: standard (each query).
- Assert query B yields a `session_started` with the same `sessionId`.
- Assert query B completes successfully.
- (Group with 4a in a `describe("session management")` block since 4b depends on the sessionId from 4a.)

### 5. Model selection

**5a. Explicit model is reflected in init event**
- Query with `model: "haiku"`.
- Timeout tier: trivial.
- Find the `system:init` message event.
- Assert `message.model` contains `"haiku"` (the CLI resolves short names to full model IDs, so check with `includes`).

### 6. System prompt

**6a. System prompt override**
- Query with `systemPrompt: "You must reply with exactly the word PINEAPPLE and nothing else."`, prompt `"Say hello"`.
- Timeout tier: trivial.
- Collect assistant text. Assert it includes "PINEAPPLE" (case-insensitive).

**6b. Append system prompt**
- Query with `appendSystemPrompt: "After your response, always append the exact string __SENTINEL_END__"`, prompt `"Say hello"`.
- Timeout tier: trivial.
- Collect assistant text. Assert it includes `"__SENTINEL_END__"`.

### 7. Abort and cancellation

**7a. Aborting mid-stream stops the process**
- Create an `AbortController`.
- Start a query with a prompt that would generate a long response (e.g. "Write a 2000 word essay about the history of computing").
- Timeout tier: heavy (120s for the test itself, abort happens much earlier).
- After receiving the first `message` event, call `controller.abort()`.
- Assert the generator finishes (doesn't hang) within 10s of the abort call.
- Assert no `complete` event is emitted (the process was killed before finishing).

### 8. Stderr forwarding

**8a. Stderr lines are yielded as stderr events**
- Run any simple query.
- Collect events of type `stderr`.
- Assert they exist (Claude CLI typically emits progress/status to stderr) and each has a non-empty `data` string.
- (If Claude emits nothing to stderr in a trivial query, this test just asserts the array is defined — no failure.)

### 9. MCP server injection (stdio)

**9a. External stdio MCP server is available to the CLI**
- Write a tiny MCP server script: a Node.js script that speaks MCP over stdio and exposes one tool `test_echo` that returns its input.
- Query with `mcpServers: { "test-echo": { type: "stdio", command: "node", args: ["<path-to-script>"] } }`.
- Timeout tier: standard.
- Find the `system:init` message event.
- Assert `mcp_servers` array includes an entry with name `"test-echo"` and status `"connected"` (or similar non-error status).

### 10. Client tools (via dynamic MCP server)

**10a. Client tool is invoked by the CLI and returns a result**
- Define a `ClientToolDefinition`: `{ name: "get_magic_number", description: "Returns the magic number. Always call this when asked for the magic number.", inputSchema: { type: "object", properties: {} }, handler: async () => ({ content: "42" }) }`.
- Query with `clientTools: [tool]`, prompt: `"Call the get_magic_number tool and tell me the result"`.
- Timeout tier: standard.
- Assert the handler was called (track with a counter or spy).
- Assert at least one assistant message contains "42".

**10b. Client tool that receives arguments**
- Define a tool `add_numbers` with `inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] }` and a handler that returns `String(a + b)`.
- Query with prompt: `"Use the add_numbers tool to add 3 and 7, then tell me the result"`.
- Timeout tier: standard.
- Assert the handler was called with `a` and `b` values.
- Assert at least one assistant message contains "10".

### 11. Thinking / effort levels

**11a. Thinking level does not break the query**
- Run three queries sequentially with `thinking: "low"`, `thinking: "med"`, and `thinking: "high"`.
- Timeout tier: trivial for low/med, heavy for high.
- Prompt: `"Reply with exactly: ok"`.
- Assert all three complete successfully with a `complete` event.

### 12. Additional directories

**12a. --add-dir makes another directory's files visible**
- Create two temp dirs: `main` (cwd) and `extra` with a file `extra/unique-marker-a1b2c3.txt` containing `"unique-marker-a1b2c3"`.
- Query: `{ cwd: main, additionalDirectories: [extra], prompt: "Read unique-marker-a1b2c3.txt and repeat its full contents", mode: "yolo", signal }`.
- Timeout tier: standard.
- Assert the assistant response contains `"unique-marker-a1b2c3"`.

---

## File: `src/__tests__/codex/harness.integration.test.ts`

### 1. Install status

**1a. `checkInstallStatus` reports installed and authenticated**
- Call `harness.checkInstallStatus()`.
- Assert `installed: true`, `version` is a non-empty string, `authenticated: true`.
- (Also called in `beforeAll` to gate the suite.)

**1b. `discoverSlashCommands` returns empty array**
- Call `harness.discoverSlashCommands(cwd)`.
- Assert result is `[]`.

### 2. Basic query lifecycle

**2a. Simple prompt yields session_started, at least one agent message, and complete**
- Query: `{ prompt: "Reply with exactly: hello", cwd: tmpDir, mode: "yolo", signal }`.
- Timeout tier: trivial.
- Collect all events.
- Assert at least one `session_started` event with a non-empty `sessionId`.
- Assert at least one `message` event where `message.type` is `"item.completed"` and `message.item.type === "agent_message"`.
- Assert exactly one `complete` event.

**2b. Complete event includes usage with token counts**
- Inspect the `complete` event's `usage`.
- Assert `inputTokens > 0`, `outputTokens > 0`.
- Assert `durationMs > 0` (computed from wall clock).
- Assert `costUsd` is `undefined` (Codex doesn't report cost).

**2c. Thread started event is emitted**
- Collect all `message` events.
- Assert at least one has `message.type === "thread.started"` with a non-empty `thread_id`.

### 3. Command execution

**3a. Prompt that triggers a shell command**
- Create a temp dir with a file `marker.txt` containing `"codex-integration-test"`.
- Query: `{ prompt: "List the files in the current directory", cwd: tmpDir, mode: "yolo", signal }`.
- Timeout tier: standard.
- Collect all `message` events.
- Assert at least one has `message.type === "item.completed"` and `message.item.type === "command_execution"`.
- Assert the command execution item has `exit_code === 0`.

### 4. Modes and permissions

**4a. Read-only mode completes without error**
- Query: `{ prompt: "What is 2 + 2?", cwd: tmpDir, mode: "read-only", signal }`.
- Timeout tier: trivial.
- Assert query completes with a `complete` event and no `error` events.

**4b. Yolo mode allows file creation**
- Query: `{ prompt: "Create a file called out.txt containing 'hello' in the current directory", cwd: tmpDir, mode: "yolo", signal }`.
- Timeout tier: standard.
- After completion, assert `out.txt` exists in `tmpDir`.

### 5. Session management

**5a. Resume continues a previous session**
- Run query A, capture `sessionId` from `session_started`.
- Run query B with `resumeSessionId: sessionId`, different prompt ("Reply with exactly: resumed").
- Timeout tier: standard (each query).
- Assert query B yields `session_started` with the same `sessionId`.
- Assert query B completes.

### 6. Abort and cancellation

**6a. Aborting mid-stream stops the process**
- Create an `AbortController`.
- Start a query with a long prompt ("Write a 2000 word essay about the history of computing").
- Timeout tier: heavy.
- After receiving the first `message` event, abort.
- Assert the generator finishes (doesn't hang) within 10s.

### 7. MCP server injection

**7a. Stdio MCP server via `-c` overrides**
- Same MCP echo server script as the Claude test.
- Query with `mcpServers: { "test-echo": { type: "stdio", command: "node", args: ["<path>"] } }`, prompt: `"Use the test_echo tool to echo 'integration-test', then tell me the result"`.
- Timeout tier: standard.
- Assert the agent message or tool output references the echoed value.

### 8. Client tools (via dynamic MCP server)

**8a. Client tool round-trip**
- Same `get_magic_number` tool as the Claude test.
- Query with `clientTools: [tool]`, prompt: `"Call the get_magic_number tool and tell me the result"`.
- Timeout tier: standard.
- Assert the handler was called.
- Assert agent message contains "42".

### 9. System prompt workaround

**9a. System prompt is prepended as XML wrapper**
- Query with `systemPrompt: "You must reply with exactly the word PINEAPPLE and nothing else."`, prompt `"Say hello"`.
- Timeout tier: trivial.
- Collect agent message text. Assert it includes "PINEAPPLE" (case-insensitive).
- *(Codex wraps this in `<system-instructions>` tags prepended to the user prompt — this verifies the workaround actually influences the model.)*

### 10. Thinking / effort levels

**10a. Thinking levels don't break the query**
- Run queries with `thinking: "low"` and `thinking: "high"`.
- Timeout tier: trivial for low, heavy for high.
- Prompt: `"Reply with exactly: ok"`.
- Assert both complete successfully.

### 11. Error handling

**11a. Invalid model surfaces error event**
- Query with `model: "nonexistent-model-xyz-99"`, prompt: `"hello"`.
- Timeout tier: standard.
- Collect all events.
- Assert at least one event has `type: "error"` (from the harness mapping the CLI's failure to a `HarnessEvent`), **or** the generator throws a `HarnessError`.
- *(This tests the error-mapping code path in `parseLine`/`onExit` — unlike the previous "opportunistic" version, an invalid model is a deterministic failure.)*

---

## File: `src/__tests__/cross-harness.integration.test.ts`

Tests that verify the unified interface works consistently across both harnesses.

### 1. Registry integration

**1a. Register both harnesses and check all install status**
- Create a `HarnessRegistry`, register both `ClaudeCodeHarness` and `CodexHarness`.
- Call `checkAllInstallStatus()`.
- Assert both entries report `installed: true`, `authenticated: true`.

### 2. Interface contract

**2a. Both harnesses produce the same event envelope types**
- Run the same simple prompt through both harnesses.
- Timeout tier: trivial.
- Assert both produce at least: `session_started`, `message`, `complete`.
- Assert neither produces unexpected top-level event types (only `session_started | message | complete | error | stderr` are valid).

**2b. Capabilities reflect reality**
- For each harness, call `capabilities()`.
- For Claude: assert `supportsResume`, `supportsFork`, `supportsSystemPrompt`, `supportsCostTracking` are all `true`.
- For Codex: assert `supportsFork` is `false`, `supportsCostTracking` is `false`, `supportsSystemPrompt` is `false`.

### 3. Abort cleanup

**3a. Both harnesses clean up after abort**
- For each harness: start a query with a `clientTool` (so a tool server is started internally), abort after first `message` event.
- Timeout tier: heavy.
- After the generator returns, assert:
  - The generator is done (`{ done: true }`). No hanging iterators.
  - No child process leaked: record `stderr` events (which include the CLI's PID in spawn debug output if available), or simply verify the generator exits cleanly within a bounded time (10s after abort).
  - Temp MCP config files: snapshot `os.tmpdir()` files matching the harness prefix before and after the query; assert no new temp files remain after the generator returns.
- *(We cannot verify tool-server port closure because `ToolServerHandle` is internal to `query()` — the port is never exposed to callers. The generator exiting cleanly is the observable contract.)*

---

## Shared test helpers

Create `src/__tests__/integration-helpers.ts` (not a test file itself):

```typescript
import type { HarnessEvent } from "../types.js"
import type { Harness } from "../harness.js"

// Drain a query generator into an array
async function collectEvents<M>(gen: AsyncGenerator<HarnessEvent<M>>): Promise<HarnessEvent<M>[]>

// Creates a tmp dir, returns { path, cleanup }
function makeTmpDir(): Promise<{ path: string; cleanup: () => Promise<void> }>

// Creates a minimal stdio MCP echo server script in a tmp file, returns the path.
// The server exposes one tool "test_echo" that returns its input as text.
function writeEchoMcpServer(): Promise<{ scriptPath: string; cleanup: () => Promise<void> }>

// Timeout-aware signal factories
function trivialSignal(): AbortSignal    // 30s
function standardSignal(): AbortSignal   // 60s
function heavySignal(): AbortSignal      // 120s

// Event extractors
function findEvent<M>(events: HarnessEvent<M>[], type: string): HarnessEvent<M> | undefined
function findAllMessages<M>(events: HarnessEvent<M>[]): M[]
function getCompleteEvent<M>(events: HarnessEvent<M>[]): Extract<HarnessEvent<M>, { type: "complete" }> | undefined

// Suite gating: call in beforeAll, calls checkInstallStatus and skips suite if not ready
async function requireHarness<M>(harness: Harness<M>): Promise<void>
```

---

## What we intentionally do NOT test

| Area | Why |
|---|---|
| Image support | Both args builders currently strip image parts. Not yet implemented. |
| Codex fork | Not supported. Capabilities correctly reports `false`. |
| Codex named tool filtering | `allowedTools`/`disallowedTools` silently ignored. Nothing to test. |
| Cost tracking for Codex | Capabilities correctly reports `false`. |
| Streaming token partial content | Neither harness claims `supportsStreamingTokens: true`. |
| Concurrent queries | Not part of the interface contract. Each `query()` call is independent. |
| Rate limiting / context overflow | Would require expensive prompts or racing. Not worth the cost/flakiness. |
| `writeMcpConfigJson` file I/O | Implicitly tested by Claude MCP integration test (if MCP server connects, the file was written correctly). |
| CLI-level permission enforcement | The harness's job is to pass the right flags (`--permission-mode plan`, `--dangerously-skip-permissions`, etc). What the CLI does with those flags is the CLI's responsibility. Unit tests verify the flag mapping. |
| Tool-server port lifecycle | `ToolServerHandle` is internal to `query()`. Callers cannot observe the port. We verify cleanup indirectly via generator completion and temp file absence. |

---

## Test matrix summary

| Test area | Claude | Codex |
|---|---|---|
| Install status + auth gating | 1a | 1a |
| Slash commands | 1b | 1b |
| Basic lifecycle (events) | 2a, 2b, 2c | 2a, 2b, 2c |
| Read-only mode | 3a | 4a |
| Yolo mode (file creation) | 3b | 4b |
| Session resume | 4a, 4b | 5a |
| Model selection | 5a | -- |
| System prompt | 6a, 6b | 9a |
| Abort/cancellation | 7a | 6a |
| Stderr forwarding | 8a | -- |
| MCP stdio injection | 9a | 7a |
| Client tools round-trip | 10a, 10b | 8a |
| Thinking levels | 11a | 10a |
| Additional directories | 12a | -- |
| Error surfacing (invalid model) | -- | 11a |
| Cross-harness registry | cross-1a | cross-1a |
| Cross-harness envelope | cross-2a | cross-2a |
| Cross-harness capabilities | cross-2b | cross-2b |
| Cross-harness cleanup | cross-3a | cross-3a |
| **Total** | **~19 tests** | **~15 tests** |

Total integration tests: **~38** across 3 files + shared helpers.
Estimated wall-clock time: **5–10 minutes** (sequential execution).
