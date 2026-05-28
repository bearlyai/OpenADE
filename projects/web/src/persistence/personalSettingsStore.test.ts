import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { createPersonalSettingsStore } from "./personalSettingsStore"

describe("createPersonalSettingsStore", () => {
    it("defaults to system theme for new settings documents", () => {
        const doc = new Y.Doc()
        const store = createPersonalSettingsStore(doc)

        expect(store.settings.current.theme).toBe("system")
        expect(store.settings.current.renderMarkdownMessages).toBe(true)
    })

    it("normalizes legacy light and dark theme settings", () => {
        const lightDoc = new Y.Doc()
        lightDoc.getMap("personal_settings").set("theme", "light")

        const darkDoc = new Y.Doc()
        darkDoc.getMap("personal_settings").set("theme", "dark")

        expect(createPersonalSettingsStore(lightDoc).settings.current.theme).toBe("code-theme-light")
        expect(createPersonalSettingsStore(darkDoc).settings.current.theme).toBe("code-theme-black")
    })
})
