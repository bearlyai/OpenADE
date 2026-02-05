import { type Patch, enablePatches, produce } from "immer"
import * as Y from "yjs"

import type { AnyJSON, JSONObject, JSONPrimitive, JsonArray } from "./json"

type AnyYAbstractType = Y.AbstractType<any>

enablePatches()

type DropReporter = (path: string, value: unknown) => void

const DROP = Symbol("drop")

const reportDrop: DropReporter = (path, value) => {
    console.error(`[y-utils] Dropping unsupported value at ${path}`, value)
}

const ROOT_PATH = "__root"

const isJsonPrimitive = (value: unknown): value is string | number | boolean | null | undefined => {
    if (value === null || value === undefined) {
        return true
    }

    const valueType = typeof value
    if (valueType === "string" || valueType === "boolean") {
        return true
    }

    if (valueType === "number") {
        return Number.isFinite(value)
    }

    return false
}

const isPlainObject = (value: unknown): value is JSONObject => {
    if (value === null || typeof value !== "object") {
        return false
    }

    if (Array.isArray(value)) {
        return false
    }

    if (value instanceof Y.AbstractType) {
        return false
    }

    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

const pathWithKey = (base: string, key: string) => {
    return base ? `${base}.${key}` : key
}

const pathWithIndex = (base: string, index: number) => {
    return `${base}[${index}]`
}

const buildYMapFromObject = (obj: JSONObject, path: string, onDrop: DropReporter): Y.Map<any> => {
    const yMap = new Y.Map<any>()

    for (const [key, value] of Object.entries(obj)) {
        const nextPath = pathWithKey(path, key)
        const converted = convertValueForInsert(value, nextPath, onDrop)
        if (converted !== DROP) {
            yMap.set(key, converted)
        }
    }

    return yMap
}

const buildYArrayFromValues = (values: AnyJSON[], path: string, onDrop: DropReporter): Y.Array<any> => {
    const yArray = new Y.Array<any>()

    for (let index = 0; index < values.length; index += 1) {
        const nextPath = pathWithIndex(path, index)
        const converted = convertValueForInsert(values[index], nextPath, onDrop)
        if (converted !== DROP) {
            yArray.push([converted])
        }
    }

    return yArray
}

const convertValueForInsert = (value: unknown, path: string, onDrop: DropReporter): unknown => {
    if (value instanceof Y.AbstractType) {
        return value
    }

    if (isJsonPrimitive(value)) {
        return value
    }

    if (Array.isArray(value)) {
        return buildYArrayFromValues(value as AnyJSON[], path, onDrop)
    }

    if (isPlainObject(value)) {
        return buildYMapFromObject(value as JSONObject, path, onDrop)
    }

    onDrop(path, value)
    return DROP
}

const normalizeExistingYStructure = (value: AnyYAbstractType, path: string, onDrop: DropReporter): void => {
    if (value instanceof Y.Map) {
        for (const key of Array.from(value.keys())) {
            const nextPath = pathWithKey(path, key)
            const nested = value.get(key)
            const normalized = ensureYStructure(nested, nextPath, onDrop)
            if (normalized === DROP) {
                value.delete(key)
                continue
            }
            if (!Object.is(nested, normalized)) {
                value.set(key, normalized)
            }
        }
        return
    }

    if (value instanceof Y.Array) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
            const nextPath = pathWithIndex(path, index)
            const nested = value.get(index)
            const normalized = ensureYStructure(nested, nextPath, onDrop)
            if (normalized === DROP) {
                value.delete(index, 1)
                continue
            }
            if (Object.is(nested, normalized)) {
                continue
            }
            value.delete(index, 1)
            value.insert(index, [normalized])
        }
    }
}

const ensureYStructure = (value: unknown, path: string, onDrop: DropReporter): AnyJSON | AnyYAbstractType | typeof DROP => {
    if (value instanceof Y.AbstractType) {
        const typedValue = value as AnyYAbstractType
        normalizeExistingYStructure(typedValue, path, onDrop)
        return typedValue
    }

    return convertValueForInsert(value, path, onDrop) as AnyJSON | AnyYAbstractType | typeof DROP
}

const convertFromYValue = (value: unknown, path: string, onDrop: DropReporter): AnyJSON | typeof DROP => {
    if (value instanceof Y.Map) {
        const result: JSONObject = {}
        value.forEach((mapValue, mapKey) => {
            const nextPath = pathWithKey(path, mapKey)
            const converted = convertFromYValue(mapValue, nextPath, onDrop)
            if (converted !== DROP) {
                result[mapKey] = converted
            }
        })
        return result
    }

    if (value instanceof Y.Array) {
        const arrayValues = value.toArray()
        const result: AnyJSON[] = []
        for (let index = 0; index < arrayValues.length; index += 1) {
            const nextPath = pathWithIndex(path, index)
            const converted = convertFromYValue(arrayValues[index], nextPath, onDrop)
            if (converted !== DROP) {
                result.push(converted)
            }
        }
        return result
    }

    if (value instanceof Y.AbstractType) {
        onDrop(path, value)
        return DROP
    }

    if (isJsonPrimitive(value)) {
        return value
    }

    if (Array.isArray(value)) {
        const result: AnyJSON[] = []
        for (let index = 0; index < value.length; index += 1) {
            const nextPath = pathWithIndex(path, index)
            const converted = convertFromYValue(value[index], nextPath, onDrop)
            if (converted !== DROP) {
                result.push(converted)
            }
        }
        return result
    }

    if (isPlainObject(value)) {
        const result: JSONObject = {}
        for (const [key, nested] of Object.entries(value)) {
            const nextPath = pathWithKey(path, key)
            const converted = convertFromYValue(nested, nextPath, onDrop)
            if (converted !== DROP) {
                result[key] = converted
            }
        }
        return result
    }

    onDrop(path, value)
    return DROP
}

type PlainConversionResult = {
    value: AnyJSON | typeof DROP
    changed: boolean
}

const convertValueToPlain = (value: unknown, path: string, onDrop: DropReporter): PlainConversionResult => {
    if (value instanceof Y.Map || value instanceof Y.Array) {
        const converted = convertFromYValue(value, path, onDrop)
        return {
            value: converted,
            changed: true,
        }
    }

    if (value instanceof Y.AbstractType) {
        const converted = convertFromYValue(value, path, onDrop)
        return {
            value: converted,
            changed: true,
        }
    }

    if (isJsonPrimitive(value)) {
        return {
            value: value as JSONPrimitive,
            changed: false,
        }
    }

    if (Array.isArray(value)) {
        const original = value as AnyJSON[]
        let changed = false
        const result: AnyJSON[] = []

        for (let index = 0; index < original.length; index += 1) {
            const nextPath = pathWithIndex(path, index)
            const child = convertValueToPlain(original[index], nextPath, onDrop)
            if (child.value === DROP) {
                changed = true
                continue
            }
            if (child.changed) {
                changed = true
            } else if (!Object.is(child.value, original[index])) {
                changed = true
            }
            result.push(child.value)
        }

        if (!changed && result.length === original.length) {
            return { value: original, changed: false }
        }

        return {
            value: result,
            changed: true,
        }
    }

    if (isPlainObject(value)) {
        const original = value as JSONObject
        let changed = false
        const result: JSONObject = {}

        for (const [key, nested] of Object.entries(original)) {
            const nextPath = pathWithKey(path, key)
            const child = convertValueToPlain(nested, nextPath, onDrop)
            if (child.value === DROP) {
                changed = true
                continue
            }
            result[key] = child.value as AnyJSON
            if (child.changed) {
                changed = true
            } else if (!Object.is(child.value, nested)) {
                changed = true
            }
        }

        if (!changed && Object.keys(result).length === Object.keys(original).length) {
            return { value: original, changed: false }
        }

        return {
            value: result,
            changed: true,
        }
    }

    onDrop(path, value)
    return {
        value: DROP,
        changed: true,
    }
}

const syncYArray = (target: Y.Array<any>, values: AnyJSON[], path: string, onDrop: DropReporter) => {
    const converted: unknown[] = []
    for (let index = 0; index < values.length; index += 1) {
        const nextPath = pathWithIndex(path, index)
        const nextValue = convertValueForInsert(values[index], nextPath, onDrop)
        if (nextValue !== DROP) {
            converted.push(nextValue)
        }
    }

    if (target.length > 0) {
        target.delete(0, target.length)
    }

    if (converted.length > 0) {
        target.insert(0, converted)
    }
}

const applyValueToYMap = (map: Y.Map<any>, key: string, value: AnyJSON, path: string, onDrop: DropReporter) => {
    const existing = map.get(key)

    if (value instanceof Y.AbstractType) {
        if (existing !== value) {
            map.set(key, value)
        }
        return
    }

    if (isJsonPrimitive(value)) {
        if (!map.has(key) || !Object.is(existing, value)) {
            map.set(key, value)
        }
        return
    }

    if (Array.isArray(value)) {
        if (existing instanceof Y.Array) {
            syncYArray(existing, value, path, onDrop)
        } else {
            const yArray = buildYArrayFromValues(value, path, onDrop)
            map.set(key, yArray)
        }
        return
    }

    if (isPlainObject(value)) {
        if (existing instanceof Y.Map) {
            syncYMapWithObject(existing, value as JSONObject, path, onDrop)
        } else {
            const yMap = buildYMapFromObject(value as JSONObject, path, onDrop)
            map.set(key, yMap)
        }
        return
    }

    const converted = convertValueForInsert(value, path, onDrop)
    if (converted !== DROP) {
        map.set(key, converted)
    } else if (map.has(key)) {
        map.delete(key)
    }
}

const insertValueIntoYArray = (array: Y.Array<any>, index: number, value: AnyJSON, path: string, onDrop: DropReporter) => {
    const converted = convertValueForInsert(value, path, onDrop)
    if (converted !== DROP) {
        array.insert(index, [converted])
    }
}

const replaceValueInYArray = (array: Y.Array<any>, index: number, value: AnyJSON, path: string, onDrop: DropReporter) => {
    const existing = index < array.length ? array.get(index) : undefined

    if (value instanceof Y.AbstractType) {
        if (existing !== value) {
            if (index < array.length) {
                array.delete(index, 1)
            }
            array.insert(index, [value])
        }
        return
    }

    if (isJsonPrimitive(value)) {
        if (index < array.length && Object.is(existing, value)) {
            return
        }
        if (index < array.length) {
            array.delete(index, 1)
        }
        array.insert(index, [value])
        return
    }

    if (Array.isArray(value)) {
        if (existing instanceof Y.Array) {
            syncYArray(existing, value, path, onDrop)
        } else {
            const yArray = buildYArrayFromValues(value, path, onDrop)
            if (index < array.length) {
                array.delete(index, 1)
            }
            array.insert(index, [yArray])
        }
        return
    }

    if (isPlainObject(value)) {
        if (existing instanceof Y.Map) {
            syncYMapWithObject(existing, value as JSONObject, path, onDrop)
        } else {
            const yMap = buildYMapFromObject(value as JSONObject, path, onDrop)
            if (index < array.length) {
                array.delete(index, 1)
            }
            array.insert(index, [yMap])
        }
        return
    }

    const converted = convertValueForInsert(value, path, onDrop)
    if (converted !== DROP) {
        if (index < array.length) {
            array.delete(index, 1)
        }
        array.insert(index, [converted])
    } else if (index < array.length) {
        array.delete(index, 1)
    }
}

const syncYMapWithObject = (map: Y.Map<any>, value: JSONObject, path: string, onDrop: DropReporter) => {
    const nextKeys = new Set(Object.keys(value))
    for (const key of Array.from(map.keys())) {
        if (!nextKeys.has(key)) {
            map.delete(key)
        }
    }

    for (const [key, nested] of Object.entries(value)) {
        const nextPath = pathWithKey(path, key)
        applyValueToYMap(map, key, nested, nextPath, onDrop)
    }
}

type YValue = AnyYAbstractType | AnyJSON
type YContainer = Y.Map<YValue> | Y.Array<YValue>

type ContainerResolution = {
    container: YContainer
    parentPath: string
    key: string | number
} | null

const resolveContainerForPatch = (root: Y.Map<YValue>, path: Array<string | number>, onDrop: DropReporter): ContainerResolution => {
    if (path.length === 0) {
        return null
    }

    let container: YContainer = root
    let currentPath = ROOT_PATH

    for (let index = 0; index < path.length - 1; index += 1) {
        const segment = path[index]

        if (container instanceof Y.Map) {
            if (typeof segment !== "string") {
                return null
            }

            const nextPath = pathWithKey(currentPath, segment)
            const nextValue = container.get(segment)

            if (nextValue instanceof Y.Map || nextValue instanceof Y.Array) {
                container = nextValue
                currentPath = nextPath
                continue
            }

            if (Array.isArray(nextValue)) {
                const yArray = buildYArrayFromValues(nextValue as AnyJSON[], nextPath, onDrop)
                container.set(segment, yArray)
                container = yArray
                currentPath = nextPath
                continue
            }

            if (isPlainObject(nextValue)) {
                const yMap = buildYMapFromObject(nextValue as JSONObject, nextPath, onDrop)
                container.set(segment, yMap)
                container = yMap
                currentPath = nextPath
                continue
            }

            if (nextValue === undefined) {
                return null
            }

            return null
        }

        if (container instanceof Y.Array) {
            if (typeof segment !== "number") {
                return null
            }

            const nextPath = pathWithIndex(currentPath, segment)
            const nextValue: YValue | undefined = container.get(segment)

            if (nextValue instanceof Y.Map || nextValue instanceof Y.Array) {
                container = nextValue
                currentPath = nextPath
                continue
            }

            if (Array.isArray(nextValue)) {
                const yArray = buildYArrayFromValues(nextValue as AnyJSON[], nextPath, onDrop)
                container.delete(segment, 1)
                container.insert(segment, [yArray])
                container = yArray
                currentPath = nextPath
                continue
            }

            if (isPlainObject(nextValue)) {
                const yMap = buildYMapFromObject(nextValue as JSONObject, nextPath, onDrop)
                container.delete(segment, 1)
                container.insert(segment, [yMap])
                container = yMap
                currentPath = nextPath
                continue
            }

            if (nextValue === undefined) {
                return null
            }

            return null
        }

        return null
    }

    return {
        container,
        parentPath: currentPath,
        key: path[path.length - 1] as string | number,
    }
}

const applyPatchToYMap = (root: Y.Map<any>, patch: Patch, onDrop: DropReporter): boolean => {
    if (patch.path.length === 0) {
        return false
    }

    const resolved = resolveContainerForPatch(root, patch.path, onDrop)
    if (!resolved) {
        return false
    }

    const { container, key, parentPath } = resolved
    const fullPath = typeof key === "number" ? pathWithIndex(parentPath, key) : pathWithKey(parentPath, key)

    if (container instanceof Y.Map) {
        if (typeof key !== "string") {
            return false
        }

        if (patch.op === "remove") {
            container.delete(key)
            return true
        }

        if (patch.op === "add" || patch.op === "replace") {
            applyValueToYMap(container, key, patch.value as AnyJSON, fullPath, onDrop)
            return true
        }

        return false
    }

    if (container instanceof Y.Array) {
        if (typeof key !== "number") {
            return false
        }

        if (patch.op === "remove") {
            if (key < container.length) {
                container.delete(key, 1)
            }
            return true
        }

        if (patch.op === "add") {
            insertValueIntoYArray(container, key, patch.value as AnyJSON, fullPath, onDrop)
            return true
        }

        if (patch.op === "replace") {
            replaceValueInYArray(container, key, patch.value as AnyJSON, fullPath, onDrop)
            return true
        }

        return false
    }

    return false
}

export function asYObject<T extends AnyJSON>(thing: AnyYAbstractType | T): AnyYAbstractType | T
export function asYObject(thing: unknown): AnyYAbstractType | AnyJSON | undefined
export function asYObject(thing: unknown): AnyYAbstractType | AnyJSON | undefined {
    const converted = ensureYStructure(thing, ROOT_PATH, reportDrop)
    if (converted === DROP) {
        return undefined
    }
    return converted
}

export function asJavascriptObject<T extends AnyJSON>(thing: AnyYAbstractType | T): T
export function asJavascriptObject<T extends AnyJSON>(thing: unknown): T
export function asJavascriptObject<T extends AnyJSON>(thing: unknown): T {
    const result = convertValueToPlain(thing, ROOT_PATH, reportDrop)
    if (result.value === DROP) {
        return undefined as T
    }
    return result.value as T
}

export function mutate<T extends JSONObject>(target: Y.Map<any>, updater: (draft: T) => void): void
export function mutate<T extends JsonArray>(target: Y.Array<any>, updater: (draft: T) => void): void
export function mutate(target: Y.Map<any> | Y.Array<any>, updater: (draft: JSONObject | JsonArray) => void): void
export function mutate(target: Y.Map<any> | Y.Array<any>, updater: (draft: JSONObject | JsonArray) => void): void {
    const patches: Patch[] = []

    if (target instanceof Y.Array) {
        const current = (asJavascriptObject<JsonArray>(target) ?? []) as JsonArray
        const next = produce(current, updater as (draft: JsonArray) => void, (generatedPatches) => {
            patches.push(...generatedPatches)
        })

        if (patches.length === 0) {
            return
        }

        if (!Array.isArray(next)) {
            reportDrop(ROOT_PATH, next)
            return
        }

        const applyChanges = () => {
            syncYArray(target, next as JsonArray, ROOT_PATH, reportDrop)
        }

        const doc = target.doc
        if (doc) {
            doc.transact(applyChanges)
        } else {
            applyChanges()
        }
        return
    }

    const current = (asJavascriptObject<JSONObject>(target) ?? {}) as JSONObject
    const next = produce(current, updater as (draft: JSONObject) => void, (generatedPatches) => {
        patches.push(...generatedPatches)
    })

    if (patches.length === 0) {
        return
    }

    if (!isPlainObject(next)) {
        reportDrop(ROOT_PATH, next)
        return
    }

    const applyChanges = () => {
        if (patches.some((patch) => patch.path.length === 0)) {
            syncYMapWithObject(target, next as JSONObject, ROOT_PATH, reportDrop)
            return
        }

        for (const patch of patches) {
            const applied = applyPatchToYMap(target, patch, reportDrop)
            if (!applied) {
                syncYMapWithObject(target, next as JSONObject, ROOT_PATH, reportDrop)
                return
            }
        }
    }

    const doc = target.doc
    if (doc) {
        doc.transact(applyChanges)
    } else {
        applyChanges()
    }
}
