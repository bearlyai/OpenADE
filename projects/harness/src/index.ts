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
} from "./types.js"

// ── Core interface ──
export type { Harness } from "./harness.js"

// ── Errors ──
export { HarnessError, HarnessNotInstalledError, HarnessAuthError } from "./errors.js"

// ── Registry ──
export { HarnessRegistry } from "./registry.js"

// ── Harnesses ──
export { ClaudeCodeHarness } from "./harnesses/claude-code/index.js"
export type { ClaudeCodeHarnessConfig, ClaudeEvent } from "./harnesses/claude-code/index.js"

export { CodexHarness } from "./harnesses/codex/index.js"
export type { CodexHarnessConfig, CodexEvent } from "./harnesses/codex/index.js"

// ── Utilities ──
export { startToolServer } from "./util/tool-server.js"
export type { ToolServerHandle, ToolServerOptions } from "./util/tool-server.js"
export { resolveExecutable } from "./util/which.js"
export { detectShellEnvironment, clearShellEnvironmentCache } from "./util/env.js"
export { spawnJsonl } from "./util/spawn.js"
export type { SpawnJsonlOptions } from "./util/spawn.js"

// ── Claude Code sub-types (for consumers that need them) ──
export type {
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

// ── Codex sub-types (for consumers that need them) ──
export type {
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
