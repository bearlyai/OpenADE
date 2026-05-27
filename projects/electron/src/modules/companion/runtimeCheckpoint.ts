import { app } from "electron"
import os from "node:os"
import path from "node:path"
import { createRuntimeNodeCheckpointStore } from "../../../../runtime-node/src"
import type { RuntimeCheckpointStore } from "../../../../runtime/src"

const CHECKPOINT_FILE = "openade-runtime-checkpoints.json"

function checkpointPath(): string {
    if (process.env.OPENADE_RUNTIME_CHECKPOINT_FILE) return process.env.OPENADE_RUNTIME_CHECKPOINT_FILE
    try {
        return path.join(app.getPath("userData"), CHECKPOINT_FILE)
    } catch {
        return path.join(os.tmpdir(), CHECKPOINT_FILE)
    }
}

export function createRuntimeCheckpointStore(): RuntimeCheckpointStore {
    return createRuntimeNodeCheckpointStore(checkpointPath())
}
