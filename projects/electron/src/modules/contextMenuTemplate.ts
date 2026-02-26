import type { ContextMenuParams, MenuItemConstructorOptions } from "electron"

export interface NativeContextMenuActions {
    replaceMisspelling: (word: string) => void
    learnSpelling: (word: string) => void
    lookUpSelection: () => void
    copyImageAt: (x: number, y: number) => void
    copyImageAddress: (url: string) => void
    copyVideoAddress: (url: string) => void
    copyLink: (url: string, text: string) => void
}

const buildMenuSections = (sections: MenuItemConstructorOptions[][]): MenuItemConstructorOptions[] => {
    const template: MenuItemConstructorOptions[] = []
    for (const section of sections) {
        if (section.length === 0) {
            continue
        }
        if (template.length > 0) {
            template.push({ type: "separator" })
        }
        template.push(...section)
    }
    return template
}

const trimAndEscape = (value: string): string => {
    return value.trim().replaceAll("&", "&&")
}

const toLookupLabel = (selectionText: string): string => {
    const trimmed = trimAndEscape(selectionText)
    if (trimmed.length <= 25) {
        return `Look Up "${trimmed}"`
    }
    return `Look Up "${trimmed.slice(0, 24)}..."`
}

export const buildNativeContextMenuTemplate = (
    params: ContextMenuParams,
    actions: NativeContextMenuActions,
    platform: NodeJS.Platform = process.platform
): MenuItemConstructorOptions[] => {
    const hasSelection = params.selectionText.trim().length > 0
    const hasMisspelledWord = params.isEditable && params.misspelledWord.trim().length > 0

    const editFlags = params.editFlags ?? {
        canCut: false,
        canCopy: false,
        canPaste: false,
        canSelectAll: false,
    }

    const spellSection: MenuItemConstructorOptions[] = []
    if (hasMisspelledWord) {
        if (params.dictionarySuggestions.length > 0) {
            spellSection.push(
                ...params.dictionarySuggestions.map((suggestion) => ({
                    label: trimAndEscape(suggestion),
                    click: () => actions.replaceMisspelling(suggestion),
                }))
            )
        } else {
            spellSection.push({
                label: "No Guesses Found",
                enabled: false,
            })
        }

        spellSection.push(
            { type: "separator" },
            {
                label: "Learn Spelling",
                click: () => actions.learnSpelling(params.misspelledWord),
            }
        )
    }

    const lookupSection: MenuItemConstructorOptions[] = []
    if (platform === "darwin" && hasSelection && params.linkURL.length === 0) {
        lookupSection.push({
            label: toLookupLabel(params.selectionText),
            click: () => actions.lookUpSelection(),
        })
    }

    const editSection: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
        editSection.push(
            { role: "cut", enabled: editFlags.canCut },
            { role: "copy", enabled: editFlags.canCopy },
            { role: "paste", enabled: editFlags.canPaste }
        )
    } else if (hasSelection) {
        editSection.push({ role: "copy", enabled: editFlags.canCopy })
    }

    const showSelectAll = editFlags.canSelectAll && (params.isEditable || hasSelection || platform !== "darwin")
    if (showSelectAll) {
        editSection.push({ role: "selectAll" })
    }

    const mediaSection: MenuItemConstructorOptions[] = []
    if (params.mediaType === "image") {
        if (params.hasImageContents) {
            mediaSection.push({
                label: "Copy Image",
                click: () => actions.copyImageAt(params.x, params.y),
            })
        }
        if (params.srcURL.length > 0) {
            mediaSection.push({
                label: "Copy Image Address",
                click: () => actions.copyImageAddress(params.srcURL),
            })
        }
    }
    if (params.mediaType === "video" && params.srcURL.length > 0) {
        mediaSection.push({
            label: "Copy Video Address",
            click: () => actions.copyVideoAddress(params.srcURL),
        })
    }

    const linkSection: MenuItemConstructorOptions[] = []
    if (params.linkURL.length > 0 && params.mediaType === "none") {
        linkSection.push({
            label: "Copy Link",
            click: () => actions.copyLink(params.linkURL, params.linkText),
        })
    }

    const servicesSection: MenuItemConstructorOptions[] = []
    if (platform === "darwin" && (params.isEditable || hasSelection)) {
        servicesSection.push({ role: "services" })
    }

    return buildMenuSections([spellSection, lookupSection, editSection, mediaSection, linkSection, servicesSection])
}
