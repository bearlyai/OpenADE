package product

import (
	"context"
	"encoding/json"
	"time"
)

type AgentExecutionStatus string

const (
	AgentExecutionCompleted AgentExecutionStatus = "completed"
	AgentExecutionFailed    AgentExecutionStatus = "failed"
	AgentExecutionStopped   AgentExecutionStatus = "stopped"
)

type AgentExecutionRequest struct {
	RuntimeID           string
	RepoID              string
	RepoPath            string
	TaskID              string
	EventID             string
	QueuedTurnID        string
	ExecutionID         string
	HarnessID           string
	ModelID             string
	TurnType            string
	Input               string
	AppendSystemPrompt  string
	EnabledMCPServerIDs []string
	MCPServerConfigs    json.RawMessage
	ReadOnly            bool
	IncludeComments     bool
	Thinking            string
	FastMode            *bool
	Source              json.RawMessage
	Images              *json.RawMessage
	EnvVars             map[string]string
	OnCompleted         func(ctx context.Context, request AgentExecutionRequest, result AgentExecutionResult)
}

type AgentExecutionUpdate struct {
	SessionID        string
	ParentSessionID  string
	GitRefsAfter     json.RawMessage
	PID              *int
	PGID             *int
	ProcessStartedAt time.Time
	RecoveryFile     string
}

type AgentExecutionResult struct {
	Status          AgentExecutionStatus
	Success         *bool
	SessionID       string
	ParentSessionID string
	GitRefsAfter    json.RawMessage
	Error           string
	CompletedAt     time.Time
}

type AgentExecutionEmitter interface {
	AppendStreamEvent(ctx context.Context, streamEvent json.RawMessage) error
	UpdateExecution(ctx context.Context, update AgentExecutionUpdate) error
}

type AgentExecutor interface {
	Run(ctx context.Context, request AgentExecutionRequest, emitter AgentExecutionEmitter) AgentExecutionResult
}
