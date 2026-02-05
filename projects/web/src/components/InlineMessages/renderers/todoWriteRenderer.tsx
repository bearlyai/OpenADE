import cx from "classnames"
import { AlertCircle, ListTodo, Square } from "lucide-react"
import type { CommentContext, GroupRenderer, TodoItem, TodoWriteGroup } from "../../events/messageGroups"

function TodoCompletionBadge({ todos }: { todos: TodoItem[] }) {
    const completed = todos.filter((t) => t.status === "completed").length
    const total = todos.length

    if (total === 0) return null

    const allComplete = completed === total

    return (
        <span
            className={cx(
                "inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5",
                allComplete ? "bg-success/20 text-success" : "bg-base-200 text-base-content"
            )}
        >
            {completed}/{total}
        </span>
    )
}

function TodoItemRow({ item }: { item: TodoItem }) {
    const isCompleted = item.status === "completed"
    const isInProgress = item.status === "in_progress"

    return (
        <div className={cx("flex items-start gap-2 px-3 py-1.5 text-xs", isCompleted && "text-muted")}>
            <span className="flex-shrink-0 mt-0.5">
                <Square size="1em" className={cx(isCompleted ? "text-success fill-success" : isInProgress ? "text-warning fill-warning" : "text-muted")} />
            </span>
            <span className={cx(isCompleted && "line-through")}>{isInProgress ? item.activeForm : item.content}</span>
        </div>
    )
}

function TodoWriteContent({ group }: { group: TodoWriteGroup; ctx: CommentContext }) {
    if (group.todos.length === 0) {
        return <div className="px-3 py-2 text-xs text-muted italic">No todos defined</div>
    }

    return (
        <div className="py-1">
            {group.todos.map((item, i) => (
                <TodoItemRow key={`${item.content}-${i}`} item={item} />
            ))}
        </div>
    )
}

export const todoWriteRenderer: GroupRenderer<TodoWriteGroup> = {
    getLabel: () => "Update Todos",
    getIcon: () => <ListTodo size="0.85em" className="text-muted flex-shrink-0" />,
    getStatusIcon: (group) => {
        if (group.isError) return <AlertCircle size="1em" className="text-error flex-shrink-0" />
        return null
    },
    getHeaderInfo: (group) => <TodoCompletionBadge todos={group.todos} />,
    renderContent: (group, ctx) => <TodoWriteContent group={group} ctx={ctx} />,
}
