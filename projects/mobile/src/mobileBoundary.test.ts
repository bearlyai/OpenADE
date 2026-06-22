import { describe, expect, it } from "vitest"
import appSource from "./App.tsx?raw"
import mainSource from "./main.tsx?raw"

const productionSources = [
    { path: "src/App.tsx", source: appSource },
    { path: "src/main.tsx", source: mainSource },
]

const forbiddenDirectProductImports = [
    "../../openade-client",
    "../../openade-module",
    "../../runtime-client",
    "../../runtime-protocol",
    "../../runtime/src",
    "../../electron",
    "../../web/src/CodeApp",
    "../../web/src/store",
    "../../web/src/electronAPI",
    "../../web/src/kernel/productStore",
]

describe("mobile production boundary", () => {
    it("keeps mobile as a thin native host over the shared remote shell", () => {
        expect(appSource).toContain('import { RemoteApp } from "../../web/src/remote/RemoteApp"')
        expect(appSource).toContain("<RemoteApp scanPairingCode={scanPairingCode} />")

        for (const { path, source } of productionSources) {
            for (const forbiddenImport of forbiddenDirectProductImports) {
                expect(source, `${path} must not import ${forbiddenImport} directly`).not.toContain(forbiddenImport)
            }
        }
    })
})
