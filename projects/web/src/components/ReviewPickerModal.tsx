import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { observer } from "mobx-react"
import { useState } from "react"
import { getDefaultModelForHarness } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import type { ReviewType } from "../prompts/reviewPrompts"
import { useCodeStore } from "../store/context"
import { HarnessPicker } from "./HarnessPicker"
import { ModelPicker } from "./ModelPicker"
import { Modal } from "./ui"

interface ReviewPickerModalProps {
    taskId: string
    reviewType: ReviewType
}

export const ReviewPickerModal = NiceModal.create(
    observer(({ taskId, reviewType }: ReviewPickerModalProps) => {
        const modal = useModal()
        const codeStore = useCodeStore()
        const taskModel = codeStore.tasks.getTaskModel(taskId)

        const initialHarnessId = taskModel?.harnessId ?? codeStore.defaultHarnessId
        const initialModelId = taskModel?.model ?? getDefaultModelForHarness(initialHarnessId)

        const [harnessId, setHarnessId] = useState<HarnessId>(initialHarnessId)
        const [modelId, setModelId] = useState<string>(initialModelId)

        const onHarnessChange = (nextHarnessId: HarnessId) => {
            setHarnessId(nextHarnessId)
            setModelId(getDefaultModelForHarness(nextHarnessId))
        }

        const onStartReview = () => {
            modal.remove()
            void codeStore.execution.executeReview({
                taskId,
                reviewType,
                harnessId,
                modelId,
            })
        }

        const title = reviewType === "plan" ? "Review Plan" : "Review Work"

        return (
            <Modal
                title={title}
                onClose={() => modal.remove()}
                footer={
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn px-4 h-9 text-sm text-muted hover:text-base-content" onClick={() => modal.remove()}>
                            Cancel
                        </button>
                        <button type="button" className="btn px-4 h-9 text-sm bg-primary text-primary-content hover:bg-primary/80" onClick={onStartReview}>
                            Start Review
                        </button>
                    </div>
                }
            >
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <span className="w-16 text-sm text-muted">Harness</span>
                        <HarnessPicker value={harnessId} onChange={onHarnessChange} />
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="w-16 text-sm text-muted">Model</span>
                        <ModelPicker value={modelId} onChange={setModelId} harnessId={harnessId} />
                    </div>
                </div>
            </Modal>
        )
    })
)
