import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { type OpenADEYjsMutationStorageAdapter, createOpenADEYjsWriter } from "../../../../openade-module/src/yjsMutation"
import { createOpenADEYjsProjection } from "../../../../openade-module/src/yjsProjection"
import { createElectronOpenADEYjsStorageAdapter } from "./openadeYjsStorageAdapter"

function uint8ArrayToBase64(data: Uint8Array): string {
    let binary = ""
    const chunkSize = 0x8000
    for (let index = 0; index < data.length; index += chunkSize) {
        const chunk = data.subarray(index, index + chunkSize)
        binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
}

function createInMemoryYjsStorage(): OpenADEYjsMutationStorageAdapter {
    const documents = new Map<string, Uint8Array>()

    return {
        async listDocuments() {
            return [...documents.keys()].sort()
        },
        async readDocumentUpdate(id) {
            return documents.get(id) ?? null
        },
        async saveDocumentUpdate(id, data) {
            const doc = new Y.Doc()
            try {
                const existing = documents.get(id)
                if (existing) Y.applyUpdate(doc, existing)
                Y.applyUpdate(doc, data)
                documents.set(id, Y.encodeStateAsUpdate(doc))
            } finally {
                doc.destroy()
            }
        },
        async deleteDocument(id) {
            documents.delete(id)
        },
        async readDocumentBase64(id) {
            const data = documents.get(id)
            return data ? { id, data: uint8ArrayToBase64(data) } : null
        },
        async readMapObject() {
            return null
        },
        async readOrderedArray() {
            return null
        },
    }
}

describe("createElectronOpenADEYjsStorageAdapter", () => {
    it("projects local Electron Yjs document bytes through the OpenADE Yjs projection", async () => {
        const sourceStorage = createInMemoryYjsStorage()
        const writer = createOpenADEYjsWriter(sourceStorage, {
            createId: () => "generated-id",
            createSlug: () => "generated-slug",
            now: () => "2026-06-01T00:00:00.000Z",
        })

        await writer.createRepo({
            repoId: "repo-local",
            name: "Local Repo",
            path: "/tmp/local-repo",
            createdBy: { id: "user-1", email: "user@example.com" },
            createdAt: "2026-06-01T00:00:00.000Z",
        })
        await writer.createTask({
            repoId: "repo-local",
            taskId: "task-local",
            slug: "local-task",
            title: "Local Task",
            input: "Import through the desktop adapter",
            createdBy: { id: "user-1", email: "user@example.com" },
            deviceId: "device-1",
            createdAt: "2026-06-01T00:01:00.000Z",
            isolationStrategy: { type: "head" },
        })

        const adapter = createElectronOpenADEYjsStorageAdapter({
            listYjsDocs: () => sourceStorage.listDocuments(),
            loadYjsDoc: (id) => sourceStorage.readDocumentUpdate(id),
        })
        const projection = createOpenADEYjsProjection(adapter)

        await expect(projection.listDataDocuments()).resolves.toEqual(["code:repos", "code:task:task-local"])
        await expect(projection.readDataDocumentBase64("code:repos")).resolves.toEqual({
            id: "code:repos",
            data: expect.any(String),
        })
        await expect(projection.readSnapshot()).resolves.toMatchObject({
            repos: [
                {
                    id: "repo-local",
                    name: "Local Repo",
                    tasks: [{ id: "task-local", title: "Local Task" }],
                },
            ],
        })
        await expect(projection.readTask("repo-local", "task-local", { hydrateSessionEvents: true })).resolves.toMatchObject({
            id: "task-local",
            repoId: "repo-local",
            title: "Local Task",
            description: "Import through the desktop adapter",
        })
    })
})
