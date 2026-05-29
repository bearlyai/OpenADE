import { describe, expect, it } from "vitest"
import { getExternalUrlToOpen } from "./externalLinks"

describe("getExternalUrlToOpen", () => {
    it("allows external web and mail links", () => {
        expect(getExternalUrlToOpen("https://openade.ai")).toBe("https://openade.ai/")
        expect(getExternalUrlToOpen("http://127.0.0.1:7823/pair")).toBe("http://127.0.0.1:7823/pair")
        expect(getExternalUrlToOpen("mailto:hello@openade.ai")).toBe("mailto:hello@openade.ai")
    })

    it("does not send relative, hash, or unsafe protocols to the OS shell", () => {
        expect(getExternalUrlToOpen("/settings")).toBeNull()
        expect(getExternalUrlToOpen("#task")).toBeNull()
        expect(getExternalUrlToOpen("javascript:alert(1)")).toBeNull()
        expect(getExternalUrlToOpen("file:///etc/passwd")).toBeNull()
    })
})
