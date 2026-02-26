import type { ContextMenuParams, MenuItemConstructorOptions } from "electron"
import { describe, expect, it, vi } from "vitest"
import { buildNativeContextMenuTemplate, type NativeContextMenuActions } from "./contextMenuTemplate"

const makeActions = (): {
    actions: NativeContextMenuActions
    replaceMisspelling: ReturnType<typeof vi.fn>
    learnSpelling: ReturnType<typeof vi.fn>
    lookUpSelection: ReturnType<typeof vi.fn>
    copyImageAt: ReturnType<typeof vi.fn>
    copyImageAddress: ReturnType<typeof vi.fn>
    copyVideoAddress: ReturnType<typeof vi.fn>
    copyLink: ReturnType<typeof vi.fn>
} => {
    const replaceMisspelling = vi.fn()
    const learnSpelling = vi.fn()
    const lookUpSelection = vi.fn()
    const copyImageAt = vi.fn()
    const copyImageAddress = vi.fn()
    const copyVideoAddress = vi.fn()
    const copyLink = vi.fn()

    return {
        actions: {
            replaceMisspelling,
            learnSpelling,
            lookUpSelection,
            copyImageAt,
            copyImageAddress,
            copyVideoAddress,
            copyLink,
        },
        replaceMisspelling,
        learnSpelling,
        lookUpSelection,
        copyImageAt,
        copyImageAddress,
        copyVideoAddress,
        copyLink,
    }
}

const makeParams = (overrides: Partial<ContextMenuParams> = {}): ContextMenuParams => {
    return {
        x: 0,
        y: 0,
        isEditable: false,
        selectionText: "",
        misspelledWord: "",
        dictionarySuggestions: [],
        spellcheckEnabled: true,
        linkURL: "",
        linkText: "",
        srcURL: "",
        mediaType: "none",
        hasImageContents: false,
        editFlags: {
            canCut: false,
            canCopy: false,
            canPaste: false,
            canUndo: false,
            canRedo: false,
            canDelete: false,
            canSelectAll: false,
            canEditRichly: false,
        },
        ...overrides,
    } as ContextMenuParams
}

const findByLabel = (template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions | undefined => {
    return template.find((item) => item.label === label)
}

describe("buildNativeContextMenuTemplate", () => {
    it("includes native edit roles for editable targets", () => {
        const { actions } = makeActions()
        const template = buildNativeContextMenuTemplate(
            makeParams({
                isEditable: true,
                editFlags: {
                    canCut: true,
                    canCopy: true,
                    canPaste: true,
                    canUndo: false,
                    canRedo: false,
                    canDelete: false,
                    canSelectAll: true,
                    canEditRichly: false,
                },
            }),
            actions,
            "linux"
        )

        const roles = template.map((item) => item.role).filter(Boolean)
        expect(roles).toContain("cut")
        expect(roles).toContain("copy")
        expect(roles).toContain("paste")
        expect(roles).toContain("selectAll")
    })

    it("includes spelling suggestions and learn spelling for misspelled words", () => {
        const { actions, replaceMisspelling, learnSpelling } = makeActions()
        const template = buildNativeContextMenuTemplate(
            makeParams({
                isEditable: true,
                misspelledWord: "teh",
                dictionarySuggestions: ["the", "tech"],
            }),
            actions,
            "darwin"
        )

        const firstSuggestion = findByLabel(template, "the")
        const learn = findByLabel(template, "Learn Spelling")

        expect(firstSuggestion).toBeDefined()
        expect(learn).toBeDefined()

        firstSuggestion?.click?.(undefined as never, undefined as never, undefined as never)
        learn?.click?.(undefined as never, undefined as never, undefined as never)

        expect(replaceMisspelling).toHaveBeenCalledWith("the")
        expect(learnSpelling).toHaveBeenCalledWith("teh")
    })

    it("includes no-guesses row when misspelled word has no suggestions", () => {
        const { actions } = makeActions()
        const template = buildNativeContextMenuTemplate(
            makeParams({
                isEditable: true,
                misspelledWord: "teh",
                dictionarySuggestions: [],
            }),
            actions,
            "linux"
        )

        const noGuesses = findByLabel(template, "No Guesses Found")
        expect(noGuesses).toBeDefined()
        expect(noGuesses?.enabled).toBe(false)
    })

    it("includes image actions and dispatches copy image handlers", () => {
        const { actions, copyImageAt, copyImageAddress } = makeActions()
        const template = buildNativeContextMenuTemplate(
            makeParams({
                mediaType: "image",
                hasImageContents: true,
                srcURL: "https://example.com/cat.png",
                x: 44,
                y: 55,
            }),
            actions,
            "linux"
        )

        const copyImage = findByLabel(template, "Copy Image")
        const copyImageAddressItem = findByLabel(template, "Copy Image Address")

        expect(copyImage).toBeDefined()
        expect(copyImageAddressItem).toBeDefined()

        copyImage?.click?.(undefined as never, undefined as never, undefined as never)
        copyImageAddressItem?.click?.(undefined as never, undefined as never, undefined as never)

        expect(copyImageAt).toHaveBeenCalledWith(44, 55)
        expect(copyImageAddress).toHaveBeenCalledWith("https://example.com/cat.png")
    })

    it("includes copy link action for non-media links", () => {
        const { actions, copyLink } = makeActions()
        const template = buildNativeContextMenuTemplate(
            makeParams({
                mediaType: "none",
                linkURL: "https://openade.ai",
                linkText: "OpenADE",
            }),
            actions,
            "linux"
        )

        const copyLinkItem = findByLabel(template, "Copy Link")
        expect(copyLinkItem).toBeDefined()

        copyLinkItem?.click?.(undefined as never, undefined as never, undefined as never)
        expect(copyLink).toHaveBeenCalledWith("https://openade.ai", "OpenADE")
    })

    it("adds macOS lookup and services items when text is selected", () => {
        const { actions, lookUpSelection } = makeActions()
        const template = buildNativeContextMenuTemplate(
            makeParams({
                selectionText: "selected text",
                editFlags: {
                    canCut: false,
                    canCopy: true,
                    canPaste: false,
                    canUndo: false,
                    canRedo: false,
                    canDelete: false,
                    canSelectAll: true,
                    canEditRichly: false,
                },
            }),
            actions,
            "darwin"
        )

        const lookup = template.find((item) => typeof item.label === "string" && item.label.startsWith("Look Up "))
        const services = template.find((item) => item.role === "services")

        expect(lookup).toBeDefined()
        expect(services).toBeDefined()

        lookup?.click?.(undefined as never, undefined as never, undefined as never)
        expect(lookUpSelection).toHaveBeenCalled()
    })

    it("does not produce leading, trailing, or duplicate separators", () => {
        const { actions } = makeActions()
        const template = buildNativeContextMenuTemplate(
            makeParams({
                isEditable: true,
                selectionText: "abc",
                misspelledWord: "teh",
                dictionarySuggestions: ["the"],
                mediaType: "image",
                hasImageContents: true,
                srcURL: "https://example.com/cat.png",
                linkURL: "https://openade.ai",
                linkText: "OpenADE",
                editFlags: {
                    canCut: true,
                    canCopy: true,
                    canPaste: true,
                    canUndo: false,
                    canRedo: false,
                    canDelete: false,
                    canSelectAll: true,
                    canEditRichly: false,
                },
            }),
            actions,
            "darwin"
        )

        expect(template[0]?.type).not.toBe("separator")
        expect(template[template.length - 1]?.type).not.toBe("separator")

        for (let i = 1; i < template.length; i++) {
            expect(!(template[i - 1]?.type === "separator" && template[i]?.type === "separator")).toBe(true)
        }
    })
})
