import { describe, expect, it } from "vitest"
import { buildDoPrompt, type PromptBuildContext } from "./prompts"

describe("buildDoPrompt", () => {
    it("passes raw user input through unchanged when there are no comments or images", async () => {
        const userInput = "/continue --last\n@src/file.ts\nSend this exactly to the harness parser."
        const ctx: PromptBuildContext = {
            userInput,
            comments: [],
            images: [],
        }

        const result = await buildDoPrompt(ctx)

        expect(result.systemPrompt).toBeUndefined()
        expect(result.userMessage).toBe(userInput)
    })
})
