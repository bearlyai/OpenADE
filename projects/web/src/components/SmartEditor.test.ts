import { createElement, type ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SlashCommandEntry, SmartEditorFileSearchResult, SmartEditorManagerContract, SmartEditorSdkCapabilitiesContract } from "./SmartEditor"

interface SuggestionItemsArgs {
    query: string
}

type SuggestionItems = (args: SuggestionItemsArgs) => unknown[]

interface SlashSuggestionStartProps {
    items: SlashCommandEntry[]
    query: string
    clientRect?: () => DOMRect | null
}

interface SlashSuggestionRenderHandlers {
    onStart(props: SlashSuggestionStartProps): void
}

interface SuggestionConfig {
    char: string
    items?: SuggestionItems
    render?: () => SlashSuggestionRenderHandlers
}

const tiptapMocks = vi.hoisted(() => ({
    fileSuggestionItems: null as SuggestionItems | null,
    slashSuggestionRender: null as (() => SlashSuggestionRenderHandlers) | null,
}))

vi.mock("@floating-ui/react-dom", () => ({
    autoUpdate: vi.fn(),
    flip: vi.fn(() => ({})),
    offset: vi.fn(() => ({})),
    shift: vi.fn(() => ({})),
    useFloating: () => ({
        refs: {
            setReference: vi.fn(),
            setFloating: vi.fn(),
        },
        floatingStyles: {},
    }),
}))

vi.mock("@tiptap/suggestion", () => ({
    default: (config: SuggestionConfig) => {
        if (config.char === "@") tiptapMocks.fileSuggestionItems = config.items ?? null
        if (config.char === "/") tiptapMocks.slashSuggestionRender = config.render ?? null
        return { name: `suggestion-${config.char}` }
    },
}))

vi.mock("@tiptap/react", async () => {
    const react = await vi.importActual<typeof import("react")>("react")
    const chain = {
        focus: () => chain,
        deleteRange: () => chain,
        insertContent: () => chain,
        run: () => true,
    }
    const editor = {
        chain: () => chain,
        commands: {
            blur: vi.fn(),
            clearContent: vi.fn(),
            focus: vi.fn(),
            setContent: vi.fn(),
        },
        getJSON: () => ({ type: "doc" }),
        setEditable: vi.fn(),
        state: {
            doc: {
                descendants: vi.fn(),
            },
        },
    }

    return {
        EditorContent: () => react.createElement("div", { "data-testid": "editor" }),
        Extension: {
            create: (config: { name: string; addProseMirrorPlugins?: (this: { editor: unknown }) => unknown[] }) => {
                config.addProseMirrorPlugins?.call({ editor })
                return { name: config.name }
            },
        },
        NodeViewWrapper: ({ as = "span", children }: { as?: string; children?: ReactNode }) => react.createElement(as, null, children),
        ReactNodeViewRenderer: () => ({}),
        useEditor: () => editor,
    }
})

vi.mock("@tiptap/extension-document", () => ({ default: { name: "document" } }))
vi.mock("@tiptap/extension-hard-break", () => ({ default: { name: "hardBreak" } }))
vi.mock("@tiptap/extension-history", () => ({ default: { name: "history" } }))
vi.mock("@tiptap/extension-paragraph", () => ({ default: { name: "paragraph" } }))
vi.mock("@tiptap/extension-placeholder", () => ({ default: { configure: vi.fn((config: unknown) => ({ name: "placeholder", config })) } }))
vi.mock("@tiptap/extension-text", () => ({ default: { name: "text" } }))
vi.mock("@tiptap/extension-mention", () => ({
    default: {
        extend: vi.fn(() => ({
            configure: vi.fn((config: { suggestion?: { char?: string; items?: SuggestionItems } }) => {
                if (config.suggestion?.char === "@") tiptapMocks.fileSuggestionItems = config.suggestion.items ?? null
                return { name: "mention", config }
            }),
        })),
    },
}))

interface Deferred<T> {
    promise: Promise<T>
    resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => undefined
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    return { promise, resolve }
}

function createManager(): SmartEditorManagerContract {
    return {
        value: "",
        files: [],
        editorContent: null,
        pendingImages: [],
        setValue: vi.fn(),
        setFiles: vi.fn(),
        setEditorContent: vi.fn(),
        setTextContent: vi.fn(),
        clear: vi.fn(),
        addImage: vi.fn(),
        insertFile: vi.fn(),
        canSearchFileMentions: vi.fn(() => true),
        getFileMentionFavorites: vi.fn(() => []),
        searchFileMentions: vi.fn(
            async (_dir: string, query: string): Promise<SmartEditorFileSearchResult> => ({
                results: [`${query}.ts`],
                treeMatch: null,
            })
        ),
        registerInsertCallback: vi.fn(),
        unregisterInsertCallback: vi.fn(),
        registerClearCallback: vi.fn(),
        unregisterClearCallback: vi.fn(),
        registerSetContentCallback: vi.fn(),
        unregisterSetContentCallback: vi.fn(),
    }
}

describe("SmartEditor file mentions", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        vi.useFakeTimers()
        tiptapMocks.fileSuggestionItems = null
        tiptapMocks.slashSuggestionRender = null
        const testGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
        previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
        testGlobal.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => {
            root.unmount()
        })
        container.remove()
        vi.useRealTimers()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("drops stale file mention queries while a runtime working-dir resolver is still pending", async () => {
        const { SmartEditor } = await import("./SmartEditor")
        const manager = createManager()
        const dirLoads = [createDeferred<string | null>(), createDeferred<string | null>(), createDeferred<string | null>()]
        const pendingDirLoads = [...dirLoads]
        const resolveWorkingDir = vi.fn(() => {
            const deferred = pendingDirLoads.shift()
            if (!deferred) throw new Error("unexpected working-dir load")
            return deferred.promise
        })

        await act(async () => {
            root.render(
                createElement(SmartEditor, {
                    manager,
                    fileMentionsDir: null,
                    slashCommandsDir: null,
                    resolveWorkingDir,
                })
            )
        })

        const fileSuggestionItems = tiptapMocks.fileSuggestionItems
        expect(fileSuggestionItems).not.toBeNull()
        if (!fileSuggestionItems) throw new Error("file suggestion items callback was not registered")

        await act(async () => {
            fileSuggestionItems({ query: "s" })
            fileSuggestionItems({ query: "sr" })
            fileSuggestionItems({ query: "src" })
        })

        expect(resolveWorkingDir).toHaveBeenCalledTimes(1)

        await act(async () => {
            dirLoads[0]?.resolve("/repo")
            await Promise.resolve()
        })

        await act(async () => {
            await vi.advanceTimersByTimeAsync(150)
        })

        expect(manager.searchFileMentions).toHaveBeenCalledTimes(1)
        expect(manager.searchFileMentions).toHaveBeenCalledWith("/repo", "src", 20)
    })

    it("shows local favorites for empty file mention queries without resolving or searching", async () => {
        const { SmartEditor } = await import("./SmartEditor")
        const manager = createManager()
        manager.getFileMentionFavorites = vi.fn(() => ["README.md", "src/App.tsx"])
        const resolveWorkingDir = vi.fn(async () => "/repo")

        await act(async () => {
            root.render(
                createElement(SmartEditor, {
                    manager,
                    fileMentionsDir: null,
                    slashCommandsDir: null,
                    resolveWorkingDir,
                })
            )
        })

        const fileSuggestionItems = tiptapMocks.fileSuggestionItems
        expect(fileSuggestionItems).not.toBeNull()
        if (!fileSuggestionItems) throw new Error("file suggestion items callback was not registered")

        await act(async () => {
            fileSuggestionItems({ query: "" })
            await vi.advanceTimersByTimeAsync(200)
        })

        expect(resolveWorkingDir).not.toHaveBeenCalled()
        expect(manager.getFileMentionFavorites).toHaveBeenCalledWith(20)
        expect(manager.searchFileMentions).not.toHaveBeenCalled()
    })

    it("keeps SDK slash-command discovery lazy until the slash popup opens", async () => {
        const { SmartEditor } = await import("./SmartEditor")
        const manager = createManager()
        const sdkCapabilities: SmartEditorSdkCapabilitiesContract = {
            slashCommands: [],
            skills: [],
            allCommands: [],
            loadCapabilities: vi.fn(async () => undefined),
        }
        const resolveSdkCapabilities = vi.fn(() => sdkCapabilities)

        await act(async () => {
            root.render(
                createElement(SmartEditor, {
                    manager,
                    fileMentionsDir: null,
                    slashCommandsDir: "/repo",
                    resolveSdkCapabilities,
                })
            )
        })

        expect(resolveSdkCapabilities).not.toHaveBeenCalled()
        expect(sdkCapabilities.loadCapabilities).not.toHaveBeenCalled()

        const renderSlashSuggestion = tiptapMocks.slashSuggestionRender
        expect(renderSlashSuggestion).not.toBeNull()
        if (!renderSlashSuggestion) throw new Error("slash suggestion render callback was not registered")

        await act(async () => {
            renderSlashSuggestion().onStart({
                items: [],
                query: "",
                clientRect: () => null,
            })
        })

        expect(resolveSdkCapabilities).toHaveBeenCalledTimes(1)
        expect(sdkCapabilities.loadCapabilities).toHaveBeenCalledTimes(1)
        expect(sdkCapabilities.loadCapabilities).toHaveBeenCalledWith("/repo")
    })

    it("runs only one active file mention search and then the latest queued query", async () => {
        const { SmartEditor } = await import("./SmartEditor")
        const manager = createManager()
        const firstSearch = createDeferred<SmartEditorFileSearchResult>()
        manager.searchFileMentions = vi.fn(async (_dir: string, query: string) => {
            if (query === "s") return firstSearch.promise
            return { results: [`${query}.ts`], treeMatch: null }
        })

        await act(async () => {
            root.render(
                createElement(SmartEditor, {
                    manager,
                    fileMentionsDir: "/repo",
                    slashCommandsDir: null,
                })
            )
        })

        const fileSuggestionItems = tiptapMocks.fileSuggestionItems
        expect(fileSuggestionItems).not.toBeNull()
        if (!fileSuggestionItems) throw new Error("file suggestion items callback was not registered")

        await act(async () => {
            fileSuggestionItems({ query: "s" })
            await vi.advanceTimersByTimeAsync(150)
        })

        expect(manager.searchFileMentions).toHaveBeenCalledTimes(1)
        expect(manager.searchFileMentions).toHaveBeenLastCalledWith("/repo", "s", 20)

        await act(async () => {
            fileSuggestionItems({ query: "sr" })
            await vi.advanceTimersByTimeAsync(150)
            fileSuggestionItems({ query: "src" })
            await vi.advanceTimersByTimeAsync(150)
        })

        expect(manager.searchFileMentions).toHaveBeenCalledTimes(1)

        await act(async () => {
            firstSearch.resolve({ results: ["s.ts"], treeMatch: null })
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(manager.searchFileMentions).toHaveBeenCalledTimes(2)
        expect(manager.searchFileMentions).toHaveBeenLastCalledWith("/repo", "src", 20)
    })
})
