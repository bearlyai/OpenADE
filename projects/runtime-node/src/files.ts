import type { RuntimeServer } from "../../runtime/src"
import { optionalBoolean, optionalFiniteNumber, optionalStringEnum, requiredString, validateParams } from "./validation"

export interface RuntimeNodeFilesAdapter {
    describePath(params: unknown): Promise<unknown> | unknown
    readFile(params: unknown): Promise<unknown> | unknown
    writeFile(params: unknown): Promise<unknown> | unknown
    createDirectory(params: unknown): Promise<unknown> | unknown
    removePath(params: unknown): Promise<unknown> | unknown
    copyPath(params: unknown): Promise<unknown> | unknown
    fuzzySearch(params: unknown): Promise<unknown> | unknown
    searchContent(params: unknown): Promise<unknown> | unknown
}

const fileEncoding = optionalStringEnum("encoding", ["utf8", "base64"])

export function registerRuntimeNodeFilesModule(server: RuntimeServer, adapter: RuntimeNodeFilesAdapter): void {
    server.register("fs/path/describe", (params) => adapter.describePath(params), {
        validateParams: validateParams(requiredString("path"), optionalBoolean("readContents"), optionalFiniteNumber("maxReadSize"), optionalBoolean("showHidden")),
    })
    server.register("fs/file/read", (params) => adapter.readFile(params), {
        validateParams: validateParams(requiredString("path"), fileEncoding, optionalFiniteNumber("maxReadSize")),
    })
    server.register("fs/file/write", (params) => adapter.writeFile(params), {
        validateParams: validateParams(requiredString("path"), requiredString("content", { allowEmpty: true }), fileEncoding, optionalBoolean("createDirectory")),
    })
    server.register("fs/directory/create", (params) => adapter.createDirectory(params), {
        validateParams: validateParams(requiredString("path"), optionalBoolean("recursive")),
    })
    server.register("fs/path/remove", (params) => adapter.removePath(params), {
        validateParams: validateParams(requiredString("path"), optionalBoolean("recursive"), optionalBoolean("force")),
    })
    server.register("fs/path/copy", (params) => adapter.copyPath(params), {
        validateParams: validateParams(requiredString("from"), requiredString("to"), optionalBoolean("recursive"), optionalBoolean("force")),
    })
    server.register("fs/search/fuzzy", (params) => adapter.fuzzySearch(params), {
        validateParams: validateParams(requiredString("dir"), requiredString("query", { allowEmpty: true }), optionalBoolean("matchDirs"), optionalFiniteNumber("limit")),
    })
    server.register("fs/search/content", (params) => adapter.searchContent(params), {
        validateParams: validateParams(
            requiredString("dir"),
            requiredString("query", { allowEmpty: true }),
            optionalFiniteNumber("limit"),
            optionalBoolean("caseSensitive"),
            optionalBoolean("regex"),
            optionalBoolean("rankByHotFiles")
        ),
    })
}
