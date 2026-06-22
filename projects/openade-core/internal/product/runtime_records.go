package product

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

type runtimeScopeDTO struct {
	WorkspaceID   string            `json:"workspaceId,omitempty"`
	RootPath      string            `json:"rootPath,omitempty"`
	RepoPath      string            `json:"repoPath,omitempty"`
	CorrelationID string            `json:"correlationId,omitempty"`
	OwnerType     string            `json:"ownerType,omitempty"`
	OwnerID       string            `json:"ownerId,omitempty"`
	Labels        map[string]string `json:"labels,omitempty"`
}

type runtimeRecordDTO struct {
	RuntimeID           string          `json:"runtimeId"`
	Kind                string          `json:"kind"`
	Status              string          `json:"status"`
	Scope               runtimeScopeDTO `json:"scope"`
	StartedAt           string          `json:"startedAt"`
	UpdatedAt           string          `json:"updatedAt"`
	LastActivityAt      string          `json:"lastActivityAt"`
	NativeID            string          `json:"nativeId,omitempty"`
	PID                 *int            `json:"pid,omitempty"`
	PGID                *int            `json:"pgid,omitempty"`
	ProcessLabel        string          `json:"processLabel,omitempty"`
	ProcessStartedAt    string          `json:"processStartedAt,omitempty"`
	ExitedAt            string          `json:"exitedAt,omitempty"`
	ExitCode            *int            `json:"exitCode,omitempty"`
	Signal              *string         `json:"signal,omitempty"`
	Error               string          `json:"error,omitempty"`
	RecoveryFile        string          `json:"-"`
	ProcessDefinitionID string          `json:"-"`
	ProcessStdoutFile   string          `json:"-"`
	ProcessStderrFile   string          `json:"-"`
	ProcessStdoutOffset int64           `json:"-"`
	ProcessStderrOffset int64           `json:"-"`
}

type runtimeRecordPayloadDTO struct {
	NativeID            string  `json:"nativeId,omitempty"`
	PID                 *int    `json:"pid,omitempty"`
	PGID                *int    `json:"pgid,omitempty"`
	ProcessLabel        string  `json:"processLabel,omitempty"`
	ProcessStartedAt    string  `json:"processStartedAt,omitempty"`
	ExitedAt            string  `json:"exitedAt,omitempty"`
	ExitCode            *int    `json:"exitCode,omitempty"`
	Signal              *string `json:"signal,omitempty"`
	Error               string  `json:"error,omitempty"`
	RecoveryFile        string  `json:"recoveryFile,omitempty"`
	ProcessDefinitionID string  `json:"processDefinitionId,omitempty"`
	ProcessStdoutFile   string  `json:"processStdoutFile,omitempty"`
	ProcessStderrFile   string  `json:"processStderrFile,omitempty"`
	ProcessStdoutOffset int64   `json:"processStdoutOffset,omitempty"`
	ProcessStderrOffset int64   `json:"processStderrOffset,omitempty"`
}

type runtimeReconcileDTO struct {
	State     string            `json:"state"`
	Runtime   *runtimeRecordDTO `json:"runtime,omitempty"`
	RuntimeID string            `json:"runtimeId,omitempty"`
}

const orphanedAgentWorkerStartupStopReason = "agent worker process was orphaned during core startup"
const orphanedProjectProcessStartupStopReason = "process was orphaned during core startup"
const adoptedAgentWorkerTranscriptPollInterval = 100 * time.Millisecond

func (service *Service) handleRuntimeList(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		OwnerType string   `json:"ownerType"`
		OwnerID   string   `json:"ownerId"`
		Status    string   `json:"status"`
		Statuses  []string `json:"statuses"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	params.OwnerType = strings.TrimSpace(params.OwnerType)
	params.OwnerID = strings.TrimSpace(params.OwnerID)
	params.Status = strings.TrimSpace(params.Status)
	if params.Status != "" && !isRuntimeRecordStatus(params.Status) {
		return nil, invalidParams("status is invalid")
	}
	statuses, runtimeErr := normalizeRuntimeStatusList(params.Statuses)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.Status != "" && len(statuses) > 0 && !runtimeStatusListContains(statuses, params.Status) {
		return []runtimeRecordDTO{}, nil
	}
	records, err := service.store.ListRuntimesFiltered(ctx, storage.RuntimeListFilter{
		OwnerType: params.OwnerType,
		OwnerID:   params.OwnerID,
		Status:    params.Status,
		Statuses:  statuses,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	results := []runtimeRecordDTO{}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		results = append(results, dto)
	}
	return results, nil
}

func (service *Service) listActiveOpenADETaskRuntimeRecords(ctx context.Context, taskID string) ([]runtimeRecordDTO, *core.RuntimeError) {
	records, err := service.store.ListRuntimesFiltered(ctx, storage.RuntimeListFilter{
		OwnerType: "openade-task",
		OwnerID:   strings.TrimSpace(taskID),
		Statuses:  []string{"running", "starting"},
	})
	if err != nil {
		return nil, handlerError(err)
	}
	results := []runtimeRecordDTO{}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if dto.Scope.OwnerType == "openade-task" && dto.Scope.OwnerID != "" && isActiveRuntimeStatus(dto.Status) {
			results = append(results, dto)
		}
	}
	return results, nil
}

func (service *Service) listActiveOpenADETaskIDs(ctx context.Context) ([]string, *core.RuntimeError) {
	records, runtimeErr := service.listActiveOpenADETaskRuntimeRecords(ctx, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	seen := map[string]bool{}
	taskIDs := []string{}
	for _, record := range records {
		taskID := strings.TrimSpace(record.Scope.OwnerID)
		if taskID == "" || seen[taskID] {
			continue
		}
		seen[taskID] = true
		taskIDs = append(taskIDs, taskID)
	}
	return taskIDs, nil
}

func normalizeRuntimeStatusList(values []string) ([]string, *core.RuntimeError) {
	if len(values) == 0 {
		return nil, nil
	}
	seen := map[string]bool{}
	statuses := []string{}
	for _, value := range values {
		status := strings.TrimSpace(value)
		if !isRuntimeRecordStatus(status) {
			return nil, invalidParams("statuses contains invalid status")
		}
		if seen[status] {
			continue
		}
		seen[status] = true
		statuses = append(statuses, status)
	}
	return statuses, nil
}

func runtimeStatusListContains(statuses []string, expected string) bool {
	for _, status := range statuses {
		if status == expected {
			return true
		}
	}
	return false
}

func (service *Service) handleRuntimeRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RuntimeID string `json:"runtimeId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.RuntimeID == "" {
		return nil, invalidParams("runtimeId is required")
	}
	record, ok, err := service.store.GetRuntime(ctx, params.RuntimeID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok {
		return nil, nil
	}
	return runtimeRecordToDTO(record)
}

func (service *Service) handleRuntimeReconcile(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RuntimeID string `json:"runtimeId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.RuntimeID == "" {
		return nil, invalidParams("runtimeId is required")
	}
	record, ok, err := service.store.GetRuntime(ctx, params.RuntimeID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok {
		return runtimeReconcileDTO{State: "missing", RuntimeID: params.RuntimeID}, nil
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if shouldReconcileAgentWorkerProcess(dto) {
		dto, runtimeErr = service.reconcileAgentWorkerProcess(ctx, dto)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
	}
	if shouldReconcileProjectProcessRuntime(dto) {
		dto, runtimeErr = service.reconcileProjectProcessRuntime(ctx, dto)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
	}
	if shouldReconcileTaskTerminalRuntime(dto) {
		dto, runtimeErr = service.reconcileTaskTerminalRuntime(ctx, dto)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
	}
	return runtimeReconcileDTO{State: runtimeStateForStatus(dto.Status), Runtime: &dto}, nil
}

func (service *Service) handleRuntimeStop(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RuntimeID string `json:"runtimeId"`
		Reason    string `json:"reason"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.RuntimeID == "" {
		return nil, invalidParams("runtimeId is required")
	}
	record, ok, err := service.store.GetRuntime(ctx, params.RuntimeID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok {
		return nil, nil
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if dto.Kind == "process" && dto.NativeID != "" && isActiveRuntimeStatus(dto.Status) {
		stop := service.stopProjectProcessByRuntime(dto.NativeID, params.Reason)
		if stop.OK {
			updated, ok, err := service.store.GetRuntime(ctx, params.RuntimeID)
			if err != nil {
				return nil, handlerError(err)
			}
			if ok {
				return runtimeRecordToDTO(updated)
			}
		}
		if dto.PID == nil {
			return nil, &core.RuntimeError{Code: "stop_failed", Message: firstNonEmptyString(stop.Error, "Failed to stop process runtime")}
		}
		return service.stopStoredProjectProcessRuntimeRecord(ctx, dto, firstNonEmptyString(params.Reason, stop.Error))
	}
	if dto.Kind == "process" && dto.NativeID != "" && dto.Status == "orphaned" {
		return service.stopStoredProjectProcessRuntimeRecord(ctx, dto, params.Reason)
	}
	if dto.Kind == "pty" && dto.NativeID != "" && isActiveRuntimeStatus(dto.Status) {
		stop := service.stopTaskTerminalByRuntime(dto.NativeID, params.Reason)
		if stop.OK {
			updated, ok, err := service.store.GetRuntime(ctx, params.RuntimeID)
			if err != nil {
				return nil, handlerError(err)
			}
			if ok {
				return runtimeRecordToDTO(updated)
			}
		}
		if dto.PID == nil {
			return nil, &core.RuntimeError{Code: "stop_failed", Message: "Failed to stop PTY runtime"}
		}
		return service.stopStoredTaskTerminalRuntimeRecord(ctx, dto, params.Reason)
	}
	if dto.Kind == "pty" && dto.NativeID != "" && dto.Status == "orphaned" {
		return service.stopStoredTaskTerminalRuntimeRecord(ctx, dto, params.Reason)
	}
	if dto.Kind == "agent" && (isActiveRuntimeStatus(dto.Status) || dto.Status == "orphaned") {
		return service.stopAgentRuntime(ctx, dto, params.Reason)
	}
	if isTerminalRuntimeStatus(dto.Status) {
		return dto, nil
	}
	updatedAt := time.Now().UTC()
	dto.Status = "stopped"
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	dto.ExitedAt = dto.UpdatedAt
	signal := "stopped"
	dto.Signal = &signal
	if params.Reason != "" {
		dto.Error = params.Reason
	}
	record, runtimeErr = runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
		return nil, handlerError(err)
	}
	service.runtime.Notify("runtime/stopped", dto)
	return dto, nil
}

func (service *Service) stopAgentRuntime(ctx context.Context, dto runtimeRecordDTO, reason string) (core.JSONPayload, *core.RuntimeError) {
	return service.stopStoredAgentRuntimeRecord(ctx, dto, reason)
}

func (service *Service) stopStoredAgentRuntimeRecord(ctx context.Context, dto runtimeRecordDTO, reason string) (runtimeRecordDTO, *core.RuntimeError) {
	if dto.PID != nil && agentWorkerProcessIsRunning(*dto.PID) && !terminateAgentWorkerProcess(dto.PID, dto.PGID) {
		if dto.Status == "orphaned" || !service.hasAgentExecution(dto.RuntimeID) {
			return runtimeRecordDTO{}, &core.RuntimeError{Code: "stop_failed", Message: "Failed to stop agent runtime"}
		}
	}
	return service.stopAgentRuntimeRecord(ctx, dto, reason)
}

func (service *Service) hasAgentExecution(runtimeID string) bool {
	service.agentMu.Lock()
	defer service.agentMu.Unlock()
	return service.agentExecutions[runtimeID] != nil
}

func (service *Service) stopAgentRuntimeRecord(ctx context.Context, dto runtimeRecordDTO, reason string) (runtimeRecordDTO, *core.RuntimeError) {
	updatedAt := time.Now().UTC()
	taskID := dto.Scope.OwnerID
	eventID := ""
	queuedTurnID := ""
	if dto.Scope.Labels != nil {
		eventID = dto.Scope.Labels["eventId"]
		queuedTurnID = dto.Scope.Labels["queuedTurnId"]
	}
	if dto.Scope.OwnerType == "openade-task" && taskID != "" && eventID != "" {
		if runtimeErr := service.updateActionTerminalState(ctx, actionTerminalUpdate{
			TaskID:        taskID,
			EventID:       eventID,
			Status:        "stopped",
			CompletedAt:   updatedAt,
			FromReconcile: true,
		}); runtimeErr != nil {
			return runtimeRecordDTO{}, runtimeErr
		}
	}
	if dto.Scope.OwnerType == "openade-task" && taskID != "" && queuedTurnID != "" {
		if task, ok, err := service.store.GetTask(ctx, taskID); err == nil && ok {
			service.completeQueuedTurn(ctx, task, queuedTurnID, "stopped", updatedAt)
		}
	}
	dto.Status = "stopped"
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	dto.ExitedAt = dto.UpdatedAt
	signal := "stopped"
	dto.Signal = &signal
	if reason != "" {
		dto.Error = reason
	}
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return runtimeRecordDTO{}, runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
		return runtimeRecordDTO{}, handlerError(err)
	}
	service.cancelAgentExecution(dto.RuntimeID)
	service.runtime.Notify("runtime/stopped", dto)
	service.notifyWorkingTasks(ctx, updatedAt)
	return dto, nil
}

func shouldReconcileAgentWorkerProcess(dto runtimeRecordDTO) bool {
	return dto.Kind == "agent" && dto.PID != nil && (isActiveRuntimeStatus(dto.Status) || dto.Status == "orphaned")
}

func (service *Service) reconcileAgentWorkerProcess(ctx context.Context, dto runtimeRecordDTO) (runtimeRecordDTO, *core.RuntimeError) {
	if dto.PID == nil || agentWorkerProcessIsRunning(*dto.PID) {
		return dto, nil
	}
	return service.stopAgentRuntimeRecord(ctx, dto, "agent worker process is no longer running")
}

func shouldReconcileProjectProcessRuntime(dto runtimeRecordDTO) bool {
	return dto.Kind == "process" && dto.PID != nil && (isActiveRuntimeStatus(dto.Status) || dto.Status == "orphaned")
}

func (service *Service) reconcileProjectProcessRuntime(ctx context.Context, dto runtimeRecordDTO) (runtimeRecordDTO, *core.RuntimeError) {
	if dto.PID == nil || runtimeProcessIsRunning(*dto.PID) {
		return dto, nil
	}
	updatedAt := time.Now().UTC()
	dto.Status = "stopped"
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	dto.ExitedAt = dto.UpdatedAt
	signal := "stopped"
	dto.Signal = &signal
	dto.Error = "process is no longer running"
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return runtimeRecordDTO{}, runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
		return runtimeRecordDTO{}, handlerError(err)
	}
	service.runtime.Notify("runtime/stopped", dto)
	return dto, nil
}

func shouldReconcileTaskTerminalRuntime(dto runtimeRecordDTO) bool {
	return dto.Kind == "pty" && dto.PID != nil && (isActiveRuntimeStatus(dto.Status) || dto.Status == "orphaned")
}

func (service *Service) reconcileTaskTerminalRuntime(ctx context.Context, dto runtimeRecordDTO) (runtimeRecordDTO, *core.RuntimeError) {
	if dto.PID == nil || runtimeProcessIsRunning(*dto.PID) {
		return dto, nil
	}
	updatedAt := time.Now().UTC()
	dto.Status = "stopped"
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	dto.ExitedAt = dto.UpdatedAt
	signal := "stopped"
	dto.Signal = &signal
	dto.Error = taskTerminalProcessMissingError
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return runtimeRecordDTO{}, runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
		return runtimeRecordDTO{}, handlerError(err)
	}
	service.runtime.Notify("runtime/stopped", dto)
	return dto, nil
}

func (service *Service) markActiveRuntimesOrphaned() {
	ctx := context.Background()
	updatedAt := time.Now().UTC()
	if err := service.store.MarkActiveRuntimesOrphaned(ctx, updatedAt); err != nil {
		return
	}
	service.recoverOrAdoptStoredAgentWorkers(ctx)
	service.adoptStoredProjectProcesses(ctx)
	service.stopStoredLiveUnadoptableProjectProcesses(ctx)
	service.stopStoredLiveOrphanedAgentWorkers(ctx)
	service.stopStoredLiveOrphanedTaskTerminals(ctx)
	service.reconcileStoredDeadProcessBackedRuntimes(ctx)
	service.reconcileStoredAgentActionEvents(ctx, updatedAt)
}

func (service *Service) recoverOrAdoptStoredAgentWorkers(ctx context.Context) {
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return
	}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil || dto.Kind != "agent" || dto.Status != "orphaned" || dto.RecoveryFile == "" {
			continue
		}
		recovered, runtimeErr := service.recoverCompletedAgentWorkerTranscript(ctx, dto)
		if runtimeErr != nil || !recovered {
			if runtimeErr == nil {
				_, _ = service.adoptLiveAgentWorkerTranscript(ctx, dto)
			}
			continue
		}
	}
}

func (service *Service) recoverCompletedAgentWorkerTranscript(ctx context.Context, dto runtimeRecordDTO) (bool, *core.RuntimeError) {
	taskID := dto.Scope.OwnerID
	if dto.Scope.OwnerType != "openade-task" || taskID == "" || dto.RecoveryFile == "" {
		return false, nil
	}
	eventID := ""
	queuedTurnID := ""
	if dto.Scope.Labels != nil {
		eventID = dto.Scope.Labels["eventId"]
		queuedTurnID = dto.Scope.Labels["queuedTurnId"]
	}
	if eventID == "" {
		return false, nil
	}
	messages, recoveredResult, ok, runtimeErr := readCommandAgentRecoveryTranscript(dto.RecoveryFile)
	if runtimeErr != nil || !ok {
		return false, runtimeErr
	}
	for _, message := range messages {
		if message.Type == "result" {
			if runtimeErr := service.applyAgentWorkerRecoveryResult(ctx, dto, recoveredResult, queuedTurnID); runtimeErr != nil {
				return false, runtimeErr
			}
			terminateRecoveredAgentWorkerIfStillRunning(dto)
			return true, nil
		}
		if runtimeErr := service.applyAgentWorkerRecoveryMessage(ctx, taskID, eventID, message); runtimeErr != nil {
			return false, runtimeErr
		}
	}
	return false, nil
}

func (service *Service) adoptLiveAgentWorkerTranscript(ctx context.Context, dto runtimeRecordDTO) (bool, *core.RuntimeError) {
	if dto.PID == nil || !agentWorkerProcessIsRunning(*dto.PID) || dto.RecoveryFile == "" {
		return false, nil
	}
	taskID := dto.Scope.OwnerID
	eventID := ""
	if dto.Scope.Labels != nil {
		eventID = dto.Scope.Labels["eventId"]
	}
	if dto.Scope.OwnerType != "openade-task" || taskID == "" || eventID == "" {
		return false, nil
	}
	messages, recoveredResult, ok, runtimeErr := readCommandAgentRecoveryTranscript(dto.RecoveryFile)
	if runtimeErr != nil {
		return false, runtimeErr
	}
	if ok {
		return service.recoverCompletedAgentWorkerTranscript(ctx, dto)
	}
	for _, message := range messages {
		if runtimeErr := service.applyAgentWorkerRecoveryMessage(ctx, taskID, eventID, message); runtimeErr != nil {
			return false, runtimeErr
		}
	}
	dto.Status = "running"
	updatedAt := time.Now().UTC()
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return false, runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
		return false, handlerError(err)
	}
	service.runtime.Notify("runtime/updated", dto)
	service.notifyWorkingTasks(ctx, updatedAt)

	tailCtx, cancelTail := context.WithCancel(context.Background())
	service.registerAdoptedAgentExecution(dto, cancelTail)
	go service.tailAdoptedAgentWorkerTranscript(tailCtx, dto, len(messages), recoveredResult)
	return true, nil
}

func (service *Service) registerAdoptedAgentExecution(dto runtimeRecordDTO, cancelTail context.CancelFunc) {
	service.agentMu.Lock()
	service.agentExecutions[dto.RuntimeID] = &agentExecutionState{cancel: func() {
		cancelTail()
		_ = terminateAgentWorkerProcess(dto.PID, dto.PGID)
	}}
	service.agentMu.Unlock()
}

func (service *Service) tailAdoptedAgentWorkerTranscript(ctx context.Context, dto runtimeRecordDTO, appliedCount int, recoveredResult AgentExecutionResult) {
	ticker := time.NewTicker(adoptedAgentWorkerTranscriptPollInterval)
	defer ticker.Stop()
	defer service.unregisterAgentExecution(dto.RuntimeID)

	for {
		messages, result, ok, runtimeErr := readCommandAgentRecoveryTranscript(dto.RecoveryFile)
		if runtimeErr == nil {
			if len(messages) > appliedCount {
				taskID := dto.Scope.OwnerID
				eventID := ""
				queuedTurnID := ""
				if dto.Scope.Labels != nil {
					eventID = dto.Scope.Labels["eventId"]
					queuedTurnID = dto.Scope.Labels["queuedTurnId"]
				}
				for index := appliedCount; index < len(messages); index++ {
					message := messages[index]
					if message.Type == "result" {
						if result.Status == "" {
							result = recoveredResult
						}
						_ = service.applyAgentWorkerRecoveryResult(context.Background(), dto, result, queuedTurnID)
						terminateRecoveredAgentWorkerIfStillRunning(dto)
						return
					}
					_ = service.applyAgentWorkerRecoveryMessage(context.Background(), taskID, eventID, message)
				}
				appliedCount = len(messages)
			}
			if ok {
				if result.Status == "" {
					result = recoveredResult
				}
				queuedTurnID := ""
				if dto.Scope.Labels != nil {
					queuedTurnID = dto.Scope.Labels["queuedTurnId"]
				}
				_ = service.applyAgentWorkerRecoveryResult(context.Background(), dto, result, queuedTurnID)
				terminateRecoveredAgentWorkerIfStillRunning(dto)
				return
			}
		}
		if dto.PID != nil && !agentWorkerProcessIsRunning(*dto.PID) {
			_, _ = service.stopAgentRuntimeRecord(context.Background(), dto, "agent worker process is no longer running")
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (service *Service) applyAgentWorkerRecoveryMessage(ctx context.Context, taskID string, eventID string, message commandAgentWorkerMessage) *core.RuntimeError {
	switch message.Type {
	case "stream":
		if len(message.Event) == 0 {
			return handlerError(errorString("agent worker recovery stream event is missing"))
		}
		return service.appendActionStreamEventValue(ctx, taskID, eventID, message.Event)
	case "execution":
		if message.SessionID == "" && message.ParentSessionID == "" && len(message.GitRefsAfter) == 0 {
			return nil
		}
		return service.updateActionExecutionState(ctx, taskID, eventID, AgentExecutionUpdate{
			SessionID:       message.SessionID,
			ParentSessionID: message.ParentSessionID,
			GitRefsAfter:    message.GitRefsAfter,
		})
	default:
		return nil
	}
}

func (service *Service) applyAgentWorkerRecoveryResult(ctx context.Context, dto runtimeRecordDTO, recoveredResult AgentExecutionResult, queuedTurnID string) *core.RuntimeError {
	taskID := dto.Scope.OwnerID
	eventID := ""
	if dto.Scope.Labels != nil {
		eventID = dto.Scope.Labels["eventId"]
	}
	status := normalizeAgentExecutionStatus(recoveredResult)
	completedAt := recoveredResult.CompletedAt
	if completedAt.IsZero() {
		completedAt = time.Now().UTC()
	}
	if recoveredResult.SessionID != "" || recoveredResult.ParentSessionID != "" || len(recoveredResult.GitRefsAfter) > 0 {
		if runtimeErr := service.updateActionExecutionState(ctx, taskID, eventID, AgentExecutionUpdate{
			SessionID:       recoveredResult.SessionID,
			ParentSessionID: recoveredResult.ParentSessionID,
			GitRefsAfter:    recoveredResult.GitRefsAfter,
		}); runtimeErr != nil {
			return runtimeErr
		}
	}
	success := recoveredResult.Success
	if success == nil {
		value := status == AgentExecutionCompleted
		success = &value
	}
	actionStatus := string(status)
	if actionStatus == string(AgentExecutionFailed) {
		actionStatus = "error"
	}
	if runtimeErr := service.updateActionTerminalState(ctx, actionTerminalUpdate{
		TaskID:        taskID,
		EventID:       eventID,
		Status:        actionStatus,
		Success:       success,
		CompletedAt:   completedAt,
		FromReconcile: true,
	}); runtimeErr != nil {
		return runtimeErr
	}
	if queuedTurnID != "" {
		if task, found, err := service.store.GetTask(ctx, taskID); err == nil && found {
			service.completeQueuedTurn(ctx, task, queuedTurnID, queuedTurnStatusForAgentStatus(status), completedAt)
		}
	}
	service.settleRecoveredAgentRuntime(ctx, dto, string(status), recoveredResult.Error, completedAt)
	if status == AgentExecutionCompleted {
		service.drainNextQueuedTurn(ctx, taskID)
	}
	return nil
}

func terminateRecoveredAgentWorkerIfStillRunning(dto runtimeRecordDTO) {
	if dto.PID != nil && agentWorkerProcessIsRunning(*dto.PID) {
		_ = terminateAgentWorkerProcess(dto.PID, dto.PGID)
	}
}

func readCommandAgentRecoveryTranscript(path string) ([]commandAgentWorkerMessage, AgentExecutionResult, bool, *core.RuntimeError) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, AgentExecutionResult{}, false, nil
	}
	if err != nil {
		return nil, AgentExecutionResult{}, false, handlerError(err)
	}
	defer file.Close()

	messages := []commandAgentWorkerMessage{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), commandAgentWorkerMaxLineBytes)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		message := commandAgentWorkerMessage{}
		if err := json.Unmarshal(line, &message); err != nil {
			return nil, AgentExecutionResult{}, false, handlerError(err)
		}
		messages = append(messages, message)
		if message.Type == "result" {
			result, runtimeErr := commandAgentRecoveryResult(message)
			if runtimeErr != nil {
				return nil, AgentExecutionResult{}, false, runtimeErr
			}
			return messages, result, true, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, AgentExecutionResult{}, false, handlerError(err)
	}
	return messages, AgentExecutionResult{}, false, nil
}

func commandAgentRecoveryResult(message commandAgentWorkerMessage) (AgentExecutionResult, *core.RuntimeError) {
	status, ok := agentExecutionStatusFromWorker(message.Status)
	if !ok {
		return AgentExecutionResult{}, handlerError(errorString("agent worker recovery result status is invalid"))
	}
	completedAt := time.Time{}
	if message.CompletedAt != "" {
		parsed, err := time.Parse(time.RFC3339Nano, message.CompletedAt)
		if err != nil {
			return AgentExecutionResult{}, handlerError(errorString("agent worker recovery completedAt is invalid"))
		}
		completedAt = parsed
	}
	return AgentExecutionResult{
		Status:          status,
		Success:         message.Success,
		SessionID:       message.SessionID,
		ParentSessionID: message.ParentSessionID,
		GitRefsAfter:    message.GitRefsAfter,
		Error:           message.Error,
		CompletedAt:     completedAt,
	}, nil
}

func (service *Service) settleRecoveredAgentRuntime(ctx context.Context, dto runtimeRecordDTO, status string, errorMessage string, completedAt time.Time) {
	if isTerminalRuntimeStatus(dto.Status) {
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
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
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

func (service *Service) stopStoredLiveOrphanedAgentWorkers(ctx context.Context) {
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return
	}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil || dto.Kind != "agent" || dto.Status != "orphaned" || dto.PID == nil {
			continue
		}
		if !agentWorkerProcessIsRunning(*dto.PID) {
			continue
		}
		_, _ = service.stopStoredAgentRuntimeRecord(ctx, dto, orphanedAgentWorkerStartupStopReason)
	}
}

func (service *Service) stopStoredProjectProcessRuntimeRecord(ctx context.Context, dto runtimeRecordDTO, reason string) (runtimeRecordDTO, *core.RuntimeError) {
	if dto.PID != nil {
		if err := terminateProjectProcessID(dto.PID, dto.PGID); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return runtimeRecordDTO{}, handlerError(err)
		}
	}
	updatedAt := time.Now().UTC()
	dto.Status = "stopped"
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	dto.ExitedAt = dto.UpdatedAt
	signal := "stopped"
	dto.Signal = &signal
	if reason != "" {
		dto.Error = reason
	}
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return runtimeRecordDTO{}, runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
		return runtimeRecordDTO{}, handlerError(err)
	}
	service.runtime.Notify("runtime/stopped", dto)
	return dto, nil
}

func (service *Service) stopStoredLiveUnadoptableProjectProcesses(ctx context.Context) {
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return
	}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil || dto.Kind != "process" || dto.Status != "orphaned" || dto.PID == nil {
			continue
		}
		if !runtimeProcessIsRunning(*dto.PID) {
			continue
		}
		_, _ = service.stopStoredProjectProcessRuntimeRecord(ctx, dto, orphanedProjectProcessStartupStopReason)
	}
}

func (service *Service) stopStoredTaskTerminalRuntimeRecord(ctx context.Context, dto runtimeRecordDTO, reason string) (runtimeRecordDTO, *core.RuntimeError) {
	if dto.PID != nil {
		if err := terminateProjectProcessID(dto.PID, dto.PGID); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return runtimeRecordDTO{}, handlerError(err)
		}
	}
	updatedAt := time.Now().UTC()
	dto.Status = "stopped"
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	dto.ExitedAt = dto.UpdatedAt
	signal := "stopped"
	dto.Signal = &signal
	if reason != "" {
		dto.Error = reason
	}
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return runtimeRecordDTO{}, runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
		return runtimeRecordDTO{}, handlerError(err)
	}
	service.runtime.Notify("runtime/stopped", dto)
	return dto, nil
}

func (service *Service) stopStoredLiveOrphanedTaskTerminals(ctx context.Context) {
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return
	}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil || dto.Kind != "pty" || dto.Status != "orphaned" || dto.PID == nil {
			continue
		}
		if !runtimeProcessIsRunning(*dto.PID) {
			continue
		}
		_, _ = service.stopStoredTaskTerminalRuntimeRecord(ctx, dto, orphanedTaskTerminalStopReason)
	}
}

func (service *Service) reconcileStoredDeadProcessBackedRuntimes(ctx context.Context) {
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return
	}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil {
			continue
		}
		if shouldReconcileAgentWorkerProcess(dto) {
			if _, runtimeErr := service.reconcileAgentWorkerProcess(ctx, dto); runtimeErr != nil {
				continue
			}
			continue
		}
		if shouldReconcileProjectProcessRuntime(dto) {
			_, _ = service.reconcileProjectProcessRuntime(ctx, dto)
			continue
		}
		if shouldReconcileTaskTerminalRuntime(dto) {
			_, _ = service.reconcileTaskTerminalRuntime(ctx, dto)
		}
	}
}

func (service *Service) reconcileStoredAgentActionEvents(ctx context.Context, updatedAt time.Time) {
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return
	}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil || dto.Kind != "agent" || dto.Scope.OwnerType != "openade-task" || dto.Scope.OwnerID == "" {
			continue
		}
		status := actionStatusForRuntimeStatus(dto.Status)
		if status == "" {
			continue
		}
		eventID := ""
		queuedTurnID := ""
		if dto.Scope.Labels != nil {
			eventID = dto.Scope.Labels["eventId"]
			queuedTurnID = dto.Scope.Labels["queuedTurnId"]
		}
		event, found, runtimeErr := service.findActionEventForRuntime(ctx, dto.Scope.OwnerID, eventID, dto.NativeID)
		if runtimeErr != nil || !found {
			continue
		}
		payload, runtimeErr := decodeActionPayload(event)
		if runtimeErr != nil {
			continue
		}
		currentStatus, _ := rawRecordString(payload, "status")
		if currentStatus != "in_progress" {
			continue
		}
		success := status == "completed"
		_ = service.updateActionTerminalState(ctx, actionTerminalUpdate{
			TaskID:        dto.Scope.OwnerID,
			EventID:       event.ID,
			Status:        status,
			Success:       &success,
			CompletedAt:   updatedAt,
			FromReconcile: true,
		})
		if queuedTurnID != "" {
			if task, ok, err := service.store.GetTask(ctx, dto.Scope.OwnerID); err == nil && ok {
				service.completeQueuedTurn(ctx, task, queuedTurnID, queuedTurnStatusForAgentStatus(AgentExecutionStatus(status)), updatedAt)
			}
		}
	}
}

func (service *Service) taskHasActiveRuntime(ctx context.Context, taskID string) (bool, *core.RuntimeError) {
	runtimes, runtimeErr := service.listActiveOpenADETaskRuntimeRecords(ctx, taskID)
	if runtimeErr != nil {
		return false, runtimeErr
	}
	return len(runtimes) > 0, nil
}

func runtimeRecordToDTO(record storage.RuntimeRecord) (runtimeRecordDTO, *core.RuntimeError) {
	scope, runtimeErr := runtimeScopeFromRecord(record)
	if runtimeErr != nil {
		return runtimeRecordDTO{}, runtimeErr
	}
	payload := runtimeRecordPayloadDTO{}
	if record.PayloadJSON.Valid && record.PayloadJSON.String != "" {
		if err := json.Unmarshal([]byte(record.PayloadJSON.String), &payload); err != nil {
			return runtimeRecordDTO{}, handlerError(err)
		}
	}
	return runtimeRecordDTO{
		RuntimeID:           record.RuntimeID,
		Kind:                record.Kind,
		Status:              record.Status,
		Scope:               scope,
		StartedAt:           formatTime(record.StartedAt),
		UpdatedAt:           formatTime(record.UpdatedAt),
		LastActivityAt:      formatTime(record.LastActivityAt),
		NativeID:            payload.NativeID,
		PID:                 cloneIntPointer(payload.PID),
		PGID:                cloneIntPointer(payload.PGID),
		ProcessLabel:        payload.ProcessLabel,
		ProcessStartedAt:    payload.ProcessStartedAt,
		ExitedAt:            payload.ExitedAt,
		ExitCode:            cloneIntPointer(payload.ExitCode),
		Signal:              cloneStringPointer(payload.Signal),
		Error:               payload.Error,
		RecoveryFile:        payload.RecoveryFile,
		ProcessDefinitionID: payload.ProcessDefinitionID,
		ProcessStdoutFile:   payload.ProcessStdoutFile,
		ProcessStderrFile:   payload.ProcessStderrFile,
		ProcessStdoutOffset: payload.ProcessStdoutOffset,
		ProcessStderrOffset: payload.ProcessStderrOffset,
	}, nil
}

func runtimeScopeFromRecord(record storage.RuntimeRecord) (runtimeScopeDTO, *core.RuntimeError) {
	scope := runtimeScopeDTO{}
	if record.ScopeJSON.Valid && record.ScopeJSON.String != "" {
		if err := json.Unmarshal([]byte(record.ScopeJSON.String), &scope); err != nil {
			return runtimeScopeDTO{}, handlerError(err)
		}
	}
	return scope, nil
}

func runtimeDTOToStorage(dto runtimeRecordDTO) (storage.RuntimeRecord, *core.RuntimeError) {
	scopeJSON, err := json.Marshal(dto.Scope)
	if err != nil {
		return storage.RuntimeRecord{}, handlerError(err)
	}
	payloadJSON, err := json.Marshal(runtimeRecordPayloadDTO{
		NativeID:            dto.NativeID,
		PID:                 cloneIntPointer(dto.PID),
		PGID:                cloneIntPointer(dto.PGID),
		ProcessLabel:        dto.ProcessLabel,
		ProcessStartedAt:    dto.ProcessStartedAt,
		ExitedAt:            dto.ExitedAt,
		ExitCode:            cloneIntPointer(dto.ExitCode),
		Signal:              cloneStringPointer(dto.Signal),
		Error:               dto.Error,
		RecoveryFile:        dto.RecoveryFile,
		ProcessDefinitionID: dto.ProcessDefinitionID,
		ProcessStdoutFile:   dto.ProcessStdoutFile,
		ProcessStderrFile:   dto.ProcessStderrFile,
		ProcessStdoutOffset: dto.ProcessStdoutOffset,
		ProcessStderrOffset: dto.ProcessStderrOffset,
	})
	if err != nil {
		return storage.RuntimeRecord{}, handlerError(err)
	}
	startedAt, runtimeErr := parseStoredRuntimeTime("startedAt", dto.StartedAt)
	if runtimeErr != nil {
		return storage.RuntimeRecord{}, runtimeErr
	}
	updatedAt, runtimeErr := parseStoredRuntimeTime("updatedAt", dto.UpdatedAt)
	if runtimeErr != nil {
		return storage.RuntimeRecord{}, runtimeErr
	}
	lastActivityAt, runtimeErr := parseStoredRuntimeTime("lastActivityAt", dto.LastActivityAt)
	if runtimeErr != nil {
		return storage.RuntimeRecord{}, runtimeErr
	}
	return storage.RuntimeRecord{
		RuntimeID:      dto.RuntimeID,
		Kind:           dto.Kind,
		Status:         dto.Status,
		ScopeJSON:      sql.NullString{String: string(scopeJSON), Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      updatedAt,
		LastActivityAt: lastActivityAt,
		PayloadJSON:    sql.NullString{String: string(payloadJSON), Valid: true},
	}, nil
}

func parseStoredRuntimeTime(field string, value string) (time.Time, *core.RuntimeError) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, invalidParams(field + " is invalid")
	}
	return parsed, nil
}

func runtimeStateForStatus(status string) string {
	if status == "starting" || status == "running" {
		return "running"
	}
	if status == "completed" || status == "failed" || status == "stopped" || status == "orphaned" {
		return status
	}
	return "orphaned"
}

func isActiveRuntimeStatus(status string) bool {
	return status == "starting" || status == "running"
}

func isRuntimeRecordStatus(status string) bool {
	return isActiveRuntimeStatus(status) || status == "completed" || status == "failed" || status == "stopped" || status == "orphaned"
}

func isTerminalRuntimeStatus(status string) bool {
	return status == "completed" || status == "failed" || status == "stopped"
}

func actionStatusForRuntimeStatus(status string) string {
	switch status {
	case "completed":
		return "completed"
	case "failed":
		return "failed"
	case "stopped", "orphaned":
		return "stopped"
	default:
		return ""
	}
}
