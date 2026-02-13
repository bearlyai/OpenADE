import type { HarnessId, HarnessMeta, HarnessCapabilities, HarnessInstallStatus, SlashCommand, HarnessQuery, HarnessEvent } from "./types.js"

export interface Harness<M = unknown> {
    readonly id: HarnessId

    // ── Discovery (sync, cheap, no I/O) ──
    meta(): HarnessMeta
    capabilities(): HarnessCapabilities

    // ── Status (async, may shell out) ──
    checkInstallStatus(): Promise<HarnessInstallStatus>

    // ── Probing (async, may run the CLI briefly) ──
    discoverSlashCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]>

    // ── Execution ──
    query(q: HarnessQuery): AsyncGenerator<HarnessEvent<M>>
}
