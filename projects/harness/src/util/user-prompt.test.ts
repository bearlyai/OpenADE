import { describe, it, expect, vi } from "vitest"
import { buildUserPromptTool, parseUserPromptRequest, formatUserPromptResponse, USER_PROMPT_TOOL_NAME } from "./user-prompt.js"
import type { UserPromptHandler, UserPromptRequest, UserPromptResponse } from "../types.js"

describe("buildUserPromptTool", () => {
    it("returns a tool with the correct name and schema", () => {
        const handler: UserPromptHandler = async () => ({ answers: {} })
        const tool = buildUserPromptTool(handler)

        expect(tool.name).toBe(USER_PROMPT_TOOL_NAME)
        expect(tool.name).toBe("ask_user")
        expect(tool.description).toBeTruthy()
        expect(tool.inputSchema).toBeDefined()
        expect((tool.inputSchema as Record<string, unknown>).type).toBe("object")
        expect((tool.inputSchema as Record<string, unknown>).required).toEqual(["questions"])
    })

    it("handler parses args and calls the user handler", async () => {
        const userHandler = vi.fn<UserPromptHandler>(async () => ({
            answers: { language: "Python" },
        }))

        const tool = buildUserPromptTool(userHandler)

        const result = await tool.handler({
            questions: [
                {
                    id: "language",
                    question: "Which language?",
                    options: [
                        { label: "Python", description: "Great for data science" },
                        { label: "JavaScript", description: "Great for web" },
                    ],
                },
            ],
        })

        expect(userHandler).toHaveBeenCalledOnce()

        const request = userHandler.mock.calls[0][0]
        expect(request.questions).toHaveLength(1)
        expect(request.questions[0].id).toBe("language")
        expect(request.questions[0].question).toBe("Which language?")
        expect(request.questions[0].options).toHaveLength(2)
        expect(request.questions[0].options[0].label).toBe("Python")
        expect(request.questions[0].allowMultiple).toBe(false)

        expect(result.content).toContain("language: Python")
        expect(result.error).toBeUndefined()
    })

    it("handler propagates errors from the user handler", async () => {
        const tool = buildUserPromptTool(async () => {
            throw new Error("User cancelled")
        })

        await expect(tool.handler({ questions: [] })).rejects.toThrow("User cancelled")
    })

    it("handles allowMultiple flag", async () => {
        const userHandler = vi.fn<UserPromptHandler>(async () => ({
            answers: { features: "Auth, Logging" },
        }))

        const tool = buildUserPromptTool(userHandler)

        await tool.handler({
            questions: [
                {
                    id: "features",
                    question: "Which features?",
                    options: [
                        { label: "Auth", description: "Authentication" },
                        { label: "Logging", description: "Structured logging" },
                    ],
                    allowMultiple: true,
                },
            ],
        })

        const request = userHandler.mock.calls[0][0]
        expect(request.questions[0].allowMultiple).toBe(true)
    })
})

describe("parseUserPromptRequest", () => {
    it("parses well-formed input", () => {
        const result = parseUserPromptRequest({
            questions: [
                {
                    id: "color",
                    question: "What color?",
                    options: [
                        { label: "Red", description: "A warm color" },
                        { label: "Blue", description: "A cool color" },
                    ],
                    allowMultiple: false,
                },
            ],
        })

        expect(result.questions).toHaveLength(1)
        expect(result.questions[0]).toEqual({
            id: "color",
            question: "What color?",
            options: [
                { label: "Red", description: "A warm color" },
                { label: "Blue", description: "A cool color" },
            ],
            allowMultiple: false,
        })
    })

    it("handles missing questions array", () => {
        const result = parseUserPromptRequest({})
        expect(result.questions).toEqual([])
    })

    it("handles non-array questions", () => {
        const result = parseUserPromptRequest({ questions: "not an array" })
        expect(result.questions).toEqual([])
    })

    it("handles missing fields with defaults", () => {
        const result = parseUserPromptRequest({
            questions: [{}],
        })

        expect(result.questions[0].id).toBe("")
        expect(result.questions[0].question).toBe("")
        expect(result.questions[0].options).toEqual([])
        expect(result.questions[0].allowMultiple).toBe(false)
    })

    it("handles missing option fields", () => {
        const result = parseUserPromptRequest({
            questions: [
                {
                    id: "q1",
                    question: "Test?",
                    options: [{}],
                },
            ],
        })

        expect(result.questions[0].options[0]).toEqual({
            label: "",
            description: "",
        })
    })

    it("handles null values in questions", () => {
        const result = parseUserPromptRequest({
            questions: [null, { id: "q1", question: "Test?", options: [] }],
        })

        expect(result.questions).toHaveLength(2)
        expect(result.questions[0].id).toBe("")
        expect(result.questions[1].id).toBe("q1")
    })

    it("parses multiple questions", () => {
        const result = parseUserPromptRequest({
            questions: [
                {
                    id: "q1",
                    question: "First?",
                    options: [{ label: "A", description: "Option A" }],
                },
                {
                    id: "q2",
                    question: "Second?",
                    options: [{ label: "B", description: "Option B" }],
                    allowMultiple: true,
                },
            ],
        })

        expect(result.questions).toHaveLength(2)
        expect(result.questions[0].id).toBe("q1")
        expect(result.questions[1].id).toBe("q2")
        expect(result.questions[1].allowMultiple).toBe(true)
    })
})

describe("formatUserPromptResponse", () => {
    it("formats single answer", () => {
        const result = formatUserPromptResponse({
            answers: { language: "Python" },
        })
        expect(result).toBe("User answers:\nlanguage: Python")
    })

    it("formats multiple answers", () => {
        const result = formatUserPromptResponse({
            answers: { language: "Python", framework: "Django" },
        })
        expect(result).toContain("language: Python")
        expect(result).toContain("framework: Django")
        expect(result).toMatch(/^User answers:\n/)
    })

    it("handles empty answers", () => {
        const result = formatUserPromptResponse({ answers: {} })
        expect(result).toBe("The user did not provide any answers.")
    })
})
