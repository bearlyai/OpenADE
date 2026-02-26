import { app, clipboard, Menu, webContents, type ContextMenuParams, type WebContents } from "electron"
import { buildNativeContextMenuTemplate } from "./contextMenuTemplate"

const trackedContents = new WeakSet<WebContents>()

const addContextMenu = (wc: WebContents) => {
    if (trackedContents.has(wc)) {
        return
    }
    trackedContents.add(wc)

    wc.once("destroyed", () => {
        trackedContents.delete(wc)
    })

    wc.on("context-menu", (_event, params: ContextMenuParams) => {
        try {
            const template = buildNativeContextMenuTemplate(
                params,
                {
                    replaceMisspelling: (word: string) => wc.replaceMisspelling(word),
                    learnSpelling: (word: string) => wc.session.addWordToSpellCheckerDictionary(word),
                    lookUpSelection: () => wc.showDefinitionForSelection(),
                    copyImageAt: (x: number, y: number) => wc.copyImageAt(x, y),
                    copyImageAddress: (url: string) => clipboard.write({ text: url, bookmark: url }),
                    copyVideoAddress: (url: string) => clipboard.write({ text: url, bookmark: url }),
                    copyLink: (url: string, text: string) => clipboard.write({ text: url, bookmark: text || url }),
                },
                process.platform
            )

            if (template.length === 0) {
                return
            }

            Menu.buildFromTemplate(template).popup()
        } catch (error) {
            console.error("[contextMenu] Failed to build or show context menu:", error)
        }
    })
}

export const load = () => {
    app.on("web-contents-created", (_, wc) => {
        addContextMenu(wc)
    })

    app.whenReady().then(() => {
        for (const wc of webContents.getAllWebContents()) {
            addContextMenu(wc)
        }
    })
}
