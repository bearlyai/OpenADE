import { Clock, Zap } from "lucide-react"
import { observer } from "mobx-react"
import type { TaskModel } from "../store/TaskModel"

interface TaskStatsBarProps {
    taskModel: TaskModel
}

export const TaskStatsBar = observer(({ taskModel }: TaskStatsBarProps) => {
    const { totalCostUsd, durationMs, inputTokens, outputTokens } = taskModel.stats

    // Don't render if no executions yet
    if (totalCostUsd === 0 && durationMs === 0) {
        return null
    }

    const cost = totalCostUsd < 0.01 ? `$${totalCostUsd.toFixed(4)}` : `$${totalCostUsd.toFixed(2)}`

    const seconds = durationMs / 1000
    const duration = seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`

    const totalTokens = inputTokens + outputTokens

    return (
        <div className="flex items-center gap-3 text-xs text-muted">
            <span>{cost}</span>
            <span className="flex items-center gap-1">
                <Clock size="0.85em" />
                {duration}
            </span>
            <span className="flex items-center gap-1">
                <Zap size="0.85em" />
                {totalTokens.toLocaleString()}
            </span>
        </div>
    )
})
