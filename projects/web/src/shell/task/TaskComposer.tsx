import { ImagePlus, Loader2, RefreshCcw, Send, Square, X } from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"
import { FastModeToggle } from "../../components/FastModeToggle"
import { HarnessPicker } from "../../components/HarnessPicker"
import { ModelPicker } from "../../components/ModelPicker"
import { ThinkingPicker } from "../../components/ThinkingPicker"
import { ShortcutBadge } from "../../components/ui/ShortcutBadge"
import type { HarnessId } from "../../electronAPI/harnessEventTypes"
import { resetMetaKeyPressed } from "../../hooks/useMetaKeyPressed"
import type { ThinkingLevel } from "../../store/TaskModel"
import type { ImageAttachment } from "../../types"
import { isMetaOnlyShortcut } from "../../utils/keyboardShortcuts"
import { TASK_COMPOSER_COMMANDS, canQueueTaskCommandWhileRunning, taskCommandLabel, type TaskCommandType } from "./taskCommands"

export interface TaskComposerAgentControls {
    harnessId?: HarnessId
    allowHarnessSwitch?: boolean
    selectedModel?: string
    thinking?: ThinkingLevel
    fastMode?: boolean
    mcpControl?: ReactNode
    onHarnessChange?: (harnessId: HarnessId) => void
    onModelChange?: (modelId: string) => void
    onThinkingChange?: (level: ThinkingLevel) => void
    onFastModeChange?: (enabled: boolean) => void
}

export interface TaskComposerImageAttachment {
    attachment: ImageAttachment
    dataUrl: string
}

export interface TaskComposerAction {
    id: string
    label: string
    ariaLabel?: string
    shortcutLabel?: string
    onClick: () => void
    disabled?: boolean
}

export interface TaskComposerRepeatState {
    stopOnText: string
    maxRuns: number
    iterationCount: number
    onStopOnTextChange: (value: string) => void
    onMaxRunsChange: (value: number) => void
}

const EMPTY_IMAGE_ATTACHMENTS: readonly TaskComposerImageAttachment[] = []
const EMPTY_ACTIONS: readonly TaskComposerAction[] = []

export function TaskComposer({
    input,
    commandType,
    commands = TASK_COMPOSER_COMMANDS,
    isLoading,
    isSubmitting,
    isOnline,
    isRunning,
    agentControls,
    hyperplanControl,
    commandShortcutLabels,
    actions = EMPTY_ACTIONS,
    abortShortcutLabel,
    retryShortcutLabel,
    shortcutHintsVisible = false,
    imageAttachments = EMPTY_IMAGE_ATTACHMENTS,
    imageAttachLoading = false,
    repeatState,
    editor,
    inputDisabled = false,
    placeholder,
    sendLabel,
    onInputChange,
    onCommandTypeChange,
    onAttachImage,
    onRemoveImage,
    onFocusInputShortcut,
    onSend,
    onAbort,
    onRetry,
}: {
    input: string
    commandType: TaskCommandType
    commands?: readonly TaskCommandType[]
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    isRunning: boolean
    agentControls?: TaskComposerAgentControls
    hyperplanControl?: ReactNode
    commandShortcutLabels?: Partial<Record<TaskCommandType, string>>
    actions?: readonly TaskComposerAction[]
    abortShortcutLabel?: string
    retryShortcutLabel?: string
    shortcutHintsVisible?: boolean
    imageAttachments?: readonly TaskComposerImageAttachment[]
    imageAttachLoading?: boolean
    repeatState?: TaskComposerRepeatState
    editor?: ReactNode
    inputDisabled?: boolean
    placeholder?: string
    sendLabel?: string
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: TaskCommandType) => void
    onAttachImage?: (file: File) => void
    onRemoveImage?: (imageId: string) => void
    onFocusInputShortcut?: () => void
    onSend?: () => void
    onAbort?: () => void
    onRetry?: () => void
}) {
    const imageInputRef = useRef<HTMLInputElement | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const canQueueCurrentMode = !isRunning || canQueueTaskCommandWhileRunning(commandType)
    const showHarnessPicker = Boolean(agentControls?.allowHarnessSwitch && agentControls.harnessId && agentControls.onHarnessChange)
    const showModelPicker = Boolean(agentControls?.selectedModel && agentControls.onModelChange)
    const showThinkingPicker = Boolean(agentControls?.thinking && agentControls.onThinkingChange)
    const showFastMode = agentControls?.fastMode !== undefined && Boolean(agentControls.onFastModeChange)
    const showMcpControl = Boolean(agentControls?.mcpControl)
    const showAgentControls = showHarnessPicker || showModelPicker || showThinkingPicker || showFastMode || showMcpControl
    const showImageAttach = Boolean(onAttachImage)
    const showAbort = isRunning && Boolean(onAbort)
    const showRetry = !isRunning && Boolean(onRetry)
    const showCommandControls = commands.length > 0 || actions.length > 0 || showAbort || showRetry
    const hasSendHandler = Boolean(onSend)

    useEffect(() => {
        const handleFocusShortcut = (event: KeyboardEvent) => {
            if (!isMetaOnlyShortcut(event, "KeyL")) return
            if (isSubmitting || inputDisabled) return

            event.preventDefault()
            resetMetaKeyPressed()
            if (onFocusInputShortcut) {
                onFocusInputShortcut()
                return
            }

            const textarea = textareaRef.current
            if (!textarea) return
            textarea.focus()
            textarea.setSelectionRange(textarea.value.length, textarea.value.length)
        }

        window.addEventListener("keydown", handleFocusShortcut, true)
        return () => window.removeEventListener("keydown", handleFocusShortcut, true)
    }, [inputDisabled, isSubmitting, onFocusInputShortcut])

    return (
        <footer className="w-full max-w-full shrink-0 overflow-hidden border-t border-border bg-base-100 p-3">
            {showAgentControls && (
                <div className="mb-2 flex max-w-full items-center gap-2 overflow-x-auto overscroll-x-contain border-b border-border pb-2">
                    {showHarnessPicker && agentControls?.harnessId && agentControls.onHarnessChange && (
                        <div className="shrink-0">
                            <HarnessPicker value={agentControls.harnessId} onChange={agentControls.onHarnessChange} />
                        </div>
                    )}
                    {showModelPicker && agentControls?.selectedModel && agentControls.onModelChange && (
                        <div className="shrink-0">
                            <ModelPicker value={agentControls.selectedModel} onChange={agentControls.onModelChange} harnessId={agentControls.harnessId} />
                        </div>
                    )}
                    {showThinkingPicker && agentControls?.thinking && agentControls.onThinkingChange && (
                        <div className="shrink-0">
                            <ThinkingPicker value={agentControls.thinking} onChange={agentControls.onThinkingChange} />
                        </div>
                    )}
                    {showFastMode && agentControls?.onFastModeChange && (
                        <FastModeToggle enabled={agentControls.fastMode === true} onChange={agentControls.onFastModeChange} />
                    )}
                    {showMcpControl && agentControls?.mcpControl}
                </div>
            )}
            {showCommandControls && (
                <div className="mb-2 flex max-w-full gap-1 overflow-x-auto overscroll-x-contain">
                    {commands.map((type) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => onCommandTypeChange(type)}
                            disabled={isSubmitting || (isRunning && !canQueueTaskCommandWhileRunning(type))}
                            className={`btn relative shrink-0 border border-border px-2 py-1 text-xs ${commandType === type ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"}`}
                            aria-keyshortcuts={commandShortcutLabels?.[type] ? `Meta+${commandShortcutLabels[type]}` : undefined}
                        >
                            {taskCommandLabel(type)}
                            <ShortcutBadge label={commandShortcutLabels?.[type]} visible={shortcutHintsVisible} variant="corner" />
                        </button>
                    ))}
                    {actions.map((action) => (
                        <button
                            key={action.id}
                            type="button"
                            onClick={action.onClick}
                            disabled={isSubmitting || isLoading || !isOnline || action.disabled === true}
                            className="btn relative shrink-0 border border-border bg-base-200 px-2 py-1 text-xs text-base-content disabled:opacity-50"
                            aria-label={action.ariaLabel}
                            aria-keyshortcuts={action.shortcutLabel ? `Meta+${action.shortcutLabel}` : undefined}
                        >
                            {action.label}
                            <ShortcutBadge label={action.shortcutLabel} visible={shortcutHintsVisible} variant="corner" />
                        </button>
                    ))}
                    {showAbort && onAbort && (
                        <button
                            type="button"
                            onClick={onAbort}
                            aria-label="Abort task"
                            aria-keyshortcuts={abortShortcutLabel ? `Meta+${abortShortcutLabel}` : undefined}
                            className="btn relative ml-auto flex h-8 w-8 items-center justify-center bg-error/10 text-error"
                        >
                            <Square size={14} />
                            <ShortcutBadge label={abortShortcutLabel} visible={shortcutHintsVisible} variant="corner" />
                        </button>
                    )}
                    {showRetry && onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            disabled={isSubmitting || isLoading || !isOnline}
                            aria-label="Retry failed action"
                            title="Retry"
                            aria-keyshortcuts={retryShortcutLabel ? `Meta+${retryShortcutLabel}` : undefined}
                            className="btn relative ml-auto flex h-8 w-8 items-center justify-center bg-error/10 text-error disabled:opacity-50"
                        >
                            <RefreshCcw size={14} />
                            <ShortcutBadge label={retryShortcutLabel} visible={shortcutHintsVisible} variant="corner" />
                        </button>
                    )}
                </div>
            )}
            {commandType === "hyperplan" && hyperplanControl && <div className="mb-2">{hyperplanControl}</div>}
            <div className="flex min-w-0 gap-2">
                {editor ?? (
                    <textarea
                        ref={textareaRef}
                        value={input}
                        aria-label="Task input"
                        onChange={(event) => onInputChange(event.target.value)}
                        disabled={isSubmitting || inputDisabled}
                        placeholder={
                            isSubmitting
                                ? "Sending..."
                                : !isOnline
                                  ? "Offline"
                                  : inputDisabled
                                    ? "Unavailable"
                                    : canQueueCurrentMode
                                      ? (placeholder ?? "Send to OpenADE")
                                      : "Only Do, Ask, and HyperPlan can be queued while running"
                        }
                        className="input min-h-12 max-h-28 min-w-0 flex-1 resize-none border border-border bg-base-200 p-2 text-sm"
                    />
                )}
                {showImageAttach && (
                    <>
                        <input
                            ref={imageInputRef}
                            type="file"
                            aria-label="Attach image file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0]
                                event.target.value = ""
                                if (file && onAttachImage) onAttachImage(file)
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => imageInputRef.current?.click()}
                            disabled={isSubmitting || imageAttachLoading || !isOnline}
                            className="btn flex h-12 w-10 shrink-0 items-center justify-center bg-base-200 text-muted disabled:opacity-50"
                            aria-label="Attach image"
                            title="Attach image"
                        >
                            {imageAttachLoading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                        </button>
                    </>
                )}
                <button
                    type="button"
                    onClick={onSend}
                    aria-label={sendLabel ?? "Send task input"}
                    disabled={!input.trim() || isLoading || isSubmitting || !isOnline || !canQueueCurrentMode || !hasSendHandler}
                    className={`btn flex shrink-0 items-center justify-center gap-1 bg-primary px-2 text-primary-content disabled:opacity-50 ${
                        isSubmitting || sendLabel ? "min-w-24 text-xs" : "w-12"
                    }`}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 size={15} className="animate-spin" />
                            Sending
                        </>
                    ) : (
                        <>
                            <Send size={16} />
                            {sendLabel && <span>{sendLabel}</span>}
                        </>
                    )}
                </button>
            </div>
            {repeatState && (
                <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-sm">
                    <span className="shrink-0 text-xs text-muted">Stop on text:</span>
                    <input
                        type="text"
                        value={repeatState.stopOnText}
                        aria-label="Stop repeat on text"
                        onChange={(event) => repeatState.onStopOnTextChange(event.target.value)}
                        placeholder="optional"
                        className="input h-8 min-w-0 flex-1 border border-border bg-base-200 px-2 text-sm"
                    />
                    <span className="shrink-0 text-xs text-muted">Max runs:</span>
                    <input
                        type="number"
                        min={1}
                        value={repeatState.maxRuns}
                        aria-label="Repeat max runs"
                        onChange={(event) => repeatState.onMaxRunsChange(Number.parseInt(event.target.value, 10) || 1)}
                        className="input h-8 w-16 border border-border bg-base-200 px-2 text-sm"
                    />
                    <span className="shrink-0 text-xs tabular-nums text-muted">#{repeatState.iterationCount}</span>
                </div>
            )}
            {imageAttachments.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto border-t border-border pt-2">
                    {imageAttachments.map(({ attachment, dataUrl }) => (
                        <div key={attachment.id} className="group relative shrink-0 overflow-hidden border border-border bg-base-200">
                            <img
                                src={dataUrl}
                                alt=""
                                className="h-16 object-cover"
                                style={{ aspectRatio: `${attachment.resizedWidth}/${attachment.resizedHeight}` }}
                            />
                            {onRemoveImage && (
                                <button
                                    type="button"
                                    onClick={() => onRemoveImage(attachment.id)}
                                    className="btn absolute right-1 top-1 flex h-6 w-6 items-center justify-center bg-base-300/90 p-0 text-base-content opacity-0 transition-opacity group-hover:opacity-100"
                                    aria-label="Remove image"
                                    title="Remove image"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </footer>
    )
}
