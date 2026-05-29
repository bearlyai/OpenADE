export const REMOTE_TASK_REFRESH_MIN_INTERVAL_MS = 900

export function nextRemoteRefreshDelay(params: { now: number; lastRefreshAt: number; requestedDelayMs: number; minIntervalMs?: number }): number {
    const minIntervalMs = params.minIntervalMs ?? REMOTE_TASK_REFRESH_MIN_INTERVAL_MS
    if (params.lastRefreshAt <= 0) return params.requestedDelayMs
    return Math.max(params.requestedDelayMs, minIntervalMs - (params.now - params.lastRefreshAt))
}
