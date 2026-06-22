package product

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

const (
	commandAgentWorkerProtocolVersion = 1
	commandAgentWorkerMaxLineBytes    = 1024 * 1024
	commandAgentWorkerMaxStderrBytes  = 4096
)

type CommandAgentExecutor struct {
	Command     []string
	Env         []string
	RecoveryDir string
}

type commandAgentWorkerStartEnvelope struct {
	Type            string                         `json:"type"`
	ProtocolVersion int                            `json:"protocolVersion"`
	Request         commandAgentWorkerStartRequest `json:"request"`
}

type commandAgentWorkerSDKCapabilitiesEnvelope struct {
	Type            string                                   `json:"type"`
	ProtocolVersion int                                      `json:"protocolVersion"`
	Request         commandAgentWorkerSDKCapabilitiesRequest `json:"request"`
}

type commandAgentWorkerSDKCapabilitiesRequest struct {
	RepoID    string `json:"repoId"`
	RepoPath  string `json:"repoPath"`
	Cwd       string `json:"cwd"`
	TaskID    string `json:"taskId,omitempty"`
	HarnessID string `json:"harnessId"`
}

type commandAgentWorkerStartRequest struct {
	RuntimeID           string           `json:"runtimeId"`
	RepoID              string           `json:"repoId"`
	RepoPath            string           `json:"repoPath"`
	Cwd                 string           `json:"cwd"`
	TaskID              string           `json:"taskId"`
	EventID             string           `json:"eventId"`
	QueuedTurnID        string           `json:"queuedTurnId,omitempty"`
	ExecutionID         string           `json:"executionId"`
	HarnessID           string           `json:"harnessId"`
	ModelID             string           `json:"modelId,omitempty"`
	TurnType            string           `json:"turnType"`
	Input               string           `json:"input"`
	AppendSystemPrompt  string           `json:"appendSystemPrompt,omitempty"`
	EnabledMCPServerIDs []string         `json:"enabledMcpServerIds,omitempty"`
	MCPServerConfigs    json.RawMessage  `json:"mcpServerConfigs,omitempty"`
	ReadOnly            bool             `json:"readOnly,omitempty"`
	IncludeComments     bool             `json:"includeComments,omitempty"`
	Thinking            string           `json:"thinking,omitempty"`
	FastMode            *bool            `json:"fastMode,omitempty"`
	Source              json.RawMessage  `json:"source,omitempty"`
	Images              *json.RawMessage `json:"images,omitempty"`
	HyperPlanStrategy   json.RawMessage  `json:"hyperplanStrategy,omitempty"`
}

type commandAgentWorkerMessage struct {
	Type            string          `json:"type"`
	Event           json.RawMessage `json:"event,omitempty"`
	SessionID       string          `json:"sessionId,omitempty"`
	ParentSessionID string          `json:"parentSessionId,omitempty"`
	GitRefsAfter    json.RawMessage `json:"gitRefsAfter,omitempty"`
	Status          string          `json:"status,omitempty"`
	Success         *bool           `json:"success,omitempty"`
	Error           string          `json:"error,omitempty"`
	CompletedAt     string          `json:"completedAt,omitempty"`
}

type commandAgentWorkerSDKPluginCapability struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type commandAgentWorkerSDKCapabilitiesMessage struct {
	Type          string                                  `json:"type"`
	SlashCommands []string                                `json:"slash_commands,omitempty"`
	Skills        []string                                `json:"skills,omitempty"`
	Plugins       []commandAgentWorkerSDKPluginCapability `json:"plugins,omitempty"`
	CachedAt      int64                                   `json:"cachedAt,omitempty"`
	Status        string                                  `json:"status,omitempty"`
	Success       *bool                                   `json:"success,omitempty"`
	Error         string                                  `json:"error,omitempty"`
}

func NewCommandAgentExecutor(command []string) CommandAgentExecutor {
	return CommandAgentExecutor{Command: append([]string(nil), command...)}
}

func NewCommandAgentExecutorWithRecoveryDir(command []string, recoveryDir string) CommandAgentExecutor {
	return CommandAgentExecutor{Command: append([]string(nil), command...), RecoveryDir: recoveryDir}
}

func (executor CommandAgentExecutor) Run(ctx context.Context, request AgentExecutionRequest, emitter AgentExecutionEmitter) AgentExecutionResult {
	command := normalizedCommand(executor.Command)
	if len(command) == 0 {
		return failedAgentExecution("agent worker command is not configured")
	}

	execCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(execCtx, command[0], command[1:]...)
	if request.RepoPath != "" {
		cmd.Dir = request.RepoPath
	}
	configureCommandAgentProcess(cmd)
	envExtras := append([]string(nil), executor.Env...)
	recoveryFile := commandAgentRecoveryFile(executor.RecoveryDir, request.RuntimeID)
	if recoveryFile != "" {
		envExtras = append(envExtras, "OPENADE_AGENT_WORKER_RECOVERY_FILE="+recoveryFile)
		if err := emitter.UpdateExecution(execCtx, AgentExecutionUpdate{RecoveryFile: recoveryFile}); err != nil {
			cancel()
			return failedAgentExecution("agent worker recovery metadata rejected")
		}
	}
	cmd.Env = environmentWithOverrides(os.Environ(), request.EnvVars, envExtras...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return failedAgentExecution("agent worker stdin unavailable")
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return failedAgentExecution("agent worker stdout unavailable")
	}
	stderr := &limitedStringWriter{limit: commandAgentWorkerMaxStderrBytes}
	cmd.Stderr = stderr

	if err := cmd.Start(); err != nil {
		return failedAgentExecution("agent worker failed to start")
	}
	if cmd.Process != nil {
		pid := cmd.Process.Pid
		if err := emitter.UpdateExecution(execCtx, AgentExecutionUpdate{
			PID:              &pid,
			PGID:             commandAgentProcessGroupID(cmd),
			ProcessStartedAt: time.Now().UTC(),
		}); err != nil {
			cancel()
			_ = cmd.Wait()
			if execCtx.Err() != nil {
				return AgentExecutionResult{Status: AgentExecutionStopped}
			}
			return failedAgentExecution("agent worker runtime metadata rejected")
		}
	}
	if err := json.NewEncoder(stdin).Encode(commandAgentStartEnvelope(request)); err != nil {
		_ = stdin.Close()
		cancel()
		_ = cmd.Wait()
		return failedAgentExecution("agent worker request write failed")
	}
	_ = stdin.Close()

	result, settled := readCommandAgentWorkerMessages(execCtx, stdout, emitter)
	if result.Status == AgentExecutionFailed {
		cancel()
	}
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return AgentExecutionResult{Status: AgentExecutionStopped}
	}
	if result.Status == AgentExecutionFailed {
		return result
	}
	if waitErr != nil {
		message := "agent worker failed"
		if stderr.String() != "" {
			message = message + ": " + stderr.String()
		}
		return failedAgentExecution(message)
	}
	if !settled {
		return failedAgentExecution("agent worker exited without result")
	}
	return result
}

func (executor CommandAgentExecutor) DiscoverSDKCapabilities(ctx context.Context, request SDKCapabilitiesRequest) (SDKCapabilitiesResult, *core.RuntimeError) {
	command := normalizedCommand(executor.Command)
	if len(command) == 0 {
		return SDKCapabilitiesResult{}, handlerError(errors.New("agent worker command is not configured"))
	}

	execCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(execCtx, command[0], command[1:]...)
	if request.RepoPath != "" {
		cmd.Dir = request.RepoPath
	}
	configureCommandAgentProcess(cmd)
	cmd.Env = environmentWithOverrides(os.Environ(), request.EnvVars, executor.Env...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return SDKCapabilitiesResult{}, handlerError(errors.New("agent worker stdin unavailable"))
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return SDKCapabilitiesResult{}, handlerError(errors.New("agent worker stdout unavailable"))
	}
	stderr := &limitedStringWriter{limit: commandAgentWorkerMaxStderrBytes}
	cmd.Stderr = stderr

	if err := cmd.Start(); err != nil {
		return SDKCapabilitiesResult{}, handlerError(errors.New("agent worker failed to start"))
	}
	if err := json.NewEncoder(stdin).Encode(commandAgentSDKCapabilitiesEnvelope(request)); err != nil {
		_ = stdin.Close()
		cancel()
		_ = cmd.Wait()
		return SDKCapabilitiesResult{}, handlerError(errors.New("agent worker SDK capabilities request write failed"))
	}
	_ = stdin.Close()

	result, settled, runtimeErr := readCommandAgentWorkerSDKCapabilities(execCtx, stdout)
	if runtimeErr != nil {
		cancel()
		_ = cmd.Wait()
		return SDKCapabilitiesResult{}, runtimeErr
	}
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return SDKCapabilitiesResult{}, handlerError(ctx.Err())
	}
	if waitErr != nil {
		message := "agent worker SDK capabilities failed"
		if stderr.String() != "" {
			message = message + ": " + stderr.String()
		}
		return SDKCapabilitiesResult{}, handlerError(errors.New(message))
	}
	if !settled {
		return SDKCapabilitiesResult{}, handlerError(errors.New("agent worker exited without SDK capabilities"))
	}
	return result, nil
}

func readCommandAgentWorkerMessages(ctx context.Context, stdoutReader io.Reader, emitter AgentExecutionEmitter) (AgentExecutionResult, bool) {
	scanner := bufio.NewScanner(stdoutReader)
	scanner.Buffer(make([]byte, 0, 64*1024), commandAgentWorkerMaxLineBytes)
	result := AgentExecutionResult{}
	settled := false
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		message := commandAgentWorkerMessage{}
		if err := json.Unmarshal(line, &message); err != nil {
			return failedAgentExecution("agent worker emitted invalid JSON"), false
		}
		switch message.Type {
		case "stream":
			if len(message.Event) == 0 {
				return failedAgentExecution("agent worker stream event is missing"), false
			}
			if err := emitter.AppendStreamEvent(ctx, message.Event); err != nil {
				if ctx.Err() != nil {
					return AgentExecutionResult{Status: AgentExecutionStopped}, true
				}
				return failedAgentExecution("agent worker stream event rejected"), false
			}
		case "execution":
			if err := emitter.UpdateExecution(ctx, AgentExecutionUpdate{
				SessionID:       message.SessionID,
				ParentSessionID: message.ParentSessionID,
				GitRefsAfter:    message.GitRefsAfter,
			}); err != nil {
				if ctx.Err() != nil {
					return AgentExecutionResult{Status: AgentExecutionStopped}, true
				}
				return failedAgentExecution("agent worker execution update rejected"), false
			}
		case "result":
			status, ok := agentExecutionStatusFromWorker(message.Status)
			if !ok {
				return failedAgentExecution("agent worker result status is invalid"), false
			}
			completedAt := time.Time{}
			if strings.TrimSpace(message.CompletedAt) != "" {
				parsed, err := time.Parse(time.RFC3339Nano, message.CompletedAt)
				if err != nil {
					return failedAgentExecution("agent worker completedAt is invalid"), false
				}
				completedAt = parsed
			}
			result = AgentExecutionResult{
				Status:          status,
				Success:         message.Success,
				SessionID:       message.SessionID,
				ParentSessionID: message.ParentSessionID,
				GitRefsAfter:    message.GitRefsAfter,
				Error:           strings.TrimSpace(message.Error),
				CompletedAt:     completedAt,
			}
			settled = true
		default:
			return failedAgentExecution("agent worker message type is invalid"), false
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, context.Canceled) {
		if ctx.Err() != nil {
			return AgentExecutionResult{Status: AgentExecutionStopped}, true
		}
		return failedAgentExecution("agent worker output read failed"), false
	}
	return result, settled
}

func readCommandAgentWorkerSDKCapabilities(ctx context.Context, stdoutReader io.Reader) (SDKCapabilitiesResult, bool, *core.RuntimeError) {
	scanner := bufio.NewScanner(stdoutReader)
	scanner.Buffer(make([]byte, 0, 64*1024), commandAgentWorkerMaxLineBytes)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		message := commandAgentWorkerSDKCapabilitiesMessage{}
		if err := json.Unmarshal(line, &message); err != nil {
			return SDKCapabilitiesResult{}, false, handlerError(errors.New("agent worker emitted invalid JSON"))
		}
		switch message.Type {
		case "sdkCapabilities":
			plugins := make([]SDKPluginCapability, 0, len(message.Plugins))
			for _, plugin := range message.Plugins {
				plugins = append(plugins, SDKPluginCapability{Name: plugin.Name, Path: plugin.Path})
			}
			cachedAt := time.Now().UTC()
			if message.CachedAt > 0 {
				cachedAt = time.Unix(0, message.CachedAt*int64(time.Millisecond)).UTC()
			}
			return SDKCapabilitiesResult{
				SlashCommands: append([]string(nil), message.SlashCommands...),
				Skills:        append([]string(nil), message.Skills...),
				Plugins:       plugins,
				CachedAt:      cachedAt,
			}, true, nil
		case "result":
			if message.Status == "failed" {
				return SDKCapabilitiesResult{}, false, handlerError(errors.New(firstNonEmptyString(strings.TrimSpace(message.Error), "agent worker SDK capabilities failed")))
			}
			return SDKCapabilitiesResult{}, false, handlerError(errors.New("agent worker SDK capabilities result is invalid"))
		default:
			return SDKCapabilitiesResult{}, false, handlerError(errors.New("agent worker SDK capabilities message type is invalid"))
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, context.Canceled) {
		if ctx.Err() != nil {
			return SDKCapabilitiesResult{}, false, handlerError(ctx.Err())
		}
		return SDKCapabilitiesResult{}, false, handlerError(errors.New("agent worker SDK capabilities output read failed"))
	}
	return SDKCapabilitiesResult{}, false, nil
}

func commandAgentStartEnvelope(request AgentExecutionRequest) commandAgentWorkerStartEnvelope {
	return commandAgentWorkerStartEnvelope{
		Type:            "start",
		ProtocolVersion: commandAgentWorkerProtocolVersion,
		Request: commandAgentWorkerStartRequest{
			RuntimeID:           request.RuntimeID,
			RepoID:              request.RepoID,
			RepoPath:            request.RepoPath,
			Cwd:                 request.RepoPath,
			TaskID:              request.TaskID,
			EventID:             request.EventID,
			QueuedTurnID:        request.QueuedTurnID,
			ExecutionID:         request.ExecutionID,
			HarnessID:           request.HarnessID,
			ModelID:             request.ModelID,
			TurnType:            request.TurnType,
			Input:               request.Input,
			AppendSystemPrompt:  request.AppendSystemPrompt,
			EnabledMCPServerIDs: append([]string(nil), request.EnabledMCPServerIDs...),
			MCPServerConfigs:    append(json.RawMessage(nil), request.MCPServerConfigs...),
			ReadOnly:            request.ReadOnly,
			IncludeComments:     request.IncludeComments,
			Thinking:            request.Thinking,
			FastMode:            request.FastMode,
			Source:              append(json.RawMessage(nil), request.Source...),
			Images:              cloneRawMessagePointer(request.Images),
			HyperPlanStrategy:   append(json.RawMessage(nil), request.HyperPlanStrategy...),
		},
	}
}

func commandAgentSDKCapabilitiesEnvelope(request SDKCapabilitiesRequest) commandAgentWorkerSDKCapabilitiesEnvelope {
	cwd := request.Cwd
	if cwd == "" {
		cwd = request.RepoPath
	}
	return commandAgentWorkerSDKCapabilitiesEnvelope{
		Type:            "sdkCapabilities",
		ProtocolVersion: commandAgentWorkerProtocolVersion,
		Request: commandAgentWorkerSDKCapabilitiesRequest{
			RepoID:    request.RepoID,
			RepoPath:  request.RepoPath,
			Cwd:       cwd,
			TaskID:    request.TaskID,
			HarnessID: request.HarnessID,
		},
	}
}

func normalizedCommand(command []string) []string {
	normalized := make([]string, 0, len(command))
	for _, part := range command {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
}

func commandAgentRecoveryFile(recoveryDir string, runtimeID string) string {
	dir := strings.TrimSpace(recoveryDir)
	if dir == "" {
		return ""
	}
	name := commandAgentRecoveryFileName(runtimeID)
	if name == "" {
		return ""
	}
	return filepath.Join(dir, name+".ndjson")
}

func commandAgentRecoveryFileName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	var builder strings.Builder
	for _, char := range trimmed {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			builder.WriteRune(char)
			continue
		}
		builder.WriteByte('_')
	}
	return builder.String()
}

func agentExecutionStatusFromWorker(status string) (AgentExecutionStatus, bool) {
	switch AgentExecutionStatus(status) {
	case AgentExecutionCompleted, AgentExecutionFailed, AgentExecutionStopped:
		return AgentExecutionStatus(status), true
	default:
		return "", false
	}
}

func failedAgentExecution(message string) AgentExecutionResult {
	return AgentExecutionResult{Status: AgentExecutionFailed, Error: message}
}

type limitedStringWriter struct {
	limit   int
	builder strings.Builder
}

func (writer *limitedStringWriter) Write(data []byte) (int, error) {
	remaining := writer.limit - writer.builder.Len()
	if remaining > 0 {
		if len(data) > remaining {
			writer.builder.Write(data[:remaining])
		} else {
			writer.builder.Write(data)
		}
	}
	return len(data), nil
}

func (writer *limitedStringWriter) String() string {
	return strings.TrimSpace(writer.builder.String())
}
