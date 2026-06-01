#!/usr/bin/env node
import { readFileSync } from "node:fs"
import {
    formatRuntimeProductRolloutReview,
    parseTelemetryEvents,
    reviewRuntimeProductRollout,
} from "../src/analytics/runtimeProductRolloutReview.ts"

const telemetryPath = process.argv[2]

if (!telemetryPath) {
    console.error("Usage: npm run review:runtime-product-rollout -- <telemetry-export.json-or-ndjson>")
    process.exitCode = 2
} else {
    try {
        const rawTelemetry = readFileSync(telemetryPath, "utf8")
        const events = parseTelemetryEvents(rawTelemetry)
        const result = reviewRuntimeProductRollout(events)
        console.log(formatRuntimeProductRolloutReview(result))
        process.exitCode = result.passed ? 0 : 1
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`Runtime product rollout review failed to read telemetry: ${message}`)
        process.exitCode = 2
    }
}
