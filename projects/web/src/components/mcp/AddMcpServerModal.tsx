/**
 * AddMcpServerModal
 *
 * Modal for adding or editing custom MCP server configurations.
 * Flat, square design following Theme V2.
 */

import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { Eye, EyeOff, Minus, Plus } from "lucide-react"
import { observer } from "mobx-react"
import { useState } from "react"
import type { McpServerItem } from "../../persistence/mcpServerStore"
import type { McpServerManager } from "../../store/managers/McpServerManager"
import { Modal, Switch } from "../ui"
import { McpServerIcon } from "./McpServerIcon"

interface AddMcpServerModalProps {
    manager: McpServerManager
    editServer?: McpServerItem
}

interface KeyValuePair {
    key: string
    value: string
    isSecret?: boolean
}

const KeyValueEditor = ({
    pairs,
    onChange,
    keyPlaceholder = "Key",
    valuePlaceholder = "Value",
    secretMode = false,
}: {
    pairs: KeyValuePair[]
    onChange: (pairs: KeyValuePair[]) => void
    keyPlaceholder?: string
    valuePlaceholder?: string
    secretMode?: boolean
}) => {
    const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set())

    const toggleReveal = (index: number) => {
        const newRevealed = new Set(revealedIndices)
        if (newRevealed.has(index)) {
            newRevealed.delete(index)
        } else {
            newRevealed.add(index)
        }
        setRevealedIndices(newRevealed)
    }

    const addPair = () => {
        onChange([...pairs, { key: "", value: "", isSecret: secretMode }])
    }

    const removePair = (index: number) => {
        onChange(pairs.filter((_, i) => i !== index))
    }

    const updatePair = (index: number, field: "key" | "value", value: string) => {
        const newPairs = [...pairs]
        newPairs[index] = { ...newPairs[index], [field]: value }
        onChange(newPairs)
    }

    return (
        <div className="flex flex-col gap-2">
            {pairs.map((pair, index) => (
                <div key={index} className="flex items-center gap-2">
                    <input
                        type="text"
                        placeholder={keyPlaceholder}
                        value={pair.key}
                        onChange={(e) => updatePair(index, "key", e.target.value)}
                        className="input flex-1 bg-base-200 border border-border p-2 px-3 text-sm"
                    />
                    <div className="relative flex-1">
                        <input
                            type={secretMode && !revealedIndices.has(index) ? "password" : "text"}
                            placeholder={valuePlaceholder}
                            value={pair.value}
                            onChange={(e) => updatePair(index, "value", e.target.value)}
                            className="input w-full bg-base-200 border border-border p-2 px-3 pr-10 text-sm"
                        />
                        {secretMode && pair.value && (
                            <button
                                type="button"
                                onClick={() => toggleReveal(index)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-base-content"
                            >
                                {revealedIndices.has(index) ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => removePair(index)}
                        className="btn w-8 h-8 flex items-center justify-center bg-error/10 hover:bg-error text-error hover:text-error-content transition-colors"
                    >
                        <Minus size={14} />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={addPair}
                className="btn flex items-center justify-center gap-2 p-2 bg-base-200 hover:bg-base-300 text-muted hover:text-base-content transition-colors text-sm border border-dashed border-border"
            >
                <Plus size={14} />
                Add
            </button>
        </div>
    )
}

export const AddMcpServerModal = NiceModal.create(
    observer(({ manager, editServer }: AddMcpServerModalProps) => {
        const modal = useModal()
        const isEditing = !!editServer

        // Extract type-specific fields from editServer (with proper type narrowing)
        const editHttpServer = editServer?.transportType === "http" ? editServer : null
        const editStdioServer = editServer?.transportType === "stdio" ? editServer : null

        // Form state
        const [name, setName] = useState(editServer?.name ?? "")
        const [transportType, setTransportType] = useState<"http" | "stdio">(editServer?.transportType ?? "http")
        const [url, setUrl] = useState(editHttpServer?.url ?? "")
        const [headers, setHeaders] = useState<KeyValuePair[]>(
            editHttpServer?.headers ? Object.entries(editHttpServer.headers).map(([key, value]) => ({ key, value })) : []
        )
        const [command, setCommand] = useState(editStdioServer?.command ?? "")
        const [args, setArgs] = useState(editStdioServer?.args?.join(" ") ?? "")
        const [envVars, setEnvVars] = useState<KeyValuePair[]>(
            editStdioServer?.envVars ? Object.entries(editStdioServer.envVars).map(([key, value]) => ({ key, value, isSecret: true })) : []
        )
        const [enabled, setEnabled] = useState(editServer?.enabled ?? true)

        const [isLoading, setIsLoading] = useState(false)
        const [error, setError] = useState("")

        // Validation
        const isValid = () => {
            if (!name.trim()) return false
            if (transportType === "http" && !url.trim()) return false
            if (transportType === "stdio" && !command.trim()) return false
            return true
        }

        // Save handler
        const handleSave = async () => {
            if (!isValid()) {
                setError("Please fill in all required fields")
                return
            }

            setIsLoading(true)
            setError("")

            try {
                const headersObj = headers.reduce(
                    (acc, { key, value }) => {
                        if (key.trim()) acc[key.trim()] = value
                        return acc
                    },
                    {} as Record<string, string>
                )

                const envVarsObj = envVars.reduce(
                    (acc, { key, value }) => {
                        if (key.trim()) acc[key.trim()] = value
                        return acc
                    },
                    {} as Record<string, string>
                )

                if (isEditing && editServer) {
                    // Update existing server
                    manager.updateServer(editServer.id, {
                        name: name.trim(),
                        enabled,
                        url: transportType === "http" ? url.trim() : undefined,
                        headers: transportType === "http" && Object.keys(headersObj).length > 0 ? headersObj : undefined,
                        command: transportType === "stdio" ? command.trim() : undefined,
                        args: transportType === "stdio" && args.trim() ? args.trim().split(/\s+/) : undefined,
                        envVars: transportType === "stdio" && Object.keys(envVarsObj).length > 0 ? envVarsObj : undefined,
                    })
                } else {
                    // Add new server
                    if (transportType === "http") {
                        manager.addHttpServer({
                            name: name.trim(),
                            url: url.trim(),
                            headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
                        })
                    } else {
                        manager.addStdioServer({
                            name: name.trim(),
                            command: command.trim(),
                            args: args.trim() ? args.trim().split(/\s+/) : undefined,
                            envVars: Object.keys(envVarsObj).length > 0 ? envVarsObj : undefined,
                        })
                    }
                }

                modal.remove()
            } catch (e) {
                console.error("Failed to save MCP server:", e)
                setError("Failed to save MCP server. Please try again.")
            } finally {
                setIsLoading(false)
            }
        }

        const footer = (
            <div className="flex flex-col gap-3">
                {error && (
                    <div className="p-3 bg-error/10 border border-error/20">
                        <p className="text-error text-sm font-medium">{error}</p>
                    </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                    <button
                        type="button"
                        className="btn flex-1 py-2.5 px-4 bg-base-200 hover:bg-base-300 text-base-content font-medium transition-colors border border-border"
                        onClick={() => modal.remove()}
                        disabled={isLoading}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn flex-1 py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-content font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleSave}
                        disabled={!isValid() || isLoading}
                    >
                        {isLoading ? "Saving..." : isEditing ? "Save Changes" : "Add Server"}
                    </button>
                </div>
            </div>
        )

        return (
            <Modal title={isEditing ? "Edit MCP Server" : "Add Custom Server"} footer={footer} onClose={() => modal.remove()}>
                <div className="flex flex-col gap-5">
                    {/* Name */}
                    <div className="flex flex-col gap-2">
                        <label htmlFor="mcp-name" className="text-sm font-medium text-base-content">
                            Name <span className="text-error">*</span>
                        </label>
                        <input
                            id="mcp-name"
                            type="text"
                            placeholder="My MCP Server"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="input bg-base-200 border border-border p-3 px-4 w-full"
                            autoFocus={!isEditing}
                        />
                    </div>

                    {/* Transport Type */}
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-base-content">Transport Type</span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setTransportType("http")}
                                className={`btn flex-1 p-3 border flex items-center justify-center gap-2 transition-colors ${
                                    transportType === "http" ? "border-primary bg-primary/10 text-primary" : "border-border bg-base-200 text-muted"
                                }`}
                            >
                                <McpServerIcon type="http" size={16} />
                                <span className="font-medium">HTTP</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setTransportType("stdio")}
                                className={`btn flex-1 p-3 border flex items-center justify-center gap-2 transition-colors ${
                                    transportType === "stdio" ? "border-warning bg-warning/10 text-warning" : "border-border bg-base-200 text-muted"
                                }`}
                            >
                                <McpServerIcon type="stdio" size={16} />
                                <span className="font-medium">Stdio</span>
                            </button>
                        </div>
                    </div>

                    {/* HTTP Fields */}
                    {transportType === "http" && (
                        <>
                            <div className="flex flex-col gap-2">
                                <label htmlFor="mcp-url" className="text-sm font-medium text-base-content">
                                    URL <span className="text-error">*</span>
                                </label>
                                <input
                                    id="mcp-url"
                                    type="url"
                                    placeholder="https://mcp.example.com"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="input bg-base-200 border border-border p-3 px-4 w-full font-mono text-sm"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <span className="text-sm font-medium text-base-content">
                                    Headers <span className="text-muted text-xs font-normal">(optional)</span>
                                </span>
                                <p className="text-xs text-muted mb-1">Add custom headers like Authorization tokens</p>
                                <KeyValueEditor pairs={headers} onChange={setHeaders} keyPlaceholder="Header Name" valuePlaceholder="Header Value" secretMode />
                            </div>
                        </>
                    )}

                    {/* Stdio Fields */}
                    {transportType === "stdio" && (
                        <>
                            <div className="flex flex-col gap-2">
                                <label htmlFor="mcp-command" className="text-sm font-medium text-base-content">
                                    Command <span className="text-error">*</span>
                                </label>
                                <input
                                    id="mcp-command"
                                    type="text"
                                    placeholder="npx"
                                    value={command}
                                    onChange={(e) => setCommand(e.target.value)}
                                    className="input bg-base-200 border border-border p-3 px-4 w-full font-mono text-sm"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label htmlFor="mcp-args" className="text-sm font-medium text-base-content">
                                    Arguments <span className="text-muted text-xs font-normal">(space-separated)</span>
                                </label>
                                <input
                                    id="mcp-args"
                                    type="text"
                                    placeholder="-y @anthropic-ai/mcp-server-filesystem"
                                    value={args}
                                    onChange={(e) => setArgs(e.target.value)}
                                    className="input bg-base-200 border border-border p-3 px-4 w-full font-mono text-sm"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <span className="text-sm font-medium text-base-content">
                                    Environment Variables <span className="text-muted text-xs font-normal">(optional)</span>
                                </span>
                                <KeyValueEditor pairs={envVars} onChange={setEnvVars} keyPlaceholder="Variable Name" valuePlaceholder="Value" secretMode />
                            </div>
                        </>
                    )}

                    {/* Enabled toggle */}
                    <div className="flex items-center justify-between p-4 bg-base-200 border border-border">
                        <div>
                            <p className="text-sm font-medium text-base-content">Enable Server</p>
                            <p className="text-xs text-muted mt-1">Disabled servers won't appear in task creation</p>
                        </div>
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                    </div>
                </div>
            </Modal>
        )
    })
)
