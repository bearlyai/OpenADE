package product

import (
	"context"
	"database/sql"
	"encoding/json"
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
	RuntimeID        string          `json:"runtimeId"`
	Kind             string          `json:"kind"`
	Status           string          `json:"status"`
	Scope            runtimeScopeDTO `json:"scope"`
	StartedAt        string          `json:"startedAt"`
	UpdatedAt        string          `json:"updatedAt"`
	LastActivityAt   string          `json:"lastActivityAt"`
	NativeID         string          `json:"nativeId,omitempty"`
	PID              *int            `json:"pid,omitempty"`
	PGID             *int            `json:"pgid,omitempty"`
	ProcessLabel     string          `json:"processLabel,omitempty"`
	ProcessStartedAt string          `json:"processStartedAt,omitempty"`
	ExitedAt         string          `json:"exitedAt,omitempty"`
	ExitCode         *int            `json:"exitCode,omitempty"`
	Signal           *string         `json:"signal,omitempty"`
	Error            string          `json:"error,omitempty"`
}

type runtimeRecordPayloadDTO struct {
	NativeID         string  `json:"nativeId,omitempty"`
	PID              *int    `json:"pid,omitempty"`
	PGID             *int    `json:"pgid,omitempty"`
	ProcessLabel     string  `json:"processLabel,omitempty"`
	ProcessStartedAt string  `json:"processStartedAt,omitempty"`
	ExitedAt         string  `json:"exitedAt,omitempty"`
	ExitCode         *int    `json:"exitCode,omitempty"`
	Signal           *string `json:"signal,omitempty"`
	Error            string  `json:"error,omitempty"`
}

type runtimeReconcileDTO struct {
	State     string            `json:"state"`
	Runtime   *runtimeRecordDTO `json:"runtime,omitempty"`
	RuntimeID string            `json:"runtimeId,omitempty"`
}

const orphanedAgentWorkerStartupStopReason = "agent worker process was orphaned during core startup"

func (service *Service) handleRuntimeList(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		OwnerType string `json:"ownerType"`
		OwnerID   string `json:"ownerId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return nil, handlerError(err)
	}
	results := []runtimeRecordDTO{}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if params.OwnerType != "" && dto.Scope.OwnerType != params.OwnerType {
			continue
		}
		if params.OwnerID != "" && dto.Scope.OwnerID != params.OwnerID {
			continue
		}
		results = append(results, dto)
	}
	return results, nil
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
		if !stop.OK {
			return nil, &core.RuntimeError{Code: "stop_failed", Message: firstNonEmptyString(stop.Error, "Failed to stop process runtime")}
		}
		updated, ok, err := service.store.GetRuntime(ctx, params.RuntimeID)
		if err != nil {
			return nil, handlerError(err)
		}
		if ok {
			return runtimeRecordToDTO(updated)
		}
	}
	if dto.Kind == "pty" && dto.NativeID != "" && isActiveRuntimeStatus(dto.Status) {
		stop := service.stopTaskTerminalByRuntime(dto.NativeID, params.Reason)
		if !stop.OK {
			return nil, &core.RuntimeError{Code: "stop_failed", Message: "Failed to stop PTY runtime"}
		}
		updated, ok, err := service.store.GetRuntime(ctx, params.RuntimeID)
		if err != nil {
			return nil, handlerError(err)
		}
		if ok {
			return runtimeRecordToDTO(updated)
		}
	}
	if dto.Kind == "agent" && isActiveRuntimeStatus(dto.Status) {
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
	return service.stopAgentRuntimeRecord(ctx, dto, reason)
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
	service.stopStoredLiveOrphanedAgentWorkers(ctx)
	service.reconcileStoredDeadProcessBackedRuntimes(ctx)
	service.reconcileStoredAgentActionEvents(ctx, updatedAt)
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
		if !agentWorkerProcessIsRunning(*dto.PID) || !terminateAgentWorkerProcess(dto.PID, dto.PGID) {
			continue
		}
		_, _ = service.stopAgentRuntimeRecord(ctx, dto, orphanedAgentWorkerStartupStopReason)
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
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return false, handlerError(err)
	}
	for _, record := range records {
		if !isActiveRuntimeStatus(record.Status) {
			continue
		}
		scope, runtimeErr := runtimeScopeFromRecord(record)
		if runtimeErr != nil {
			return false, runtimeErr
		}
		if scope.OwnerType == "openade-task" && scope.OwnerID == taskID {
			return true, nil
		}
	}
	return false, nil
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
		RuntimeID:        record.RuntimeID,
		Kind:             record.Kind,
		Status:           record.Status,
		Scope:            scope,
		StartedAt:        formatTime(record.StartedAt),
		UpdatedAt:        formatTime(record.UpdatedAt),
		LastActivityAt:   formatTime(record.LastActivityAt),
		NativeID:         payload.NativeID,
		PID:              cloneIntPointer(payload.PID),
		PGID:             cloneIntPointer(payload.PGID),
		ProcessLabel:     payload.ProcessLabel,
		ProcessStartedAt: payload.ProcessStartedAt,
		ExitedAt:         payload.ExitedAt,
		ExitCode:         cloneIntPointer(payload.ExitCode),
		Signal:           cloneStringPointer(payload.Signal),
		Error:            payload.Error,
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
		NativeID:         dto.NativeID,
		PID:              cloneIntPointer(dto.PID),
		PGID:             cloneIntPointer(dto.PGID),
		ProcessLabel:     dto.ProcessLabel,
		ProcessStartedAt: dto.ProcessStartedAt,
		ExitedAt:         dto.ExitedAt,
		ExitCode:         cloneIntPointer(dto.ExitCode),
		Signal:           cloneStringPointer(dto.Signal),
		Error:            dto.Error,
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
