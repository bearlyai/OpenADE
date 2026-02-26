import { app, clipboard, Menu, type ContextMenuParams, type WebContents } from "electron"
import { buildNativeContextMenuTemplate } from "./contextMenuTemplate"

const addContextMenu = (wc: WebContents) => {
    wc.on("context-menu", (_event, params: ContextMenuParams) => {
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
    })
}

export const load = () => {
    app.whenReady().then(() => {
        app.on("web-contents-created", (_, wc) => {
            addContextMenu(wc)
        })
    })
}
