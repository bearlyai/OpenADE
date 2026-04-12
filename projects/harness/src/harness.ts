import type {
    HarnessId,
    HarnessMeta,
    HarnessCapabilities,
    HarnessModelConfig,
    HarnessInstallStatus,
    SlashCommand,
    HarnessQuery,
    HarnessEvent,
    StructuredQueryInput,
    StructuredQueryResult,
    SessionMeta,
    ListSessionsOptions,
    GetSessionEventsOptions,
    WriteSessionEventsOptions,
    DeleteSessionOptions,
} from "./types.js"

export interface Harness<M = unknown> {
    readonly id: HarnessId

    // ── Discovery (sync, cheap, no I/O) ──
    meta(): HarnessMeta
    capabilities(): HarnessCapabilities
    models(): HarnessModelConfig

    // ── Status (async, may shell out) ──
    checkInstallStatus(): Promise<HarnessInstallStatus>

    // ── Probing (async, may run the CLI briefly) ──
    discoverSlashCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]>

    // ── Execution ──
    query(q: HarnessQuery): AsyncGenerator<HarnessEvent<M>>
    structuredQuery<T = unknown>(q: StructuredQueryInput<T>): Promise<StructuredQueryResult<T, M>>

    // ── Session management (async, reads/writes disk) ──
    listSessions(options?: ListSessionsOptions): Promise<SessionMeta[]>
    getSessionEvents(sessionId: string, options?: GetSessionEventsOptions): Promise<HarnessEvent<M>[] | null>
    writeSessionEvents(sessionId: string, events: HarnessEvent<M>[], options: WriteSessionEventsOptions): Promise<void>
    deleteSession(sessionId: string, options?: DeleteSessionOptions): Promise<boolean>
    isSessionActive(sessionId: string): Promise<boolean>
}
