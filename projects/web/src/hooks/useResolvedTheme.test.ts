import { describe, expect, it } from "vitest"
import { resolveThemeSetting } from "./useResolvedTheme"

describe("resolveThemeSetting", () => {
    it("uses system preference when setting is system or missing", () => {
        expect(resolveThemeSetting("system", "light")).toBe("code-theme-light")
        expect(resolveThemeSetting(undefined, "dark")).toBe("code-theme-black")
    })

    it("maps legacy light and dark settings", () => {
        expect(resolveThemeSetting("light", "dark")).toBe("code-theme-light")
        expect(resolveThemeSetting("dark", "light")).toBe("code-theme-black")
    })
})
