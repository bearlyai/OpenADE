import { Loader2, Send, Square } from "lucide-react"
import type { ReactNode } from "react"
import { FastModeToggle } from "../../components/FastModeToggle"
import { HarnessPicker } from "../../components/HarnessPicker"
import { ModelPicker } from "../../components/ModelPicker"
import { ThinkingPicker } from "../../components/ThinkingPicker"
import type { HarnessId } from "../../electronAPI/harnessEventTypes"
import type { ThinkingLevel } from "../../store/TaskModel"
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

export function TaskComposer({
    input,
    commandType,
    isLoading,
    isSubmitting,
    isOnline,
    isRunning,
    agentControls,
    onInputChange,
    onCommandTypeChange,
    onSend,
    onAbort,
}: {
    input: string
    commandType: TaskCommandType
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    isRunning: boolean
    agentControls?: TaskComposerAgentControls
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: TaskCommandType) => void
    onSend: () => void
    onAbort: () => void
}) {
    const canQueueCurrentMode = !isRunning || canQueueTaskCommandWhileRunning(commandType)
    const showHarnessPicker = Boolean(agentControls?.allowHarnessSwitch && agentControls.harnessId && agentControls.onHarnessChange)
    const showModelPicker = Boolean(agentControls?.selectedModel && agentControls.onModelChange)
    const showThinkingPicker = Boolean(agentControls?.thinking && agentControls.onThinkingChange)
    const showFastMode = agentControls?.fastMode !== undefined && Boolean(agentControls.onFastModeChange)
    const showMcpControl = Boolean(agentControls?.mcpControl)
    const showAgentControls = showHarnessPicker || showModelPicker || showThinkingPicker || showFastMode || showMcpControl

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
            <div className="mb-2 flex max-w-full gap-1 overflow-x-auto overscroll-x-contain">
                {TASK_COMPOSER_COMMANDS.map((type) => (
                    <button
                        key={type}
                        type="button"
                        onClick={() => onCommandTypeChange(type)}
                        disabled={isSubmitting || (isRunning && !canQueueTaskCommandWhileRunning(type))}
                        className={`btn shrink-0 border border-border px-2 py-1 text-xs ${commandType === type ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"}`}
                    >
                        {taskCommandLabel(type)}
                    </button>
                ))}
                {isRunning && (
                    <button type="button" onClick={onAbort} className="btn ml-auto flex h-8 w-8 items-center justify-center bg-error/10 text-error">
                        <Square size={14} />
                    </button>
                )}
            </div>
            <div className="flex min-w-0 gap-2">
                <textarea
                    value={input}
                    onChange={(event) => onInputChange(event.target.value)}
                    disabled={isSubmitting}
                    placeholder={
                        isSubmitting
                            ? "Sending..."
                            : !isOnline
                              ? "Offline"
                              : canQueueCurrentMode
                                ? "Send to OpenADE"
                                : "Only Do and Ask can be queued while running"
                    }
                    className="input min-h-12 max-h-28 min-w-0 flex-1 resize-none border border-border bg-base-200 p-2 text-sm"
                />
                <button
                    type="button"
                    onClick={onSend}
                    disabled={!input.trim() || isLoading || isSubmitting || !isOnline || !canQueueCurrentMode}
                    className={`btn flex shrink-0 items-center justify-center gap-1 bg-primary px-2 text-primary-content disabled:opacity-50 ${
                        isSubmitting ? "w-24 text-xs" : "w-12"
                    }`}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 size={15} className="animate-spin" />
                            Sending
                        </>
                    ) : (
                        <Send size={16} />
                    )}
                </button>
            </div>
        </footer>
    )
}
