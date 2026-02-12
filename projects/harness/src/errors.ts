import type { HarnessErrorCode, HarnessId } from "./types.js"

export class HarnessError extends Error {
    constructor(
        message: string,
        public code: HarnessErrorCode,
        public harnessId: HarnessId,
        public override cause?: Error
    ) {
        super(message)
        this.name = "HarnessError"
    }
}

export class HarnessNotInstalledError extends HarnessError {
    instructions?: string
    constructor(harnessId: HarnessId, instructions?: string) {
        super(`${harnessId} CLI is not installed${instructions ? `. ${instructions}` : ""}`, "not_installed", harnessId)
        this.name = "HarnessNotInstalledError"
        this.instructions = instructions
    }
}

export class HarnessAuthError extends HarnessError {
    authInstructions: string
    constructor(harnessId: HarnessId, authInstructions: string) {
        super(`${harnessId} is not authenticated. ${authInstructions}`, "auth_failed", harnessId)
        this.name = "HarnessAuthError"
        this.authInstructions = authInstructions
    }
}
