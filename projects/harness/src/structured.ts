import type { Harness } from "./harness.js"
import { HarnessStructuredOutputError } from "./errors.js"
import type { HarnessEvent, HarnessQuery, StructuredQueryInput, StructuredQueryResult } from "./types.js"

export async function runStructuredQuery<M, T>(
    harness: Pick<Harness<M>, "id" | "query">,
    input: StructuredQueryInput<T>
): Promise<StructuredQueryResult<T, M>> {
    const query: HarnessQuery = {
        ...input,
        outputSchema: input.output.schema,
    }

    const events: HarnessEvent<M>[] = []
    const errorMessages: string[] = []
    const providerErrors: string[] = []
    let sessionId: string | undefined
    let usage: StructuredQueryResult<T, M>["usage"]
    let rawOutput: unknown

    for await (const event of harness.query(query)) {
        events.push(event)

        if (event.type === "session_started") {
            sessionId = event.sessionId
            continue
        }

        if (event.type === "complete") {
            usage = event.usage
            if (event.structuredOutput !== undefined) {
                rawOutput = event.structuredOutput
            }
            continue
        }

        if (event.type === "error") {
            errorMessages.push(event.error)
            continue
        }

        if (event.type === "message") {
            providerErrors.push(...extractProviderErrors(event.message))
        }
    }

    if (errorMessages.length > 0) {
        throw new HarnessStructuredOutputError(errorMessages.join("; "), harness.id, {
            providerErrors: providerErrors.length > 0 ? providerErrors : undefined,
        })
    }

    if (rawOutput === undefined) {
        const providerMessage = providerErrors.length > 0 ? ` Provider errors: ${providerErrors.join("; ")}` : ""
        throw new HarnessStructuredOutputError(`Query completed without structured output.${providerMessage}`, harness.id, {
            providerErrors: providerErrors.length > 0 ? providerErrors : undefined,
        })
    }

    let output: T
    if (input.output.parse) {
        try {
            output = input.output.parse(rawOutput)
        } catch (cause) {
            throw new HarnessStructuredOutputError("Structured output parser rejected the payload", harness.id, {
                cause: asError(cause),
                rawOutput,
            })
        }
    } else {
        output = rawOutput as T
    }

    return {
        output,
        sessionId,
        usage,
        events,
    }
}

function extractProviderErrors(message: unknown): string[] {
    if (!message || typeof message !== "object") return []
    const msg = message as Record<string, unknown>

    if (msg.type === "result" && msg.is_error === true) {
        const errors = msg.errors
        if (Array.isArray(errors)) {
            return errors.filter((e): e is string => typeof e === "string")
        }
        if (typeof msg.result === "string" && msg.result.trim().length > 0) {
            return [msg.result]
        }
    }

    return []
}

function asError(cause: unknown): Error {
    if (cause instanceof Error) return cause
    return new Error(String(cause))
}
