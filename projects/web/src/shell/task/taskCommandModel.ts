import { taskCommandLabel } from "./taskCommands"

export const COMMIT_AND_PUSH_COMMAND_LABEL = "Commit & Push"

export type TaskShellCommandId =
    | "stop"
    | "interrupt"
    | "retry"
    | "runPlan"
    | "reviewPlan"
    | "revise"
    | "cancelPlan"
    | "do"
    | "plan"
    | "ask"
    | "review"
    | "repeat"
    | "commitAndPush"
    | "close"
    | "reopen"
    | "repeatStop"

export type TaskShellCommandVariant = "primary" | "success" | "danger" | "neutral" | "ghost"
export type TaskShellCommandGroup = "primary" | "secondary"

export interface TaskShellCommandStyle {
    variant?: TaskShellCommandVariant
}

export interface TaskShellCommandDescriptor {
    id: TaskShellCommandId
    label: string
    order: number
    style?: TaskShellCommandStyle
    show: boolean
    enabled: boolean
    spacer?: boolean
    group?: TaskShellCommandGroup
}

export interface TaskShellCommandContext {
    repeatActive: boolean
    closed: boolean
    working: boolean
    activePlan: boolean
    feedback: boolean
    input: boolean
    retryable: boolean
    actionHistory: boolean
    gitWorkingChanges: boolean
    gitStateUnknown: boolean
    unpushedCommits: boolean
    commitAndPushInProgress: boolean
    forceAllCommands?: boolean
}

export const TRACKABLE_TASK_COMMAND_IDS: ReadonlySet<TaskShellCommandId> = new Set([
    "plan",
    "do",
    "ask",
    "revise",
    "runPlan",
    "retry",
    "review",
    "reviewPlan",
    "interrupt",
])

export function buildTaskShellCommandDescriptors(context: TaskShellCommandContext): TaskShellCommandDescriptor[] {
    if (context.repeatActive) {
        const repeatCommands: TaskShellCommandDescriptor[] = [
            {
                id: "repeatStop",
                label: "Stop",
                order: 0,
                style: { variant: "danger" },
                show: true,
                enabled: true,
            },
            {
                id: "close",
                label: "Close",
                order: 200,
                style: { variant: "neutral" },
                show: !context.closed,
                enabled: true,
                spacer: true,
            },
        ]
        return repeatCommands.filter((command) => command.show).sort((first, second) => first.order - second.order)
    }

    const allCommands: TaskShellCommandDescriptor[] = [
        {
            id: "stop",
            label: "Stop",
            order: 0,
            group: "primary",
            style: { variant: "danger" },
            show: context.working,
            enabled: true,
        },
        {
            id: "interrupt",
            label: "Interrupt",
            order: 2,
            group: "primary",
            style: { variant: "primary" },
            show: context.working && !context.activePlan,
            enabled: context.feedback,
        },
        {
            id: "retry",
            label: "Retry",
            order: 1,
            group: "primary",
            style: { variant: "danger" },
            show: context.retryable,
            enabled: true,
        },
        {
            id: "runPlan",
            label: taskCommandLabel("run_plan"),
            order: 4,
            group: "primary",
            style: { variant: "success" },
            show: context.activePlan && !context.working,
            enabled: true,
        },
        {
            id: "reviewPlan",
            label: "Review Plan",
            order: 8,
            group: "secondary",
            style: { variant: "neutral" },
            show: context.activePlan && !context.working,
            enabled: true,
        },
        {
            id: "revise",
            label: taskCommandLabel("revise"),
            order: 6,
            group: "primary",
            style: { variant: "primary" },
            show: context.activePlan && !context.working,
            enabled: context.feedback,
        },
        {
            id: "cancelPlan",
            label: "Cancel Plan",
            order: 7,
            group: "secondary",
            style: { variant: "danger" },
            show: context.activePlan && !context.working,
            enabled: true,
        },
        {
            id: "do",
            label: taskCommandLabel("do", { queued: context.working }),
            order: 10,
            group: "primary",
            style: { variant: "success" },
            show: !context.activePlan,
            enabled: context.feedback,
        },
        {
            id: "plan",
            label: taskCommandLabel("plan"),
            order: 15,
            group: "primary",
            style: { variant: "primary" },
            show: !context.activePlan && !context.working,
            enabled: context.feedback,
        },
        {
            id: "ask",
            label: taskCommandLabel("ask", { queued: context.working }),
            order: 20,
            group: "primary",
            style: { variant: "neutral" },
            show: true,
            enabled: context.feedback,
        },
        {
            id: "review",
            label: "Review",
            order: 21,
            group: "secondary",
            style: { variant: "neutral" },
            show: !context.activePlan && !context.working && context.actionHistory,
            enabled: true,
        },
        {
            id: "repeat",
            label: "Repeat",
            order: 22,
            group: "secondary",
            style: { variant: "neutral" },
            show: !context.activePlan && !context.working,
            enabled: context.input,
        },
        {
            id: "commitAndPush",
            label: COMMIT_AND_PUSH_COMMAND_LABEL,
            order: 100,
            group: "secondary",
            style: { variant: "neutral" },
            show: (context.gitWorkingChanges || context.unpushedCommits || context.gitStateUnknown) && !context.working,
            enabled: true,
        },
        {
            id: "close",
            label: "Close",
            order: 200,
            group: "primary",
            style: { variant: "neutral" },
            show: !context.closed && (!context.working || context.commitAndPushInProgress),
            enabled: true,
            spacer: true,
        },
        {
            id: "reopen",
            label: "Reopen",
            order: 201,
            group: "primary",
            style: { variant: "neutral" },
            show: context.closed,
            enabled: true,
            spacer: true,
        },
    ]

    const forceAll = context.forceAllCommands === true
    return allCommands.filter((command) => forceAll || command.show).sort((first, second) => first.order - second.order)
}
