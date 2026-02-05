import { ipcMain, IpcMainInvokeEvent, dialog } from "electron"
import { readdir, stat } from "fs/promises"
import { dirname, resolve } from "path"
import { isDev } from "../config"

const crypto = require("crypto")

interface FileListing {
    name: string
    path: string
    size: number
    isDir: boolean
    shasum256?: string
}

interface ListDirRequest {
    dir: string
    sizeLimitBytes: number
    shaSum: boolean
}

interface ListDirResponse {
    files: FileListing[]
}

interface FileContentsBase64 {
    contentsBase64: string
    path: string
}

interface FileContentsRequest {
    path: string
}

interface FileContentsResponse {
    file: FileContentsBase64
}

// github.com/sindresorhus/junk/blob/main/index.js
const ignoreList = [
    // # All
    "^npm-debug\\.log$", // Error log for npm
    "^\\..*\\.swp$", // Swap file for vim state

    // # macOS
    "^\\.DS_Store$", // Stores custom folder attributes
    "^\\.AppleDouble$", // Stores additional file resources
    "^\\.LSOverride$", // Contains the absolute path to the app to be used
    "^Icon\\r$", // Custom Finder icon: http://superuser.com/questions/298785/icon-file-on-os-x-desktop
    "^\\._.*", // Thumbnail
    "^\\.Spotlight-V100(?:$|\\/)", // Directory that might appear on external disk
    "\\.Trashes", // File that might appear on external disk
    "^__MACOSX$", // Resource fork

    // # Linux
    "~$", // Backup file

    // # Windows
    "^Thumbs\\.db$", // Image file cache
    "^ehthumbs\\.db$", // Folder config file
    "^[Dd]esktop\\.ini$", // Stores custom folder attributes
    "@eaDir$", // Synology Diskstation "hidden" folder where the server stores thumbnails
]

const junkRegex = new RegExp(ignoreList.join("|"))

function isJunk(filename: string) {
    return junkRegex.test(filename)
}

async function shasum256(path: string) {
    return new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash("sha256")
        const stream = require("fs").createReadStream(path)
        stream.on("error", reject)
        stream.on("data", (chunk: any) => hash.update(chunk))
        stream.on("end", () => resolve(hash.digest("hex")))
    })
}

async function getFiles(dir: string, opts: { sizeLimit: number; shaSum: boolean }, fileList: FileListing[] | null = null) {
    const dirents = await readdir(dir, { withFileTypes: true })
    let files: FileListing[] = fileList || []
    await Promise.all(
        dirents.map(async (dirent) => {
            const res = resolve(dir, dirent.name)
            const info = await stat(res)
            const isDir = dirent.isDirectory()
            if (info.size > opts.sizeLimit) {
                return
            }
            if (isJunk(dirent.name)) {
                return
            }
            if (dirent.name.startsWith(".")) {
                return
            }
            let shaSum = undefined
            if (opts.shaSum && !isDir) {
                shaSum = await shasum256(res)
            }
            files.push({
                name: dirent.name,
                path: res,
                size: info.size,
                isDir: isDir,
                shasum256: shaSum,
            })
            return isDir ? getFiles(res, opts, files) : res
        })
    )
    return files
}

async function getFileContents(path: string): Promise<FileContentsBase64> {
    const contents = await require("fs").promises.readFile(path)
    return {
        contentsBase64: contents.toString("base64"),
        path: path,
    }
}

const checkAllowed = (e: IpcMainInvokeEvent): boolean => {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        } else {
            return url.hostname.endsWith(".bearly.ai") || url.hostname === "bearly.ai"
        }
    } catch (e) {
        console.error(e)
        return false
    }
}

export const load = () => {
    ipcMain.handle("dir-access-enabled", (e) => {
        return checkAllowed(e)
    })
    ipcMain.handle("list-dir", async (e, args: ListDirRequest): Promise<ListDirResponse> => {
        if (!args.dir) {
            throw new Error("dir is required")
        }
        const allowed = checkAllowed(e)
        if (!allowed) {
            throw new Error("not allowed")
        }

        const files = await getFiles(args.dir, { sizeLimit: args.sizeLimitBytes, shaSum: args.shaSum })
        return {
            files: files,
        }
    })

    ipcMain.handle("get-dir-from-path", async (e, args: { path: string }): Promise<{ dir: string }> => {
        if (!args.path) {
            throw new Error("path is required")
        }
        const allowed = checkAllowed(e)
        if (!allowed) {
            throw new Error("not allowed")
        }

        // stat to check if its a directory or file
        const info = await stat(args.path)
        if (info.isDirectory()) {
            return {
                dir: args.path,
            }
        }
        return {
            dir: dirname(args.path),
        }
    })

    ipcMain.handle("file-contents", async (e, args: FileContentsRequest): Promise<FileContentsResponse> => {
        if (!args.path) {
            throw new Error("path is required")
        }
        const allowed = checkAllowed(e)
        if (!allowed) {
            throw new Error("not allowed")
        }

        const file = await getFileContents(args.path)
        return {
            file: file,
        }
    })

    ipcMain.handle("select-directory", async (e, args?: { defaultPath?: string }): Promise<{ path: string } | null> => {
        const allowed = checkAllowed(e)
        if (!allowed) {
            throw new Error("not allowed")
        }

        const result = await dialog.showOpenDialog({
            properties: ["openDirectory"],
            defaultPath: args?.defaultPath,
        })

        if (result.canceled || result.filePaths.length === 0) {
            return null
        }

        return { path: result.filePaths[0] }
    })
}
