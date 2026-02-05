import { app, WebContents } from "electron"
import contextMenu from "electron-context-menu"

const addContextMenu = (wc: WebContents) => {
    contextMenu({
        window: wc,
        showSearchWithGoogle: false,
        // prepend: prependMenu,

        // Todo: we can enable these when we implement helpers for them
        showCopyImageAddress: false,
        showSaveImage: false,
        showSaveImageAs: false,
        showCopyImage: true,

        showInspectElement: false,
        showLookUpSelection: true,
    })
}

export const load = () => {
    app.whenReady().then(() => {
        app.on("web-contents-created", (_, wc) => {
            addContextMenu(wc)
        })
    })
}
