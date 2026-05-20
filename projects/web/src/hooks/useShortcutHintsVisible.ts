import { useCodeStore } from "../store/context"
import { useMetaKeyPressed } from "./useMetaKeyPressed"

export function useShortcutHintsVisible(): boolean {
    const codeStore = useCodeStore()
    const metaPressed = useMetaKeyPressed()
    const hidden = codeStore.personalSettingsStore?.settings.current.shortcutHintsHidden ?? false

    return metaPressed && !hidden
}
