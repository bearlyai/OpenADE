import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { Check, Copy, Download } from "lucide-react"
import { observer } from "mobx-react"
import { useState } from "react"
import { useCodeStore } from "../store/context"
import { Modal, Switch } from "./ui"

interface CopyMarkdownModalProps {
    taskId: string
}

interface IncludeOptions {
    functionCalls: boolean
    functionResults: boolean
    thinking: boolean
}

const OPTION_ROWS: { key: keyof IncludeOptions; label: string; description: string }[] = [
    { key: "functionCalls", label: "Function calls & parameters", description: "Tools the agent ran and the arguments passed" },
    { key: "functionResults", label: "Function results", description: "Output returned from each tool call" },
    { key: "thinking", label: "Agent thinking", description: "The agent's internal reasoning blocks" },
]

function fileSlug(value: string | undefined): string {
    const slug = (value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    return slug || "chat"
}

export const CopyMarkdownModal = NiceModal.create(
    observer(({ taskId }: CopyMarkdownModalProps) => {
        const modal = useModal()
        const codeStore = useCodeStore()
        const taskModel = codeStore.tasks.getTaskModel(taskId)

        const [options, setOptions] = useState<IncludeOptions>({
            functionCalls: false,
            functionResults: false,
            thinking: false,
        })
        const [copied, setCopied] = useState(false)

        const markdown =
            taskModel?.getThreadMarkdown({
                includeMessages: true,
                includeFunctionInputs: options.functionCalls,
                includeFunctionOutputs: options.functionResults,
                includeThinking: options.thinking,
            }) ?? ""

        const toggle = (key: keyof IncludeOptions) => {
            setOptions((prev) => ({ ...prev, [key]: !prev[key] }))
        }

        const handleCopy = async () => {
            if (!markdown) return
            try {
                await navigator.clipboard.writeText(markdown)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
            } catch (error) {
                console.error("[CopyMarkdownModal] Failed to copy markdown:", error)
            }
        }

        const handleDownload = () => {
            if (!markdown) return
            const blob = new Blob([markdown], { type: "text/markdown" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${fileSlug(taskModel?.slug || taskModel?.title)}.md`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        }

        return (
            <Modal
                title="Copy as Markdown"
                size="lg"
                onClose={() => modal.remove()}
                footer={
                    <div className="flex items-center justify-end gap-2">
                        <button type="button" className="btn px-4 h-9 text-sm text-muted hover:text-base-content" onClick={() => modal.remove()}>
                            Close
                        </button>
                        <button
                            type="button"
                            className="btn flex items-center gap-1.5 px-3 h-9 text-sm border border-border bg-base-200 hover:bg-base-300 text-base-content disabled:opacity-50"
                            onClick={handleDownload}
                            disabled={!markdown}
                        >
                            <Download size={14} />
                            Download .md
                        </button>
                        <button
                            type="button"
                            className="btn flex items-center gap-1.5 px-3 h-9 text-sm border border-primary/40 bg-primary/10 hover:bg-primary/20 text-base-content disabled:opacity-50"
                            onClick={handleCopy}
                            disabled={!markdown}
                        >
                            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                }
            >
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Include</div>
                        <div className="flex flex-col gap-px border border-border">
                            <div className="flex items-center justify-between gap-4 px-3 py-2.5 bg-base-200">
                                <div className="min-w-0">
                                    <div className="text-sm text-base-content">User & agent messages</div>
                                    <div className="text-xs text-muted">Your prompts and the agent's replies</div>
                                </div>
                                <Switch checked readOnly aria-label="User and agent messages (always included)" />
                            </div>
                            {OPTION_ROWS.map((row) => (
                                <div key={row.key} className="flex items-center justify-between gap-4 px-3 py-2.5 bg-base-200">
                                    <div className="min-w-0">
                                        <div className="text-sm text-base-content">{row.label}</div>
                                        <div className="text-xs text-muted">{row.description}</div>
                                    </div>
                                    <Switch checked={options[row.key]} onCheckedChange={() => toggle(row.key)} aria-label={row.label} />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Preview</div>
                            <div className="text-[11px] text-muted">{markdown.length.toLocaleString()} chars</div>
                        </div>
                        <textarea
                            readOnly
                            value={markdown}
                            spellCheck={false}
                            className="w-full h-80 px-3 py-2 font-mono text-xs leading-relaxed bg-base-200 border border-border text-base-content resize-none focus:outline-none focus:border-primary/50"
                        />
                    </div>
                </div>
            </Modal>
        )
    })
)
