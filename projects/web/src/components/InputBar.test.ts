import { type ComponentProps, createElement } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CodeStoreProvider } from "../store/context"
import type { CodeStore } from "../store/store"
import type { SmartEditorRef } from "./SmartEditor"
import { InputBar } from "./InputBar"

interface CapturedSmartEditorProps {
    resolveWorkingDir?: () => Promise<string | null>
    enableImagePasteDrop?: boolean
}

let capturedSmartEditorProps: CapturedSmartEditorProps | null = null

vi.mock("./SmartEditor", async () => {
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

describe("InputBar", () => {
    afterEach(() => {
        capturedSmartEditorProps = null
    })

    it("passes the lazy working directory resolver to SmartEditor", async () => {
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)
        const resolveWorkingDir = vi.fn(async () => "/tmp/runtime-repo")
        const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const fakeStore = {
            personalSettingsStore: {
                settings: {
                    current: {
                        shortcutHintsHidden: true,
                    },
                },
            },
        } as unknown as CodeStore
        const props = {
            input: {
                commands: [],
                queuedTurns: [],
                canAttachImages: true,
                isDisabled: false,
                runCommand: vi.fn(),
                cancelQueuedTurn: vi.fn(),
                persistImage: vi.fn(),
            },
            editorManager: {
                workspaceId: "repo-1",
                id: "task-task-1",
                pendingImages: [],
                pendingImageDataUrls: new Map(),
                addImage: vi.fn(),
                removeImage: vi.fn(),
            },
            tray: {
                isOpen: false,
                openTray: null,
                close: vi.fn(),
            },
            fileMentionsDir: null,
            slashCommandsDir: null,
            resolveWorkingDir,
            hideTray: true,
        } as unknown as ComponentProps<typeof InputBar>

        try {
            await act(async () => {
                root.render(createElement(CodeStoreProvider, { store: fakeStore }, createElement(InputBar, props)))
            })

            await vi.waitFor(() => {
                expect(capturedSmartEditorProps?.resolveWorkingDir).toBe(resolveWorkingDir)
            })
            await expect(capturedSmartEditorProps?.resolveWorkingDir?.()).resolves.toBe("/tmp/runtime-repo")
            expect(resolveWorkingDir).toHaveBeenCalledTimes(1)
        } finally {
            await act(async () => root.unmount())
            container.remove()
            ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
        }
    })

    it("hides queued-turn cancellation when the input manager cannot cancel", async () => {
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)
        const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const fakeStore = {
            personalSettingsStore: {
                settings: {
                    current: {
                        shortcutHintsHidden: true,
                    },
                },
            },
        } as unknown as CodeStore
        const props = {
            input: {
                commands: [],
                queuedTurns: [
                    {
                        id: "queued-do",
                        type: "do",
                        input: "Run this next",
                        status: "queued",
                        createdAt: "2026-06-12T00:00:00.000Z",
                        updatedAt: "2026-06-12T00:00:00.000Z",
                    },
                ],
                canCancelQueuedTurn: false,
                canAttachImages: false,
                isDisabled: false,
                runCommand: vi.fn(),
                cancelQueuedTurn: vi.fn(),
                persistImage: vi.fn(),
            },
            editorManager: {
                workspaceId: "repo-1",
                id: "task-task-1",
                pendingImages: [],
                pendingImageDataUrls: new Map(),
                addImage: vi.fn(),
                removeImage: vi.fn(),
            },
            tray: {
                isOpen: false,
                openTray: null,
                close: vi.fn(),
            },
            fileMentionsDir: null,
            slashCommandsDir: null,
            hideTray: true,
        } as unknown as ComponentProps<typeof InputBar>

        try {
            await act(async () => {
                root.render(createElement(CodeStoreProvider, { store: fakeStore }, createElement(InputBar, props)))
            })

            expect(container.textContent).toContain("Run this next")
            expect(container.querySelector('[aria-label="Cancel queued do"]')).toBeNull()
        } finally {
            await act(async () => root.unmount())
            container.remove()
            ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
        }
    })

    it("hides image attachment and disables editor image paste when image upload is unavailable", async () => {
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)
        const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const fakeStore = {
            personalSettingsStore: {
                settings: {
                    current: {
                        shortcutHintsHidden: true,
                    },
                },
            },
        } as unknown as CodeStore
        const props = {
            input: {
                commands: [],
                queuedTurns: [],
                canCancelQueuedTurn: true,
                canAttachImages: false,
                isDisabled: false,
                runCommand: vi.fn(),
                cancelQueuedTurn: vi.fn(),
                persistImage: vi.fn(),
            },
            editorManager: {
                workspaceId: "repo-1",
                id: "task-task-1",
                pendingImages: [],
                pendingImageDataUrls: new Map(),
                addImage: vi.fn(),
                removeImage: vi.fn(),
            },
            tray: {
                isOpen: false,
                openTray: null,
                close: vi.fn(),
            },
            fileMentionsDir: null,
            slashCommandsDir: null,
            hideTray: true,
        } as unknown as ComponentProps<typeof InputBar>

        try {
            await act(async () => {
                root.render(createElement(CodeStoreProvider, { store: fakeStore }, createElement(InputBar, props)))
            })

            expect(capturedSmartEditorProps?.enableImagePasteDrop).toBe(false)
            expect(container.querySelector('[aria-label="Attach image"]')).toBeNull()
        } finally {
            await act(async () => root.unmount())
            container.remove()
            ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
        }
    })
})
