import { toXML } from "jstoxml"

export const makeSimpleXmlTag = (tagName: string, attrs: Record<string, string>, content?: string): string => {
    return toXML(
        {
            _name: tagName,
            _attrs: attrs,
            _content: content,
        },
        {
            header: false,
            indent: "   ",
            contentReplacements: {
                // Disables all quoting, before it'd replace " with &quot;
                "<": "<",
                ">": ">",
                "&": "&",
                '"': `"`,
            },
        }
    ).trim()
}
