import { toBlob } from "html-to-image"

export async function copyCardToClipboard(node: HTMLElement): Promise<void> {
    const blob = await toBlob(node, { pixelRatio: 3 })
    if (!blob) throw new Error("Failed to render card")
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
}
