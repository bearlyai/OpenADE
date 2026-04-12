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

export class HarnessStructuredOutputError extends HarnessError {
    rawOutput?: unknown
    providerErrors?: string[]

    constructor(
        message: string,
        harnessId: HarnessId,
        options?: {
            code?: HarnessErrorCode
            cause?: Error
            rawOutput?: unknown
            providerErrors?: string[]
        }
    ) {
        super(message, options?.code ?? "unknown", harnessId, options?.cause)
        this.name = "HarnessStructuredOutputError"
        this.rawOutput = options?.rawOutput
        this.providerErrors = options?.providerErrors
    }
}
