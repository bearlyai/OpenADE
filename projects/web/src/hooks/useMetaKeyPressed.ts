import { useEffect, useState } from "react"

let metaKeyPressed = false
const subscribers = new Set<(pressed: boolean) => void>()

function setMetaKeyPressed(pressed: boolean) {
    if (metaKeyPressed === pressed) return
    metaKeyPressed = pressed
    for (const subscriber of subscribers) {
        subscriber(pressed)
    }
}

export function resetMetaKeyPressed() {
    setMetaKeyPressed(false)
}

function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Meta" || event.metaKey) {
        setMetaKeyPressed(true)
    }
}

function handleKeyUp(event: KeyboardEvent) {
    if (event.key === "Meta" || !event.metaKey) {
        setMetaKeyPressed(false)
    }
}

function handleBlur() {
    setMetaKeyPressed(false)
}

function addWindowListeners() {
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
}

function removeWindowListeners() {
    window.removeEventListener("keydown", handleKeyDown)
    window.removeEventListener("keyup", handleKeyUp)
    window.removeEventListener("blur", handleBlur)
}

export function useMetaKeyPressed(): boolean {
    const [pressed, setPressed] = useState(metaKeyPressed)

    useEffect(() => {
        subscribers.add(setPressed)
        if (subscribers.size === 1) {
            addWindowListeners()
        }

        return () => {
            subscribers.delete(setPressed)
            if (subscribers.size === 0) {
                removeWindowListeners()
            }
        }
    }, [])

    return pressed
}
