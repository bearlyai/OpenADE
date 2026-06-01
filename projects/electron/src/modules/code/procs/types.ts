/**
 * Types for openade.toml configuration
 *
 * OpenADE module owns these browser-safe DTOs.
 * No Electron or Node-specific dependencies.
 */
import type {
    OpenADEEditableProcsFile,
    OpenADEProcsConfig,
    OpenADEProcsConfigError,
    OpenADEProcsCronDef,
    OpenADEProcsCronInput,
    OpenADEProcsCronTaskType,
    OpenADEProcsProcessDef,
    OpenADEProcsProcessInput,
    OpenADEProcsProcessType,
    OpenADEProcsReadResult,
    OpenADEProcsRunContext,
    OpenADESaveEditableProcsResult,
} from "../../../../../openade-module/src"

export type ProcessType = OpenADEProcsProcessType

export type ProcessDef = OpenADEProcsProcessDef

/** Editable process shape used by the config editor (id is derived from file + name) */
export type ProcessInput = OpenADEProcsProcessInput

// ============================================================================
// Cron Types
// ============================================================================

export type CronTaskType = OpenADEProcsCronTaskType

export type CronDef = OpenADEProcsCronDef

/** Editable cron shape used by the config editor (id is derived from file + name) */
export type CronInput = OpenADEProcsCronInput

// ============================================================================
// Config Types
// ============================================================================

export type ProcsConfig = OpenADEProcsConfig

export type ProcsConfigError = OpenADEProcsConfigError

export type ReadProcsResult = OpenADEProcsReadResult

export type EditableProcsFile = OpenADEEditableProcsFile

export type SaveEditableProcsResult = OpenADESaveEditableProcsResult

export type RunContext = OpenADEProcsRunContext
