export interface TelemetryEvent {
    name: string
    properties: Record<string, unknown>
    sourceIndex: number
}

export interface RolloutReviewFailure {
    code: string
    message: string
    eventName?: string
    sourceIndex?: number
}

export interface RolloutReviewSummary {
    totalEvents: number
    appOpenedEvents: number
    readyDefaultOnAppOpenedEvents: number
    fallbackEvents: number
    errorEvents: number
    hygieneViolations: number
}

export interface RolloutReviewResult {
    passed: boolean
    summary: RolloutReviewSummary
    failures: RolloutReviewFailure[]
}

const APP_OPENED_EVENT = "app_opened"
const FALLBACK_EVENT = "runtime_product_store_fallback"
const ERROR_EVENT = "runtime_product_store_error"

const APP_OPENED_ALLOWED_KEYS = new Set([
    "deviceIdSource",
    "deviceConfigWasGenerated",
    "deviceConfigReadFailed",
    "runtimeProductStoreEnabled",
    "runtimeProductStoreStatus",
    "runtimeProductStoreHasSnapshot",
])

const RUNTIME_PRODUCT_ALLOWED_KEYS = new Set([
    "source",
    "reason",
    "enabled",
    "status",
    "hasSnapshot",
    "repoCount",
    "taskPreviewCount",
    "cachedTaskCount",
    "errorKind",
])

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | null {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === "string" && value.trim().length > 0) return value
    }
    return null
}

function propertiesField(record: Record<string, unknown>): Record<string, unknown> {
    const candidate = record.properties ?? record.event_properties ?? record.eventProperties
    return isRecord(candidate) ? candidate : {}
}

function normalizeTelemetryEvent(value: unknown, sourceIndex: number): TelemetryEvent {
    if (!isRecord(value)) throw new Error(`Telemetry event ${sourceIndex + 1} is not an object`)

    const name = stringField(value, ["event", "eventName", "event_type", "name"])
    if (!name) throw new Error(`Telemetry event ${sourceIndex + 1} is missing an event name`)

    return {
        name,
        properties: propertiesField(value),
        sourceIndex,
    }
}

function parseJsonDocument(raw: string): unknown | null {
    try {
        return JSON.parse(raw) as unknown
    } catch {
        return null
    }
}

function parseJsonTelemetryEvents(document: unknown): TelemetryEvent[] | null {
    if (Array.isArray(document)) {
        return document.map((event, index) => normalizeTelemetryEvent(event, index))
    }

    if (!isRecord(document)) return null

    if (Array.isArray(document.events)) {
        return document.events.map((event, index) => normalizeTelemetryEvent(event, index))
    }

    return [normalizeTelemetryEvent(document, 0)]
}

function parseNdjsonTelemetryEvents(raw: string): TelemetryEvent[] {
    const events: TelemetryEvent[] = []
    const lines = raw.split(/\r?\n/)
    for (const [lineIndex, line] of lines.entries()) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
            events.push(normalizeTelemetryEvent(JSON.parse(trimmed) as unknown, lineIndex))
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`Invalid telemetry JSON on line ${lineIndex + 1}: ${message}`)
        }
    }
    return events
}

export function parseTelemetryEvents(raw: string): TelemetryEvent[] {
    const trimmed = raw.trim()
    if (!trimmed) return []

    const document = parseJsonDocument(trimmed)
    const jsonEvents = document === null ? null : parseJsonTelemetryEvents(document)
    return jsonEvents ?? parseNdjsonTelemetryEvents(trimmed)
}

function allowedKeysForEvent(name: string): Set<string> | null {
    if (name === APP_OPENED_EVENT) return APP_OPENED_ALLOWED_KEYS
    if (name === FALLBACK_EVENT || name === ERROR_EVENT) return RUNTIME_PRODUCT_ALLOWED_KEYS
    return null
}

function addFailure(failures: RolloutReviewFailure[], event: TelemetryEvent, code: string, message: string): void {
    failures.push({
        code,
        message,
        eventName: event.name,
        sourceIndex: event.sourceIndex,
    })
}

function validatePropertyHygiene(event: TelemetryEvent, failures: RolloutReviewFailure[]): number {
    const allowedKeys = allowedKeysForEvent(event.name)
    if (!allowedKeys) return 0

    const extraKeys = Object.keys(event.properties).filter((key) => !allowedKeys.has(key))
    if (extraKeys.length === 0) return 0

    addFailure(failures, event, "event_property_hygiene", `${event.name} contains non-rollout properties: ${extraKeys.sort().join(", ")}`)
    return 1
}

function isReadyDefaultOnAppOpened(event: TelemetryEvent): boolean {
    const properties = event.properties
    return (
        event.name === APP_OPENED_EVENT &&
        properties.runtimeProductStoreEnabled === true &&
        properties.runtimeProductStoreStatus === "ready" &&
        properties.runtimeProductStoreHasSnapshot === true
    )
}

function validateAppOpened(event: TelemetryEvent, failures: RolloutReviewFailure[]): void {
    if (event.name !== APP_OPENED_EVENT) return

    const properties = event.properties
    if (properties.runtimeProductStoreEnabled !== true) {
        addFailure(failures, event, "runtime_product_store_not_enabled", "app_opened did not report runtime product store enabled")
    }
    if (properties.runtimeProductStoreStatus !== "ready") {
        addFailure(failures, event, "runtime_product_store_not_ready", "app_opened did not report a ready runtime product store")
    }
    if (properties.runtimeProductStoreHasSnapshot !== true) {
        addFailure(failures, event, "runtime_product_store_missing_snapshot", "app_opened did not report a runtime product snapshot")
    }
}

export function reviewRuntimeProductRollout(events: readonly TelemetryEvent[]): RolloutReviewResult {
    const failures: RolloutReviewFailure[] = []
    let appOpenedEvents = 0
    let readyDefaultOnAppOpenedEvents = 0
    let fallbackEvents = 0
    let errorEvents = 0
    let hygieneViolations = 0

    for (const event of events) {
        hygieneViolations += validatePropertyHygiene(event, failures)

        if (event.name === APP_OPENED_EVENT) {
            appOpenedEvents += 1
            if (isReadyDefaultOnAppOpened(event)) readyDefaultOnAppOpenedEvents += 1
            validateAppOpened(event, failures)
            continue
        }

        if (event.name === FALLBACK_EVENT) {
            fallbackEvents += 1
            addFailure(failures, event, "runtime_product_store_fallback", "runtime product store fallback event blocks broad rollout")
            continue
        }

        if (event.name === ERROR_EVENT) {
            errorEvents += 1
            addFailure(failures, event, "runtime_product_store_error", "runtime product store error event blocks broad rollout")
        }
    }

    if (appOpenedEvents === 0) {
        failures.push({
            code: "missing_app_opened",
            message: "telemetry export does not contain app_opened events for the default-on cohort",
        })
    } else if (readyDefaultOnAppOpenedEvents === 0) {
        failures.push({
            code: "missing_ready_default_on_app_opened",
            message: "telemetry export does not contain a ready default-on app_opened event with a runtime snapshot",
        })
    }

    const summary: RolloutReviewSummary = {
        totalEvents: events.length,
        appOpenedEvents,
        readyDefaultOnAppOpenedEvents,
        fallbackEvents,
        errorEvents,
        hygieneViolations,
    }

    return {
        passed: failures.length === 0,
        summary,
        failures,
    }
}

export function formatRuntimeProductRolloutReview(result: RolloutReviewResult): string {
    const lines = [
        `Runtime product rollout review: ${result.passed ? "PASS" : "FAIL"}`,
        `Events: ${result.summary.totalEvents} total, ${result.summary.appOpenedEvents} app_opened, ${result.summary.fallbackEvents} fallback, ${result.summary.errorEvents} error`,
        `Ready default-on app_opened events: ${result.summary.readyDefaultOnAppOpenedEvents}`,
        `Property hygiene violations: ${result.summary.hygieneViolations}`,
    ]

    if (result.failures.length > 0) {
        lines.push("Failures:")
        for (const failure of result.failures) {
            const event = failure.eventName ? ` ${failure.eventName}` : ""
            const location = failure.sourceIndex === undefined ? "" : ` #${failure.sourceIndex + 1}`
            lines.push(`- [${failure.code}]${event}${location}: ${failure.message}`)
        }
    }

    return lines.join("\n")
}
