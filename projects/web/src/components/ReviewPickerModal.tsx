import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { Star } from "lucide-react"
import { observer } from "mobx-react"
import { useMemo, useState } from "react"
import { HARNESS_META, MODEL_REGISTRY } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { getVisibleModelEntries, getVisibleModelId } from "../modelVisibility"
import type { ReviewType } from "../prompts/reviewPrompts"
import { useCodeStore } from "../store/context"
import { Modal } from "./ui"

interface ReviewPickerModalProps {
    taskId: string
    reviewType: ReviewType
    customInstructions?: string
    onStart?: () => void
}

interface ReviewAgentOption {
    id: string
    harnessId: HarnessId
    modelId: string
    harnessLabel: string
    modelLabel: string
    isTop: boolean
}

const TOP_MODEL_IDS = new Set(Object.values(MODEL_REGISTRY).map((config) => config.defaultModel))

const OpenAIIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="w-4 h-4">
        <path
            d="M19.7978 10.3242C20.2171 9.0657 20.0727 7.68705 19.4022 6.54232C18.3937 4.78653 16.3665 3.88321 14.3866 4.3083C13.5058 3.31605 12.2404 2.75177 10.9137 2.75985C8.88991 2.75523 7.09426 4.05822 6.47165 5.98382C5.17155 6.25007 4.04934 7.06386 3.39265 8.21726C2.37672 9.96843 2.60832 12.1759 3.9656 13.6776C3.54628 14.9361 3.69067 16.3147 4.36123 17.4594C5.36965 19.2152 7.39691 20.1186 9.3768 19.6935C10.257 20.6857 11.523 21.25 12.8497 21.2413C14.8746 21.2465 16.6709 19.9424 17.2935 18.0151C18.5936 17.7488 19.7158 16.935 20.3725 15.7816C21.3873 14.0304 21.1551 11.8247 19.7984 10.3231L19.7978 10.3242ZM12.8508 20.0337C12.0405 20.0348 11.2556 19.7512 10.6336 19.232C10.6619 19.217 10.711 19.1898 10.7427 19.1702L14.423 17.0448C14.6113 16.9379 14.7268 16.7375 14.7256 16.5209V11.3326L16.281 12.2308C16.2978 12.2388 16.3087 12.255 16.311 12.2735V16.57C16.3087 18.4806 14.7614 20.0296 12.8508 20.0337ZM5.40951 16.8553C5.00348 16.1542 4.85735 15.3323 4.99655 14.5347C5.02369 14.5508 5.07163 14.5803 5.10571 14.5999L8.78595 16.7254C8.9725 16.8345 9.20353 16.8345 9.39066 16.7254L13.8835 14.1309V15.9272C13.8847 15.9456 13.876 15.9636 13.8616 15.9751L10.1415 18.1231C8.48446 19.0772 6.36826 18.51 5.41008 16.8553H5.40951ZM4.44093 8.82197C4.84523 8.11965 5.48343 7.58252 6.24351 7.30355C6.24351 7.33532 6.24178 7.39134 6.24178 7.43062V11.6821C6.24062 11.8981 6.35613 12.0985 6.54384 12.2053L11.0367 14.7992L9.48134 15.6973C9.46574 15.7077 9.4461 15.7094 9.42878 15.7019L5.70811 13.5522C4.05454 12.5946 3.48737 10.479 4.44035 8.82255L4.44093 8.82197ZM17.2201 11.7958L12.7272 9.20143L14.2826 8.30389C14.2982 8.2935 14.3179 8.29176 14.3352 8.29927L18.0559 10.4472C19.7123 11.4043 20.2801 13.5233 19.323 15.1798C18.9182 15.881 18.2805 16.4181 17.521 16.6976V12.3191C17.5228 12.1031 17.4078 11.9033 17.2207 11.7958H17.2201ZM18.768 9.46595C18.7409 9.4492 18.6929 9.42033 18.6588 9.40069L14.9786 7.27525C14.792 7.16609 14.561 7.16609 14.3739 7.27525L9.88101 9.86967V8.07345C9.87986 8.05496 9.88852 8.03706 9.90296 8.02551L13.6231 5.87928C15.2801 4.92341 17.3986 5.49231 18.3539 7.14992C18.7576 7.84993 18.9037 8.66949 18.7668 9.46595H18.768ZM9.03546 12.6674L7.4795 11.7693C7.46275 11.7612 7.45177 11.745 7.44946 11.7265V7.43004C7.45062 5.51714 9.00254 3.96696 10.9154 3.96812C11.7246 3.96812 12.5078 4.25228 13.1298 4.76978C13.1015 4.78479 13.053 4.81194 13.0207 4.83158L9.34041 6.95701C9.15212 7.06386 9.03661 7.2637 9.03777 7.48029L9.03546 12.6662V12.6674ZM9.88043 10.8458L11.8817 9.69005L13.883 10.8452V13.156L11.8817 14.3111L9.88043 13.156V10.8458Z"
            fill="currentColor"
        />
    </svg>
)

const AnthropicIcon = () => (
    <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current">
        <title>Anthropic</title>
        <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
)

const getHarnessIcon = (harnessId: HarnessId) => {
    if (harnessId === "codex") return <OpenAIIcon />
    if (harnessId === "claude-code") return <AnthropicIcon />
    return <span className="inline-block w-2 h-2 rounded-full bg-muted" />
}

export const ReviewPickerModal = NiceModal.create(
    observer(({ taskId, reviewType, customInstructions, onStart }: ReviewPickerModalProps) => {
        const modal = useModal()
        const codeStore = useCodeStore()
        const taskModel = codeStore.tasks.getTaskModel(taskId)

        const [notes, setNotes] = useState(customInstructions ?? "")

        const options = useMemo<ReviewAgentOption[]>(() => {
            const pairs: ReviewAgentOption[] = []
            for (const harnessId of Object.keys(MODEL_REGISTRY) as HarnessId[]) {
                const harnessLabel = HARNESS_META[harnessId]?.name ?? harnessId
                for (const model of getVisibleModelEntries(harnessId)) {
                    pairs.push({
                        id: `${harnessId}:${model.id}`,
                        harnessId,
                        modelId: model.id,
                        harnessLabel,
                        modelLabel: model.label,
                        isTop: TOP_MODEL_IDS.has(model.id),
                    })
                }
            }
            return pairs.sort((a, b) => {
                if (a.isTop !== b.isTop) return a.isTop ? -1 : 1
                return `${a.harnessLabel} ${a.modelLabel}`.localeCompare(`${b.harnessLabel} ${b.modelLabel}`)
            })
        }, [])

        const startReview = (harnessId: HarnessId, modelId: string) => {
            onStart?.()
            modal.remove()
            void codeStore.execution.executeReview({
                taskId,
                reviewType,
                harnessId,
                modelId,
                customInstructions: notes.trim() || undefined,
            })
        }

        const title = reviewType === "plan" ? "Review Plan" : "Review Work"
        const topOptions = options.filter((option) => option.isTop)
        const otherOptions = options.filter((option) => !option.isTop)
        const orderedOptions = [...topOptions, ...otherOptions]
        const hasOtherHarness = taskModel ? options.some((option) => option.harnessId !== taskModel.harnessId) : false
        const currentVisibleModelId = taskModel ? getVisibleModelId(taskModel.model, taskModel.harnessId) : undefined
        const currentOption =
            taskModel && hasOtherHarness
                ? options.find((option) => option.harnessId === taskModel.harnessId && option.modelId === currentVisibleModelId)
                : undefined
        const reviewOptions = currentOption ? orderedOptions.filter((option) => option.id !== currentOption.id) : orderedOptions

        return (
            <Modal
                title={title}
                onClose={() => modal.remove()}
                footer={
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn px-4 h-9 text-sm text-muted hover:text-base-content" onClick={() => modal.remove()}>
                            Cancel
                        </button>
                    </div>
                }
            >
                <div className="flex flex-col gap-4">
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Add notes for the reviewer (optional)"
                        className="w-full px-3 py-2 text-sm bg-base-200 border border-border text-base-content placeholder:text-muted resize-none focus:outline-none focus:border-primary/50"
                        rows={3}
                    />

                    <div className="text-xs text-muted">Pick an agent to start review.</div>

                    {reviewOptions.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {reviewOptions.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    className={`btn flex w-full items-center justify-between px-3 py-2.5 border text-base-content ${
                                        option.isTop ? "border-primary/35 bg-primary/10 hover:bg-primary/20" : "border-border bg-base-200 hover:bg-base-300"
                                    }`}
                                    onClick={() => startReview(option.harnessId, option.modelId)}
                                >
                                    <span className="flex min-w-0 items-center gap-2.5 text-left">
                                        <span className={`${option.isTop ? "text-primary" : "text-muted"} shrink-0`}>{getHarnessIcon(option.harnessId)}</span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-semibold truncate">{option.modelLabel}</span>
                                            <span className="block text-[11px] text-muted truncate">{option.harnessLabel}</span>
                                        </span>
                                    </span>
                                    {option.isTop && (
                                        <span className="ml-3 inline-flex items-center gap-1 bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                                            <Star size={10} className="fill-current" />
                                            Top
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    {currentOption && (
                        <div className="flex flex-col gap-2 border-t border-border pt-3">
                            <div className="text-[11px] font-semibold tracking-wide uppercase text-muted">Current Session</div>
                            <button
                                type="button"
                                className="btn flex w-full items-center justify-between px-3 py-2.5 border border-border bg-base-200 hover:bg-base-300 text-base-content"
                                onClick={() => startReview(currentOption.harnessId, currentOption.modelId)}
                            >
                                <span className="flex min-w-0 items-center gap-2.5 text-left">
                                    <span className="text-muted shrink-0">{getHarnessIcon(currentOption.harnessId)}</span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold truncate">{currentOption.modelLabel}</span>
                                        <span className="block text-[11px] text-muted truncate">{currentOption.harnessLabel}</span>
                                    </span>
                                </span>
                                <span className="ml-3 inline-flex items-center bg-base-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">
                                    Current
                                </span>
                            </button>
                        </div>
                    )}

                    {options.length === 0 && <div className="text-xs text-warning">No review agents are configured.</div>}
                </div>
            </Modal>
        )
    })
)
