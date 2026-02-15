// Browser-safe subset of @openade/harness.
// This entry point re-exports only pure-data modules (types + model catalog)
// and is safe to bundle with Vite/Rollup for renderer / web contexts.
//
// IMPORTANT: Never import from harness index files (claude-code/index, codex/index)
// as those pull in Node built-ins (child_process, fs, os, etc.).

// ── Core types ──
export type {
    HarnessId,
    PromptPart,
    ImageSource,
    McpServerConfig,
    McpStdioServerConfig,
    McpHttpServerConfig,
    JsonSchema,
    ClientToolDefinition,
    ClientToolResult,
    HarnessQuery,
    HarnessEvent,
    HarnessUsage,
    HarnessErrorCode,
    HarnessMeta,
    HarnessInstallStatus,
    HarnessCapabilities,
    SlashCommand,
    ModelEntry,
    HarnessModelConfig,
} from "./types.js"

// ── Model catalog (pure data, no Node I/O) ──
export {
    MODEL_REGISTRY,
    HARNESS_META,
    DEFAULT_HARNESS_ID,
    DEFAULT_MODEL,
    getModelFullId,
    getModelsForHarness,
    getDefaultModelForHarness,
    resolveModelForHarness,
    normalizeModelClass,
} from "./models.js"
export type { HarnessMetaEntry } from "./models.js"

// ── Core interface (type-only) ──
export type { Harness } from "./harness.js"

// ── Errors (pure JS classes, no Node I/O) ──
export { HarnessError, HarnessNotInstalledError, HarnessAuthError } from "./errors.js"

// ── Claude Code config & event types (from leaf modules, NOT index.ts) ──
export type { ClaudeCodeHarnessConfig } from "./harnesses/claude-code/args.js"

export type {
    ClaudeEvent,
    ClaudeSystemInitEvent,
    ClaudeSystemStatusEvent,
    ClaudeSystemCompactBoundaryEvent,
    ClaudeSystemHookStartedEvent,
    ClaudeSystemHookProgressEvent,
    ClaudeSystemHookResponseEvent,
    ClaudeSystemTaskNotificationEvent,
    ClaudeSystemFilesPersistedEvent,
    ClaudeAssistantEvent,
    ClaudeUserEvent,
    ClaudeResultEvent,
    ClaudeToolProgressEvent,
    ClaudeToolUseSummaryEvent,
    ClaudeAuthStatusEvent,
    ClaudeContentBlock,
    ClaudeUserContentBlock,
} from "./harnesses/claude-code/types.js"

export { parseClaudeEvent } from "./harnesses/claude-code/types.js"

// ── Codex config & event types (from leaf modules, NOT index.ts) ──
export type { CodexHarnessConfig } from "./harnesses/codex/args.js"

export type {
    CodexEvent,
    CodexThreadStartedEvent,
    CodexTurnStartedEvent,
    CodexTurnCompletedEvent,
    CodexTurnFailedEvent,
    CodexItemStartedEvent,
    CodexItemCompletedEvent,
    CodexErrorEvent,
    CodexUsage,
    CodexItem,
    CodexReasoningItem,
    CodexAgentMessageItem,
    CodexCommandExecutionItem,
} from "./harnesses/codex/types.js"

export { parseCodexEvent } from "./harnesses/codex/types.js"
