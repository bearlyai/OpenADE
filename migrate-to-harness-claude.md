# Migration Plan: Claude Agent SDK → @openade/harness (v2)

Replace direct `@anthropic-ai/claude-agent-sdk` usage with the `@openade/harness` library so the app can drive Claude Code, Codex, and future AI CLIs through a single unified interface.

**Approach:** One-shot migration (no feature flag, no IPC shims). The only backwards compatibility concern is persisted execution events in YJS storage, which get a tolerant reader.

---

## Current Architecture (Before)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Web (Renderer)                                                             │
│                                                                             │
│  ExecutionManager ──► ClaudeQueryManager ──► window.openadeAPI.claude.* ──┐ │
│       │                     │                                             │ │
│       │  ClaudeStreamEvent  │  SDKMessage                                 │ │
│       ▼                     ▼                                             │ │
│  EventManager         messageGroups.ts                                    │ │
│  TaskModel             (parses SDKMessage)                                │ │
│  QueryManager                                                             │ │
│  InlineMessages.tsx                                                       │ │
│  titleExtractor.ts                                                        │ │
└───────────────────────────────────────────────────────────────────┬────────┘
                                                                    │ IPC
┌───────────────────────────────────────────────────────────────────▼────────┐
│  Electron (Main)                                                           │
│                                                                            │
│  claude.ts ──► @anthropic-ai/claude-agent-sdk.query()                      │
│     │              │                                                       │
│     │  IPC: claude:event, claude:query, etc.                               │
│     │                                                                      │
│  capabilities.ts ──► @anthropic-ai/claude-agent-sdk.query() (probe)        │
│  binaries.ts ──► require.resolve("@anthropic-ai/claude-agent-sdk/sdk.mjs") │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key coupling points:**

| Concern | Current implementation |
|---|---|
| Subprocess spawning | `@anthropic-ai/claude-agent-sdk`'s `query()` in Electron main |
| Event types (main→renderer) | `SDKMessage` (opaque SDK type) wrapped in `ClaudeStreamEvent` |
| Client tools | `createSdkMcpServer()` + `tool()` from SDK to create MCP proxy |
| Binary resolution | SDK's own `cli.js` resolved via `require.resolve` in `binaries.ts` |
| Capabilities probe | SDK's `query()` run briefly in `capabilities.ts` |
| Message rendering | `messageGroups.ts` casts `SDKMessage` fields to extract content |
| IPC protocol | 10+ `claude:*` channels carrying Claude-specific payloads |
| Model catalog | `ClaudeModelId`, `CLAUDE_MODELS`, `ModelPicker.tsx` hardcoded to Claude |

---

## Target Architecture (After)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Web (Renderer)                                                             │
│                                                                             │
│  ExecutionManager ──► HarnessQueryManager ──► window.openadeAPI.harness.* ┐ │
│       │                     │                                             │ │
│       │  HarnessStreamEvent │  HarnessRawMessage                          │ │
│       ▼                     ▼                                             │ │
│  EventManager         messageGroups.ts                                    │ │
│  TaskModel             (dispatches to per-harness parser)                 │ │
│  QueryManager                                                             │ │
│  InlineMessages.tsx                                                       │ │
│  titleExtractor.ts                                                        │ │
└───────────────────────────────────────────────────────────────────┬────────┘
                                                                    │ IPC
┌───────────────────────────────────────────────────────────────────▼────────┐
│  Electron (Main)                                                           │
│                                                                            │
│  harness.ts ──► @openade/harness (ClaudeCodeHarness / CodexHarness)        │
│     │              │                                                       │
│     │  IPC: harness:event, harness:query, etc.                             │
│     │                                                                      │
│  capabilities.ts ──► harness.discoverSlashCommands() / checkInstallStatus()│
│  binaries.ts ──► simplified (no SDK resolution, harness resolves binaries) │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key changes:**

- Replace `SDKMessage` with harness raw message types (`ClaudeEvent` | `CodexEvent`)
- Replace `@anthropic-ai/claude-agent-sdk` dependency with `@openade/harness`
- Replace Claude-specific IPC channels with harness-generic ones
- Replace `ClaudeStreamEvent` with `HarnessStreamEvent` (carries `harnessId` field)
- Message rendering becomes a pluggable parser per `harnessId`
- Client tools go through harness's built-in `clientTools` / `startToolServer()`
- Model catalog becomes per-harness, UI gated by `harness.capabilities()`
- Standardize on `harnessId` everywhere (matches harness library's `Harness.id` field)

---

## Affected Files Inventory

### Electron (Main Process)

| File | Impact | Action |
|---|---|---|
| `electron/src/modules/code/claude.ts` | **Delete + replace** | New `harness.ts` using `@openade/harness` |
| `electron/src/modules/code/capabilities.ts` | Major | Use harness's `discoverSlashCommands()` and `checkInstallStatus()` |
| `electron/src/modules/code/binaries.ts` | Major | Remove SDK `require.resolve()` and `getCliJsPath()` |
| `electron/src/preload.ts` | Major | Replace `claude` namespace with `harness` namespace |
| `electron/src/main.ts` | Moderate | Import from `harness.ts` instead of `claude.ts`, update load order |
| `electron/package.json` | Dependency swap | Remove `@anthropic-ai/claude-agent-sdk`, add `@openade/harness`, update `asarUnpack` |
| `electron/build.mjs` | Minor | Verify esbuild externalization works for `@openade/harness` |

### Web (Renderer)

| File | Impact | Action |
|---|---|---|
| `web/src/electronAPI/claudeEventTypes.ts` | **Delete + replace** → `harnessEventTypes.ts` | Harness-generic event types, tolerant reader for v1 |
| `web/src/electronAPI/claude.ts` | **Delete + replace** → `harnessQuery.ts` | Generic `HarnessQuery` / `HarnessQueryManager` |
| `web/src/vite-env.d.ts` | Major | Replace `claude` interface with `harness` interface |
| `web/src/types.ts` | Major | `Execution.harnessId`, `HarnessStreamEvent` replaces `ClaudeStreamEvent` |
| `web/src/constants.ts` | Major | `CLAUDE_MODELS` → per-harness `MODEL_REGISTRY`, generic `ModelEntry` |
| `web/src/store/managers/ExecutionManager.ts` | Major | Use `HarnessQueryManager`, add install/auth pre-check |
| `web/src/store/managers/QueryManager.ts` | Major | Use `HarnessQuery` instead of `ClaudeQuery` |
| `web/src/store/managers/EventManager.ts` | Moderate | Update type imports, harness-aware `extractPrUrl()` |
| `web/src/store/TaskModel.ts` | Moderate | `model: string` + `harnessId`, update stat extraction |
| `web/src/store/EventModel.ts` | Moderate | Update type imports |
| `web/src/store/store.ts` | Moderate | `defaultModel: string` + `defaultHarnessId: HarnessId` |
| `web/src/components/events/messageGroups.ts` | **Major** | Pluggable parser per harnessId (replace `SDKMessage` parsing) |
| `web/src/components/InlineMessages/InlineMessages.tsx` | Moderate | Update type imports, pass `harnessId` |
| `web/src/components/ModelPicker.tsx` | Major | Accept per-harness model list from registry |
| `web/src/components/InputBar.tsx` | Moderate | Generic `ModelId` type, pass `harnessId` |
| `web/src/prompts/prompts.ts` | Minor | `ContentBlock` import → `harnessEventTypes.ts` |
| `web/src/prompts/titleExtractor.ts` | Moderate | Use `HarnessQueryManager` |
| `web/src/persistence/taskStatsUtils.ts` | Moderate | Harness-aware extraction, use `complete` event usage |
| `web/src/electronAPI/mcp.ts` | Minor | MCP type imports from `@openade/harness` |
| `web/src/index.ts` | Minor | Update re-exports |
| `web/package.json` | Dependency | Remove `@anthropic-ai/claude-agent-sdk` dev dep, add `@openade/harness` |

### Documentation

| File | Action |
|---|---|
| `web/src/CLAUDE.md` | Update architecture, key files, references |
| `web/src/_docs/electron-api.md` | Update IPC docs |

---

## Migration Steps

### Phase 0: Preparation

**0.1 — Verify harness library parity**

Before starting, confirm the harness library covers all features currently used:

| Feature | Current (SDK) | Harness | Status |
|---|---|---|---|
| Text prompt | `query({ prompt: string })` | `HarnessQuery.prompt: string` | ✅ |
| Image prompt | Content blocks with base64 images | `HarnessQuery.prompt: PromptPart[]` | ✅ |
| System prompt (append) | `Options.systemPrompt.append` | `HarnessQuery.appendSystemPrompt` | ✅ |
| Model selection | `Options.model` | `HarnessQuery.model` | ✅ |
| Working directory | `Options.cwd` | `HarnessQuery.cwd` | ✅ |
| Additional directories | `Options.additionalDirectories` | `HarnessQuery.additionalDirectories` | ✅ |
| Session resume/fork | `Options.resume` / `Options.forkSession` | `HarnessQuery.resumeSessionId` / `forkSession` | ✅ |
| Read-only mode | Custom `Options.permissionMode` | `HarnessQuery.mode: "read-only"` | ✅ |
| Bypass permissions (yolo) | `Options.permissionMode: "bypassPermissions"` | `HarnessQuery.mode: "yolo"` | ✅ |
| Allowed/disallowed tools | `Options.allowedTools` / `disallowedTools` | `HarnessQuery.allowedTools` / `disallowedTools` | ✅ |
| Client tools (renderer-side) | `createSdkMcpServer()` + `tool()` | `HarnessQuery.clientTools` + built-in `startToolServer()` | ✅ |
| MCP servers (external) | `Options.mcpServers` | `HarnessQuery.mcpServers` | ✅ |
| Abort/cancel | `AbortController` | `HarnessQuery.signal: AbortSignal` | ✅ |
| Env vars | `Options.env` | `HarnessQuery.env` | ✅ |
| Thinking tokens | `Options.maxThinkingTokens` | `HarnessQuery.thinking` | ⚠️ Different API (enum vs number) |
| Cost tracking | Result event `total_cost_usd` | `HarnessUsage.costUsd` | ✅ |
| Session ID extraction | Parse `system:init` for `session_id` | `HarnessEvent.session_started` | ✅ |
| stderr capture | `Options.stderr` callback | `HarnessEvent.stderr` | ✅ |
| Settings sources | `Options.settingSources` | Not in `HarnessQuery` | ⚠️ May need to add |
| Executable override | `Options.executable` / `pathToClaudeCodeExecutable` | `ClaudeCodeHarnessConfig.binaryPath` | ✅ |
| Disable telemetry | `env.DISABLE_TELEMETRY` | `ClaudeCodeHarnessConfig.disableTelemetry` | ✅ |
| Install status | Not available | `harness.checkInstallStatus()` | ✅ New |
| Capabilities | Not available | `harness.capabilities()` | ✅ New |

**Items that may need harness library changes:**

1. **`maxThinkingTokens`**: Currently we pass `maxThinkingTokens: 10000`. The harness has `thinking: "low" | "med" | "high"`. Either add numeric support to the harness or map `10000` to an enum value.

2. **`settingSources`**: Currently `["user", "project", "local"]`. The harness `ClaudeCodeHarnessConfig` may already have this. Confirm it's passed through correctly.

3. **`permissionMode: "bypassPermissions"`**: The harness uses `mode: "yolo"`. Verify this maps to the same CLI flag (`--dangerously-skip-permissions`).

4. **`tools.type: "preset", preset: "claude_code"`**: The harness needs to support this or have equivalent behavior.

5. **Model env vars**: We pass `ANTHROPIC_DEFAULT_SONNET_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, etc. The harness's `HarnessQuery.env` can carry these, but verify they get forwarded to the subprocess.

6. **`forceSubagentModel`**: The harness config has this. Verify behavior matches our current env var approach.

**0.2 — Add missing features to harness library (if any)**

Track any harness library PRs needed before migration can begin.

**0.3 — Packaging / build-order prep + DX automation**

`@openade/harness` is a local package at `projects/harness/`, not published to npm. Use `file:` references so yarn copies the built output into each consumer's `node_modules/` at install time.

**Step 1 — Add `file:` dependency in both consumers:**

```diff
# electron/package.json
  "dependencies": {
-   "@anthropic-ai/claude-agent-sdk": "^0.2.37",
+   "@openade/harness": "file:../harness",
  }

# web/package.json
  "devDependencies": {
-   "@anthropic-ai/claude-agent-sdk": "^0.2.37",
+   "@openade/harness": "file:../harness",
  }
```

With `file:`, `yarn install` copies `projects/harness/` (including its `dist/`) into `node_modules/@openade/harness`. This means:
- `require("@openade/harness")` resolves at runtime inside the asar (no symlink issues)
- esbuild externalization (`build.mjs:22`) works — the package is in `node_modules/` like any npm dep
- No `asarUnpack` rule needed — the harness spawns CLI binaries from PATH, it doesn't need files unpacked from asar

**Step 2 — Add a `preinstall` script to harness that builds itself:**

```diff
# harness/package.json
  "scripts": {
+   "preinstall": "yarn build 2>/dev/null || true",
    "build": "tsc",
```

The `|| true` ensures a fresh clone (where `dist/` doesn't exist yet and devDeps aren't installed) doesn't break the install chain. On subsequent runs, `tsc` will succeed and `dist/` will be fresh.

**Step 3 — Wire harness build into consumer `start` / `build` scripts so it's automatic:**

```diff
# electron/package.json
  "scripts": {
+   "build:harness": "cd ../harness && yarn install && yarn build",
-   "start": "npm install && RELEASE=head DEBUG=1 npm run build && npx electron dist/main.js",
+   "start": "npm run build:harness && npm install && RELEASE=head DEBUG=1 npm run build && npx electron dist/main.js",
-   "build": "npm run clean && node ./build.mjs",
+   "build": "npm run build:harness && npm install && npm run clean && node ./build.mjs",
-   "build:web": "cd ../web && yarn install && yarn build && cd ../electron && cp -r ../web/dist ./dist/web",
+   "build:web": "npm run build:harness && cd ../web && yarn install && yarn build && cd ../electron && cp -r ../web/dist ./dist/web",

# web/package.json
  "scripts": {
+   "build:harness": "cd ../harness && yarn install && yarn build",
-   "start": "yarn install && vite dev",
+   "start": "npm run build:harness && yarn install && vite dev",
-   "build": "npm run typecheck && npm run clean && vite build",
+   "build": "npm run build:harness && yarn install && npm run typecheck && npm run clean && vite build",
```

This gives you:
- **`yarn start`** in either project → harness is built, `file:` copy refreshed via `yarn install`, then dev server starts
- **`yarn build`** → same, so CI and `build:test-mac` always get a fresh harness
- **No manual steps** — you never need to remember to `cd ../harness && yarn build` first
- **`yarn install` re-copies** — because `file:` deps are copied at install time, the `yarn install` after `build:harness` ensures the latest `dist/` is in `node_modules/`

**Step 4 — Verify esbuild + electron-builder:**

- `build.mjs:22`: `external: Object.keys(externalDep)` already externalizes everything in `dependencies`. Since `@openade/harness` is in `dependencies`, it will be externalized and resolved via `require()` from `node_modules/` at runtime. No changes needed to `build.mjs`.
- `electron-builder`: The `files` array includes `dist/main.js` and `dist/preload.js`. All `node_modules/` are packaged into the asar automatically. The harness (copied by `file:`) is just another folder in `node_modules/` — it gets bundled like any other dep.
- Delete the `asarUnpack` rule for the SDK. The harness doesn't need unpacking since it doesn't have a `cli.js` that child processes read from disk.
- If we still use the managed bun approach in production, pass `binaryPath` to `ClaudeCodeHarnessConfig` pointing to whatever `binaries.ts` resolves.

**Step 5 — Watch mode (optional DX improvement):**

For hot-reload during harness development, add a watch script:

```diff
# harness/package.json
  "scripts": {
+   "watch": "tsc --watch",
```

Run `yarn watch` in the harness project in a separate terminal. After each rebuild, run `yarn install` in the consumer to refresh the copy. (This is the main downside of `file:` vs `link:` — no live symlink. But it only matters when actively developing the harness library itself, which is rare during normal app development.)

**0.4 — CI grep guard**

Add a CI check that fails on new `@anthropic-ai/claude-agent-sdk` imports:

```bash
# Fail if any non-deleted file imports from the old SDK
! grep -r "@anthropic-ai/claude-agent-sdk" projects/electron/src projects/web/src --include="*.ts" --include="*.tsx"
```

---

### Phase 1: New Event Type System (Web)

Create the harness-agnostic event types that will replace `ClaudeStreamEvent` and `SDKMessage`.

**1.1 — Create `web/src/electronAPI/harnessEventTypes.ts`**

```typescript
// The harness-generic equivalent of claudeEventTypes.ts

import type { HarnessId, HarnessUsage, HarnessErrorCode, McpServerConfig as HarnessMcpServerConfig } from "@openade/harness"

export type { HarnessId, HarnessMcpServerConfig as McpServerConfig }

// ============================================================================
// Prompt Content
// ============================================================================

/** Content block for Vision API support — text or base64 image */
export type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

// ============================================================================
// Query Options (renderer → Electron)
// ============================================================================

/** Serialized tool definition for IPC (no handler, JSON Schema) */
export interface SerializedToolDefinition {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

/** Tool result from renderer */
export interface ToolResult {
    content: Array<{ type: "text"; text: string }>
    isError?: boolean
}

export interface HarnessQueryOptions {
    harnessId: HarnessId
    cwd: string
    mode: "read-only" | "yolo"
    model?: string
    thinking?: "low" | "med" | "high"
    appendSystemPrompt?: string
    resumeSessionId?: string
    forkSession?: boolean
    additionalDirectories?: string[]
    env?: Record<string, string>
    allowedTools?: string[]
    disallowedTools?: string[]
    mcpServerConfigs?: Record<string, HarnessMcpServerConfig>
    clientTools?: SerializedToolDefinition[]
}

// ============================================================================
// Raw Messages
// ============================================================================

/**
 * Raw message from a harness. Opaque to the framework —
 * the rendering layer interprets it per-harness via pluggable parsers.
 */
export type HarnessRawMessage = unknown

// ============================================================================
// Execution Events (Electron → Dashboard)
// ============================================================================

export type HarnessExecutionEvent =
    | { id: string; type: "raw_message"; executionId: string; harnessId: HarnessId; message: HarnessRawMessage }
    | { id: string; type: "stderr"; executionId: string; harnessId: HarnessId; data: string }
    | { id: string; type: "complete"; executionId: string; harnessId: HarnessId; usage?: HarnessUsage }
    | { id: string; type: "error"; executionId: string; harnessId: HarnessId; error: string; code?: HarnessErrorCode }
    | { id: string; type: "tool_call"; executionId: string; harnessId: HarnessId; callId: string; toolName: string; args: unknown }
    | { id: string; type: "session_started"; executionId: string; harnessId: HarnessId; sessionId: string }

// ============================================================================
// Command Events (Dashboard → Electron)
// ============================================================================

export type HarnessCommandEvent =
    | { id: string; type: "start_query"; executionId: string; prompt: string | ContentBlock[]; options: HarnessQueryOptions }
    | { id: string; type: "tool_response"; executionId: string; callId: string; result?: ToolResult; error?: string }
    | { id: string; type: "abort"; executionId: string }
    | { id: string; type: "reconnect"; executionId: string }
    | { id: string; type: "clear_buffer"; executionId: string }

// ============================================================================
// Combined Event Type
// ============================================================================

export type HarnessStreamEvent =
    | (HarnessExecutionEvent & { direction: "execution" })
    | (HarnessCommandEvent & { direction: "command" })

// ============================================================================
// Execution State (used by both sides for buffering)
// ============================================================================

export interface ExecutionState {
    executionId: string
    harnessId: HarnessId
    status: "in_progress" | "completed" | "error" | "aborted"
    sessionId?: string
    events: HarnessStreamEvent[]
    createdAt: string
    completedAt?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Extract raw messages from unified event stream (for rendering) */
export function extractRawMessages(events: HarnessStreamEvent[]): HarnessRawMessage[] {
    return events
        .filter((e): e is HarnessExecutionEvent & { direction: "execution"; type: "raw_message" } =>
            e.direction === "execution" && e.type === "raw_message")
        .map((e) => e.message)
}

/** Extract stderr output from unified event stream */
export function extractStderr(events: HarnessStreamEvent[]): string[] {
    return events
        .filter((e): e is HarnessExecutionEvent & { direction: "execution"; type: "stderr" } =>
            e.direction === "execution" && e.type === "stderr")
        .map((e) => e.data)
}

/** Check if an event ID already exists (for deduplication) */
export function hasEventId(events: HarnessStreamEvent[], id: string): boolean {
    return events.some((e) => e.id === id)
}

/**
 * Check if events contain only an init message (no meaningful work done).
 * Per-harnessId logic since different CLIs emit different init events.
 */
export function hasOnlyInitMessage(events: HarnessStreamEvent[], harnessId: HarnessId): boolean {
    const messages = extractRawMessages(events)
    if (messages.length !== 1) return false
    if (harnessId === "claude-code") {
        const msg = messages[0] as Record<string, unknown>
        return msg?.type === "system" && msg?.subtype === "init"
    }
    // Codex / future harnesses: add checks here
    return false
}
```

**1.2 — Create tolerant reader for v1 persisted events**

Existing YJS stores contain events in the v1 `ClaudeStreamEvent` format (with `type: "sdk_message"`, no `harnessId`). Add a normalizer that runs on read:

```typescript
// web/src/electronAPI/harnessEventCompat.ts

import type { HarnessStreamEvent } from "./harnessEventTypes"

/**
 * Normalize a persisted event that may be v1 (ClaudeStreamEvent) or v2 (HarnessStreamEvent).
 * v1 events have type:"sdk_message" and no harnessId field.
 * v2 events have type:"raw_message" and a harnessId field.
 */
export function normalizePersistedEvent(event: Record<string, unknown>): HarnessStreamEvent {
    // Already v2 — has harnessId
    if ("harnessId" in event) return event as HarnessStreamEvent

    // v1 → v2 normalization
    if (event.type === "sdk_message") {
        return {
            ...event,
            type: "raw_message",
            harnessId: "claude-code",
        } as HarnessStreamEvent
    }

    // v1 command events and other execution events — inject harnessId
    return {
        ...event,
        harnessId: "claude-code",
    } as HarnessStreamEvent
}

/** Normalize an array of persisted events */
export function normalizePersistedEvents(events: unknown[]): HarnessStreamEvent[] {
    return events.map((e) => normalizePersistedEvent(e as Record<string, unknown>))
}
```

This is called in `EventModel.ts` when loading events from YJS.

**1.3 — Update `web/src/types.ts`**

Replace `ClaudeStreamEvent` with `HarnessStreamEvent` and generalize `Execution`:

```typescript
import type { HarnessStreamEvent, HarnessId } from "./electronAPI/harnessEventTypes"

export type { HarnessStreamEvent }

export interface GitRefs {
    sha: string
    branch?: string
}

export interface Execution {
    harnessId: HarnessId     // "claude-code" | "codex" | ...
    executionId: string
    sessionId?: string
    parentSessionId?: string
    modelId?: string
    events: HarnessStreamEvent[]
    gitRefsBefore?: GitRefs
    gitRefsAfter?: GitRefs
}
```

Note: The old `type: "claude-code"` field becomes `harnessId: "claude-code"`. The tolerant reader handles old persisted data that has `type` instead of `harnessId`.

---

### Phase 2: IPC Protocol + Electron Runtime

Replace the Electron side entirely.

**2.1 — Create `electron/src/modules/code/harness.ts`**

This replaces `claude.ts`. Instead of importing from `@anthropic-ai/claude-agent-sdk`, it uses `@openade/harness`:

```typescript
import {
    ClaudeCodeHarness,
    CodexHarness,
    HarnessRegistry,
    type HarnessEvent,
    type ClaudeEvent,
    type HarnessQuery,
    type HarnessId,
} from "@openade/harness"

const registry = new HarnessRegistry()
registry.register(new ClaudeCodeHarness({ disableTelemetry: true }))
registry.register(new CodexHarness())

export { registry }

// Expose for main.ts lifecycle
export function load(webContents: WebContents): void {
    // Register IPC handlers: harness:query, harness:abort, harness:reconnect, etc.
}

export function cleanup(): void {
    // Abort all active executions, clear buffers
}

export function hasActiveQueries(): boolean {
    // Check if any execution is in_progress
}
```

**`handleStartQuery` flow:**

```
1. Look up harness from registry by options.harnessId
2. Check install/auth status (see 2.5 below)
3. Build HarnessQuery from command options:
   - Map prompt (string or ContentBlock[] → string | PromptPart[])
   - Map mode ("read-only" | "yolo")
   - Create AbortController, wrap signal into HarnessQuery
   - Map clientTools: renderer-side handlers stay in renderer,
     Electron creates MCP proxy server (see 2.4 below)
   - Map model + env (resolve via modelForHarness, see Phase 4)
4. Call harness.query(q) → AsyncGenerator<HarnessEvent<M>>
5. For each event:
   - type "message"         → emit { type: "raw_message", harnessId, message }
   - type "session_started" → emit { type: "session_started", harnessId, sessionId }
   - type "complete"        → emit { type: "complete", harnessId, usage }
   - type "error"           → emit { type: "error", harnessId, error, code }
   - type "stderr"          → emit { type: "stderr", harnessId, data }
6. Buffer events and send to renderer via "harness:event" channel
```

**2.2 — Update `electron/src/preload.ts`**

Replace the `claude` namespace with `harness`:

```typescript
// ========================================================================
// Harness (Agent Execution)
// ========================================================================
harness: {
    query: (args: unknown) => ipcRenderer.invoke("harness:query", args),
    toolResponse: (args: unknown) => ipcRenderer.invoke("harness:tool-response", args),
    reconnect: (args: unknown) => ipcRenderer.invoke("harness:reconnect", args),
    abort: (args: unknown) => ipcRenderer.invoke("harness:abort", args),
    checkStatus: (args: unknown) => ipcRenderer.invoke("harness:check-status", args),
    onEvent: (cb: (event: unknown) => void) =>
        createListener("harness:event", cb as (...args: unknown[]) => void),
    onToolCall: (executionId: string, cb: (callId: string, name: string, args: unknown) => void) => {
        const handler = (_event: IpcRendererEvent, callId: string, name: string, args: unknown) =>
            cb(callId, name, args)
        ipcRenderer.on(`harness:tool-call:${executionId}`, handler)
        return () => ipcRenderer.removeListener(`harness:tool-call:${executionId}`, handler)
    },
},
```

**2.3 — Update `web/src/vite-env.d.ts`**

Replace `claude` interface with `harness`:

```typescript
harness: {
    query: (args: unknown) => Promise<unknown>
    toolResponse: (args: unknown) => Promise<unknown>
    reconnect: (args: unknown) => Promise<unknown>
    abort: (args: unknown) => Promise<unknown>
    checkStatus: (args: unknown) => Promise<unknown>
    onEvent: (cb: (event: unknown) => void) => () => void
    onToolCall: (executionId: string, cb: (callId: string, name: string, args: unknown) => void) => () => void
}
```

**2.4 — Client tools handling**

The biggest architectural question. Currently, tool handlers live in the renderer process (Zod schema definitions, handler functions). The harness library's `clientTools` expects handlers in the same process as `query()`.

**Decision: Keep tool handlers in renderer (Option A).**

The Electron main process does NOT pass `clientTools` to the harness. Instead:
1. Main creates an MCP server that proxies tool calls to the renderer (same pattern as today)
2. The proxy server is passed as an `mcpServers` entry to the harness query
3. Renderer handles tool calls and responds via IPC (same flow as today)

This preserves the current tool architecture and is least disruptive. The client tool IPC protocol (`tool_call` / `tool_response` events) remains.

**Future option:** Move tool handlers to main process, pass `clientTools` directly to harness `query()`. Simpler but requires tool logic to run in main process.

**2.5 — Install/auth gating**

Expose a new IPC handler `harness:check-status` that calls `registry.checkAllInstallStatus()` and returns the map.

The harness library returns `HarnessInstallStatus` per harness:
```typescript
{ installed: boolean; version?: string; authType: "api-key" | "account" | "none"; authenticated: boolean; authInstructions?: string }
```

In `handleStartQuery`, before launching the harness query:
1. Call `harness.checkInstallStatus()`
2. If `!installed`, emit an error event with `code: "not_installed"` and the harness's `authInstructions`
3. If `!authenticated`, emit an error event with `code: "auth_failed"` and the harness's `authInstructions`
4. The renderer shows an actionable error to the user

The `HarnessNotInstalledError` and `HarnessAuthError` from `@openade/harness` are caught and mapped to typed error events with `HarnessErrorCode`.

**2.6 — Update `electron/src/modules/code/capabilities.ts`**

Replace the SDK probe with harness methods:

```typescript
import { registry } from "./harness"

// For slash command discovery:
const harness = registry.getOrThrow(harnessId)
const commands = await harness.discoverSlashCommands(cwd, signal)

// For install/auth status:
const status = await harness.checkInstallStatus()

// Cache by (harnessId, cwd) instead of just cwd
```

**2.7 — Update `electron/src/modules/code/binaries.ts`**

Remove the SDK-specific binary resolution:
- Delete `getCliJsPath()` function (resolves `require.resolve("@anthropic-ai/claude-agent-sdk/sdk.mjs")`)
- The harness library resolves CLI binaries from PATH internally
- If we still need managed bun for production, pass `binaryPath` to `ClaudeCodeHarnessConfig`
- Keep binary management for other tools (bun, ripgrep, etc.) if still needed

**2.8 — Update `electron/src/main.ts`**

```typescript
// Before:
import { load as loadClaudeSdk, cleanup as cleanupClaude, hasActiveQueries } from "./modules/code/claude"

// After:
import { load as loadHarness, cleanup as cleanupHarness, hasActiveQueries } from "./modules/code/harness"
```

Load order remains the same (binaries first, then capabilities, then harness).

**2.9 — Update `electron/package.json`**

This should already be done in Phase 0.3, but for completeness:

```diff
  "dependencies": {
-   "@anthropic-ai/claude-agent-sdk": "^0.2.37",
+   "@openade/harness": "file:../harness",
    ...
  },
  "build": {
    "asarUnpack": [
-     "node_modules/@anthropic-ai/claude-agent-sdk/**"
    ],
    ...
  }
```

Delete the `asarUnpack` rule entirely — the harness spawns CLI binaries from PATH, it doesn't need files unpacked from asar.

---

### Phase 3: Web Client Layer

Replace the renderer-side query management.

**3.1 — Create `web/src/electronAPI/harnessQuery.ts`**

Replaces `claude.ts`. This is the generic query manager:

```typescript
import type {
    HarnessStreamEvent,
    HarnessRawMessage,
    HarnessQueryOptions,
    HarnessExecutionEvent,
    ExecutionState,
    HarnessId,
} from "./harnessEventTypes"

export class HarnessQuery {
    private _executionState: ExecutionState

    constructor(executionId: string, harnessId: HarnessId) { ... }

    handleEvent(event: HarnessStreamEvent): boolean { ... }

    async *stream(): AsyncGenerator<HarnessRawMessage> {
        // Same shape as ClaudeQuery.stream() but yields HarnessRawMessage
    }

    get sessionId(): string | undefined { ... }
    get events(): HarnessStreamEvent[] { ... }

    async abort(): Promise<void> {
        await window.openadeAPI?.harness.abort({ executionId: this._executionState.executionId })
    }

    async clearBuffer(): Promise<void> { ... }
}

class HarnessQueryManagerImpl {
    private queries = new Map<string, HarnessQuery>()

    async startExecution(
        prompt: string | ContentBlock[],
        options: HarnessQueryOptions,
        executionId?: string
    ): Promise<HarnessQuery | null> {
        // Calls window.openadeAPI.harness.query(...)
        // Registers event listener
        // Returns HarnessQuery
    }

    async attachExecution(executionId: string, harnessId: HarnessId): Promise<HarnessQuery | null> {
        // For reconnection after page refresh
    }

    cleanup(executionId: string): void { ... }
}

let managerInstance: HarnessQueryManagerImpl | null = null

export function getHarnessQueryManager(): HarnessQueryManagerImpl {
    if (!managerInstance) {
        managerInstance = new HarnessQueryManagerImpl()
    }
    return managerInstance
}

export function isHarnessApiAvailable(): boolean {
    return !!window.openadeAPI?.harness
}
```

**Key differences from `claude.ts`:**
- Options carry `harnessId` so Electron knows which harness to use
- Default tool lists (`Read`, `Edit`, `Bash`, etc.) are NOT set here — they're Claude Code-specific. The harness resolves the right tool set internally based on the CLI being invoked.
- The stream yields `HarnessRawMessage` instead of `SDKMessage`
- No SDK imports anywhere

**3.2 — Update `store/managers/ExecutionManager.ts`**

```typescript
// Before:
import { type ClaudeStreamEvent, type McpServerConfig, getClaudeQueryManager, isClaudeApiAvailable } from "../../electronAPI/claude"

// After:
import { getHarnessQueryManager, isHarnessApiAvailable } from "../../electronAPI/harnessQuery"
import type { HarnessStreamEvent, McpServerConfig, HarnessId } from "../../electronAPI/harnessEventTypes"
```

Changes in `runExecutionLoop()`:
- `getClaudeQueryManager()` → `getHarnessQueryManager()`
- `manager.startExecution(prompt, options, executionId)` → `manager.startExecution(prompt, { harnessId, ...options }, executionId)`
- Stream wrapping: `type: "sdk_message"` → `type: "raw_message"`, add `harnessId` field
- The `system:init` detection for SDK capabilities needs to become harness-aware (only applies for `harnessId === "claude-code"`)

**Install/auth pre-check (new):** Before dispatching to the query manager, call `window.openadeAPI.harness.checkStatus({ harnessId })`. If not installed or not authenticated, show actionable error instead of starting execution.

**3.3 — Update `store/managers/QueryManager.ts`**

```typescript
// Before:
import { type ClaudeQuery, getClaudeQueryManager } from "../../electronAPI/claude"
import { hasOnlyInitMessage } from "../../electronAPI/claudeEventTypes"

// After:
import { type HarnessQuery, getHarnessQueryManager } from "../../electronAPI/harnessQuery"
import { hasOnlyInitMessage } from "../../electronAPI/harnessEventTypes"
```

Replace `ClaudeQuery` with `HarnessQuery` in the `activeQueries` map. `hasOnlyInitMessage` now takes `harnessId` as second argument.

**3.4 — Update `store/managers/EventManager.ts`**

```typescript
// Before:
import type { ClaudeStreamEvent } from "../../electronAPI/claude"
import { extractSDKMessages } from "../../electronAPI/claudeEventTypes"

// After:
import type { HarnessStreamEvent } from "../../electronAPI/harnessEventTypes"
import { extractRawMessages } from "../../electronAPI/harnessEventTypes"
```

The `extractPrUrl()` function currently parses `SDKMessage` to find PR URLs. This needs to become harness-aware since the message format differs per harness. For Claude Code, parse `ClaudeEvent` assistant messages. For Codex/others, implement per-harness extraction or return `undefined`.

**3.5 — Update `store/TaskModel.ts` and `store/EventModel.ts`**

Update type imports from `ClaudeStreamEvent` → `HarnessStreamEvent`. `EventModel` applies `normalizePersistedEvents()` when loading events from YJS to handle v1 stored data.

**3.6 — Update `prompts/titleExtractor.ts`**

```typescript
// Before:
import { getClaudeQueryManager } from "../electronAPI/claude"

// After:
import { getHarnessQueryManager } from "../electronAPI/harnessQuery"
```

Title extraction currently uses Claude Haiku. Keep it using `harnessId: "claude-code"` for now — it's a lightweight utility query, not user-facing execution. If the user's only harness is Codex, add a fallback that either uses Codex for title extraction or falls back to a regex/heuristic.

**3.7 — Update `prompts/prompts.ts`**

`ContentBlock` is currently re-exported from `claudeEventTypes.ts`. Import from `harnessEventTypes.ts` instead (same shape).

**3.8 — Update `persistence/taskStatsUtils.ts`**

Replace `extractSDKMessages` with harness-aware extraction. Cost/token stats now come from the `complete` event's `usage` field instead of parsing result messages:

```typescript
// Before: scan SDKMessages for type:"result" and extract total_cost_usd
// After: find the HarnessStreamEvent with type:"complete" and read usage.costUsd
```

For harnesses that don't report cost (e.g., Codex may not), degrade gracefully — show "—" instead of $0.00.

**3.9 — Update `electronAPI/mcp.ts`**

Update MCP type imports to come from `@openade/harness` instead of `claudeEventTypes.ts`:

```typescript
// Before:
import type { McpHttpServerConfig, McpServerConfig, McpStdioServerConfig } from "./claudeEventTypes"

// After:
import type { McpHttpServerConfig, McpServerConfig, McpStdioServerConfig } from "@openade/harness"
```

---

### Phase 4: Model Catalog + Capability-Driven UI

The current model system is hardcoded to Claude. Generalize it.

**4.1 — Generalize model constants in `web/src/constants.ts`**

```typescript
// Before:
export const CLAUDE_MODELS = [
    { id: "opus", fullId: "claude-opus-4-6", label: "Opus 4.6" },
    { id: "sonnet", fullId: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
    { id: "haiku", fullId: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const
export const DEFAULT_MODEL = "opus"
export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]["id"]

// After:
import type { HarnessId } from "@openade/harness"

export interface ModelEntry {
    id: string          // Short alias: "opus", "sonnet", "o3"
    fullId: string      // Wire ID: "claude-opus-4-6", "o3"
    label: string       // Display: "Opus 4.6", "o3"
}

export const MODEL_REGISTRY: Record<HarnessId, { models: ModelEntry[]; defaultModel: string }> = {
    "claude-code": {
        models: [
            { id: "opus", fullId: "claude-opus-4-6", label: "Opus 4.6" },
            { id: "sonnet", fullId: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
            { id: "haiku", fullId: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
        ],
        defaultModel: "opus",
    },
    "codex": {
        models: [
            { id: "o3", fullId: "o3", label: "o3" },
            { id: "o4-mini", fullId: "o4-mini", label: "o4-mini" },
        ],
        defaultModel: "o3",
    },
}

export const DEFAULT_HARNESS_ID: HarnessId = "claude-code"

/** Get the full model ID from an alias for a given harness */
export function getModelFullId(harnessId: HarnessId, alias: string): string {
    const entry = MODEL_REGISTRY[harnessId]?.models.find((m) => m.id === alias)
    return entry?.fullId ?? alias // fallback to raw alias if not found
}

/** Get the display class name for a model */
export function normalizeModelClass(modelId: string): string {
    const lower = modelId.toLowerCase()
    if (lower.includes("opus")) return "Opus"
    if (lower.includes("sonnet")) return "Sonnet"
    if (lower.includes("haiku")) return "Haiku"
    if (lower.includes("o3")) return "o3"
    if (lower.includes("o4")) return "o4-mini"
    return "Other"
}
```

Remove `USE_SAME_MODEL_FOR_AGENTS` constant — model env var injection becomes harness-specific logic in `ExecutionManager`.

**4.2 — Model fallback policy**

When the user switches harness but has a model selected from the old harness:

```typescript
/**
 * Resolve the best model for a harness.
 * If the requested model isn't available, return the harness default.
 * Never silently send an unsupported model string.
 */
export function resolveModelForHarness(harnessId: HarnessId, requestedModel?: string): string {
    const registry = MODEL_REGISTRY[harnessId]
    if (!registry) return requestedModel ?? "default"

    if (requestedModel && registry.models.some((m) => m.id === requestedModel)) {
        return requestedModel
    }

    // Requested model not available for this harness — use default
    return registry.defaultModel
}
```

**4.3 — Update `ModelPicker.tsx`**

```typescript
// Before:
import { CLAUDE_MODELS, type ClaudeModelId } from "../../constants"
interface ModelPickerProps { value: ClaudeModelId; onChange: (model: ClaudeModelId) => void }

// After:
import { MODEL_REGISTRY, type ModelEntry } from "../../constants"
import type { HarnessId } from "@openade/harness"
interface ModelPickerProps { harnessId: HarnessId; value: string; onChange: (model: string) => void }
```

The picker dynamically renders `MODEL_REGISTRY[harnessId].models`.

**4.4 — Update `InputBar.tsx`**

Replace `ClaudeModelId` props with generic `string` model + `HarnessId`.

**4.5 — Update `store/store.ts`**

```typescript
// Before:
defaultModel: ClaudeModelId

// After:
defaultModel: string
defaultHarnessId: HarnessId
```

**4.6 — Update `store/TaskModel.ts`**

`model` field becomes `string`, add `harnessId: HarnessId` to the task model.

**4.7 — Update `web/src/index.ts`**

```typescript
// Before:
export { CLAUDE_MODELS, type ClaudeModelId } from "./constants"

// After:
export { MODEL_REGISTRY, type ModelEntry, DEFAULT_HARNESS_ID } from "./constants"
```

**4.8 — Capability-driven UI gating**

Use `harness.capabilities()` (from `HarnessCapabilities` at `harness/src/types.ts:130-142`) to gate UI features instead of hardcoding `harnessId` checks:

```typescript
const caps = registry.getOrThrow(harnessId).capabilities()

// Resume button: only show if harness supports it
if (caps.supportsResume) { showResumeButton() }

// Fork session: only show if harness supports it
if (caps.supportsFork) { showForkOption() }

// Image attachments: only enable if supported
if (caps.supportsImages) { showImageUpload() }

// Cost tracking: only show if supported
if (caps.supportsCostTracking) { showCostDisplay() }

// MCP servers: only show config if supported
if (caps.supportsMcp) { showMcpConfig() }
```

Capabilities are exposed to the renderer via a new IPC call `harness:capabilities` or cached on first load.

---

### Phase 5: Message Rendering

The most complex change. `messageGroups.ts` currently parses `SDKMessage` (Claude SDK format) into renderable groups. It needs to handle multiple harness message formats.

**5.1 — Create per-harness message parsers**

```
web/src/components/events/
├── messageGroups.ts              # Generic orchestrator + group types
├── parsers/
│   ├── claudeCodeParser.ts       # Parses ClaudeEvent → MessageGroup[]
│   └── codexParser.ts            # Parses CodexEvent → MessageGroup[] (future)
```

**`claudeCodeParser.ts`:**

Extracts the same logic from current `messageGroups.ts`, but operates on `ClaudeEvent` (from `@openade/harness`) instead of `SDKMessage`:

```typescript
import type {
    ClaudeEvent,
    ClaudeAssistantEvent,
    ClaudeUserEvent,
    ClaudeResultEvent,
    ClaudeSystemInitEvent,
} from "@openade/harness"
import type { MessageGroup } from "../messageGroups"

export function groupClaudeCodeMessages(messages: ClaudeEvent[]): MessageGroup[] {
    // Same logic as current groupMessages(), but using typed ClaudeEvent
    // instead of casting SDKMessage to Record<string, unknown>

    for (const msg of messages) {
        switch (msg.type) {
            case "assistant":
                // msg is ClaudeAssistantEvent — fully typed!
                // msg.message.content is ClaudeContentBlock[]
                // No more (msg as { message?: { content?: unknown } }) casts
                break
            case "user":
                // msg is ClaudeUserEvent
                break
            case "result":
                // msg is ClaudeResultEvent — has duration_ms, total_cost_usd, usage
                break
            case "system":
                // msg is one of the system subtypes
                break
            // tool_progress, tool_use_summary, auth_status → skip or handle
        }
    }
}
```

This is actually an improvement — the current code does lots of unsafe casts on `SDKMessage` because it's an opaque type. The harness's `ClaudeEvent` union is fully typed with all 14 variants.

**5.2 — Update `messageGroups.ts` to be harness-aware**

```typescript
import type { HarnessStreamEvent, HarnessId } from "../../electronAPI/harnessEventTypes"
import { extractRawMessages } from "../../electronAPI/harnessEventTypes"
import type { ClaudeEvent } from "@openade/harness"
import { groupClaudeCodeMessages } from "./parsers/claudeCodeParser"
// import { groupCodexMessages } from "./parsers/codexParser"

// ... all group type definitions stay here (TextGroup, ToolGroup, EditGroup, etc.) ...

export function groupStreamEvents(events: HarnessStreamEvent[], harnessId: HarnessId): MessageGroup[] {
    const rawMessages = extractRawMessages(events)

    let messageGroups: MessageGroup[]
    switch (harnessId) {
        case "claude-code":
            messageGroups = groupClaudeCodeMessages(rawMessages as ClaudeEvent[])
            break
        // case "codex":
        //     messageGroups = groupCodexMessages(rawMessages as CodexEvent[])
        //     break
        default:
            messageGroups = []
    }

    // Stderr groups (harness-generic — all harnesses emit stderr the same way)
    const stderrGroups: StderrGroup[] = events
        .filter((e): e is HarnessStreamEvent & { type: "stderr"; direction: "execution" } =>
            e.direction === "execution" && e.type === "stderr")
        .map((e) => ({
            type: "stderr" as const,
            data: (e as any).data,
            eventId: e.id,
        }))

    return [...messageGroups, ...stderrGroups]
}
```

**5.3 — Update `InlineMessages.tsx`**

Pass `harnessId` through to `groupStreamEvents()`. The component's `events` prop changes from `ClaudeStreamEvent[]` to `HarnessStreamEvent[]`.

```typescript
// Before:
interface InlineMessagesProps { events: ClaudeStreamEvent[]; ... }

// After:
interface InlineMessagesProps { events: HarnessStreamEvent[]; harnessId: HarnessId; ... }
```

---

### Phase 6: Delete Old Code & Dependencies

**6.1 — Delete old files**
- `web/src/electronAPI/claudeEventTypes.ts`
- `web/src/electronAPI/claude.ts`
- `electron/src/modules/code/claude.ts`

**6.2 — Remove `@anthropic-ai/claude-agent-sdk` dependency**
- `electron/package.json`: Remove from `dependencies` (line 22)
- `electron/package.json`: Remove from `asarUnpack` (line 56)
- `web/package.json`: Remove from `devDependencies`
- Run lockfile update

**6.3 — Confirm `@openade/harness` dependency**
- `electron/package.json`: `"@openade/harness": "file:../harness"` in `dependencies`
- `web/package.json`: `"@openade/harness": "file:../harness"` in `devDependencies` (for types)
- Both `start` and `build` scripts include `build:harness` step (set up in Phase 0.3)

**6.4 — Update documentation**
- `web/src/CLAUDE.md` — update architecture, key files, IPC references
- `web/src/_docs/electron-api.md` — update IPC channel docs

**6.5 — Verify CI grep guard passes**

The grep guard from Phase 0.4 should now pass with zero matches.

---

## Execution Order & Dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
  │              │            │            │            │            │
  │  Prep +      │  New       │  Electron  │  Web       │  Model     │  Pluggable
  │  packaging   │  event     │  runtime   │  client    │  catalog   │  message
  │  + CI guard  │  types +   │  + IPC     │  layer     │  + caps    │  rendering
  │              │  tolerant  │            │            │  UI        │
  │              │  reader    │            │            │            │
  └──────────────┴────────────┴────────────┴────────────┴────────────┘
```

Phases 2-3 can be partially parallelized if types (Phase 1) are stable.
Phase 4 (model catalog) can be developed alongside Phase 3.
Phase 5 (rendering) depends on Phase 1 types but can be developed alongside Phases 3-4.
Phase 6 (cleanup) comes last.

---

## PR Sequence

```
PR1: Phase 0 + 1 — Prep, packaging, CI guard, new event types, tolerant reader
PR2: Phase 2     — Electron runtime rewrite (harness.ts, preload, capabilities, binaries)
PR3: Phase 3     — Web client layer (HarnessQueryManager, ExecutionManager, stores)
PR4: Phase 4     — Model catalog, ModelPicker, capability-driven UI
PR5: Phase 5     — Pluggable message parsers (claudeCodeParser.ts)
PR6: Phase 6     — Delete old files, remove SDK dep, docs
```

Each PR is self-contained and the app should build at each step (though it won't fully function until PR3 lands).

---

## Risk Areas

### 1. Client Tool Architecture

The biggest architectural question. Currently, tool handlers live in the renderer process (e.g., Zod schema definitions, handler functions). The harness library's `clientTools` expects handlers in the same process as `query()`.

**Mitigation:** Keep the current proxy architecture (Option A in Phase 2.4). The Electron side creates an MCP proxy server that forwards tool calls to the renderer via IPC. The harness receives this proxy as an `mcpServers` entry, not as `clientTools`.

### 2. Binary Management

The current `binaries.ts` downloads a managed `bun` binary and uses it to run the Claude SDK's `cli.js` (resolved from the asar-unpacked SDK at `binaries.ts:167-181`). The harness library resolves the `claude` binary from PATH and spawns it directly.

**Mitigation:** Either:
- Configure `ClaudeCodeHarness` with `binaryPath` pointing to our managed binary setup
- Or let the harness find `claude` on PATH (simpler, but loses the bun optimization)
- The asar unpack rule for the SDK can be deleted since the harness doesn't need unpacked JS files

### 3. SDKMessage → ClaudeEvent Mapping

`SDKMessage` (from the SDK) and `ClaudeEvent` (from the harness) represent the same CLI output but are parsed differently. The SDK returns its own wrapper types, while the harness parses raw JSONL into typed `ClaudeEvent` variants.

The message rendering code (`messageGroups.ts`) currently does lots of unsafe casts on `SDKMessage`:
```typescript
const message = msg as { message?: { content?: unknown } }
```

Moving to `ClaudeEvent` is an improvement since the harness types are fully typed with proper discriminated unions. `ClaudeAssistantEvent.message.content` is `ClaudeContentBlock[]`, not `unknown`.

**Key structural equivalence:** Both represent the same CLI JSON output. `SDKMessage` wraps content in `{ type: "assistant", message: { role, content } }`. `ClaudeEvent` has the same structure (`ClaudeAssistantEvent.message.content`). The mapping is straightforward.

### 4. Reconnection & Buffering

The current system has sophisticated reconnection support (renderer refresh → replay buffered events). This lives entirely in the IPC layer and is harness-agnostic — it should migrate cleanly since it only cares about `StreamEvent` objects, not their contents.

### 5. Cost & Token Tracking

Currently extracted from `SDKMessage` result events by the rendering layer. The harness provides this via `HarnessEvent.complete.usage` (`HarnessUsage` with `inputTokens`, `outputTokens`, `costUsd`, `durationMs`). The migration shifts extraction to the `complete` event rather than parsing result messages.

For harnesses that don't report cost (Codex may not), the `HarnessUsage.costUsd` will be `undefined`. The UI should degrade gracefully (show "—" instead of $0.00).

### 6. Persisted Data

Events are persisted in YJS stores. Existing events use the v1 `ClaudeStreamEvent` format (`type: "sdk_message"`, no `harnessId`).

**Mitigation:** The tolerant reader (Phase 1.2) normalizes v1 → v2 on read. `sdk_message` → `raw_message`, inject `harnessId: "claude-code"`. Zero-cost for new events, graceful for old ones.

### 7. Model Fallback

If a user has `model: "opus"` saved on a task and switches to Codex, "opus" is meaningless.

**Mitigation:** `resolveModelForHarness()` (Phase 4.2) maps to the harness default when the requested model isn't available. The UI should show a notice: "Switched to o3 (opus not available for Codex)."

---

## Rollback Plan

If the migration causes regressions (broken reconnect, tool calls, event streaming):

**Before Phase 6 (old code not yet deleted):** Revert the offending PR. The old `claude.ts` + SDK dependency are still in the tree from before the migration PRs.

**After Phase 6 (old code deleted):** Revert the Phase 6 PR to restore old files + SDK dependency, then revert backwards as needed. Each PR in the sequence is independently revertable.

**Monitoring signals that should trigger rollback:**
- Tool call responses not reaching the renderer (broken MCP proxy)
- Reconnect after page refresh drops events
- Cost/token tracking shows zeros for Claude executions
- Session resume/fork failures
- stderr not captured

---

## Codex Support Considerations

With the harness abstraction in place, adding full Codex support requires:

1. **No Electron changes** — the `HarnessRegistry` already has `CodexHarness` registered
2. **New message parser** — `parsers/codexParser.ts` to convert `CodexEvent` → `MessageGroup[]`
3. **UI for harness selection** — Task creation or global setting lets user pick `harnessId`
4. **Per-harness defaults** — Already handled by `MODEL_REGISTRY` and `resolveModelForHarness()`
5. **Feature gating** — Already handled by `harness.capabilities()` (e.g., hide "Resume" for harnesses where `supportsResume === false`)

The `Execution.harnessId` field on stored events supports multi-provider discrimination.

---

## Testing Strategy

1. **Unit tests** — Message parser tests per harness (`ClaudeEvent` → `MessageGroup`)
2. **Unit tests** — Tolerant reader: v1 events normalize correctly to v2
3. **Unit tests** — `resolveModelForHarness()` fallback behavior
4. **IPC round-trip tests** — Verify events serialize/deserialize correctly across IPC
5. **Integration tests** — End-to-end query execution with real CLI (existing patterns in harness library)
6. **Manual QA checklist:**
   - [ ] Start a plan execution, verify messages render correctly
   - [ ] Start a "do" execution with tool calls (Edit, Bash, Write)
   - [ ] Abort mid-execution, verify clean stop
   - [ ] Resume from a stopped execution (session fork)
   - [ ] Use client tools (if any configured)
   - [ ] Verify MCP server connections work
   - [ ] Verify cost/token tracking displays correctly
   - [ ] Refresh the page mid-execution, verify reconnection works
   - [ ] Verify title extraction still works (Haiku model)
   - [ ] Verify image attachments in prompts work
   - [ ] Open an old task with v1 events, verify they render correctly (tolerant reader)
   - [ ] Switch model to one not available for current harness, verify fallback
   - [ ] Execute with uninstalled/unauthenticated harness, verify actionable error

---

## Definition of Done

- [ ] No imports of `@anthropic-ai/claude-agent-sdk` remain in `projects/electron/src` or `projects/web/src`
- [ ] CI grep guard passes
- [ ] `openadeAPI.claude.*` fully replaced by `openadeAPI.harness.*`
- [ ] `Execution` persistence uses `harnessId` field, supports at least `"claude-code"`
- [ ] Claude flows (plan/revise/do/ask/run_plan/title generation) work via harness runtime
- [ ] Old persisted events (v1) render correctly via tolerant reader
- [ ] Model catalog is per-harness via `MODEL_REGISTRY`
- [ ] `ModelPicker` renders models for the active `harnessId`
- [ ] `resolveModelForHarness()` prevents invalid model strings reaching a harness
- [ ] Install/auth errors surface actionable messages to the user
- [ ] UI features gated by `harness.capabilities()`, not hardcoded `harnessId` checks
- [ ] Docs updated to reflect harness-driven runtime
