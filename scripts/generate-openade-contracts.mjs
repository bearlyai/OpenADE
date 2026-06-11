#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname)
const CONTRACT_SOURCE = path.join(REPO_ROOT, "projects", "openade-client", "openade-contracts.json")
const GENERATED_TARGET = path.join(REPO_ROOT, "projects", "openade-client", "src", "generated", "openade-contracts.ts")
const CLIENT_SOURCE = path.join(REPO_ROOT, "projects", "openade-client", "src", "index.ts")
const CORE_PRODUCT_SOURCE = path.join(REPO_ROOT, "projects", "openade-core", "internal", "product", "product.go")
const CORE_INTERNAL_ROOT = path.join(REPO_ROOT, "projects", "openade-core", "internal")
const RUNTIME_SRC_ROOT = path.join(REPO_ROOT, "projects", "runtime", "src")
const MODULE_SRC_ROOT = path.join(REPO_ROOT, "projects", "openade-module", "src")
const MODULE_SOURCE = path.join(REPO_ROOT, "projects", "openade-module", "src", "module.ts")
const MODULE_TYPES_SOURCE = path.join(REPO_ROOT, "projects", "openade-module", "src", "types.ts")
const OPENADE_MODULE_TYPES_IMPORT = "../../../openade-module/src/types"
const BUILTIN_TYPE_NAMES = new Set(["Array", "Date", "Exclude", "Extract", "NonNullable", "Omit", "Partial", "Pick", "Promise", "Readonly", "Record", "Required"])

const checkOnly = process.argv.includes("--check")
const source = readContractSource()
validateContractSource(source)
const generated = renderGeneratedContracts(source)

if (checkOnly) {
    const existing = fs.existsSync(GENERATED_TARGET) ? fs.readFileSync(GENERATED_TARGET, "utf8") : ""
    if (existing !== generated) {
        console.error(`${path.relative(REPO_ROOT, GENERATED_TARGET)} is out of date. Run npm run generate:contracts in projects/openade-client.`)
        process.exit(1)
    }
    console.log("OpenADE client contracts are up to date")
} else {
    fs.mkdirSync(path.dirname(GENERATED_TARGET), { recursive: true })
    fs.writeFileSync(GENERATED_TARGET, generated)
    console.log(`Generated ${path.relative(REPO_ROOT, GENERATED_TARGET)}`)
}

function readContractSource() {
    const parsed = JSON.parse(fs.readFileSync(CONTRACT_SOURCE, "utf8"))
    if (!isRecord(parsed)) throw new Error("Contract source must be an object")
    return parsed
}

function validateContractSource(source) {
    const methods = requireArray(source.methods, "methods")
    const notifications = requireArray(source.notifications, "notifications")
    const errorCodes = requireArray(source.errorCodes, "errorCodes")
    const localTypes = Array.isArray(source.localTypes) ? source.localTypes : []
    const readMethods = requireArray(source.readMethodsToCoalesce, "readMethodsToCoalesce")
    const methodNames = methods.map((entry, index) => requireMethod(entry, `methods[${index}]`))
    const notificationNames = notifications.map((entry, index) => requireString(entry, `notifications[${index}]`))
    const errorCodeNames = errorCodes.map((entry, index) => requireString(entry, `errorCodes[${index}]`))
    assertNoDuplicates(methodNames, "contract methods")
    assertNoDuplicates(notificationNames, "contract notifications")
    assertNoDuplicates(errorCodeNames, "contract error codes")
    assertNoDuplicates(readMethods, "read methods")

    const contractMethodSet = new Set(methodNames)
    for (const method of readMethods) {
        if (!contractMethodSet.has(method)) throw new Error(`Read method ${method} is not present in methods`)
    }

    const localTypeNames = localTypes.map((entry, index) => requireString(entry?.name, `localTypes[${index}].name`))
    assertNoDuplicates(localTypeNames, "local types")
    validateTypeImports(localTypes, methods, localTypeNames)

    const clientMethods = extractMatches(fs.readFileSync(CLIENT_SOURCE, "utf8"), /this\.request\("([^"]+)"/g)
    assertSameSet(methodNames, clientMethods, "contract methods", "OpenADEClient request methods")

    if (fs.existsSync(CORE_PRODUCT_SOURCE)) {
        const coreSource = fs.readFileSync(CORE_PRODUCT_SOURCE, "utf8")
        const coreMethods = new Set(extractMatches(coreSource, /runtime\.Register\("([^"]+)"/g))
        const missingInCore = methodNames.filter((method) => !coreMethods.has(method))
        if (missingInCore.length > 0) {
            throw new Error(`Contract methods missing in OpenADE Core registration: ${missingInCore.join(", ")}`)
        }
        const coreNotifications = new Set(extractMatches(coreSource, /runtime\.RegisterNotification\("([^"]+)"/g))
        const missingNotificationsInCore = notificationNames.filter((notification) => !coreNotifications.has(notification))
        if (missingNotificationsInCore.length > 0) {
            throw new Error(`Contract notifications missing in OpenADE Core registration: ${missingNotificationsInCore.join(", ")}`)
        }
    }

    if (fs.existsSync(MODULE_SOURCE)) {
        const moduleNotifications = new Set(extractMatches(fs.readFileSync(MODULE_SOURCE, "utf8"), /server\.registerNotification\(\s*"([^"]+)"/g))
        const missingNotificationsInModule = notificationNames.filter((notification) => !moduleNotifications.has(notification))
        if (missingNotificationsInModule.length > 0) {
            throw new Error(`Contract notifications missing in OpenADE module registration: ${missingNotificationsInModule.join(", ")}`)
        }
    }

    const implementationErrorCodes = collectImplementationErrorCodes()
    assertSameSet(errorCodeNames, implementationErrorCodes, "contract error codes", "Core/runtime/module runtime error codes")
}

function renderGeneratedContracts(source) {
    const methods = source.methods
    const notifications = source.notifications
    const errorCodes = source.errorCodes
    const localTypes = Array.isArray(source.localTypes) ? source.localTypes : []
    const readMethods = source.readMethodsToCoalesce
    const imports = new Set()
    for (const entry of localTypes) {
        for (const imported of entry.imports ?? []) imports.add(imported)
    }
    for (const entry of methods) {
        for (const imported of entry.imports ?? []) imports.add(imported)
    }
    const sortedImports = [...imports].sort()

    const lines = [
        "/*",
        " * Generated by scripts/generate-openade-contracts.mjs from projects/openade-client/openade-contracts.json.",
        " * Do not edit by hand.",
        " */",
        "",
    ]

    if (sortedImports.length > 0) {
        lines.push("import type {")
        for (const imported of sortedImports) lines.push(`    ${imported},`)
        lines.push(`} from "${OPENADE_MODULE_TYPES_IMPORT}"`, "")
    }

    for (const entry of localTypes) {
        lines.push(`export type ${entry.name} = ${entry.definition}`, "")
    }

    lines.push("export const OPENADE_METHODS = [")
    for (const entry of methods) lines.push(`    ${JSON.stringify(entry.method)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADEMethod = (typeof OPENADE_METHODS)[number]", "")
    lines.push("export const OPENADE_NOTIFICATIONS = [")
    for (const notification of notifications) lines.push(`    ${JSON.stringify(notification)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADENotificationMethod = (typeof OPENADE_NOTIFICATIONS)[number]", "")
    lines.push("export const OPENADE_ERROR_CODES = [")
    for (const errorCode of errorCodes) lines.push(`    ${JSON.stringify(errorCode)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADEErrorCode = (typeof OPENADE_ERROR_CODES)[number]", "")
    lines.push("export const OPENADE_READ_METHODS_TO_COALESCE = [")
    for (const method of readMethods) lines.push(`    ${JSON.stringify(method)},`)
    lines.push("] as const satisfies readonly OpenADEMethod[]", "")

    lines.push("export interface OpenADERequestByMethod {")
    for (const entry of methods) lines.push(`    ${JSON.stringify(entry.method)}: ${entry.request}`)
    lines.push("}", "")
    lines.push("export interface OpenADEResponseByMethod {")
    for (const entry of methods) lines.push(`    ${JSON.stringify(entry.method)}: ${entry.response}`)
    lines.push("}", "")
    lines.push("export type OpenADERequestForMethod<Method extends OpenADEMethod> = OpenADERequestByMethod[Method]")
    lines.push("export type OpenADEResponseForMethod<Method extends OpenADEMethod> = OpenADEResponseByMethod[Method]")
    lines.push("")
    return `${lines.join("\n")}`
}

function requireMethod(value, label) {
    if (!isRecord(value)) throw new Error(`${label} must be an object`)
    const method = requireString(value.method, `${label}.method`)
    requireString(value.request, `${label}.request`)
    requireString(value.response, `${label}.response`)
    if (value.imports !== undefined) requireArray(value.imports, `${label}.imports`)
    return method
}

function validateTypeImports(localTypes, methods, localTypeNames) {
    const localTypeSet = new Set(localTypeNames)
    const moduleExportedTypes = exportedTypeNames(MODULE_TYPES_SOURCE)
    for (let index = 0; index < localTypes.length; index += 1) {
        const entry = localTypes[index]
        requireTypeImports(entry.imports, `localTypes[${index}].imports`, moduleExportedTypes)
        requireDeclaredTypeReferences(entry.definition, entry.imports ?? [], localTypeSet, `localTypes[${index}].definition`)
    }
    for (let index = 0; index < methods.length; index += 1) {
        const entry = methods[index]
        requireTypeImports(entry.imports, `methods[${index}].imports`, moduleExportedTypes)
        const imports = entry.imports ?? []
        requireDeclaredTypeReferences(entry.request, imports, localTypeSet, `methods[${index}].request`)
        requireDeclaredTypeReferences(entry.response, imports, localTypeSet, `methods[${index}].response`)
    }
}

function requireTypeImports(imports, label, exportedTypes) {
    if (imports === undefined) return
    const importedNames = requireArray(imports, label)
    assertNoDuplicates(importedNames, label)
    const missing = importedNames.filter((name) => !exportedTypes.has(name))
    if (missing.length > 0) {
        throw new Error(`${label} not exported from projects/openade-module/src/types.ts: ${missing.join(", ")}`)
    }
}

function requireDeclaredTypeReferences(typeExpression, imports, localTypeSet, label) {
    const importedSet = new Set(imports)
    const referenced = capitalizedTypeReferences(typeExpression)
    const missing = referenced.filter((name) => !BUILTIN_TYPE_NAMES.has(name) && !importedSet.has(name) && !localTypeSet.has(name))
    if (missing.length > 0) {
        throw new Error(`${label} references types without declaring imports or localTypes: ${missing.join(", ")}`)
    }
}

function capitalizedTypeReferences(typeExpression) {
    const stripped = typeExpression.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "")
    return [...new Set(extractMatches(stripped, /\b([A-Z][A-Za-z0-9_]*)\b/g))].sort()
}

function exportedTypeNames(filePath) {
    if (!fs.existsSync(filePath)) return new Set()
    const source = fs.readFileSync(filePath, "utf8")
    return new Set([
        ...extractMatches(source, /^export\s+interface\s+([A-Za-z0-9_]+)/gm),
        ...extractMatches(source, /^export\s+type\s+([A-Za-z0-9_]+)/gm),
    ])
}

function requireArray(value, label) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" && !isRecord(entry))) {
        throw new Error(`${label} must be an array`)
    }
    return value
}

function requireString(value, label) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`)
    return value
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function extractMatches(source, pattern) {
    return [...source.matchAll(pattern)].map((match) => match[1])
}

function collectImplementationErrorCodes() {
    const codes = new Set()
    for (const file of listFiles(CORE_INTERNAL_ROOT, (filePath) => filePath.endsWith(".go") && !filePath.endsWith("_test.go"))) {
        const source = fs.readFileSync(file, "utf8")
        for (const code of extractMatches(source, /RuntimeError\{[^}]*Code:\s*"([^"]+)"/gs)) codes.add(code)
        for (const code of extractMatches(source, /protocolError\("([^"]+)"/g)) codes.add(code)
        for (const code of extractMatches(source, /formattedHandlerError\("([^"]+)"/g)) codes.add(code)
    }
    for (const root of [RUNTIME_SRC_ROOT, MODULE_SRC_ROOT]) {
        for (const file of listFiles(root, (filePath) => filePath.endsWith(".ts") && !filePath.endsWith(".test.ts") && !filePath.endsWith(".spec.ts"))) {
            const source = fs.readFileSync(file, "utf8")
            for (const code of extractMatches(source, /runtimeError\("([^"]+)"/g)) codes.add(code)
            for (const code of extractMatches(source, /new RuntimeHandlerError\("([^"]+)"/g)) codes.add(code)
        }
    }
    return [...codes].sort()
}

function listFiles(root, predicate) {
    if (!fs.existsSync(root)) return []
    const files = []
    const stack = [root]
    while (stack.length > 0) {
        const current = stack.pop()
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name)
            if (entry.isDirectory()) {
                stack.push(fullPath)
            } else if (entry.isFile() && predicate(fullPath)) {
                files.push(fullPath)
            }
        }
    }
    return files.sort()
}

function assertNoDuplicates(values, label) {
    const seen = new Set()
    const duplicates = []
    for (const value of values) {
        if (seen.has(value)) duplicates.push(value)
        seen.add(value)
    }
    if (duplicates.length > 0) throw new Error(`Duplicate ${label}: ${duplicates.join(", ")}`)
}

function assertSameSet(left, right, leftLabel, rightLabel) {
    const leftSet = new Set(left)
    const rightSet = new Set(right)
    const missingFromRight = left.filter((value) => !rightSet.has(value))
    const missingFromLeft = right.filter((value) => !leftSet.has(value))
    if (missingFromRight.length > 0 || missingFromLeft.length > 0) {
        const details = []
        if (missingFromRight.length > 0) details.push(`${leftLabel} missing from ${rightLabel}: ${missingFromRight.join(", ")}`)
        if (missingFromLeft.length > 0) details.push(`${rightLabel} missing from ${leftLabel}: ${missingFromLeft.join(", ")}`)
        throw new Error(details.join("\n"))
    }
}
