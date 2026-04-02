import { toXML } from "jstoxml"

type XmlAttrValue = string | number | boolean | undefined

export interface XmlNode {
    name: string
    attrs?: Record<string, XmlAttrValue>
    content?: string
    children?: XmlNode[]
}

const XML_RENDER_OPTIONS = {
    header: false,
    indent: "   ",
    contentReplacements: {
        // Disables all quoting, before it'd replace " with &quot;
        "<": "<",
        ">": ">",
        "&": "&",
        '"': `"`,
    },
} as const

function toXmlAttrs(attrs?: Record<string, XmlAttrValue>): Record<string, string> | undefined {
    if (!attrs) return undefined

    const entries = Object.entries(attrs)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)] as const)

    if (entries.length === 0) return undefined
    return Object.fromEntries(entries)
}

function toJstoxmlNode(node: XmlNode): Record<string, unknown> {
    const attrs = toXmlAttrs(node.attrs)
    const children = node.children?.map((child) => toJstoxmlNode(child)) ?? []
    const hasContent = node.content !== undefined

    if (!hasContent && children.length === 0) {
        return {
            _name: node.name,
            ...(attrs ? { _attrs: attrs } : {}),
        }
    }

    const contentParts: Array<string | Record<string, unknown>> = []
    if (hasContent) {
        contentParts.push(node.content ?? "")
    }
    if (children.length > 0) {
        contentParts.push(...children)
    }

    return {
        _name: node.name,
        ...(attrs ? { _attrs: attrs } : {}),
        _content: contentParts.length === 1 ? contentParts[0] : contentParts,
    }
}

export const makeXml = (node: XmlNode | XmlNode[]): string => {
    const payload = Array.isArray(node) ? node.map((n) => toJstoxmlNode(n)) : toJstoxmlNode(node)
    return toXML(payload, XML_RENDER_OPTIONS).trim()
}

export const makeSimpleXmlTag = (tagName: string, attrs: Record<string, string>, content?: string): string => {
    return makeXml({
        name: tagName,
        attrs,
        ...(content !== undefined ? { content } : {}),
    })
}
