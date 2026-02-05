import { app, ipcMain } from "electron"

// sync with fe
interface FindInPageAction {
    action: "next" | "prev" | "stop" | "find" | "available"
    query: string
    findNext?: boolean
    forward?: boolean
    stopAction?: "clearSelection" | "keepSelection" | "activateSelection"
}

const waitForFind = (wc: Electron.WebContents) => {
    return new Promise<void>((resolve) => {
        wc.once("found-in-page", () => {
            resolve()
        })
    })
}

export const load = () => {
    app.whenReady().then(() => {
        ipcMain.handle("find-in-page", async (v, args: FindInPageAction) => {
            const wc = v.sender
            if (!wc) {
                return
            }

            if (args.action === "find") {
                const waiter = waitForFind(wc)
                wc.findInPage(args.query, { findNext: args.findNext || true, forward: args.forward || true })
                await waiter
                return null
            } else if (args.action === "next") {
                const waiter = waitForFind(wc)
                wc.findInPage(args.query, { forward: args.forward || true, findNext: args.findNext || false })
                await waiter
                return null
            } else if (args.action === "prev") {
                const waiter = waitForFind(wc)
                wc.findInPage(args.query, { forward: args.forward || false, findNext: args.findNext || false })
                await waiter
                return null
            } else if (args.action === "stop") {
                wc.stopFindInPage(args.stopAction || "clearSelection")
                return null
            } else if (args.action === "available") {
                return true
            } else {
                console.warn("Unknown action", v as never)
                return null
            }
        })
    })
}
