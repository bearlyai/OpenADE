import type { RuntimeValidationResult } from "../../runtime-protocol/src"

type ParamCheck = (record: Record<string, unknown>) => RuntimeValidationResult<unknown> | null

function paramsError(path: string, message: string): RuntimeValidationResult<never> {
    return { ok: false, error: { code: "invalid_params", message, path } }
}

export function validateRecordParams(params: unknown): RuntimeValidationResult<Record<string, unknown>> {
    if (params === undefined) return { ok: true, value: {} }
    if (typeof params !== "object" || params === null || Array.isArray(params)) return paramsError("$", "Runtime params must be an object")
    return { ok: true, value: params as Record<string, unknown> }
}

export function validateParams(...checks: ParamCheck[]) {
    return (params: unknown): RuntimeValidationResult<unknown> => {
        const record = validateRecordParams(params)
        if (!record.ok) return record
        for (const check of checks) {
            const result = check(record.value)
            if (result && !result.ok) return result
        }
        return { ok: true, value: params ?? {} }
    }
}

export function requiredString(key: string, options: { allowEmpty?: boolean } = {}): ParamCheck {
    return (record) => {
        const value = record[key]
        if (typeof value !== "string" || (!options.allowEmpty && value.length < 1)) {
            return paramsError(`$.${key}`, `${key} must be ${options.allowEmpty ? "a string" : "a non-empty string"}`)
        }
        return null
    }
}

export function optionalString(key: string): ParamCheck {
    return (record) => {
        const value = record[key]
        if (value !== undefined && typeof value !== "string") return paramsError(`$.${key}`, `${key} must be a string`)
        return null
    }
}

export function optionalStringEnum(key: string, values: readonly string[]): ParamCheck {
    return (record) => {
        const value = record[key]
        if (value === undefined) return null
        if (typeof value !== "string" || !values.includes(value)) return paramsError(`$.${key}`, `${key} must be one of: ${values.join(", ")}`)
        return null
    }
}

export function optionalBoolean(key: string): ParamCheck {
    return (record) => {
        const value = record[key]
        if (value !== undefined && typeof value !== "boolean") return paramsError(`$.${key}`, `${key} must be a boolean`)
        return null
    }
}

export function optionalFiniteNumber(key: string): ParamCheck {
    return (record) => {
        const value = record[key]
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) return paramsError(`$.${key}`, `${key} must be a finite number`)
        return null
    }
}

export function requiredPositiveInteger(key: string): ParamCheck {
    return (record) => {
        const value = record[key]
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return paramsError(`$.${key}`, `${key} must be a positive integer`)
        return null
    }
}

export function optionalPositiveInteger(key: string): ParamCheck {
    return (record) => {
        const value = record[key]
        if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 1)) {
            return paramsError(`$.${key}`, `${key} must be a positive integer`)
        }
        return null
    }
}

export function optionalStringArray(key: string): ParamCheck {
    return (record) => {
        const value = record[key]
        if (value === undefined) return null
        if (!Array.isArray(value)) return paramsError(`$.${key}`, `${key} must be an array`)
        for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== "string") return paramsError(`$.${key}[${i}]`, `${key} entries must be strings`)
        }
        return null
    }
}

export function optionalStringRecord(key: string): ParamCheck {
    return (record) => {
        const value = record[key]
        if (value === undefined) return null
        if (typeof value !== "object" || value === null || Array.isArray(value)) return paramsError(`$.${key}`, `${key} must be an object`)
        for (const [entryKey, entryValue] of Object.entries(value)) {
            if (typeof entryValue !== "string") return paramsError(`$.${key}.${entryKey}`, `${key} values must be strings`)
        }
        return null
    }
}
