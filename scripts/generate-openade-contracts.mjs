#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { execFileSync } from "node:child_process"

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname)
const CONTRACT_SOURCE = path.join(REPO_ROOT, "projects", "openade-client", "openade-contracts.json")
const GENERATED_TARGET = path.join(REPO_ROOT, "projects", "openade-client", "src", "generated", "openade-contracts.ts")
const GENERATED_GO_TARGET = path.join(REPO_ROOT, "projects", "openade-core", "internal", "product", "generated_contracts.go")
const GENERATED_MODULE_TARGET = path.join(REPO_ROOT, "projects", "openade-module", "src", "generated", "openade-contracts.ts")
const CLIENT_SOURCE = path.join(REPO_ROOT, "projects", "openade-client", "src", "index.ts")
const CORE_PRODUCT_SOURCE = path.join(REPO_ROOT, "projects", "openade-core", "internal", "product", "product.go")
const CORE_PRODUCT_ROOT = path.dirname(CORE_PRODUCT_SOURCE)
const CORE_PERMISSIONS_SOURCE = path.join(CORE_PRODUCT_ROOT, "permissions.go")
const CORE_INTERNAL_ROOT = path.join(REPO_ROOT, "projects", "openade-core", "internal")
const RUNTIME_SRC_ROOT = path.join(REPO_ROOT, "projects", "runtime", "src")
const MODULE_SRC_ROOT = path.join(REPO_ROOT, "projects", "openade-module", "src")
const MODULE_SOURCE = path.join(REPO_ROOT, "projects", "openade-module", "src", "module.ts")
const MODULE_NODE_SOURCE = path.join(REPO_ROOT, "projects", "openade-module", "src", "node.ts")
const MODULE_TYPES_SOURCE = path.join(REPO_ROOT, "projects", "openade-module", "src", "types.ts")
const WEB_RUNTIME_PRODUCT_ROOTS = [
    path.join(REPO_ROOT, "projects", "web", "src", "components"),
    path.join(REPO_ROOT, "projects", "web", "src", "kernel"),
    path.join(REPO_ROOT, "projects", "web", "src", "pages"),
    path.join(REPO_ROOT, "projects", "web", "src", "remote"),
    path.join(REPO_ROOT, "projects", "web", "src", "shell"),
    path.join(REPO_ROOT, "projects", "web", "src", "store"),
]
const WEB_REMOTE_METHOD_ROOTS = [...WEB_RUNTIME_PRODUCT_ROOTS, path.join(REPO_ROOT, "projects", "web", "src", "electronAPI")]
const COMPANION_RUNTIME_SOCKET_SOURCE = path.join(REPO_ROOT, "projects", "electron", "src", "modules", "companion", "runtimeSocket.ts")
const SHARED_COMPANION_RUNTIME_PERMISSIONS_SOURCE = path.join(REPO_ROOT, "projects", "shared", "companion", "src", "runtimePermissions.ts")
const ELECTRON_COMPANION_REMOTE_METHOD_SOURCES = [
    COMPANION_RUNTIME_SOCKET_SOURCE,
    path.join(REPO_ROOT, "projects", "electron", "src", "modules", "companion", "deviceRuntime.ts"),
]
const ELECTRON_COMPANION_PRODUCT_NOTIFY_SOURCES = [
    path.join(REPO_ROOT, "projects", "electron", "src", "modules", "companion", "runtimeGateway.ts"),
    path.join(REPO_ROOT, "projects", "electron", "src", "modules", "companion", "deviceRuntime.ts"),
]
const OPENADE_MODULE_TYPES_IMPORT = "../../../openade-module/src/types"
const SHARED_COMPANION_TYPES_IMPORT = "../../../shared/companion/src"
const BUILTIN_TYPE_NAMES = new Set(["Array", "Date", "Exclude", "Extract", "NonNullable", "Omit", "Partial", "Pick", "Promise", "Readonly", "Record", "Required"])
const PermissionProfilePaired = "paired"

const args = new Set(process.argv.slice(2))
const checkOnly = args.has("--check")
const selfTestOnly = args.has("--self-test") && !checkOnly

if (checkOnly || args.has("--self-test")) {
    runContractSchemaSelfTest()
    if (selfTestOnly) {
        console.log("OpenADE contract schema self-test passed")
        process.exit(0)
    }
}

const source = readContractSource()
validateContractSource(source)
const generated = renderGeneratedContracts(source)
const generatedGo = renderGeneratedGoContracts(source)
const generatedModule = renderGeneratedModuleContracts(source)

if (checkOnly) {
    const existing = fs.existsSync(GENERATED_TARGET) ? fs.readFileSync(GENERATED_TARGET, "utf8") : ""
    if (existing !== generated) {
        console.error(`${path.relative(REPO_ROOT, GENERATED_TARGET)} is out of date. Run npm run generate:contracts in projects/openade-client.`)
        process.exit(1)
    }
    const existingGo = fs.existsSync(GENERATED_GO_TARGET) ? fs.readFileSync(GENERATED_GO_TARGET, "utf8") : ""
    if (existingGo !== generatedGo) {
        console.error(`${path.relative(REPO_ROOT, GENERATED_GO_TARGET)} is out of date. Run npm run generate:contracts in projects/openade-client.`)
        process.exit(1)
    }
    const existingModule = fs.existsSync(GENERATED_MODULE_TARGET) ? fs.readFileSync(GENERATED_MODULE_TARGET, "utf8") : ""
    if (existingModule !== generatedModule) {
        console.error(`${path.relative(REPO_ROOT, GENERATED_MODULE_TARGET)} is out of date. Run npm run generate:contracts in projects/openade-client.`)
        process.exit(1)
    }
    console.log("OpenADE client contracts are up to date")
} else {
    fs.mkdirSync(path.dirname(GENERATED_TARGET), { recursive: true })
    fs.writeFileSync(GENERATED_TARGET, generated)
    console.log(`Generated ${path.relative(REPO_ROOT, GENERATED_TARGET)}`)
    fs.mkdirSync(path.dirname(GENERATED_GO_TARGET), { recursive: true })
    fs.writeFileSync(GENERATED_GO_TARGET, generatedGo)
    console.log(`Generated ${path.relative(REPO_ROOT, GENERATED_GO_TARGET)}`)
    fs.mkdirSync(path.dirname(GENERATED_MODULE_TARGET), { recursive: true })
    fs.writeFileSync(GENERATED_MODULE_TARGET, generatedModule)
    console.log(`Generated ${path.relative(REPO_ROOT, GENERATED_MODULE_TARGET)}`)
}

function readContractSource() {
    const parsed = JSON.parse(fs.readFileSync(CONTRACT_SOURCE, "utf8"))
    if (!isRecord(parsed)) throw new Error("Contract source must be an object")
    return parsed
}

function validateContractSource(source) {
    validateContractSchema(source)
    const methods = requireArray(source.methods, "methods")
    const notifications = requireArray(source.notifications, "notifications")
    const remoteMethods = requireArray(source.remoteMethods ?? [], "remoteMethods")
    const errorCodes = requireArray(source.errorCodes, "errorCodes")
    const permissionProfiles = requireRecordArray(source.permissionProfiles, "permissionProfiles")
    const localTypes = Array.isArray(source.localTypes) ? source.localTypes : []
    const readMethods = requireArray(source.readMethodsToCoalesce, "readMethodsToCoalesce")
    const methodNames = methods.map((entry, index) => requireMethod(entry, `methods[${index}]`))
    const notificationNames = notifications.map((entry, index) => requireString(entry, `notifications[${index}]`))
    const remoteMethodNames = remoteMethods.map((entry, index) => requireRemoteMethod(entry, `remoteMethods[${index}]`))
    const errorCodeNames = errorCodes.map((entry, index) => requireString(entry, `errorCodes[${index}]`))
    assertNoDuplicates(methodNames, "contract methods")
    assertNoDuplicates(methodNames.map(methodKey), "contract method keys")
    assertNoDuplicates(notificationNames, "contract notifications")
    assertNoDuplicates(notificationNames.map(methodKey), "contract notification keys")
    assertNoDuplicates(remoteMethodNames, "contract remote methods")
    assertNoDuplicates(remoteMethodNames.map(methodKey), "contract remote method keys")
    assertNoDuplicates(errorCodeNames, "contract error codes")
    assertNoDuplicates(readMethods, "read methods")

    const contractMethodSet = new Set(methodNames)
    for (const method of readMethods) {
        if (!contractMethodSet.has(method)) throw new Error(`Read method ${method} is not present in methods`)
    }
    validatePermissionProfileRefs(permissionProfiles, methodNames, remoteMethodNames, notificationNames)

    const localTypeNames = localTypes.map((entry, index) => requireString(entry?.name, `localTypes[${index}].name`))
    assertNoDuplicates(localTypeNames, "local types")
    validateTypeImports(localTypes, methods, remoteMethods, localTypeNames)

    const clientSource = fs.readFileSync(CLIENT_SOURCE, "utf8")
    const clientLiteralMethods = extractMatches(clientSource, /this\.request\("([^"]+)"/g).filter((method) => method.startsWith("openade/"))
    if (clientLiteralMethods.length > 0) {
        throw new Error(`OpenADEClient request methods must use OPENADE_METHOD constants: ${clientLiteralMethods.join(", ")}`)
    }
    const methodByKey = new Map(methodNames.map((method) => [methodKey(method), method]))
    const clientMethodKeys = extractMatches(clientSource, /this\.request\(OPENADE_METHOD\.([A-Za-z0-9_]+)/g)
    const unknownClientMethodKeys = clientMethodKeys.filter((key) => !methodByKey.has(key))
    if (unknownClientMethodKeys.length > 0) {
        throw new Error(`OpenADEClient references unknown OPENADE_METHOD keys: ${unknownClientMethodKeys.join(", ")}`)
    }
    const clientMethods = clientMethodKeys.map((key) => methodByKey.get(key))
    assertSameSet(methodNames, clientMethods, "contract methods", "OpenADEClient request methods")
    const notificationByKey = new Map(notificationNames.map((notification) => [methodKey(notification), notification]))
    const methodByGoConstant = new Map(methodNames.map((method) => [goMethodConstName(method), method]))
    const notificationByGoConstant = new Map(notificationNames.map((notification) => [goNotificationConstName(notification), notification]))
    const remoteMethodByKey = new Map(remoteMethodNames.map((method) => [methodKey(method), method]))
    const remoteMethodByGoConstant = new Map(remoteMethodNames.map((method) => [goRemoteMethodConstName(method), method]))
    const webRuntimeProductSources = WEB_RUNTIME_PRODUCT_ROOTS.flatMap((root) =>
        listFiles(
            root,
            (filePath) =>
                (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) &&
                !filePath.endsWith(".test.ts") &&
                !filePath.endsWith(".test.tsx") &&
                !filePath.endsWith(".spec.ts") &&
                !filePath.endsWith(".spec.tsx")
        )
    )
        .map((filePath) => fs.readFileSync(filePath, "utf8"))
        .join("\n")
    const webLiteralProductMethods = extractMatches(webRuntimeProductSources, /"([^"]+)"/g).filter((method) => method.startsWith("openade/"))
    if (webLiteralProductMethods.length > 0) {
        throw new Error(`Runtime-backed web product surfaces must use OPENADE_METHOD constants: ${webLiteralProductMethods.join(", ")}`)
    }
    const webLiteralProductNotifications = extractMatches(webRuntimeProductSources, /"([^"]+)"/g).filter(isOpenADEContractNotification)
    if (webLiteralProductNotifications.length > 0) {
        throw new Error(`Runtime-backed web product surfaces must use OPENADE_NOTIFICATION constants: ${webLiteralProductNotifications.join(", ")}`)
    }
    const webMethodKeys = extractMatches(webRuntimeProductSources, /OPENADE_METHOD\.([A-Za-z0-9_]+)/g)
    const unknownWebMethodKeys = webMethodKeys.filter((key) => !methodByKey.has(key))
    if (unknownWebMethodKeys.length > 0) {
        throw new Error(`Runtime-backed web product surfaces reference unknown OPENADE_METHOD keys: ${unknownWebMethodKeys.join(", ")}`)
    }
    const webNotificationKeys = extractMatches(webRuntimeProductSources, /OPENADE_NOTIFICATION\.([A-Za-z0-9_]+)/g)
    const unknownWebNotificationKeys = webNotificationKeys.filter((key) => !notificationByKey.has(key))
    if (unknownWebNotificationKeys.length > 0) {
        throw new Error(`Runtime-backed web product surfaces reference unknown OPENADE_NOTIFICATION keys: ${unknownWebNotificationKeys.join(", ")}`)
    }
    const remoteMethodSet = new Set(remoteMethodNames)
    const webRemoteMethodSources = WEB_REMOTE_METHOD_ROOTS.flatMap((root) =>
        listFiles(
            root,
            (filePath) =>
                (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) &&
                !filePath.endsWith(".test.ts") &&
                !filePath.endsWith(".test.tsx") &&
                !filePath.endsWith(".spec.ts") &&
                !filePath.endsWith(".spec.tsx")
        )
    )
        .map((filePath) => fs.readFileSync(filePath, "utf8"))
        .join("\n")
    const webLiteralRemoteMethods = extractMatches(webRemoteMethodSources, /"([^"]+)"/g).filter((method) => remoteMethodSet.has(method))
    if (webLiteralRemoteMethods.length > 0) {
        throw new Error(`Runtime-backed web remote surfaces must use OPENADE_REMOTE_METHOD constants: ${webLiteralRemoteMethods.join(", ")}`)
    }
    const webRemoteMethodKeys = extractMatches(webRemoteMethodSources, /OPENADE_REMOTE_METHOD\.([A-Za-z0-9_]+)/g)
    const unknownWebRemoteMethodKeys = webRemoteMethodKeys.filter((key) => !remoteMethodByKey.has(key))
    if (unknownWebRemoteMethodKeys.length > 0) {
        throw new Error(`Runtime-backed web remote surfaces reference unknown OPENADE_REMOTE_METHOD keys: ${unknownWebRemoteMethodKeys.join(", ")}`)
    }
    if (fs.existsSync(SHARED_COMPANION_RUNTIME_PERMISSIONS_SOURCE)) {
        const sharedCompanionRuntimePermissionsSource = fs.readFileSync(SHARED_COMPANION_RUNTIME_PERMISSIONS_SOURCE, "utf8")
        const companionLiteralProductMethods = extractMatches(sharedCompanionRuntimePermissionsSource, /"([^"]+)"/g).filter(
            (method) => method.startsWith("openade/") && method !== "openade/*"
        )
        if (companionLiteralProductMethods.length > 0) {
            throw new Error(`Shared companion runtime permissions must use OPENADE_METHOD constants: ${companionLiteralProductMethods.join(", ")}`)
        }
        const companionLiteralProductNotifications = extractMatches(sharedCompanionRuntimePermissionsSource, /"([^"]+)"/g).filter(
            (notification) => notification !== "openade/*" && isOpenADEContractNotification(notification)
        )
        if (companionLiteralProductNotifications.length > 0) {
            throw new Error(
                `Shared companion runtime notification permissions must use OPENADE_NOTIFICATION constants: ${companionLiteralProductNotifications.join(", ")}`
            )
        }
        const companionMethodKeys = extractMatches(sharedCompanionRuntimePermissionsSource, /OPENADE_METHOD\.([A-Za-z0-9_]+)/g)
        const unknownCompanionMethodKeys = companionMethodKeys.filter((key) => !methodByKey.has(key))
        if (unknownCompanionMethodKeys.length > 0) {
            throw new Error(`Shared companion runtime permissions reference unknown OPENADE_METHOD keys: ${unknownCompanionMethodKeys.join(", ")}`)
        }
        const companionNotificationKeys = extractMatches(sharedCompanionRuntimePermissionsSource, /OPENADE_NOTIFICATION\.([A-Za-z0-9_]+)/g)
        const unknownCompanionNotificationKeys = companionNotificationKeys.filter((key) => !notificationByKey.has(key))
        if (unknownCompanionNotificationKeys.length > 0) {
            throw new Error(
                `Shared companion runtime notification permissions reference unknown OPENADE_NOTIFICATION keys: ${unknownCompanionNotificationKeys.join(", ")}`
            )
        }
        const companionLiteralRemoteMethods = extractMatches(sharedCompanionRuntimePermissionsSource, /"([^"]+)"/g).filter((method) =>
            remoteMethodSet.has(method)
        )
        if (companionLiteralRemoteMethods.length > 0) {
            throw new Error(`Shared companion runtime permissions must use OPENADE_REMOTE_METHOD constants: ${companionLiteralRemoteMethods.join(", ")}`)
        }
        const companionRemoteMethodKeys = extractMatches(sharedCompanionRuntimePermissionsSource, /OPENADE_REMOTE_METHOD\.([A-Za-z0-9_]+)/g)
        const unknownCompanionRemoteMethodKeys = companionRemoteMethodKeys.filter((key) => !remoteMethodByKey.has(key))
        if (unknownCompanionRemoteMethodKeys.length > 0) {
            throw new Error(`Shared companion runtime permissions reference unknown OPENADE_REMOTE_METHOD keys: ${unknownCompanionRemoteMethodKeys.join(", ")}`)
        }
        if (permissionProfiles.some((profile) => profile.name === PermissionProfilePaired)) {
            if (
                !sharedCompanionRuntimePermissionsSource.includes(permissionProfilePermissionsConstName(PermissionProfilePaired)) ||
                !sharedCompanionRuntimePermissionsSource.includes(permissionProfileNotificationPermissionsConstName(PermissionProfilePaired))
            ) {
                throw new Error("Shared companion runtime permissions must use generated paired permission profile constants")
            }
        }
    }
    const electronCompanionRemoteMethodSources = ELECTRON_COMPANION_REMOTE_METHOD_SOURCES.filter(fs.existsSync)
        .map((filePath) => fs.readFileSync(filePath, "utf8"))
        .join("\n")
    const electronCompanionLiteralRemoteMethods = extractMatches(electronCompanionRemoteMethodSources, /"([^"]+)"/g).filter((method) =>
        remoteMethodSet.has(method)
    )
    if (electronCompanionLiteralRemoteMethods.length > 0) {
        throw new Error(`Electron companion remote methods must use OPENADE_REMOTE_METHOD constants: ${electronCompanionLiteralRemoteMethods.join(", ")}`)
    }
    const electronCompanionRemoteMethodKeys = extractMatches(electronCompanionRemoteMethodSources, /OPENADE_REMOTE_METHOD\.([A-Za-z0-9_]+)/g)
    const unknownElectronCompanionRemoteMethodKeys = electronCompanionRemoteMethodKeys.filter((key) => !remoteMethodByKey.has(key))
    if (unknownElectronCompanionRemoteMethodKeys.length > 0) {
        throw new Error(`Electron companion remote methods reference unknown OPENADE_REMOTE_METHOD keys: ${unknownElectronCompanionRemoteMethodKeys.join(", ")}`)
    }
    const electronCompanionProductNotifySources = ELECTRON_COMPANION_PRODUCT_NOTIFY_SOURCES.filter(fs.existsSync)
        .map((filePath) => fs.readFileSync(filePath, "utf8"))
        .join("\n")
    const electronCompanionLiteralProductNotifies = extractMatches(electronCompanionProductNotifySources, /\.notify\("([^"]+)"/g).filter(
        isOpenADEContractNotification
    )
    if (electronCompanionLiteralProductNotifies.length > 0) {
        throw new Error(
            `Electron companion product notification emits must use OPENADE_NOTIFICATION constants: ${electronCompanionLiteralProductNotifies.join(", ")}`
        )
    }
    const electronCompanionNotificationKeys = extractMatches(electronCompanionProductNotifySources, /OPENADE_NOTIFICATION\.([A-Za-z0-9_]+)/g)
    const unknownElectronCompanionNotificationKeys = electronCompanionNotificationKeys.filter((key) => !notificationByKey.has(key))
    if (unknownElectronCompanionNotificationKeys.length > 0) {
        throw new Error(
            `Electron companion product notification emits reference unknown OPENADE_NOTIFICATION keys: ${unknownElectronCompanionNotificationKeys.join(", ")}`
        )
    }

    if (fs.existsSync(CORE_PRODUCT_SOURCE)) {
        const coreSource = fs.readFileSync(CORE_PRODUCT_SOURCE, "utf8")
        const coreLiteralMethods = [
            ...extractMatches(coreSource, /runtime\.Register\("([^"]+)"/g),
            ...extractMatches(coreSource, /registerOpenADEContractMethod\(\s*runtime\s*,\s*"([^"]+)"/g),
        ].filter((method) => method.startsWith("openade/"))
        if (coreLiteralMethods.length > 0) {
            throw new Error(`OpenADE Core product registrations must use generated method constants: ${coreLiteralMethods.join(", ")}`)
        }
        const coreMethodConstants = [
            ...extractMatches(coreSource, /runtime\.Register\(\s*([A-Za-z0-9_]+)\s*,/g),
            ...extractMatches(coreSource, /registerOpenADEContractMethod\(\s*runtime\s*,\s*([A-Za-z0-9_]+)\s*,/g),
        ].filter((name) => name.startsWith("openADEMethod"))
        const unknownCoreMethodConstants = coreMethodConstants.filter((name) => !methodByGoConstant.has(name))
        if (unknownCoreMethodConstants.length > 0) {
            throw new Error(`OpenADE Core references unknown generated method constants: ${unknownCoreMethodConstants.join(", ")}`)
        }
        const coreOpenADEMethods = coreMethodConstants.map((name) => methodByGoConstant.get(name))
        assertNoDuplicates(coreOpenADEMethods, "OpenADE Core openade/* registrations")
        assertSameSet(methodNames, coreOpenADEMethods, "contract methods", "OpenADE Core openade/* registrations")
        const coreLiteralRemoteMethods = [
            ...extractMatches(coreSource, /runtime\.Register\("([^"]+)"/g),
            ...extractMatches(coreSource, /registerOpenADEContractMethod\(\s*runtime\s*,\s*"([^"]+)"/g),
        ].filter((method) => remoteMethodSet.has(method))
        if (coreLiteralRemoteMethods.length > 0) {
            throw new Error(`OpenADE Core remote registrations must use generated remote method constants: ${coreLiteralRemoteMethods.join(", ")}`)
        }
        const coreRemoteMethodConstants = [
            ...extractMatches(coreSource, /runtime\.Register\(\s*([A-Za-z0-9_]+)\s*,/g),
            ...extractMatches(coreSource, /registerOpenADEContractMethod\(\s*runtime\s*,\s*([A-Za-z0-9_]+)\s*,/g),
        ].filter((name) => name.startsWith("openADERemoteMethod"))
        const unknownCoreRemoteMethodConstants = coreRemoteMethodConstants.filter((name) => !remoteMethodByGoConstant.has(name))
        if (unknownCoreRemoteMethodConstants.length > 0) {
            throw new Error(`OpenADE Core references unknown generated remote method constants: ${unknownCoreRemoteMethodConstants.join(", ")}`)
        }
        const coreRemoteMethods = coreRemoteMethodConstants.map((name) => remoteMethodByGoConstant.get(name))
        assertNoDuplicates(coreRemoteMethods, "OpenADE Core remote method registrations")
        assertSameSet(remoteMethodNames, coreRemoteMethods, "contract remote methods", "OpenADE Core remote method registrations")
        const coreLiteralNotifications = extractMatches(coreSource, /runtime\.RegisterNotification\("([^"]+)"/g).filter(isOpenADEContractNotification)
        if (coreLiteralNotifications.length > 0) {
            throw new Error(`OpenADE Core product notifications must use generated notification constants: ${coreLiteralNotifications.join(", ")}`)
        }
        const coreNotificationConstants = extractMatches(coreSource, /runtime\.RegisterNotification\(\s*([A-Za-z0-9_]+)\s*\)/g).filter((name) => name.startsWith("openADENotification"))
        const unknownCoreNotificationConstants = coreNotificationConstants.filter((name) => !notificationByGoConstant.has(name))
        if (unknownCoreNotificationConstants.length > 0) {
            throw new Error(`OpenADE Core references unknown generated notification constants: ${unknownCoreNotificationConstants.join(", ")}`)
        }
        const coreProductNotifications = coreNotificationConstants.map((name) => notificationByGoConstant.get(name))
        assertNoDuplicates(coreProductNotifications, "OpenADE Core product notification registrations")
        assertSameSet(notificationNames, coreProductNotifications, "contract notifications", "OpenADE Core product notification registrations")
        const coreProductSources = listFiles(
            CORE_PRODUCT_ROOT,
            (filePath) => filePath.endsWith(".go") && !filePath.endsWith("_test.go") && path.basename(filePath) !== "generated_contracts.go"
        )
            .map((filePath) => fs.readFileSync(filePath, "utf8"))
            .join("\n")
        const coreLiteralNotificationEmits = extractMatches(coreProductSources, /runtime\.Notify\("([^"]+)"/g).filter(isOpenADEContractNotification)
        if (coreLiteralNotificationEmits.length > 0) {
            throw new Error(`OpenADE Core product notification emits must use generated notification constants: ${coreLiteralNotificationEmits.join(", ")}`)
        }
        const coreNotificationEmitConstants = extractMatches(coreProductSources, /runtime\.Notify\(\s*([A-Za-z0-9_]+)\s*,/g).filter((name) =>
            name.startsWith("openADENotification")
        )
        const unknownCoreNotificationEmitConstants = coreNotificationEmitConstants.filter((name) => !notificationByGoConstant.has(name))
        if (unknownCoreNotificationEmitConstants.length > 0) {
            throw new Error(`OpenADE Core emits unknown generated notification constants: ${unknownCoreNotificationEmitConstants.join(", ")}`)
        }
        const coreLiteralIdempotentMethods = extractMatches(coreProductSources, /runIdempotentMutation\("([^"]+)"/g).filter((method) =>
            method.startsWith("openade/")
        )
        if (coreLiteralIdempotentMethods.length > 0) {
            throw new Error(`OpenADE Core idempotent mutation scopes must use generated method constants: ${coreLiteralIdempotentMethods.join(", ")}`)
        }
        const coreIdempotentMethodConstants = extractMatches(coreProductSources, /runIdempotentMutation\(\s*([A-Za-z0-9_]+)\s*,/g).filter((name) =>
            name.startsWith("openADEMethod")
        )
        const unknownCoreIdempotentMethodConstants = coreIdempotentMethodConstants.filter((name) => !methodByGoConstant.has(name))
        if (unknownCoreIdempotentMethodConstants.length > 0) {
            throw new Error(`OpenADE Core idempotent mutations reference unknown generated method constants: ${unknownCoreIdempotentMethodConstants.join(", ")}`)
        }
        if (fs.existsSync(CORE_PERMISSIONS_SOURCE)) {
            const corePermissionSource = fs.readFileSync(CORE_PERMISSIONS_SOURCE, "utf8")
            const coreLiteralPermissionMethods = extractMatches(corePermissionSource, /"([^"]+)"/g).filter((method) => method.startsWith("openade/"))
            if (coreLiteralPermissionMethods.length > 0) {
                throw new Error(`OpenADE Core permission profiles must use generated method constants: ${coreLiteralPermissionMethods.join(", ")}`)
            }
            const coreLiteralPermissionRemoteMethods = extractMatches(corePermissionSource, /"([^"]+)"/g).filter((method) => remoteMethodSet.has(method))
            if (coreLiteralPermissionRemoteMethods.length > 0) {
                throw new Error(`OpenADE Core permission profiles must use generated remote method constants: ${coreLiteralPermissionRemoteMethods.join(", ")}`)
            }
            const coreLiteralPermissionNotifications = extractMatches(corePermissionSource, /"notify:([^"]+)"/g).filter(
                (notification) => notification !== "openade/*" && isOpenADEContractNotification(notification)
            )
            if (coreLiteralPermissionNotifications.length > 0) {
                throw new Error(`OpenADE Core permission profiles must use generated notification constants: ${coreLiteralPermissionNotifications.join(", ")}`)
            }
            if (permissionProfiles.some((profile) => profile.name === PermissionProfilePaired)) {
                if (
                    !corePermissionSource.includes(goPermissionProfilePermissionsVarName(PermissionProfilePaired)) ||
                    !corePermissionSource.includes(goPermissionProfileNotificationPermissionsVarName(PermissionProfilePaired))
                ) {
                    throw new Error("OpenADE Core paired permissions must use generated paired permission profile variables")
                }
            }
        }
    }
    if (fs.existsSync(MODULE_SOURCE)) {
        const moduleSource = fs.readFileSync(MODULE_SOURCE, "utf8")
        assertNoConcreteOpenADETemplateMethodPrefixes(moduleSource, "OpenADE module")
        const moduleLiteralMethods = extractMatches(moduleSource, /server\.register\(\s*"([^"]+)"/g).filter((method) => method.startsWith("openade/"))
        if (moduleLiteralMethods.length > 0) {
            throw new Error(`OpenADE module registrations must use generated method constants: ${moduleLiteralMethods.join(", ")}`)
        }
        const moduleMethodKeys = extractMatches(moduleSource, /server\.register\(\s*OPENADE_METHOD\.([A-Za-z0-9_]+)/g)
        const unknownModuleMethodKeys = moduleMethodKeys.filter((key) => !methodByKey.has(key))
        if (unknownModuleMethodKeys.length > 0) {
            throw new Error(`OpenADE module registrations reference unknown OPENADE_METHOD keys: ${unknownModuleMethodKeys.join(", ")}`)
        }
        const moduleMethods = moduleMethodKeys.map((key) => methodByKey.get(key))
        assertNoDuplicates(moduleMethods, "OpenADE module openade/* registrations")
        assertSubset(moduleMethods, methodNames, "OpenADE module openade/* registrations", "contract methods")
        const moduleLiteralIdempotentMethods = extractMatches(moduleSource, /runIdempotentMutation\("([^"]+)"/g).filter((method) => method.startsWith("openade/"))
        if (moduleLiteralIdempotentMethods.length > 0) {
            throw new Error(`OpenADE module idempotent mutation scopes must use generated method constants: ${moduleLiteralIdempotentMethods.join(", ")}`)
        }
        const moduleIdempotentMethodKeys = extractMatches(moduleSource, /runIdempotentMutation\(\s*OPENADE_METHOD\.([A-Za-z0-9_]+)/g)
        const unknownModuleIdempotentMethodKeys = moduleIdempotentMethodKeys.filter((key) => !methodByKey.has(key))
        if (unknownModuleIdempotentMethodKeys.length > 0) {
            throw new Error(`OpenADE module idempotent mutations reference unknown OPENADE_METHOD keys: ${unknownModuleIdempotentMethodKeys.join(", ")}`)
        }
        const moduleLiteralNotifications = extractMatches(moduleSource, /server\.registerNotification\(\s*"([^"]+)"/g).filter(isOpenADEContractNotification)
        if (moduleLiteralNotifications.length > 0) {
            throw new Error(`OpenADE module notification registrations must use generated notification constants: ${moduleLiteralNotifications.join(", ")}`)
        }
        const moduleNotificationKeys = extractMatches(moduleSource, /server\.registerNotification\(\s*OPENADE_NOTIFICATION\.([A-Za-z0-9_]+)/g)
        const unknownModuleNotificationKeys = moduleNotificationKeys.filter((key) => !notificationByKey.has(key))
        if (unknownModuleNotificationKeys.length > 0) {
            throw new Error(`OpenADE module notification registrations reference unknown OPENADE_NOTIFICATION keys: ${unknownModuleNotificationKeys.join(", ")}`)
        }
        const moduleProductNotifications = moduleNotificationKeys.map((key) => notificationByKey.get(key))
        assertNoDuplicates(moduleProductNotifications, "OpenADE module product notification registrations")
        assertSameSet(notificationNames, moduleProductNotifications, "contract notifications", "OpenADE module product notification registrations")
        const moduleProductEmitSources = [
            moduleSource,
            fs.existsSync(MODULE_NODE_SOURCE) ? fs.readFileSync(MODULE_NODE_SOURCE, "utf8") : "",
        ].join("\n")
        const moduleLiteralNotificationEmits = extractMatches(moduleProductEmitSources, /\.notify\("([^"]+)"/g).filter(isOpenADEContractNotification)
        if (moduleLiteralNotificationEmits.length > 0) {
            throw new Error(`OpenADE module product notification emits must use generated notification constants: ${moduleLiteralNotificationEmits.join(", ")}`)
        }
        const moduleNotificationEmitKeys = extractMatches(moduleProductEmitSources, /\.notify\(\s*OPENADE_NOTIFICATION\.([A-Za-z0-9_]+)/g)
        const unknownModuleNotificationEmitKeys = moduleNotificationEmitKeys.filter((key) => !notificationByKey.has(key))
        if (unknownModuleNotificationEmitKeys.length > 0) {
            throw new Error(`OpenADE module product notification emits reference unknown OPENADE_NOTIFICATION keys: ${unknownModuleNotificationEmitKeys.join(", ")}`)
        }
    }

    const implementationErrorCodes = collectImplementationErrorCodes()
    assertSameSet(errorCodeNames, implementationErrorCodes, "contract error codes", "Core/runtime/module runtime error codes")
}

function validateContractSchema(source) {
    requireOnlyKeys(source, ["localTypes", "notifications", "remoteMethods", "errorCodes", "readMethodsToCoalesce", "permissionProfiles", "methods"], "contract source")
    const localTypes = source.localTypes === undefined ? [] : requireRecordArray(source.localTypes, "localTypes")
    const notifications = requireStringArray(source.notifications, "notifications")
    const remoteMethods = source.remoteMethods === undefined ? [] : requireRecordArray(source.remoteMethods, "remoteMethods")
    const errorCodes = requireStringArray(source.errorCodes, "errorCodes")
    const readMethods = requireStringArray(source.readMethodsToCoalesce, "readMethodsToCoalesce")
    const permissionProfiles = requireRecordArray(source.permissionProfiles, "permissionProfiles")
    const methods = requireRecordArray(source.methods, "methods")

    for (let index = 0; index < localTypes.length; index += 1) {
        const label = `localTypes[${index}]`
        const entry = localTypes[index]
        requireOnlyKeys(entry, ["name", "definition", "imports"], label)
        const name = requireString(entry.name, `${label}.name`)
        if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) throw new Error(`${label}.name must be a PascalCase type name`)
        requireTypeExpression(requireString(entry.definition, `${label}.definition`), `${label}.definition`)
        if (entry.imports !== undefined) requireStringArray(entry.imports, `${label}.imports`)
    }

    for (let index = 0; index < methods.length; index += 1) {
        const label = `methods[${index}]`
        const entry = methods[index]
        requireOnlyKeys(entry, ["method", "request", "response", "imports"], label)
        const method = requireString(entry.method, `${label}.method`)
        if (!/^openade\/[A-Za-z0-9][A-Za-z0-9/-]*$/.test(method)) throw new Error(`${label}.method must be an openade/* method`)
        requireTypeExpression(requireString(entry.request, `${label}.request`), `${label}.request`)
        requireTypeExpression(requireString(entry.response, `${label}.response`), `${label}.response`)
        if (entry.imports !== undefined) requireStringArray(entry.imports, `${label}.imports`)
    }

    for (let index = 0; index < remoteMethods.length; index += 1) {
        const label = `remoteMethods[${index}]`
        const entry = remoteMethods[index]
        requireOnlyKeys(entry, ["method", "request", "response", "imports"], label)
        const method = requireString(entry.method, `${label}.method`)
        if (!/^remote\/[A-Za-z0-9][A-Za-z0-9/-]*$/.test(method)) throw new Error(`${label}.method must be a remote/* method`)
        requireTypeExpression(requireString(entry.request, `${label}.request`), `${label}.request`)
        requireTypeExpression(requireString(entry.response, `${label}.response`), `${label}.response`)
        if (entry.imports !== undefined) requireStringArray(entry.imports, `${label}.imports`)
    }

    for (let index = 0; index < notifications.length; index += 1) {
        const notification = notifications[index]
        if (!isOpenADEContractNotification(notification)) throw new Error(`notifications[${index}] must be an OpenADE contract notification`)
    }

    for (let index = 0; index < errorCodes.length; index += 1) {
        const errorCode = errorCodes[index]
        if (!/^[a-z][a-z0-9_]*$/.test(errorCode)) throw new Error(`errorCodes[${index}] must be a lowercase runtime error code`)
    }

    for (let index = 0; index < readMethods.length; index += 1) {
        const method = readMethods[index]
        if (!/^openade\/[A-Za-z0-9][A-Za-z0-9/-]*$/.test(method)) throw new Error(`readMethodsToCoalesce[${index}] must be an openade/* method`)
    }

    for (let index = 0; index < permissionProfiles.length; index += 1) {
        const label = `permissionProfiles[${index}]`
        const entry = permissionProfiles[index]
        requireOnlyKeys(entry, ["name", "permissions", "notificationPermissions"], label)
        const name = requireString(entry.name, `${label}.name`)
        if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${label}.name must be a lowercase permission profile name`)
        requireStringArray(entry.permissions, `${label}.permissions`)
        requireStringArray(entry.notificationPermissions, `${label}.notificationPermissions`)
    }
}

function validatePermissionProfileRefs(permissionProfiles, methodNames, remoteMethodNames, notificationNames) {
    const profileNames = permissionProfiles.map((profile, index) => requireString(profile.name, `permissionProfiles[${index}].name`))
    assertNoDuplicates(profileNames, "permission profile names")
    const methodSet = new Set(methodNames)
    const remoteMethodSet = new Set(remoteMethodNames)
    const notificationSet = new Set(notificationNames)
    for (let profileIndex = 0; profileIndex < permissionProfiles.length; profileIndex += 1) {
        const profile = permissionProfiles[profileIndex]
        const label = `permissionProfiles[${profileIndex}]`
        const permissions = requireStringArray(profile.permissions, `${label}.permissions`)
        const notificationPermissions = requireStringArray(profile.notificationPermissions, `${label}.notificationPermissions`)
        assertNoDuplicates(permissions, `${label}.permissions`)
        assertNoDuplicates(notificationPermissions, `${label}.notificationPermissions`)
        for (let index = 0; index < permissions.length; index += 1) {
            const permission = permissions[index]
            if (permission.startsWith("openade/") && !methodSet.has(permission)) {
                throw new Error(`${label}.permissions[${index}] references unknown OpenADE method ${permission}`)
            }
            if (permission.startsWith("remote/") && !remoteMethodSet.has(permission)) {
                throw new Error(`${label}.permissions[${index}] references unknown remote method ${permission}`)
            }
            if (permission.startsWith("notify:")) throw new Error(`${label}.permissions[${index}] must use notificationPermissions instead of notify:*`)
            if (!/^[A-Za-z0-9][A-Za-z0-9/*_-]*(?:\/[A-Za-z0-9][A-Za-z0-9/*_-]*)*$/.test(permission)) {
                throw new Error(`${label}.permissions[${index}] is not a valid runtime permission`)
            }
        }
        for (let index = 0; index < notificationPermissions.length; index += 1) {
            const notification = notificationPermissions[index]
            const allowedWildcard = notification === "connection/*" || notification === "openade/*"
            if (!allowedWildcard && !notificationSet.has(notification)) {
                throw new Error(`${label}.notificationPermissions[${index}] references unknown notification ${notification}`)
            }
        }
    }
}

function runContractSchemaSelfTest() {
    const valid = {
        localTypes: [{ name: "OpenADEEmptyRequest", definition: "Record<string, never>" }],
        notifications: ["openade/task/updated", "remote/device/changed"],
        remoteMethods: [{ method: "remote/device/selfRevoke", request: "undefined", response: "RemoteDeviceSelfRevokeResult", imports: ["RemoteDeviceSelfRevokeResult"] }],
        errorCodes: ["invalid_request"],
        readMethodsToCoalesce: ["openade/task/read"],
        permissionProfiles: [
            {
                name: "paired",
                permissions: ["initialize", "remote/device/selfRevoke", "openade/task/read"],
                notificationPermissions: ["connection/*", "remote/device/changed", "openade/*"],
            },
        ],
        methods: [{ method: "openade/task/read", request: "OpenADEEmptyRequest", response: "OpenADETask", imports: ["OpenADETask"] }],
    }
    validateContractSchema(valid)

    expectSchemaError({ ...valid, unexpected: true }, "contract source has unknown keys")
    const missingPermissionProfiles = { ...valid }
    delete missingPermissionProfiles.permissionProfiles
    expectSchemaError(missingPermissionProfiles, "permissionProfiles must be an object array")
    expectSchemaError(
        {
            ...valid,
            methods: [{ method: "fs/read", request: "OpenADEEmptyRequest", response: "OpenADETask", imports: ["OpenADETask"] }],
        },
        "methods[0].method must be an openade/* method"
    )
    expectSchemaError(
        {
            ...valid,
            methods: [{ method: "openade/task/read", request: "Record<string, any>", response: "OpenADETask", imports: ["OpenADETask"] }],
        },
        "methods[0].request must not use explicit any"
    )
    expectSchemaError(
        {
            ...valid,
            remoteMethods: [{ method: "remote/device/selfRevoke", request: "undefined", response: "RemoteDeviceSelfRevokeResult", imports: [{ name: "bad" }] }],
        },
        "remoteMethods[0].imports must be a string array"
    )
    expectSchemaError(
        {
            ...valid,
            methods: [{ method: "openade/task/read", request: "OpenADEEmptyRequest", response: "OpenADETask", body: "OpenADETask", imports: ["OpenADETask"] }],
        },
        "methods[0] has unknown keys"
    )
    expectSchemaError(
        {
            ...valid,
            permissionProfiles: [{ name: "Paired", permissions: [], notificationPermissions: [] }],
        },
        "permissionProfiles[0].name must be a lowercase permission profile name"
    )
    assertNoConcreteOpenADETemplateMethodPrefixes("const key = `${OPENADE_METHOD.turnStart}:${stableKey}`", "self-test")
    expectImplementationRuleError(
        () => assertNoConcreteOpenADETemplateMethodPrefixes("const key = `openade/turn/start:${stableKey}`", "self-test"),
        "self-test method-key prefixes must use generated OPENADE_METHOD constants"
    )
}

function expectSchemaError(source, expectedMessage) {
    try {
        validateContractSchema(source)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes(expectedMessage)) throw new Error(`Expected schema error containing ${JSON.stringify(expectedMessage)}, got ${JSON.stringify(message)}`)
        return
    }
    throw new Error(`Expected schema error containing ${JSON.stringify(expectedMessage)}`)
}

function expectImplementationRuleError(run, expectedMessage) {
    try {
        run()
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes(expectedMessage)) {
            throw new Error(`Expected implementation-rule error containing ${JSON.stringify(expectedMessage)}, got ${JSON.stringify(message)}`)
        }
        return
    }
    throw new Error(`Expected implementation-rule error containing ${JSON.stringify(expectedMessage)}`)
}

function assertNoConcreteOpenADETemplateMethodPrefixes(source, label) {
    const methodPrefixes = extractMatches(source, /`(openade\/[A-Za-z0-9][A-Za-z0-9/-]*):\$\{/g)
    if (methodPrefixes.length > 0) {
        throw new Error(`${label} method-key prefixes must use generated OPENADE_METHOD constants: ${methodPrefixes.join(", ")}`)
    }
}

function renderGeneratedContracts(source) {
    const methods = source.methods
    const notifications = source.notifications
    const remoteMethods = source.remoteMethods ?? []
    const errorCodes = source.errorCodes
    const localTypes = Array.isArray(source.localTypes) ? source.localTypes : []
    const readMethods = source.readMethodsToCoalesce
    const permissionProfiles = source.permissionProfiles
    const imports = new Set()
    const remoteImports = new Set()
    for (const entry of localTypes) {
        for (const imported of entry.imports ?? []) imports.add(imported)
    }
    for (const entry of methods) {
        for (const imported of entry.imports ?? []) imports.add(imported)
    }
    for (const entry of remoteMethods) {
        for (const imported of entry.imports ?? []) remoteImports.add(imported)
    }
    const sortedImports = [...imports].sort()
    const sortedRemoteImports = [...remoteImports].sort()

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
    if (sortedRemoteImports.length > 0) {
        lines.push("import type {")
        for (const imported of sortedRemoteImports) lines.push(`    ${imported},`)
        lines.push(`} from "${SHARED_COMPANION_TYPES_IMPORT}"`, "")
    }

    for (const entry of localTypes) {
        lines.push(`export type ${entry.name} = ${entry.definition}`, "")
    }

    lines.push("export const OPENADE_METHODS = [")
    for (const entry of methods) lines.push(`    ${JSON.stringify(entry.method)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADEMethod = (typeof OPENADE_METHODS)[number]", "")
    lines.push("export const OPENADE_METHOD = {")
    for (const entry of methods) lines.push(`    ${methodKey(entry.method)}: ${JSON.stringify(entry.method)},`)
    lines.push("} as const satisfies Record<string, OpenADEMethod>", "")
    lines.push("export const OPENADE_NOTIFICATIONS = [")
    for (const notification of notifications) lines.push(`    ${JSON.stringify(notification)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADENotificationMethod = (typeof OPENADE_NOTIFICATIONS)[number]", "")
    lines.push("export const OPENADE_NOTIFICATION = {")
    for (const notification of notifications) lines.push(`    ${methodKey(notification)}: ${JSON.stringify(notification)},`)
    lines.push("} as const satisfies Record<string, OpenADENotificationMethod>", "")
    lines.push("export const OPENADE_REMOTE_METHODS = [")
    for (const entry of remoteMethods) lines.push(`    ${JSON.stringify(entry.method)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADERemoteMethod = (typeof OPENADE_REMOTE_METHODS)[number]", "")
    lines.push("export const OPENADE_REMOTE_METHOD = {")
    for (const entry of remoteMethods) lines.push(`    ${methodKey(entry.method)}: ${JSON.stringify(entry.method)},`)
    lines.push("} as const satisfies Record<string, OpenADERemoteMethod>", "")
    lines.push("export const OPENADE_ERROR_CODES = [")
    for (const errorCode of errorCodes) lines.push(`    ${JSON.stringify(errorCode)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADEErrorCode = (typeof OPENADE_ERROR_CODES)[number]", "")
    lines.push("export const OPENADE_READ_METHODS_TO_COALESCE = [")
    for (const method of readMethods) lines.push(`    ${JSON.stringify(method)},`)
    lines.push("] as const satisfies readonly OpenADEMethod[]", "")
    for (const profile of permissionProfiles) {
        lines.push(`export const ${permissionProfilePermissionsConstName(profile.name)} = [`)
        for (const permission of profile.permissions) lines.push(`    ${JSON.stringify(permission)},`)
        lines.push("] as const", "")
        lines.push(`export const ${permissionProfileNotificationPermissionsConstName(profile.name)} = [`)
        for (const notification of profile.notificationPermissions) lines.push(`    ${JSON.stringify(notification)},`)
        lines.push("] as const", "")
    }

    lines.push("export interface OpenADERequestByMethod {")
    for (const entry of methods) lines.push(`    ${JSON.stringify(entry.method)}: ${entry.request}`)
    lines.push("}", "")
    lines.push("export interface OpenADEResponseByMethod {")
    for (const entry of methods) lines.push(`    ${JSON.stringify(entry.method)}: ${entry.response}`)
    lines.push("}", "")
    lines.push("export type OpenADERequestForMethod<Method extends OpenADEMethod> = OpenADERequestByMethod[Method]")
    lines.push("export type OpenADEResponseForMethod<Method extends OpenADEMethod> = OpenADEResponseByMethod[Method]")
    lines.push("")
    lines.push("export interface OpenADERemoteRequestByMethod {")
    for (const entry of remoteMethods) lines.push(`    ${JSON.stringify(entry.method)}: ${entry.request}`)
    lines.push("}", "")
    lines.push("export interface OpenADERemoteResponseByMethod {")
    for (const entry of remoteMethods) lines.push(`    ${JSON.stringify(entry.method)}: ${entry.response}`)
    lines.push("}", "")
    lines.push("export type OpenADERemoteRequestForMethod<Method extends OpenADERemoteMethod> = OpenADERemoteRequestByMethod[Method]")
    lines.push("export type OpenADERemoteResponseForMethod<Method extends OpenADERemoteMethod> = OpenADERemoteResponseByMethod[Method]")
    lines.push("")
    return `${lines.join("\n")}`
}

function renderGeneratedModuleContracts(source) {
    const lines = [
        "/*",
        " * Generated by scripts/generate-openade-contracts.mjs from projects/openade-client/openade-contracts.json.",
        " * Do not edit by hand.",
        " */",
        "",
        "export const OPENADE_METHODS = [",
    ]
    for (const entry of source.methods) lines.push(`    ${JSON.stringify(entry.method)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADEMethod = (typeof OPENADE_METHODS)[number]", "")
    lines.push("export const OPENADE_METHOD = {")
    for (const entry of source.methods) lines.push(`    ${methodKey(entry.method)}: ${JSON.stringify(entry.method)},`)
    lines.push("} as const satisfies Record<string, OpenADEMethod>", "")
    lines.push("export const OPENADE_NOTIFICATIONS = [")
    for (const notification of source.notifications) lines.push(`    ${JSON.stringify(notification)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADENotificationMethod = (typeof OPENADE_NOTIFICATIONS)[number]", "")
    lines.push("export const OPENADE_NOTIFICATION = {")
    for (const notification of source.notifications) lines.push(`    ${methodKey(notification)}: ${JSON.stringify(notification)},`)
    lines.push("} as const satisfies Record<string, OpenADENotificationMethod>", "")
    lines.push("export const OPENADE_REMOTE_METHODS = [")
    for (const entry of source.remoteMethods ?? []) lines.push(`    ${JSON.stringify(entry.method)},`)
    lines.push("] as const", "")
    lines.push("export type OpenADERemoteMethod = (typeof OPENADE_REMOTE_METHODS)[number]", "")
    lines.push("export const OPENADE_REMOTE_METHOD = {")
    for (const entry of source.remoteMethods ?? []) lines.push(`    ${methodKey(entry.method)}: ${JSON.stringify(entry.method)},`)
    lines.push("} as const satisfies Record<string, OpenADERemoteMethod>", "")
    return `${lines.join("\n")}`
}

function formatGo(source) {
    return execFileSync("gofmt", { input: source, encoding: "utf8" })
}

function renderGeneratedGoContracts(source) {
    const entries = [...source.methods, ...(source.remoteMethods ?? [])]
    const requestValidators = buildGoRequestValidators(source)
    const permissionProfiles = source.permissionProfiles
    const lines = [
        "// Code generated by scripts/generate-openade-contracts.mjs from projects/openade-client/openade-contracts.json; DO NOT EDIT.",
        "",
        "package product",
        "",
        "import (",
        '\t"bytes"',
        '\t"encoding/json"',
        ")",
        "",
        "const (",
    ]
    for (const entry of source.methods) lines.push(`\t${goMethodConstName(entry.method)} = ${JSON.stringify(entry.method)}`)
    lines.push(")", "", "const (")
    for (const entry of source.remoteMethods ?? []) lines.push(`\t${goRemoteMethodConstName(entry.method)} = ${JSON.stringify(entry.method)}`)
    lines.push(")", "", "const (")
    for (const notification of source.notifications) lines.push(`\t${goNotificationConstName(notification)} = ${JSON.stringify(notification)}`)
    lines.push(")", "")
    for (const profile of permissionProfiles) {
        lines.push(`var ${goPermissionProfilePermissionsVarName(profile.name)} = []string{`)
        for (const permission of profile.permissions) lines.push(`\t${goPermissionExpr(permission)},`)
        lines.push("}", "")
        lines.push(`var ${goPermissionProfileNotificationPermissionsVarName(profile.name)} = []string{`)
        for (const notification of profile.notificationPermissions) lines.push(`\t${goNotificationPermissionExpr(notification)},`)
        lines.push("}", "")
    }
    lines.push("type openADEContractRequestKind uint8", "")
    lines.push("const (")
    lines.push("\topenADEContractRequestObject openADEContractRequestKind = iota")
    lines.push("\topenADEContractRequestEmptyObject")
    lines.push("\topenADEContractRequestUndefined")
    lines.push(")", "")
    lines.push("type openADEContractFieldKind uint8", "")
    lines.push("const (")
    lines.push("\topenADEContractFieldString openADEContractFieldKind = iota")
    lines.push("\topenADEContractFieldNumber")
    lines.push("\topenADEContractFieldBoolean")
    lines.push("\topenADEContractFieldArray")
    lines.push("\topenADEContractFieldObject")
    lines.push(")", "")
    lines.push("type openADEContractFieldValidator struct {")
    lines.push("\tName string")
    lines.push("\tKind openADEContractFieldKind")
    lines.push("\tRequired bool")
    lines.push("\tValues []string")
    lines.push("}", "")
    lines.push("var openADEContractRequestKinds = map[string]openADEContractRequestKind{")
    for (const entry of entries) {
        const constName = entry.method.startsWith("remote/") ? goRemoteMethodConstName(entry.method) : goMethodConstName(entry.method)
        lines.push(`\t${constName}: ${goRequestKind(entry.request)},`)
    }
    lines.push("}", "")
    lines.push("var openADEContractFields = map[string][]openADEContractFieldValidator{")
    for (const entry of entries) {
        const fields = requestValidators.get(entry.method) ?? []
        if (fields.length === 0) continue
        const constName = entry.method.startsWith("remote/") ? goRemoteMethodConstName(entry.method) : goMethodConstName(entry.method)
        lines.push(`\t${constName}: {`)
        for (const field of fields) {
            const values = field.values && field.values.length > 0 ? `, Values: []string{${field.values.map((value) => JSON.stringify(value)).join(", ")}}` : ""
            lines.push(`\t\t{Name: ${JSON.stringify(field.name)}, Kind: ${goFieldKind(field.kind)}, Required: ${field.required ? "true" : "false"}${values}},`)
        }
        lines.push("\t},")
    }
    lines.push("}", "")
    lines.push("func normalizeOpenADEContractRequest(method string, raw json.RawMessage) (json.RawMessage, string) {")
    lines.push("\tkind, ok := openADEContractRequestKinds[method]")
    lines.push("\tif !ok {")
    lines.push("\t\treturn raw, \"\"")
    lines.push("\t}")
    lines.push("\ttrimmed := bytes.TrimSpace(raw)")
    lines.push("\tswitch kind {")
    lines.push("\tcase openADEContractRequestUndefined:")
    lines.push("\t\tif len(trimmed) == 0 || bytes.Equal(trimmed, []byte(\"null\")) {")
    lines.push("\t\t\treturn raw, \"\"")
    lines.push("\t\t}")
    lines.push("\t\tif object, ok := openADEContractObjectFields(trimmed); ok && len(object) == 0 {")
    lines.push("\t\t\treturn raw, \"\"")
    lines.push("\t\t}")
    lines.push("\t\treturn raw, \"params must be omitted for this method\"")
    lines.push("\tcase openADEContractRequestEmptyObject:")
    lines.push("\t\tif len(trimmed) == 0 || bytes.Equal(trimmed, []byte(\"null\")) {")
    lines.push("\t\t\treturn json.RawMessage(`{}`), \"\"")
    lines.push("\t\t}")
    lines.push("\t\tif object, ok := openADEContractObjectFields(trimmed); ok {")
    lines.push("\t\t\tif len(object) == 0 {")
    lines.push("\t\t\t\treturn raw, \"\"")
    lines.push("\t\t\t}")
    lines.push("\t\t\treturn raw, \"params must be an empty object for this method\"")
    lines.push("\t\t}")
    lines.push("\t\treturn raw, \"params must be an empty object for this method\"")
    lines.push("\tdefault:")
    lines.push("\t\tif object, ok := openADEContractObjectFields(trimmed); ok {")
    lines.push("\t\t\tif message := validateOpenADEContractFields(method, object); message != \"\" {")
    lines.push("\t\t\t\treturn raw, message")
    lines.push("\t\t\t}")
    lines.push("\t\t\treturn raw, \"\"")
    lines.push("\t\t}")
    lines.push("\t\treturn raw, \"params must be an object\"")
    lines.push("\t}")
    lines.push("}", "")
    lines.push("func openADEContractObjectFields(raw []byte) (map[string]json.RawMessage, bool) {")
    lines.push("\tvar object map[string]json.RawMessage")
    lines.push("\tif err := json.Unmarshal(raw, &object); err != nil || object == nil {")
    lines.push("\t\treturn nil, false")
    lines.push("\t}")
    lines.push("\treturn object, true")
    lines.push("}", "")
    lines.push("func validateOpenADEContractFields(method string, object map[string]json.RawMessage) string {")
    lines.push("\tfor _, field := range openADEContractFields[method] {")
    lines.push("\t\traw, ok := object[field.Name]")
    lines.push("\t\tif !ok || bytes.Equal(bytes.TrimSpace(raw), []byte(\"null\")) {")
    lines.push("\t\t\tif !field.Required {")
    lines.push("\t\t\t\tcontinue")
    lines.push("\t\t\t}")
    lines.push("\t\t\treturn \"params.\" + field.Name + \" is required\"")
    lines.push("\t\t}")
    lines.push("\t\tif !openADEContractFieldMatches(field.Kind, raw) {")
    lines.push("\t\t\treturn \"params.\" + field.Name + \" has the wrong type\"")
    lines.push("\t\t}")
    lines.push("\t\tif len(field.Values) > 0 && !openADEContractStringValueAllowed(raw, field.Values) {")
    lines.push("\t\t\treturn \"params.\" + field.Name + \" has an unsupported value\"")
    lines.push("\t\t}")
    lines.push("\t}")
    lines.push("\treturn \"\"")
    lines.push("}", "")
    lines.push("func openADEContractStringValueAllowed(raw json.RawMessage, allowed []string) bool {")
    lines.push("\tvar value string")
    lines.push("\tif err := json.Unmarshal(raw, &value); err != nil {")
    lines.push("\t\treturn false")
    lines.push("\t}")
    lines.push("\tfor _, allowedValue := range allowed {")
    lines.push("\t\tif value == allowedValue {")
    lines.push("\t\t\treturn true")
    lines.push("\t\t}")
    lines.push("\t}")
    lines.push("\treturn false")
    lines.push("}", "")
    lines.push("func openADEContractFieldMatches(kind openADEContractFieldKind, raw json.RawMessage) bool {")
    lines.push("\tswitch kind {")
    lines.push("\tcase openADEContractFieldString:")
    lines.push("\t\tvar value string")
    lines.push("\t\treturn json.Unmarshal(raw, &value) == nil")
    lines.push("\tcase openADEContractFieldNumber:")
    lines.push("\t\tvar value float64")
    lines.push("\t\treturn json.Unmarshal(raw, &value) == nil")
    lines.push("\tcase openADEContractFieldBoolean:")
    lines.push("\t\tvar value bool")
    lines.push("\t\treturn json.Unmarshal(raw, &value) == nil")
    lines.push("\tcase openADEContractFieldArray:")
    lines.push("\t\tvar value []json.RawMessage")
    lines.push("\t\treturn json.Unmarshal(raw, &value) == nil")
    lines.push("\tcase openADEContractFieldObject:")
    lines.push("\t\tvar value map[string]json.RawMessage")
    lines.push("\t\treturn json.Unmarshal(raw, &value) == nil && value != nil")
    lines.push("\t}")
    lines.push("\treturn true")
    lines.push("}", "")
    return formatGo(`${lines.join("\n")}`)
}

function goRequestKind(request) {
    if (request === "undefined") return "openADEContractRequestUndefined"
    if (request === "OpenADEEmptyRequest" || request === "Record<string, never>") return "openADEContractRequestEmptyObject"
    return "openADEContractRequestObject"
}

function goFieldKind(kind) {
    switch (kind) {
        case "string":
            return "openADEContractFieldString"
        case "number":
            return "openADEContractFieldNumber"
        case "boolean":
            return "openADEContractFieldBoolean"
        case "array":
            return "openADEContractFieldArray"
        default:
            return "openADEContractFieldObject"
    }
}

function buildGoRequestValidators(source) {
    const localTypeDefinitions = new Map((source.localTypes ?? []).map((entry) => [entry.name, entry.definition]))
    const typeSources = [
        fs.existsSync(MODULE_TYPES_SOURCE) ? fs.readFileSync(MODULE_TYPES_SOURCE, "utf8") : "",
        fs.existsSync(path.join(REPO_ROOT, "projects", "shared", "companion", "src", "index.ts"))
            ? fs.readFileSync(path.join(REPO_ROOT, "projects", "shared", "companion", "src", "index.ts"), "utf8")
            : "",
    ].join("\n")
    const aliasKinds = exportedTypeAliasKinds(typeSources)
    const validators = new Map()
    for (const entry of [...source.methods, ...(source.remoteMethods ?? [])]) {
        const fields = requestValidatorFields(entry.request, localTypeDefinitions, typeSources, aliasKinds, new Set())
        validators.set(entry.method, fields)
    }
    return validators
}

function requestValidatorFields(typeExpression, localTypeDefinitions, typeSources, aliasKinds, seen) {
    if (typeExpression === "undefined" || typeExpression === "OpenADEEmptyRequest" || typeExpression === "Record<string, never>") return []
    const fields = []
    for (const objectLiteral of inlineObjectLiterals(typeExpression)) {
        fields.push(...parseTypeFields(objectLiteral, aliasKinds))
    }
    for (const name of capitalizedTypeReferences(typeExpression)) {
        if (seen.has(name)) continue
        seen.add(name)
        const localDefinition = localTypeDefinitions.get(name)
        if (localDefinition !== undefined) {
            fields.push(...requestValidatorFields(localDefinition, localTypeDefinitions, typeSources, aliasKinds, seen))
            continue
        }
        const interfaceBody = exportedInterfaceBody(typeSources, name)
        if (interfaceBody !== null) {
            fields.push(...parseTypeFields(interfaceBody, aliasKinds))
        }
    }
    return dedupeFields(fields)
}

function inlineObjectLiterals(typeExpression) {
    return [...typeExpression.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1])
}

function exportedInterfaceBody(source, name) {
    const match = source.match(new RegExp(`export\\s+interface\\s+${escapeRegExp(name)}(?:\\s+extends\\s+[^\\{]+)?\\s*\\{`))
    if (!match || match.index === undefined) return null
    const openIndex = match.index + match[0].length - 1
    const closeIndex = matchingBraceIndex(source, openIndex)
    if (closeIndex === -1) throw new Error(`Unable to parse interface body for ${name}`)
    return source.slice(openIndex + 1, closeIndex)
}

function parseTypeFields(body, aliasKinds) {
    return topLevelTypeStatements(body)
        .map((statement) => statement.trim().replace(/,$/, ""))
        .map((statement) => statement.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(\?)?:\s*(.+)$/s))
        .filter(Boolean)
        .map((match) => {
            const typeInfo = fieldTypeInfo(match[3].trim(), aliasKinds)
            return { name: match[1], kind: typeInfo.kind, required: match[2] !== "?", values: typeInfo.values }
        })
}

function topLevelTypeStatements(body) {
    const statements = []
    let current = ""
    let braceDepth = 0
    for (const char of body) {
        if (char === "{") braceDepth += 1
        if (char === "}") braceDepth = Math.max(0, braceDepth - 1)
        if ((char === "\n" || char === ";") && braceDepth === 0) {
            if (current.trim() !== "") statements.push(current)
            current = ""
            continue
        }
        current += char
    }
    if (current.trim() !== "") statements.push(current)
    return statements
}

function matchingBraceIndex(source, openIndex) {
    let depth = 0
    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index]
        if (char === "{") depth += 1
        if (char === "}") {
            depth -= 1
            if (depth === 0) return index
        }
    }
    return -1
}

function fieldKind(typeExpression, aliasKinds = new Map()) {
    return fieldTypeInfo(typeExpression, aliasKinds).kind
}

function fieldTypeInfo(typeExpression, aliasKinds = new Map()) {
    const trimmed = typeExpression.trim()
    const alias = aliasKinds.get(trimmed)
    if (alias) return alias

    const nullableStripped = trimmed
        .split("|")
        .map((part) => part.trim())
        .filter((part) => part !== "null" && part !== "undefined")
    const normalized = nullableStripped.length > 0 ? nullableStripped.join(" | ") : trimmed
    const normalizedAlias = aliasKinds.get(normalized)
    if (normalizedAlias) return normalizedAlias

    if (normalized === "string") return { kind: "string", values: [] }
    if (normalized === "number") return { kind: "number", values: [] }
    if (normalized === "boolean") return { kind: "boolean", values: [] }
    if (/\[\]$/.test(normalized) || /^Array</.test(normalized)) return { kind: "array", values: [] }

    const literalValues = stringLiteralUnionValues(normalized)
    if (literalValues.length > 0) return { kind: "string", values: literalValues }
    if (numericLiteralUnion(normalized)) return { kind: "number", values: [] }

    return { kind: "object", values: [] }
}

function stringLiteralUnionValues(typeExpression) {
    const parts = typeExpression.split("|").map((part) => part.trim())
    if (parts.length === 0 || parts.some((part) => !/^"[^"]+"$/.test(part))) return []
    return parts.map((part) => JSON.parse(part))
}

function numericLiteralUnion(typeExpression) {
    const parts = typeExpression.split("|").map((part) => part.trim())
    return parts.length > 0 && parts.every((part) => /^-?\d+(?:\.\d+)?$/.test(part))
}

function exportedTypeAliasKinds(source) {
    const aliasKinds = new Map()
    for (const match of source.matchAll(/^export\s+type\s+([A-Za-z0-9_]+)\s*=\s*([^\n]+)/gm)) {
        const expression = match[2].trim()
        const info = fieldTypeInfo(expression, aliasKinds)
        if (info.kind !== "object" || info.values.length > 0 || expression === "string" || expression === "number" || expression === "boolean") {
            aliasKinds.set(match[1], info)
        }
    }
    return aliasKinds
}

function dedupeFields(fields) {
    const byName = new Map()
    for (const field of fields) {
        if (!byName.has(field.name)) byName.set(field.name, field)
    }
    return [...byName.values()]
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function requireMethod(value, label) {
    if (!isRecord(value)) throw new Error(`${label} must be an object`)
    const method = requireString(value.method, `${label}.method`)
    requireString(value.request, `${label}.request`)
    requireString(value.response, `${label}.response`)
    if (value.imports !== undefined) requireArray(value.imports, `${label}.imports`)
    return method
}

function requireRemoteMethod(value, label) {
    if (!isRecord(value)) throw new Error(`${label} must be an object`)
    const method = requireString(value.method, `${label}.method`)
    requireString(value.request, `${label}.request`)
    requireString(value.response, `${label}.response`)
    if (value.imports !== undefined) requireArray(value.imports, `${label}.imports`)
    return method
}

function isOpenADEContractNotification(notification) {
    return notification.startsWith("openade/") || notification === "remote/device/changed"
}

function methodKey(method) {
    const segments = method.split("/").filter((segment) => segment !== "openade")
    return segments
        .flatMap((segment) => segment.split("-"))
        .map(methodKeySegment)
        .map((segment, index) => (index === 0 ? lowerFirst(segment) : upperFirst(segment)))
        .join("")
}

function goMethodConstName(method) {
    return `openADEMethod${upperFirst(methodKey(method))}`
}

function goRemoteMethodConstName(method) {
    return `openADERemoteMethod${upperFirst(methodKey(method))}`
}

function goNotificationConstName(notification) {
    return `openADENotification${upperFirst(methodKey(notification))}`
}

function constantProfileName(name) {
    return name
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((segment) => segment.toUpperCase())
        .join("_")
}

function permissionProfilePermissionsConstName(name) {
    return `OPENADE_PERMISSION_PROFILE_${constantProfileName(name)}_PERMISSIONS`
}

function permissionProfileNotificationPermissionsConstName(name) {
    return `OPENADE_PERMISSION_PROFILE_${constantProfileName(name)}_NOTIFICATION_PERMISSIONS`
}

function goPermissionProfilePermissionsVarName(name) {
    return `openADEPermissionProfile${upperFirst(methodKey(name))}Permissions`
}

function goPermissionProfileNotificationPermissionsVarName(name) {
    return `openADEPermissionProfile${upperFirst(methodKey(name))}NotificationPermissions`
}

function goPermissionExpr(permission) {
    if (permission.startsWith("openade/")) return goMethodConstName(permission)
    if (permission.startsWith("remote/")) return goRemoteMethodConstName(permission)
    return JSON.stringify(permission)
}

function goNotificationPermissionExpr(notification) {
    if (notification !== "openade/*" && isOpenADEContractNotification(notification)) return goNotificationConstName(notification)
    return JSON.stringify(notification)
}

function methodKeySegment(segment) {
    return segment
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part, index) => (index === 0 ? part : upperFirst(part)))
        .join("")
}

function lowerFirst(value) {
    return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value
}

function upperFirst(value) {
    return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

function validateTypeImports(localTypes, methods, remoteMethods, localTypeNames) {
    const localTypeSet = new Set(localTypeNames)
    const moduleExportedTypes = exportedTypeNames(MODULE_TYPES_SOURCE)
    const sharedCompanionExportedTypes = exportedTypeNames(path.join(REPO_ROOT, "projects", "shared", "companion", "src", "index.ts"))
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
    for (let index = 0; index < remoteMethods.length; index += 1) {
        const entry = remoteMethods[index]
        requireTypeImports(entry.imports, `remoteMethods[${index}].imports`, sharedCompanionExportedTypes)
        const imports = entry.imports ?? []
        requireDeclaredTypeReferences(entry.request, imports, localTypeSet, `remoteMethods[${index}].request`)
        requireDeclaredTypeReferences(entry.response, imports, localTypeSet, `remoteMethods[${index}].response`)
    }
}

function requireTypeImports(imports, label, exportedTypes) {
    if (imports === undefined) return
    const importedNames = requireStringArray(imports, label)
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

function requireRecordArray(value, label) {
    if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) throw new Error(`${label} must be an object array`)
    return value
}

function requireStringArray(value, label) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`${label} must be a string array`)
    return value
}

function requireString(value, label) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`)
    return value
}

function requireTypeExpression(value, label) {
    if (/\bany\b/.test(value)) throw new Error(`${label} must not use explicit any`)
    return value
}

function requireOnlyKeys(value, allowedKeys, label) {
    const allowed = new Set(allowedKeys)
    const unknown = Object.keys(value).filter((key) => !allowed.has(key))
    if (unknown.length > 0) throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`)
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

function assertSubset(subset, superset, subsetLabel, supersetLabel) {
    const supersetValues = new Set(superset)
    const missing = subset.filter((value) => !supersetValues.has(value))
    if (missing.length > 0) throw new Error(`${subsetLabel} missing from ${supersetLabel}: ${missing.join(", ")}`)
}
