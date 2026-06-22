import { type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ScratchpadMeta } from "../../persistence/scratchpadStore"
import { CodeStoreProvider } from "../../store/context"
import type { SmartEditorManager } from "../../store/managers/SmartEditorManager"
import type { CodeStore } from "../../store/store"
import type { SmartEditorRef } from "../SmartEditor"
import { ScratchpadTrayContent } from "./ScratchpadTrayContent"

interface CapturedSmartEditorProps {
    fileMentionsDir?: string | null
    slashCommandsDir?: string | null
    resolveWorkingDir?: () => Promise<string | null>
    sdkCapabilities?: unknown
}

let capturedSmartEditorProps: CapturedSmartEditorProps | null = null

vi.mock("../SmartEditor", async () => {
    const React = await import("react")
    return {
        SmartEditor: React.forwardRef<SmartEditorRef, CapturedSmartEditorProps>((props, ref) => {
            capturedSmartEditorProps = props
            React.useImperativeHandle(ref, () => ({
                focus: () => undefined,
                focusEnd: () => undefined,
                blur: () => undefined,
                clear: () => undefined,
            }))
            return React.createElement("div", { "data-testid": "smart-editor" })
        }),
    }
})

const pad: ScratchpadMeta = {
    id: "pad-1",
    title: "Notes",
    preview: "",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
}

function createEditorManager(): SmartEditorManager {
    return {
        workspaceId: "repo-1",
        id: "scratchpad-pad-1",
        value: "",
        editorContent: null,
        setEditorContent: vi.fn(),
        setValue: vi.fn(),
    } as unknown as SmartEditorManager
}

function createStore(): CodeStore {
    return {
        scratchpads: {
            ensureIndexLoaded: vi.fn(async () => undefined),
            loadContent: vi.fn(async () => undefined),
            getPads: vi.fn(() => [pad]),
            getPadMeta: vi.fn(() => pad),
            getContentStore: vi.fn(() => ({
                data: {
                    get: () => ({ content: null, plainText: "" }),
                },
            })),
            updateContent: vi.fn(),
            createPad: vi.fn(() => "pad-1"),
            deletePad: vi.fn(),
        },
        smartEditors: {
            getManager: vi.fn(() => createEditorManager()),
            disposeManager: vi.fn(),
        },
    } as unknown as CodeStore
}

describe("ScratchpadTrayContent", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        capturedSmartEditorProps = null
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        capturedSmartEditorProps = null
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    async function render(element: ReactElement): Promise<void> {
        await act(async () => {
            root.render(element)
            await Promise.resolve()
            await new Promise((resolve) => window.setTimeout(resolve, 0))
        })
    }

    it("keeps scratchpads on file mentions without raw SDK slash-command discovery", async () => {
        const resolveRepoPath = vi.fn(async () => "/tmp/repo")

        await render(
            createElement(
                CodeStoreProvider,
                { store: createStore() },
                createElement(ScratchpadTrayContent, { workspaceId: "repo-1", repoPath: null, resolveRepoPath })
            )
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(capturedSmartEditorProps?.fileMentionsDir).toBeNull()
        expect(capturedSmartEditorProps?.slashCommandsDir).toBeNull()
        expect(capturedSmartEditorProps?.resolveWorkingDir).toBe(resolveRepoPath)
        expect(capturedSmartEditorProps?.sdkCapabilities).toBeUndefined()
    })
})
