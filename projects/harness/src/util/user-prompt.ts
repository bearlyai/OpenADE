import type { ClientToolDefinition, UserPromptHandler, UserPromptRequest, UserPromptResponse } from "../types.js"

export const USER_PROMPT_TOOL_NAME = "ask_user"

const USER_PROMPT_TOOL_DESCRIPTION = [
    "Ask the user a question when you need their input, clarification, or a decision before proceeding.",
    "Present 1-4 questions with clear options for the user to choose from.",
    "The user always has the ability to provide a free-text response instead of choosing from the predefined options.",
    "Use this tool proactively when there are multiple valid approaches and the user's preference matters.",
].join(" ")

const USER_PROMPT_INPUT_SCHEMA = {
    type: "object",
    properties: {
        questions: {
            type: "array",
            description: "1-4 questions to present to the user. Prefer fewer questions when possible.",
            items: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                        description: "Stable snake_case identifier for mapping answers back to questions (e.g. 'language_choice', 'auth_method').",
                    },
                    question: {
                        type: "string",
                        description: "The question to ask. Should be clear, specific, and end with a question mark.",
                    },
                    options: {
                        type: "array",
                        description: "2-4 options to present. Put the recommended option first. Do not include an 'Other' option — one is added automatically.",
                        items: {
                            type: "object",
                            properties: {
                                label: {
                                    type: "string",
                                    description: "Short display label (1-5 words).",
                                },
                                description: {
                                    type: "string",
                                    description: "Brief explanation of what this option means or its trade-offs.",
                                },
                            },
                            required: ["label", "description"],
                        },
                    },
                    allowMultiple: {
                        type: "boolean",
                        description: "Set to true to let the user select more than one option. Defaults to false.",
                    },
                },
                required: ["id", "question", "options"],
            },
        },
    },
    required: ["questions"],
} as const

export const USER_PROMPT_SYSTEM_HINT = [
    `You have access to a tool called "${USER_PROMPT_TOOL_NAME}" that lets you ask the user questions interactively.`,
    "When you need the user's input, preference, or a decision before proceeding, call this tool with structured questions and options.",
    "The user can select from the options you provide or give a free-text response.",
].join(" ")

export function buildUserPromptTool(handler: UserPromptHandler): ClientToolDefinition {
    return {
        name: USER_PROMPT_TOOL_NAME,
        description: USER_PROMPT_TOOL_DESCRIPTION,
        inputSchema: USER_PROMPT_INPUT_SCHEMA,
        handler: async (args: Record<string, unknown>) => {
            const request = parseUserPromptRequest(args)
            const response = await handler(request)
            return { content: formatUserPromptResponse(response) }
        },
    }
}

export function parseUserPromptRequest(args: Record<string, unknown>): UserPromptRequest {
    const rawQuestions = args.questions
    if (!Array.isArray(rawQuestions)) {
        return { questions: [] }
    }
    return {
        questions: rawQuestions.map((q: unknown) => {
            const obj = (q ?? {}) as Record<string, unknown>
            const rawOptions = obj.options
            return {
                id: String(obj.id ?? ""),
                question: String(obj.question ?? ""),
                options: Array.isArray(rawOptions)
                    ? rawOptions.map((o: unknown) => {
                          const oObj = (o ?? {}) as Record<string, unknown>
                          return {
                              label: String(oObj.label ?? ""),
                              description: String(oObj.description ?? ""),
                          }
                      })
                    : [],
                allowMultiple: obj.allowMultiple === true,
            }
        }),
    }
}

export function formatUserPromptResponse(response: UserPromptResponse): string {
    const entries = Object.entries(response.answers)
    if (entries.length === 0) {
        return "The user did not provide any answers."
    }
    const lines = entries.map(([questionId, answer]) => `${questionId}: ${answer}`)
    return `User answers:\n${lines.join("\n")}`
}
