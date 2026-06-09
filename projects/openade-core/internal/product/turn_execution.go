package product

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

type agentExecutionState struct {
	cancel context.CancelFunc
}

type agentExecutionEmitter struct {
	service   *Service
	runtimeID string
	taskID    string
	eventID   string
}

func (service *Service) startAgentExecution(request AgentExecutionRequest) {
	executor := service.options.AgentExecutor
	if executor == nil {
		return
	}
	if request.EnvVars == nil {
		request.EnvVars = service.personalSettingsEnvVarsOrEmpty(context.Background())
	}

	ctx, cancel := context.WithCancel(context.Background())
	service.agentMu.Lock()
	service.agentExecutions[request.RuntimeID] = &agentExecutionState{cancel: cancel}
	service.agentMu.Unlock()

	emitter := agentExecutionEmitter{
		service:   service,
		runtimeID: request.RuntimeID,
		taskID:    request.TaskID,
		eventID:   request.EventID,
	}

	go func() {
		result := executor.Run(ctx, request, emitter)
		if ctx.Err() != nil && result.Status == "" {
			result.Status = AgentExecutionStopped
		}
		service.unregisterAgentExecution(request.RuntimeID)
		service.settleAgentExecution(context.Background(), request, result)
	}()
}

func (service *Service) unregisterAgentExecution(runtimeID string) {
	service.agentMu.Lock()
	delete(service.agentExecutions, runtimeID)
	service.agentMu.Unlock()
}

func (service *Service) cancelAgentExecution(runtimeID string) {
	service.agentMu.Lock()
	state := service.agentExecutions[runtimeID]
	service.agentMu.Unlock()
	if state != nil && state.cancel != nil {
		state.cancel()
	}
}

func (emitter agentExecutionEmitter) AppendStreamEvent(ctx context.Context, streamEvent json.RawMessage) error {
	active, runtimeErr := emitter.service.agentRuntimeIsActive(ctx, emitter.runtimeID)
	if runtimeErr != nil {
		return errorString(runtimeErr.Message)
	}
	if !active {
		return errorString("agent runtime is not active")
	}
	if runtimeErr := emitter.service.appendActionStreamEventValue(ctx, emitter.taskID, emitter.eventID, streamEvent); runtimeErr != nil {
		return errorString(runtimeErr.Message)
	}
	return nil
}

func (emitter agentExecutionEmitter) UpdateExecution(ctx context.Context, update AgentExecutionUpdate) error {
	active, runtimeErr := emitter.service.agentRuntimeIsActive(ctx, emitter.runtimeID)
	if runtimeErr != nil {
		return errorString(runtimeErr.Message)
	}
	if !active {
		return errorString("agent runtime is not active")
	}
	if update.PID != nil || update.PGID != nil || !update.ProcessStartedAt.IsZero() {
		if runtimeErr := emitter.service.updateAgentRuntimeExecutionState(ctx, emitter.runtimeID, update); runtimeErr != nil {
			return errorString(runtimeErr.Message)
		}
	}
	if update.SessionID == "" && update.ParentSessionID == "" && len(update.GitRefsAfter) == 0 {
		return nil
	}
	if runtimeErr := emitter.service.updateActionExecutionState(ctx, emitter.taskID, emitter.eventID, update); runtimeErr != nil {
		return errorString(runtimeErr.Message)
	}
	return nil
}

func (service *Service) updateAgentRuntimeExecutionState(ctx context.Context, runtimeID string, update AgentExecutionUpdate) *core.RuntimeError {
	record, ok, err := service.store.GetRuntime(ctx, runtimeID)
	if err != nil {
		return handlerError(err)
	}
	if !ok {
		return nil
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil {
		return runtimeErr
	}
	if isTerminalRuntimeStatus(dto.Status) {
		return nil
	}
	if update.PID != nil {
		dto.PID = cloneIntPointer(update.PID)
	}
	if update.PGID != nil {
		dto.PGID = cloneIntPointer(update.PGID)
	}
	if !update.ProcessStartedAt.IsZero() {
		dto.ProcessStartedAt = formatTime(update.ProcessStartedAt)
	}
	updatedAt := time.Now().UTC()
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	next, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, next); err != nil {
		return handlerError(err)
	}
	service.runtime.Notify("runtime/updated", dto)
	return nil
}

func (service *Service) settleAgentExecution(ctx context.Context, request AgentExecutionRequest, result AgentExecutionResult) {
	status := normalizeAgentExecutionStatus(result)
	completedAt := result.CompletedAt
	if completedAt.IsZero() {
		completedAt = time.Now().UTC()
	}

	active, runtimeErr := service.agentRuntimeIsActive(ctx, request.RuntimeID)
	if runtimeErr != nil || !active {
		return
	}

	if result.SessionID != "" || result.ParentSessionID != "" || len(result.GitRefsAfter) > 0 {
		runtimeErr = service.updateActionExecutionState(ctx, request.TaskID, request.EventID, AgentExecutionUpdate{
			SessionID:       result.SessionID,
			ParentSessionID: result.ParentSessionID,
			GitRefsAfter:    result.GitRefsAfter,
		})
		if runtimeErr != nil {
			status = AgentExecutionFailed
			if result.Error == "" {
				result.Error = runtimeErr.Message
			}
		}
	}

	success := result.Success
	if success == nil {
		value := status == AgentExecutionCompleted
		success = &value
	}
	actionStatus := string(status)
	if actionStatus == string(AgentExecutionFailed) {
		actionStatus = "error"
	}
	_ = service.updateActionTerminalState(ctx, actionTerminalUpdate{
		TaskID:        request.TaskID,
		EventID:       request.EventID,
		Status:        actionStatus,
		Success:       success,
		CompletedAt:   completedAt,
		FromReconcile: false,
	})
	if request.QueuedTurnID != "" {
		if task, ok, err := service.store.GetTask(ctx, request.TaskID); err == nil && ok {
			service.completeQueuedTurn(ctx, task, request.QueuedTurnID, queuedTurnStatusForAgentStatus(status), completedAt)
		}
	}
	service.settleAgentRuntime(ctx, request.RuntimeID, string(status), strings.TrimSpace(result.Error), completedAt)
	if status == AgentExecutionCompleted {
		if request.OnCompleted != nil {
			request.OnCompleted(ctx, request, result)
		}
		service.drainNextQueuedTurn(ctx, request.TaskID)
	}
}

func normalizeAgentExecutionStatus(result AgentExecutionResult) AgentExecutionStatus {
	switch result.Status {
	case AgentExecutionCompleted, AgentExecutionFailed, AgentExecutionStopped:
		return result.Status
	default:
		if strings.TrimSpace(result.Error) != "" {
			return AgentExecutionFailed
		}
		return AgentExecutionCompleted
	}
}

func (service *Service) agentRuntimeIsActive(ctx context.Context, runtimeID string) (bool, *core.RuntimeError) {
	record, ok, err := service.store.GetRuntime(ctx, runtimeID)
	if err != nil {
		return false, handlerError(err)
	}
	if !ok {
		return false, nil
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil {
		return false, runtimeErr
	}
	return isActiveRuntimeStatus(dto.Status), nil
}

func (service *Service) settleAgentRuntime(ctx context.Context, runtimeID string, status string, errorMessage string, completedAt time.Time) {
	record, ok, err := service.store.GetRuntime(ctx, runtimeID)
	if err != nil || !ok {
		return
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil || isTerminalRuntimeStatus(dto.Status) {
		return
	}
	dto.Status = status
	dto.UpdatedAt = formatTime(completedAt)
	dto.LastActivityAt = dto.UpdatedAt
	dto.ExitedAt = dto.UpdatedAt
	if status == string(AgentExecutionStopped) {
		signal := "stopped"
		dto.Signal = &signal
	}
	if errorMessage != "" {
		dto.Error = errorMessage
	}
	next, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return
	}
	if err := service.store.UpsertRuntime(ctx, next); err != nil {
		return
	}
	switch status {
	case string(AgentExecutionCompleted):
		service.runtime.Notify("runtime/completed", dto)
	case string(AgentExecutionFailed):
		service.runtime.Notify("runtime/failed", dto)
	case string(AgentExecutionStopped):
		service.runtime.Notify("runtime/stopped", dto)
	}
	service.notifyWorkingTasks(ctx, completedAt)
}
