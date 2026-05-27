import { isObservable, observable } from "mobx"
import { describe, expect, it } from "vitest"
import type { RuntimeRequest } from "../../../runtime-protocol/src"
import { cloneRuntimeRequestForIpc } from "./localRuntimeClient"

describe("localRuntimeClient IPC serialization", () => {
    it("converts observable request payloads into structured-clone-safe runtime messages", () => {
        const params = observable({
            repoId: "repo-1",
            type: "do",
            input: "ship it",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            images: [
                {
                    id: "img-1",
                    mediaType: "image/png",
                    ext: "png",
                    originalWidth: 100,
                    originalHeight: 100,
                    resizedWidth: 100,
                    resizedHeight: 100,
                },
            ],
        })
        const request: RuntimeRequest = { id: 1, method: "openade/turn/start", params }

        const cloned = cloneRuntimeRequestForIpc(request)

        expect(isObservable(params)).toBe(true)
        expect(isObservable(cloned.params)).toBe(false)
        expect(() => structuredClone(cloned)).not.toThrow()
        expect(cloned).toEqual({
            id: 1,
            method: "openade/turn/start",
            params: {
                repoId: "repo-1",
                type: "do",
                input: "ship it",
                isolationStrategy: { type: "worktree", sourceBranch: "main" },
                images: [
                    {
                        id: "img-1",
                        mediaType: "image/png",
                        ext: "png",
                        originalWidth: 100,
                        originalHeight: 100,
                        resizedWidth: 100,
                        resizedHeight: 100,
                    },
                ],
            },
        })
    })
})
