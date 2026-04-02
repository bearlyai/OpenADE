import { describe, expect, it } from "vitest"
import { makeSimpleXmlTag, makeXml } from "./makeXML"

describe("makeSimpleXmlTag", () => {
    it("renders a single tag with attributes and content", () => {
        const xml = makeSimpleXmlTag("note", { id: "n1" }, "hello")
        expect(xml).toContain(`<note id="n1">`)
        expect(xml).toContain("hello")
        expect(xml).toContain("</note>")
    })
})

describe("makeXml", () => {
    it("renders nested XML nodes", () => {
        const xml = makeXml({
            name: "task",
            attrs: { id: "task-1" },
            children: [
                { name: "agent", attrs: { harnessId: "claude-code", modelId: "opus" } },
                { name: "message", attrs: { role: "user" }, content: "Ship it." },
            ],
        })

        expect(xml).toContain(`<task id="task-1">`)
        expect(xml).toContain(`<agent harnessId="claude-code" modelId="opus"/>`)
        expect(xml).toContain(`<message role="user">Ship it.</message>`)
        expect(xml).toContain("</task>")
    })

    it("supports multiple root nodes", () => {
        const xml = makeXml([
            { name: "a", content: "1" },
            { name: "b", content: "2" },
        ])

        expect(xml).toContain("<a>1</a>")
        expect(xml).toContain("<b>2</b>")
    })

    it("serializes boolean/number attrs and omits undefined attrs", () => {
        const xml = makeXml({
            name: "item",
            attrs: { count: 2, active: true, empty: undefined },
        })

        expect(xml).toContain(`count="2"`)
        expect(xml).toContain(`active="true"`)
        expect(xml).not.toContain("empty=")
    })
})
