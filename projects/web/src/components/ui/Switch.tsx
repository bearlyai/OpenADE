/**
 * Switch
 *
 * Toggle switch component. Flat, square design following Theme V2.
 */

import { Switch as SwitchBase } from "@base-ui-components/react/switch"
import { twMerge } from "tailwind-merge"

interface SwitchProps {
    checked?: boolean
    defaultChecked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
    readOnly?: boolean
    required?: boolean
    name?: string
    "aria-label"?: string
    className?: {
        root?: string
        thumb?: string
    }
}

export function Switch({
    checked,
    defaultChecked,
    onCheckedChange,
    disabled = false,
    readOnly = false,
    required = false,
    name,
    "aria-label": ariaLabel,
    className = {},
}: SwitchProps) {
    return (
        <SwitchBase.Root
            checked={checked}
            defaultChecked={defaultChecked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            readOnly={readOnly}
            required={required}
            name={name}
            aria-label={ariaLabel}
            className={twMerge(
                "relative flex h-5 w-10 p-0.5 outline-none transition-colors duration-150",
                "bg-primary/10 data-[checked]:bg-primary",
                "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100",
                className.root
            )}
        >
            <SwitchBase.Thumb className={twMerge("h-4 w-4 bg-white transition-transform duration-150", "data-[checked]:translate-x-5", className.thumb)} />
        </SwitchBase.Root>
    )
}
