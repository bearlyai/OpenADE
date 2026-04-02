import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { groupStreamEvents, type MessageGroup } from "../components/events/messageGroups"
import type { ActionEvent, ActionEventSource, Task } from "../types"
import { makeXml, type XmlNode } from "../utils/makeXML"

export interface TaskThreadFormat {
    includeFunctionInputs: boolean
    includeFunctionOutputs: boolean
    includeThinking: boolean
    includeMessages: boolean
    /** If set, only serialize the last N action events */
    maxEvents?: number
}

export interface TaskThreadContextBudgetOptions extends Partial<TaskThreadFormat> {
    maxBytes?: number
}

export interface TaskThreadContextResult {
    xml: string
    byteLength: number
    truncated: boolean
    includedEvents: number
    omittedEvents: number
}

export const DEFAULT_TASK_THREAD_FORMAT: TaskThreadFormat = {
    includeFunctionInputs: true,
    includeFunctionOutputs: true,
    includeThinking: false,
    includeMessages: true,
    maxEvents: undefined,
}

export const DEFAULT_TASK_THREAD_CONTEXT_MAX_BYTES = 240_000
const UTF8_ENCODER = new TextEncoder()

export interface TaskThreadJson {
    task: {
        id: string
        repoId: string
        title: string
        description: string
    }
    format: TaskThreadFormat
    events: TaskThreadEventJson[]
}

export interface TaskThreadEventJson {
    id: string
    sourceType: ActionEventSource["type"]
    status: "in_progress" | "completed" | "error" | "stopped"
    createdAt: string
    completedAt?: string
    agent: {
        harnessId: HarnessId
        modelId?: string
        sessionId?: string
        parentSessionId?: string
    }
    items: TaskThreadItemJson[]
}

export type TaskThreadItemJson =
    | {
          kind: "message"
          role: "user" | "assistant" | "system"
          text: string
          subtype?: string
      }
    | {
          kind: "thinking"
          text: string
      }
    | {
          kind: "functionCall"
          name: string
          callId: string
          input?: unknown
          isPending?: boolean
      }
    | {
          kind: "functionOutput"
          name: string
          callId: string
          output: string
          isError: boolean
      }
    | {
          kind: "result"
          subtype: string
          isError: boolean
          result?: string
          errors?: string[]
      }

export function buildTaskThreadJson(task: Task, format: Partial<TaskThreadFormat> = {}): TaskThreadJson {
    const resolvedFormat = resolveFormat(format)
    let actionEvents = task.events.filter((event): event is ActionEvent => event.type === "action")
    if (resolvedFormat.maxEvents != null) {
        actionEvents = actionEvents.slice(-resolvedFormat.maxEvents)
    }

    return {
        task: {
            id: task.id,
            repoId: task.repoId,
            title: task.title,
            description: task.description,
        },
        format: resolvedFormat,
        events: actionEvents.map((event) => actionEventToThreadEvent(event, resolvedFormat)),
    }
}

export function taskThreadJsonToXml(thread: TaskThreadJson): string {
    const root: XmlNode = {
        name: "task",
        attrs: {
            id: thread.task.id,
            repoId: thread.task.repoId,
            title: thread.task.title,
        },
        children: [
            {
                name: "description",
                content: thread.task.description,
            },
            {
                name: "format",
                attrs: {
                    includeFunctionInputs: thread.format.includeFunctionInputs,
                    includeFunctionOutputs: thread.format.includeFunctionOutputs,
                    includeThinking: thread.format.includeThinking,
                    includeMessages: thread.format.includeMessages,
                    maxEvents: thread.format.maxEvents,
                },
            },
            {
                name: "events",
                children: thread.events.map((event) => threadEventToXmlNode(event)),
            },
        ],
    }

    return makeXml(root)
}

export function buildTaskThreadXml(task: Task, format: Partial<TaskThreadFormat> = {}): string {
    const threadJson = buildTaskThreadJson(task, format)
    return taskThreadJsonToXml(threadJson)
}

export function buildTaskThreadXmlWithBudget(task: Task, options: TaskThreadContextBudgetOptions = {}): TaskThreadContextResult {
    const resolvedFormat = resolveFormat(options)
    const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_TASK_THREAD_CONTEXT_MAX_BYTES)
    let actionEvents = task.events.filter((event): event is ActionEvent => event.type === "action")
    if (resolvedFormat.maxEvents != null) {
        actionEvents = actionEvents.slice(-resolvedFormat.maxEvents)
    }

    const threadTask = {
        id: task.id,
        repoId: task.repoId,
        title: task.title,
        description: task.description,
    }

    const allThreadEvents = actionEvents.map((event) => actionEventToThreadEvent(event, resolvedFormat))
    const selectedEvents: TaskThreadEventJson[] = []

    let xml = taskThreadJsonToXml({
        task: threadTask,
        format: resolvedFormat,
        events: selectedEvents,
    })
    let byteLength = getUtf8ByteLength(xml)

    for (let i = allThreadEvents.length - 1; i >= 0; i--) {
        const candidateEvents = [allThreadEvents[i], ...selectedEvents]
        const candidateXml = taskThreadJsonToXml({
            task: threadTask,
            format: resolvedFormat,
            events: candidateEvents,
        })
        const candidateBytes = getUtf8ByteLength(candidateXml)
        if (candidateBytes > maxBytes) {
            break
        }
        selectedEvents.unshift(allThreadEvents[i])
        xml = candidateXml
        byteLength = candidateBytes
    }

    const includedEvents = selectedEvents.length
    const omittedEvents = allThreadEvents.length - includedEvents

    return {
        xml,
        byteLength,
        truncated: omittedEvents > 0,
        includedEvents,
        omittedEvents,
    }
}

function resolveFormat(format: Partial<TaskThreadFormat>): TaskThreadFormat {
    return {
        includeFunctionInputs: format.includeFunctionInputs ?? DEFAULT_TASK_THREAD_FORMAT.includeFunctionInputs,
        includeFunctionOutputs: format.includeFunctionOutputs ?? DEFAULT_TASK_THREAD_FORMAT.includeFunctionOutputs,
        includeThinking: format.includeThinking ?? DEFAULT_TASK_THREAD_FORMAT.includeThinking,
        includeMessages: format.includeMessages ?? DEFAULT_TASK_THREAD_FORMAT.includeMessages,
        maxEvents: format.maxEvents,
    }
}

function actionEventToThreadEvent(event: ActionEvent, format: TaskThreadFormat): TaskThreadEventJson {
    const harnessId = getHarnessId(event)
    const groups = groupStreamEvents(event.execution.events, harnessId)

    return {
        id: event.id,
        sourceType: event.source.type,
        status: event.status,
        createdAt: event.createdAt,
        ...(event.completedAt ? { completedAt: event.completedAt } : {}),
        agent: {
            harnessId,
            ...(event.execution.modelId ? { modelId: event.execution.modelId } : {}),
            ...(event.execution.sessionId ? { sessionId: event.execution.sessionId } : {}),
            ...(event.execution.parentSessionId ? { parentSessionId: event.execution.parentSessionId } : {}),
        },
        items: groupsToItems(event, groups, format),
    }
}

function getHarnessId(event: ActionEvent): HarnessId {
    return event.execution.harnessId ?? (event.execution as unknown as { type?: HarnessId }).type ?? "claude-code"
}

function groupsToItems(event: ActionEvent, groups: MessageGroup[], format: TaskThreadFormat): TaskThreadItemJson[] {
    const items: TaskThreadItemJson[] = []

    if (format.includeMessages && event.userInput.trim().length > 0) {
        items.push({
            kind: "message",
            role: "user",
            subtype: event.source.type,
            text: event.userInput,
        })
    }

    for (const group of groups) {
        switch (group.type) {
            case "text":
                if (format.includeMessages) {
                    items.push({
                        kind: "message",
                        role: "assistant",
                        text: group.text,
                    })
                }
                break
            case "thinking":
                if (format.includeThinking) {
                    items.push({
                        kind: "thinking",
                        text: group.text,
                    })
                }
                break
            case "tool":
                if (format.includeFunctionInputs) {
                    items.push({
                        kind: "functionCall",
                        name: group.toolName,
                        callId: group.toolUseId,
                        input: group.input,
                        isPending: group.messageIndices[1] === undefined,
                    })
                }
                if (format.includeFunctionOutputs && group.result !== undefined) {
                    items.push({
                        kind: "functionOutput",
                        name: group.toolName,
                        callId: group.toolUseId,
                        output: group.result,
                        isError: group.isError,
                    })
                }
                break
            case "edit":
                if (format.includeFunctionInputs) {
                    items.push({
                        kind: "functionCall",
                        name: "Edit",
                        callId: group.toolUseId,
                        input: {
                            filePath: group.filePath,
                            oldString: group.oldString,
                            newString: group.newString,
                        },
                        isPending: group.isPending,
                    })
                }
                if (format.includeFunctionOutputs && group.errorMessage) {
                    items.push({
                        kind: "functionOutput",
                        name: "Edit",
                        callId: group.toolUseId,
                        output: group.errorMessage,
                        isError: true,
                    })
                }
                break
            case "write":
                if (format.includeFunctionInputs) {
                    items.push({
                        kind: "functionCall",
                        name: "Write",
                        callId: group.toolUseId,
                        input: {
                            filePath: group.filePath,
                            content: group.content,
                        },
                        isPending: group.isPending,
                    })
                }
                if (format.includeFunctionOutputs && group.errorMessage) {
                    items.push({
                        kind: "functionOutput",
                        name: "Write",
                        callId: group.toolUseId,
                        output: group.errorMessage,
                        isError: true,
                    })
                }
                break
            case "bash":
                if (format.includeFunctionInputs) {
                    items.push({
                        kind: "functionCall",
                        name: "Bash",
                        callId: group.toolUseId,
                        input: {
                            command: group.command,
                            ...(group.description ? { description: group.description } : {}),
                        },
                        isPending: group.isPending,
                    })
                }
                if (format.includeFunctionOutputs && group.result !== undefined) {
                    items.push({
                        kind: "functionOutput",
                        name: "Bash",
                        callId: group.toolUseId,
                        output: group.result,
                        isError: group.isError,
                    })
                }
                break
            case "todoWrite":
                if (format.includeFunctionInputs) {
                    items.push({
                        kind: "functionCall",
                        name: "TodoWrite",
                        callId: group.toolUseId,
                        input: { todos: group.todos },
                        isPending: group.isPending,
                    })
                }
                break
            case "result":
                items.push({
                    kind: "result",
                    subtype: group.subtype,
                    isError: group.isError,
                    ...(group.result ? { result: group.result } : {}),
                    ...(group.errors ? { errors: group.errors } : {}),
                })
                break
            case "stderr":
            case "system":
                // Skip noisy envelope/system messages in v1 serializer output.
                break
            default: {
                const _exhaustive: never = group
                throw new Error(`Unhandled message group type: ${String(_exhaustive)}`)
            }
        }
    }

    return items
}

function threadEventToXmlNode(event: TaskThreadEventJson): XmlNode {
    return {
        name: "event",
        attrs: {
            id: event.id,
            sourceType: event.sourceType,
            status: event.status,
            createdAt: event.createdAt,
            completedAt: event.completedAt,
        },
        children: [
            {
                name: "agent",
                attrs: {
                    harnessId: event.agent.harnessId,
                    modelId: event.agent.modelId,
                    sessionId: event.agent.sessionId,
                    parentSessionId: event.agent.parentSessionId,
                },
            },
            {
                name: "items",
                children: event.items.map((item) => threadItemToXmlNode(item)),
            },
        ],
    }
}

function threadItemToXmlNode(item: TaskThreadItemJson): XmlNode {
    switch (item.kind) {
        case "message":
            return {
                name: "message",
                attrs: {
                    role: item.role,
                    subtype: item.subtype,
                },
                content: item.text,
            }
        case "thinking":
            return {
                name: "thinking",
                content: item.text,
            }
        case "functionCall":
            return {
                name: "functionCall",
                attrs: {
                    name: item.name,
                    callId: item.callId,
                    isPending: item.isPending,
                },
                ...(item.input !== undefined
                    ? {
                          children: [
                              {
                                  name: "functionInput",
                                  content: serializeUnknown(item.input),
                              },
                          ],
                      }
                    : {}),
            }
        case "functionOutput":
            return {
                name: "functionOutput",
                attrs: {
                    name: item.name,
                    callId: item.callId,
                    isError: item.isError,
                },
                content: item.output,
            }
        case "result":
            return {
                name: "result",
                attrs: {
                    subtype: item.subtype,
                    isError: item.isError,
                },
                children: [
                    ...(item.result
                        ? [
                              {
                                  name: "resultText",
                                  content: item.result,
                              } satisfies XmlNode,
                          ]
                        : []),
                    ...(item.errors && item.errors.length > 0
                        ? [
                              {
                                  name: "errors",
                                  children: item.errors.map((error) => ({ name: "error", content: error })),
                              } satisfies XmlNode,
                          ]
                        : []),
                ],
            }
        default: {
            const _exhaustive: never = item
            throw new Error(`Unhandled task thread item kind: ${String(_exhaustive)}`)
        }
    }
}

function serializeUnknown(value: unknown): string {
    if (typeof value === "string") return value
    try {
        const serialized = JSON.stringify(value, null, 2)
        return serialized ?? ""
    } catch {
        return String(value)
    }
}

function getUtf8ByteLength(value: string): number {
    return UTF8_ENCODER.encode(value).byteLength
}
