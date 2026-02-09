import cx from "classnames"
import { GitBranch, ImagePlus, X } from "lucide-react"
import { observer } from "mobx-react"
import { useRef } from "react"
import { Z_INDEX } from "../constants"
import type { ClaudeModelId } from "../constants"
import type { GitStatusResponse } from "../electronAPI/git"
import type { Command, InputManager } from "../store/managers/InputManager"
import type { SdkCapabilitiesManager } from "../store/managers/SdkCapabilitiesManager"
import type { SmartEditorManager } from "../store/managers/SmartEditorManager"
import type { TrayManager } from "../store/managers/TrayManager"
import type { Comment } from "../types"
import { ModelPicker } from "./ModelPicker"
import { processImageBlob } from "../utils/imageAttachment"
import { SmartEditor, type SmartEditorRef } from "./SmartEditor"
import { CommentsSection } from "./events/CommentsSection"
import { TrayButtons, TraySlideOut, getTrayConfig } from "./tray"

function truncateMiddle(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str
    const ellipsis = "…"
    const charsToShow = maxLen - ellipsis.length
    const frontChars = Math.ceil(charsToShow / 2)
    const backChars = Math.floor(charsToShow / 2)
    return str.slice(0, frontChars) + ellipsis + str.slice(-backChars)
}

// Button variant styles
const BUTTON_BASE = "btn flex items-center justify-center gap-2 px-4 h-9 text-sm font-medium transition-all duration-100 whitespace-nowrap"

// Semantic button styles - each variant has enabled and disabled states
// Disabled states preserve the button's color identity with reduced opacity
const BUTTON_STYLES = {
    primary: {
        enabled: "bg-primary text-primary-content cursor-pointer hover:bg-primary/80 active:bg-primary/70 active:scale-95",
        disabled: "bg-primary/40 text-primary-content/50 cursor-not-allowed",
    },
    success: {
        enabled: "bg-success text-success-content cursor-pointer hover:bg-success/80 active:bg-success/70 active:scale-95",
        disabled: "bg-success/40 text-success-content/50 cursor-not-allowed",
    },
    danger: {
        enabled: "bg-error text-error-content cursor-pointer hover:bg-error/80 active:bg-error/70 active:scale-95",
        disabled: "bg-error/40 text-error-content/50 cursor-not-allowed",
    },
    neutral: {
        enabled: "bg-base-200 text-base-content cursor-pointer hover:bg-base-300 active:bg-base-300 active:scale-95",
        disabled: "bg-base-200/40 text-base-content/50 cursor-not-allowed",
    },
    ghost: {
        enabled: "text-base-content cursor-pointer hover:bg-base-200 active:bg-base-300 active:scale-95",
        disabled: "text-muted/50 cursor-not-allowed",
    },
} as const

type ButtonVariant = keyof typeof BUTTON_STYLES

/** Reusable action button that renders a Command */
function CommandButton({ command, onExecute }: { command: Command; onExecute: (id: string) => void }) {
    const Icon = command.icon
    const variant = (command.style?.variant ?? "ghost") as ButtonVariant
    const styles = BUTTON_STYLES[variant]

    return (
        <button
            type="button"
            onClick={() => onExecute(command.id)}
            disabled={!command.enabled}
            className={cx(BUTTON_BASE, command.enabled ? styles.enabled : styles.disabled)}
        >
            <Icon size={14} />
            {command.label}
        </button>
    )
}

export const InputBar = observer(function InputBar({
    input,
    editorManager,
    tray,
    gitStatus,
    fileMentionsDir,
    slashCommandsDir,
    sdkCapabilities,
    unsubmittedComments = [],
    selectedModel,
    onModelChange,
    hideTray = false,
}: {
    input: InputManager
    editorManager: SmartEditorManager
    tray: TrayManager
    gitStatus?: GitStatusResponse | null
    /** Directory for @file mention autocomplete, null to disable */
    fileMentionsDir: string | null
    /** Directory for /slash command autocomplete, null to disable */
    slashCommandsDir: string | null
    /** SDK capabilities manager for slash command discovery */
    sdkCapabilities?: SdkCapabilitiesManager
    unsubmittedComments?: Comment[]
    selectedModel?: ClaudeModelId
    onModelChange?: (model: ClaudeModelId) => void
    /** Dev: Hide tray buttons and slide-out */
    hideTray?: boolean
}) {
    const editorRef = useRef<SmartEditorRef>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Get commands from InputManager
    const { commands } = input
    const hasComments = unsubmittedComments.length > 0
    const hasPendingImages = editorManager.pendingImages.length > 0

    // Get tray content from config
    const trayConfig = tray.openTray ? getTrayConfig(tray.openTray) : null
    const trayContent = trayConfig?.renderContent(tray) ?? null

    return (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4" style={{ zIndex: Z_INDEX.INPUT_BAR }}>
            {!hideTray && (
                <TraySlideOut open={tray.isOpen} noPadding>
                    {trayContent}
                </TraySlideOut>
            )}
            <div className="bg-base-100 border border-border shadow-lg">
                {/* Tray toggle buttons */}
                {!hideTray && (
                    <div className="flex items-center gap-1 p-1">
                        <TrayButtons tray={tray} />
                        {gitStatus?.branch && (
                            <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono text-muted ml-auto">
                                <GitBranch size={12} />
                                <span title={gitStatus.branch}>{truncateMiddle(gitStatus.branch, 24)}</span>
                            </div>
                        )}
                        {selectedModel && onModelChange && (
                            <div className={cx(!gitStatus?.branch && "ml-auto")}>
                                <ModelPicker value={selectedModel} onChange={onModelChange} />
                            </div>
                        )}
                    </div>
                )}

                {/* Pending comments section */}
                {hasComments && <CommentsSection comments={unsubmittedComments} variant="pending" />}

                {/* Text input area with image attach overlay */}
                <div className="relative">
                    <SmartEditor
                        ref={editorRef}
                        manager={editorManager}
                        fileMentionsDir={fileMentionsDir}
                        slashCommandsDir={slashCommandsDir}
                        sdkCapabilities={sdkCapabilities}
                        placeholder={input.isDisabled ? "Task is closed. Click Reopen to continue." : "What would you like to do?"}
                        className={cx(
                            "min-h-[58px] max-h-[150px] overflow-y-auto text-sm leading-[20px] border-x-0 focus-within:border-border",
                            input.isDisabled && "opacity-50 pointer-events-none"
                        )}
                        editorClassName="px-2.5 py-[9px]"
                    />
                    {/* Image attach button - bottom right of textarea */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) {
                                processImageBlob(file)
                                    .then(({ attachment, dataUrl }) => editorManager.addImage(attachment, dataUrl))
                                    .catch((err) => console.error("[InputBar] Failed to process image:", err))
                                e.target.value = ""
                            }
                        }}
                    />
                    <button
                        type="button"
                        className={cx(
                            "btn absolute bottom-1.5 right-1.5 p-1.5 text-muted hover:text-base-content hover:bg-base-300/50 transition-colors",
                            input.isDisabled && "opacity-50 pointer-events-none"
                        )}
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach image"
                    >
                        <ImagePlus size={14} />
                    </button>
                </div>

                {/* Image preview strip */}
                {hasPendingImages && (
                    <div className="flex gap-2 px-3 py-2 border-t border-border overflow-x-auto">
                        {editorManager.pendingImages.map((img) => (
                            <div key={img.id} className="relative shrink-0 group">
                                <img
                                    src={editorManager.pendingImageDataUrls.get(img.id)}
                                    alt=""
                                    className="h-20 object-cover"
                                    style={{ aspectRatio: `${img.resizedWidth}/${img.resizedHeight}` }}
                                />
                                <button
                                    type="button"
                                    className="btn absolute -top-1.5 -right-1.5 bg-base-300 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => editorManager.removeImage(img.id)}
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Action buttons row - rendered from centralized commands */}
                <div className="flex items-center gap-2 px-2 py-2 bg-base-200">
                    {commands.map((cmd) => (
                        <div key={cmd.id} className={cx(cmd.spacer && "ml-auto", !cmd.spacer && input.isDisabled && "opacity-50 pointer-events-none")}>
                            <CommandButton
                                command={cmd}
                                onExecute={(id) => {
                                    tray.close()
                                    input.runCommand(id)
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
})
