import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    CircleDot,
    Code2,
    FileCode2,
    FilePenLine,
    FilePlus2,
    FileText,
    Image as ImageIcon,
    ListChecks,
    Loader2,
    Terminal,
    Text,
    Workflow,
    Zap,
} from "lucide-react"
import { Suspense, lazy, type ReactNode, useEffect, useState } from "react"
import type { OpenADESnapshotPatchFile, OpenADESnapshotPatchIndex } from "../../../../openade-module/src"
import type {
    BashGroup,
    EditGroup,
    FileChangeGroup,
    MessageGroup,
    ResultGroup,
    SystemGroup,
    TodoWriteGroup,
    ToolGroup,
    WriteGroup,
} from "../../components/events/messageGroups"
import { compactText, stringifyRaw, type PresentedGroup, type PresentedTone } from "../../components/events/presentation"
import { formatInputCacheRate, normalizedCacheReadTokens } from "../../components/events/usage"
import type {
    TaskActionBlock,
    TaskEventBlock,
    TaskImageAttachment,
    TaskQueuedTurnBlock,
    TaskSetupBlock,
    TaskSnapshotBlock,
    TaskUnknownBlock,
} from "./taskEventPresentation"

const MarkdownMessage = lazy(() => import("../../components/MarkdownMessage").then((module) => ({ default: module.MarkdownMessage })))

interface TaskEventThreadProps {
    blocks: TaskEventBlock[]
    isRunning: boolean
    loadImage?: TaskImageLoader
    snapshotPatches?: Record<string, TaskSnapshotPatchView>
    snapshotPatchActionId?: string | null
    onLoadSnapshotPatch?: (block: TaskSnapshotBlock) => void
    onLoadSnapshotPatchSlice?: (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => void
}

export type TaskImageLoader = (image: TaskImageAttachment) => Promise<string | null>

export interface TaskSnapshotPatchView {
    eventId: string
    patchFileId?: string
    patch?: string | null
    index?: OpenADESnapshotPatchIndex | null
    slices?: Record<string, TaskSnapshotPatchSliceView>
}

export interface TaskSnapshotPatchSliceView {
    filePath: string
    patch: string | null
}

export function taskSnapshotPatchFileKey(file: Pick<OpenADESnapshotPatchFile, "path" | "oldPath" | "patchStart" | "patchEnd">): string {
    return `${file.path}:${file.oldPath ?? ""}:${file.patchStart}:${file.patchEnd}`
}

function taskSnapshotPatchFileLabel(file: Pick<OpenADESnapshotPatchFile, "path" | "oldPath">): string {
    return file.oldPath && file.oldPath !== file.path ? `${file.oldPath} -> ${file.path}` : file.path
}

function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function taskSnapshotPatchActionId(eventId: string, file: Pick<OpenADESnapshotPatchFile, "patchStart" | "patchEnd">): string {
    return `${eventId}:${file.patchStart}:${file.patchEnd}`
}

function statusTone(status: string | undefined): PresentedTone {
    if (status === "error" || status === "failed") return "bad"
    if (status === "in_progress" || status === "queued") return "warn"
    if (status === "completed") return "ok"
    return "muted"
}

function toneClass(tone: PresentedTone): string {
    if (tone === "ok") return "border-success/25 bg-success/10 text-success"
    if (tone === "warn") return "border-warning/25 bg-warning/10 text-warning"
    if (tone === "bad") return "border-error/25 bg-error/10 text-error"
    if (tone === "info") return "border-info/25 bg-info/10 text-info"
    return "border-border bg-base-200/45 text-muted"
}

function accentClass(tone: PresentedTone): string {
    if (tone === "ok") return "border-l-success"
    if (tone === "warn") return "border-l-warning"
    if (tone === "bad") return "border-l-error"
    if (tone === "info") return "border-l-info"
    return "border-l-border"
}

function timeLabel(value: string | undefined): string | undefined {
    if (!value) return undefined
    const time = new Date(value)
    if (Number.isNaN(time.getTime())) return undefined
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(time)
}

function blockIcon(block: TaskEventBlock, tone: PresentedTone): ReactNode {
    const className = tone === "muted" ? "text-muted" : toneClass(tone).split(" ").at(-1)
    if (block.kind === "action")
        return block.status === "in_progress" ? <Loader2 size={15} className="animate-spin text-warning" /> : <Zap size={15} className={className} />
    if (block.kind === "snapshot") return <Workflow size={15} className="text-info" />
    if (block.kind === "queued") return <CircleDot size={15} className="text-warning" />
    if (block.kind === "setup") return <CheckCircle2 size={15} className="text-success" />
    return <AlertCircle size={15} className="text-muted" />
}

function groupIcon(group: MessageGroup): ReactNode {
    switch (group.type) {
        case "text":
            return <Text size={14} />
        case "thinking":
            return <Zap size={14} />
        case "bash":
            return <Terminal size={14} />
        case "edit":
            return <FilePenLine size={14} />
        case "write":
            return <FilePlus2 size={14} />
        case "fileChange":
            return <FileCode2 size={14} />
        case "todoWrite":
            return <ListChecks size={14} />
        case "tool":
            return <Code2 size={14} />
        case "result":
            return group.isError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />
        case "stderr":
            return <Terminal size={14} />
        case "system":
        case "unknown":
            return <FileText size={14} />
    }
}

function BlockShell({
    children,
    icon,
    title,
    status,
    createdAt,
    tone,
}: {
    children: ReactNode
    icon: ReactNode
    title: string
    status?: string
    createdAt?: string
    tone: PresentedTone
}) {
    const time = timeLabel(createdAt)
    return (
        <section className={`overflow-hidden border border-border border-l-2 bg-base-100 ${accentClass(tone)}`}>
            <div className="flex min-w-0 items-center gap-2 border-b border-border bg-base-200/35 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-border bg-base-100">{icon}</span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-base-content">{title}</div>
                    {(status || time) && (
                        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] uppercase text-muted">
                            {status && <span className="truncate">{status.replace(/_/g, " ")}</span>}
                            {time && <span className="shrink-0">{time}</span>}
                        </div>
                    )}
                </div>
            </div>
            {children}
        </section>
    )
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
    return (
        <div className="overflow-hidden border border-border bg-base-300/35">
            {label && <div className="border-b border-border px-2 py-1 text-[10px] font-medium uppercase text-muted">{label}</div>}
            <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words p-2 text-xs leading-relaxed text-base-content [overflow-wrap:anywhere]">
                <code>{code}</code>
            </pre>
        </div>
    )
}

function RichText({ text }: { text: string }) {
    const displayText = compactText(text, 12000)
    return (
        <div className="max-w-full text-base-content [overflow-wrap:anywhere]">
            <Suspense fallback={<p className="whitespace-pre-wrap text-sm leading-relaxed text-base-content">{displayText}</p>}>
                <MarkdownMessage text={displayText} commentHandlers={null} variant="plain" density="compact" />
            </Suspense>
        </div>
    )
}

function PromptImage({ image, loadImage }: { image: TaskImageAttachment; loadImage: TaskImageLoader }) {
    const [src, setSrc] = useState<string | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let active = true
        setSrc(null)
        setFailed(false)
        void loadImage(image)
            .then((value) => {
                if (!active) return
                if (value) setSrc(value)
                else setFailed(true)
            })
            .catch(() => {
                if (active) setFailed(true)
            })
        return () => {
            active = false
        }
    }, [image, loadImage])

    return (
        <div
            className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden border border-border bg-base-200/45"
            title={failed ? "Image unavailable" : "Prompt image"}
        >
            {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={18} className={failed ? "text-error" : "text-muted"} />}
        </div>
    )
}

function PromptImages({ images, loadImage }: { images: TaskImageAttachment[]; loadImage?: TaskImageLoader }) {
    if (!loadImage || images.length === 0) return null
    return (
        <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1">
            {images.map((image) => (
                <PromptImage key={`${image.id}.${image.ext}`} image={image} loadImage={loadImage} />
            ))}
        </div>
    )
}

function UserPrompt({ text, images, loadImage }: { text: string; images: TaskImageAttachment[]; loadImage?: TaskImageLoader }) {
    const [expanded, setExpanded] = useState(false)
    const lines = text.split("\n")
    const isLong = lines.length > 8 || text.length > 900
    const displayText = expanded || !isLong ? text : compactText(lines.slice(0, 8).join("\n"), 900)

    return (
        <div className="border-b border-border bg-primary/5 px-3 py-3">
            <div className="mb-1 text-[10px] font-semibold uppercase text-primary">Prompt</div>
            <RichText text={displayText} />
            {isLong && (
                <button type="button" className="btn mt-2 text-xs text-primary" onClick={() => setExpanded((value) => !value)}>
                    {expanded ? "Show less" : "Show more"}
                </button>
            )}
            <PromptImages images={images} loadImage={loadImage} />
        </div>
    )
}

function AssistantGroup({ group, isLive }: { group: Extract<MessageGroup, { type: "text" }>; isLive: boolean }) {
    return (
        <div className="border-b border-border px-3 py-3">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted">
                Assistant
                {isLive && <Loader2 size={11} className="animate-spin text-primary" />}
            </div>
            <RichText text={group.text} />
        </div>
    )
}

function ToolDisclosure({ presented, isInitiallyExpanded }: { presented: PresentedGroup; isInitiallyExpanded: boolean }) {
    const [expanded, setExpanded] = useState(isInitiallyExpanded)
    const group = presented.group
    return (
        <div className="border-b border-border">
            <button type="button" onClick={() => setExpanded((value) => !value)} className="btn flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center border ${toneClass(presented.tone)}`}>{groupIcon(group)}</span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-base-content">{presented.label}</span>
                    {presented.detail && <span className="block truncate text-xs text-muted">{presented.detail}</span>}
                </span>
                {presented.isPending && <Loader2 size={13} className="shrink-0 animate-spin text-warning" />}
                {presented.isError && <AlertCircle size={13} className="shrink-0 text-error" />}
                {expanded ? <ChevronDown size={14} className="shrink-0 text-muted" /> : <ChevronRight size={14} className="shrink-0 text-muted" />}
            </button>
            {expanded && <div className="space-y-2 px-3 pb-3">{renderGroupDetail(group)}</div>}
        </div>
    )
}

function renderGroupDetail(group: MessageGroup): ReactNode {
    switch (group.type) {
        case "thinking":
            return <RichText text={group.text || "Thinking"} />
        case "tool":
            return <ToolDetail group={group} />
        case "bash":
            return <BashDetail group={group} />
        case "edit":
            return <EditDetail group={group} />
        case "write":
            return <WriteDetail group={group} />
        case "fileChange":
            return <FileChangeDetail group={group} />
        case "todoWrite":
            return <TodoDetail group={group} />
        case "system":
            return <SystemDetail group={group} />
        case "result":
            return <ResultDetail group={group} />
        case "stderr":
            return <CodeBlock label="stderr" code={group.data} />
        case "unknown":
            return <CodeBlock label={group.originalType ?? "unknown"} code={stringifyRaw(group.raw)} />
        case "text":
            return <RichText text={group.text} />
    }
}

function ToolDetail({ group }: { group: ToolGroup }) {
    return (
        <>
            <CodeBlock label="input" code={typeof group.input === "string" ? group.input : stringifyRaw(group.input)} />
            {group.result !== undefined && <CodeBlock label={group.isError ? "error" : "result"} code={group.result} />}
        </>
    )
}

function BashDetail({ group }: { group: BashGroup }) {
    const content = [`$ ${group.command}`, group.result].filter(Boolean).join("\n")
    return <CodeBlock label="terminal" code={content} />
}

function EditDetail({ group }: { group: EditGroup }) {
    return (
        <>
            <CodeBlock label={`old ${group.filePath}`} code={group.oldString} />
            <CodeBlock label={`new ${group.filePath}`} code={group.newString} />
            {group.errorMessage && <CodeBlock label="error" code={group.errorMessage} />}
        </>
    )
}

function WriteDetail({ group }: { group: WriteGroup }) {
    return (
        <>
            <CodeBlock label={group.filePath} code={group.content} />
            {group.errorMessage && <CodeBlock label="error" code={group.errorMessage} />}
        </>
    )
}

function FileChangeDetail({ group }: { group: FileChangeGroup }) {
    return <CodeBlock label={`${group.kind} ${group.filePath}`} code={group.diff || group.status || "Changed"} />
}

function TodoDetail({ group }: { group: TodoWriteGroup }) {
    return (
        <div className="space-y-1">
            {group.todos.map((todo, index) => (
                <div key={`${todo.content}:${index}`} className="flex gap-2 text-sm">
                    <span
                        className={`mt-1 h-2 w-2 shrink-0 border ${todo.status === "completed" ? "bg-success border-success" : todo.status === "in_progress" ? "bg-warning border-warning" : "border-muted"}`}
                    />
                    <span className={todo.status === "completed" ? "text-muted line-through" : "text-base-content"}>{todo.content}</span>
                </div>
            ))}
        </div>
    )
}

function SystemDetail({ group }: { group: SystemGroup }) {
    return <CodeBlock label={group.subtype} code={stringifyRaw(group.metadata)} />
}

function ResultDetail({ group }: { group: ResultGroup }) {
    const cacheRate = formatInputCacheRate(group.usage)
    const cacheReadTokens = normalizedCacheReadTokens(group.usage)
    const usage = [
        `${group.usage.inputTokens.toLocaleString()} input`,
        `${group.usage.outputTokens.toLocaleString()} output`,
        cacheRate && cacheReadTokens !== undefined ? `${cacheRate} input cache (${cacheReadTokens.toLocaleString()} cached)` : undefined,
    ]
        .filter(Boolean)
        .join(", ")
    const lines = [
        group.isError ? "Failed" : "Completed",
        group.durationMs ? `${Math.round(group.durationMs / 1000)}s` : undefined,
        group.totalCostUsd ? `$${group.totalCostUsd.toFixed(4)}` : undefined,
        usage,
        group.errors?.join("\n"),
        group.result,
    ].filter(Boolean)
    return <RichText text={lines.join("\n\n")} />
}

function ActionBlockView({ block, isRunning, loadImage }: { block: TaskActionBlock; isRunning: boolean; loadImage?: TaskImageLoader }) {
    const tone = statusTone(block.status)
    const lastTextId = [...block.groups].reverse().find((item) => item.type === "text")?.id
    return (
        <BlockShell title={block.title} status={block.status} createdAt={block.createdAt} tone={tone} icon={blockIcon(block, tone)}>
            {(block.userInput || block.images.length > 0) && <UserPrompt text={block.userInput ?? ""} images={block.images} loadImage={loadImage} />}
            {block.groups.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted">{block.emptyText}</div>
            ) : (
                <div>
                    {block.groups.map((presented) =>
                        presented.group.type === "text" ? (
                            <AssistantGroup
                                key={presented.id}
                                group={presented.group}
                                isLive={isRunning && presented.id === lastTextId && block.status === "in_progress"}
                            />
                        ) : (
                            <ToolDisclosure
                                key={presented.id}
                                presented={presented}
                                isInitiallyExpanded={presented.isError || presented.isPending || presented.type === "result" || presented.type === "todoWrite"}
                            />
                        )
                    )}
                </div>
            )}
        </BlockShell>
    )
}

function SetupBlockView({ block }: { block: TaskSetupBlock }) {
    const tone = statusTone(block.status)
    return (
        <BlockShell title={block.title} status={block.status} createdAt={block.createdAt} tone={tone} icon={blockIcon(block, tone)}>
            <div className="px-3 py-3">
                <CodeBlock label="environment" code={block.body} />
            </div>
        </BlockShell>
    )
}

function SnapshotBlockView({
    block,
    patch,
    actionId,
    onLoadPatch,
    onLoadPatchSlice,
}: {
    block: TaskSnapshotBlock
    patch?: TaskSnapshotPatchView
    actionId?: string | null
    onLoadPatch?: (block: TaskSnapshotBlock) => void
    onLoadPatchSlice?: (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => void
}) {
    const tone = statusTone(block.status)
    const busy = actionId === block.id
    const indexFiles = patch?.index?.files ?? []
    return (
        <BlockShell title={block.title} status={block.status} createdAt={block.createdAt} tone={tone} icon={blockIcon(block, tone)}>
            <div className="grid grid-cols-3 border-b border-border text-center text-xs">
                <div className="border-r border-border px-2 py-2">
                    <div className="font-semibold text-base-content">{block.filesChanged}</div>
                    <div className="text-muted">files</div>
                </div>
                <div className="border-r border-border px-2 py-2">
                    <div className="font-semibold text-success">+{block.insertions}</div>
                    <div className="text-muted">added</div>
                </div>
                <div className="px-2 py-2">
                    <div className="font-semibold text-error">-{block.deletions}</div>
                    <div className="text-muted">removed</div>
                </div>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0 truncate text-xs text-muted">{block.referenceBranch ?? "Snapshot patch"}</div>
                {onLoadPatch && (
                    <button
                        type="button"
                        onClick={() => onLoadPatch(block)}
                        disabled={busy}
                        className="btn flex h-7 shrink-0 items-center gap-1 bg-base-300 px-2 text-[11px] disabled:opacity-50"
                    >
                        {busy && <Loader2 size={11} className="animate-spin text-primary" />}
                        {patch ? "Refresh Patch" : "Patch"}
                    </button>
                )}
            </div>
            {patch && (
                <div className="border-t border-border bg-base-100/50">
                    <div className="border-b border-border px-3 py-1.5 text-[11px] uppercase text-muted">{patch.patchFileId ?? patch.eventId}</div>
                    {patch.index ? (
                        <div className="flex flex-col gap-2 p-3">
                            <div className="text-xs text-muted">
                                {indexFiles.length === 0 ? "No indexed patch files." : `${indexFiles.length} files, ${formatBytes(patch.index.patchSize)}`}
                            </div>
                            {indexFiles.map((file) => {
                                const key = taskSnapshotPatchFileKey(file)
                                const slice = patch.slices?.[key]
                                const sliceBusy = actionId === taskSnapshotPatchActionId(block.id, file)
                                return (
                                    <div key={key} className="overflow-hidden border border-border bg-base-200/25">
                                        <div className="flex min-w-0 items-center gap-2 border-b border-border px-2 py-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-xs font-medium text-base-content">{taskSnapshotPatchFileLabel(file)}</div>
                                                <div className="text-[11px] text-muted">
                                                    +{file.insertions} -{file.deletions}
                                                    {file.binary ? " binary" : ""}
                                                </div>
                                            </div>
                                            {onLoadPatchSlice && (
                                                <button
                                                    type="button"
                                                    onClick={() => onLoadPatchSlice(block, file)}
                                                    disabled={sliceBusy}
                                                    className="btn flex h-7 shrink-0 items-center gap-1 bg-base-300 px-2 text-[11px] disabled:opacity-50"
                                                >
                                                    {sliceBusy && <Loader2 size={11} className="animate-spin text-primary" />}
                                                    {slice ? "Refresh" : "Load"}
                                                </button>
                                            )}
                                        </div>
                                        {slice && <CodeBlock label={slice.filePath} code={slice.patch ?? "No patch content."} />}
                                    </div>
                                )
                            })}
                        </div>
                    ) : patch.patch ? (
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-base-content [overflow-wrap:anywhere]">
                            {patch.patch}
                        </pre>
                    ) : (
                        <div className="p-3 text-xs text-muted">No patch content.</div>
                    )}
                </div>
            )}
        </BlockShell>
    )
}

function QueuedBlockView({ block }: { block: TaskQueuedTurnBlock }) {
    const tone = statusTone(block.status)
    return (
        <BlockShell title={block.title} status={block.status} createdAt={block.createdAt} tone={tone} icon={blockIcon(block, tone)}>
            <div className="px-3 py-3">
                <RichText text={block.body} />
            </div>
        </BlockShell>
    )
}

function UnknownBlockView({ block }: { block: TaskUnknownBlock }) {
    const tone = statusTone(block.status)
    return (
        <BlockShell title={block.title} status={block.status} createdAt={block.createdAt} tone={tone} icon={blockIcon(block, tone)}>
            <div className="px-3 py-3">
                <CodeBlock label="event" code={block.body} />
            </div>
        </BlockShell>
    )
}

function EventBlockView({
    block,
    isRunning,
    loadImage,
    snapshotPatches,
    snapshotPatchActionId,
    onLoadSnapshotPatch,
    onLoadSnapshotPatchSlice,
}: {
    block: TaskEventBlock
    isRunning: boolean
    loadImage?: TaskImageLoader
    snapshotPatches?: Record<string, TaskSnapshotPatchView>
    snapshotPatchActionId?: string | null
    onLoadSnapshotPatch?: (block: TaskSnapshotBlock) => void
    onLoadSnapshotPatchSlice?: (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => void
}) {
    switch (block.kind) {
        case "action":
            return <ActionBlockView block={block} isRunning={isRunning} loadImage={loadImage} />
        case "setup":
            return <SetupBlockView block={block} />
        case "snapshot":
            return (
                <SnapshotBlockView
                    block={block}
                    patch={snapshotPatches?.[block.id]}
                    actionId={snapshotPatchActionId}
                    onLoadPatch={onLoadSnapshotPatch}
                    onLoadPatchSlice={onLoadSnapshotPatchSlice}
                />
            )
        case "queued":
            return <QueuedBlockView block={block} />
        case "unknown":
            return <UnknownBlockView block={block} />
    }
}

export function TaskEventThread({
    blocks,
    isRunning,
    loadImage,
    snapshotPatches,
    snapshotPatchActionId,
    onLoadSnapshotPatch,
    onLoadSnapshotPatchSlice,
}: TaskEventThreadProps) {
    return (
        <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
            {blocks.map((block) => (
                <EventBlockView
                    key={block.id}
                    block={block}
                    isRunning={isRunning}
                    loadImage={loadImage}
                    snapshotPatches={snapshotPatches}
                    snapshotPatchActionId={snapshotPatchActionId}
                    onLoadSnapshotPatch={onLoadSnapshotPatch}
                    onLoadSnapshotPatchSlice={onLoadSnapshotPatchSlice}
                />
            ))}
            {isRunning && (
                <div className="flex items-center gap-2 self-start border border-border bg-base-200/45 px-2 py-1 text-xs text-muted">
                    <Loader2 size={13} className="animate-spin text-primary" />
                    Working
                </div>
            )}
        </div>
    )
}
