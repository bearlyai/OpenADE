package product

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

type actionEventCreateResultDTO struct {
	EventID   string `json:"eventId"`
	CreatedAt string `json:"createdAt"`
}

type actionEventReconcileResultDTO struct {
	TaskID  string `json:"taskId"`
	RepoID  string `json:"repoId,omitempty"`
	EventID string `json:"eventId,omitempty"`
	Status  string `json:"status,omitempty"`
	Changed bool   `json:"changed"`
	Reason  string `json:"reason,omitempty"`
}

type actionSourceDTO struct {
	Type      string `json:"type"`
	UserLabel string `json:"userLabel"`
}

type gitRefsDTO struct {
	SHA    string `json:"sha"`
	Branch string `json:"branch,omitempty"`
}

func (service *Service) handleActionCreate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/action/create", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.createActionEvent(ctx, raw)
	})
}

func (service *Service) handleActionStreamAppend(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/action/stream/append", raw, func() (core.JSONPayload, *core.RuntimeError) {
		runtimeErr := service.appendActionStreamEvent(ctx, raw)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) handleActionComplete(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/action/complete", raw, func() (core.JSONPayload, *core.RuntimeError) {
		runtimeErr := service.terminalActionEvent(ctx, raw, "completed")
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) handleActionError(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/action/error", raw, func() (core.JSONPayload, *core.RuntimeError) {
		runtimeErr := service.terminalActionEvent(ctx, raw, "error")
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) handleActionStopped(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/action/stopped", raw, func() (core.JSONPayload, *core.RuntimeError) {
		runtimeErr := service.terminalActionEvent(ctx, raw, "stopped")
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) handleActionReconcileRuntime(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/action/reconcileRuntime", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.reconcileActionRuntime(ctx, raw)
	})
}

func (service *Service) handleActionExecutionUpdate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/action/execution/update", raw, func() (core.JSONPayload, *core.RuntimeError) {
		runtimeErr := service.updateActionExecution(ctx, raw)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) createActionEvent(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		TaskID             string          `json:"taskId"`
		UserInput          string          `json:"userInput"`
		ExecutionID        string          `json:"executionId"`
		HarnessID          string          `json:"harnessId"`
		Source             json.RawMessage `json:"source"`
		EventID            string          `json:"eventId"`
		CreatedAt          string          `json:"createdAt"`
		Images             json.RawMessage `json:"images"`
		IncludesCommentIDs []string        `json:"includesCommentIds"`
		ModelID            string          `json:"modelId"`
		FastMode           *bool           `json:"fastMode"`
		GitRefsBefore      json.RawMessage `json:"gitRefsBefore"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if strings.TrimSpace(params.TaskID) == "" {
		return nil, invalidParams("taskId is required")
	}
	if params.UserInput == "" || len(params.UserInput) > 200000 {
		return nil, invalidParams("userInput is invalid")
	}
	if strings.TrimSpace(params.ExecutionID) == "" {
		return nil, invalidParams("executionId is required")
	}
	if strings.TrimSpace(params.HarnessID) == "" {
		return nil, invalidParams("harnessId is required")
	}
	source, sourceRaw, runtimeErr := validateActionSource(params.Source)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	createdAt, runtimeErr := optionalParamTime("createdAt", params.CreatedAt, time.Now().UTC())
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	eventID := strings.TrimSpace(params.EventID)
	if eventID == "" {
		eventID = "event-" + randomHexID()
	}
	images, runtimeErr := compactOptionalArrayParam("images", params.Images)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	gitRefsBefore, runtimeErr := compactOptionalGitRefs("gitRefsBefore", params.GitRefsBefore)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	payload, runtimeErr := createActionPayload(actionPayloadCreateInput{
		EventID:            eventID,
		CreatedAt:          createdAt,
		UserInput:          params.UserInput,
		ExecutionID:        params.ExecutionID,
		HarnessID:          params.HarnessID,
		Source:             sourceRaw,
		Images:             images,
		IncludesCommentIDs: params.IncludesCommentIDs,
		ModelID:            params.ModelID,
		FastMode:           params.FastMode,
		GitRefsBefore:      gitRefsBefore,
	})
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	task, event, created, err := service.store.WriteTaskEvent(ctx, storage.TaskEventWrite{
		Event: storage.TaskEvent{
			ID:          eventID,
			TaskID:      params.TaskID,
			Type:        "action",
			Status:      sql.NullString{String: "in_progress", Valid: true},
			SourceType:  sql.NullString{String: source.Type, Valid: true},
			SourceLabel: sql.NullString{String: source.UserLabel, Valid: true},
			CreatedAt:   createdAt,
			PayloadJSON: sql.NullString{String: string(payload), Valid: true},
		},
		UpdatedAt:        createdAt,
		PreserveExisting: true,
	})
	if err != nil {
		return nil, taskEventWriteRuntimeError(err)
	}
	if created {
		service.runtime.Notify("openade/task/updated", map[string]string{"repoId": task.RepoID, "taskId": task.ID})
	}
	return actionEventCreateResultDTO{EventID: event.ID, CreatedAt: formatTime(event.CreatedAt)}, nil
}

type actionPayloadCreateInput struct {
	EventID            string
	CreatedAt          time.Time
	UserInput          string
	ExecutionID        string
	HarnessID          string
	Source             json.RawMessage
	Images             *json.RawMessage
	IncludesCommentIDs []string
	ModelID            string
	FastMode           *bool
	GitRefsBefore      json.RawMessage
}

func createActionPayload(input actionPayloadCreateInput) (json.RawMessage, *core.RuntimeError) {
	execution := map[string]json.RawMessage{}
	putRawString(execution, "harnessId", input.HarnessID)
	putRawString(execution, "executionId", input.ExecutionID)
	if input.ModelID != "" {
		putRawString(execution, "modelId", input.ModelID)
	}
	if input.FastMode != nil {
		raw, err := json.Marshal(*input.FastMode)
		if err != nil {
			return nil, handlerError(err)
		}
		execution["fastMode"] = raw
	}
	execution["events"] = json.RawMessage("[]")
	if len(input.GitRefsBefore) > 0 {
		execution["gitRefsBefore"] = input.GitRefsBefore
	}
	executionRaw, err := json.Marshal(execution)
	if err != nil {
		return nil, handlerError(err)
	}

	payload := map[string]json.RawMessage{}
	putRawString(payload, "id", input.EventID)
	putRawString(payload, "type", "action")
	putRawString(payload, "status", "in_progress")
	putRawString(payload, "createdAt", formatTime(input.CreatedAt))
	putRawString(payload, "userInput", input.UserInput)
	payload["execution"] = executionRaw
	payload["source"] = input.Source
	included, err := json.Marshal(input.IncludesCommentIDs)
	if err != nil {
		return nil, handlerError(err)
	}
	payload["includesCommentIds"] = included
	if input.Images != nil {
		payload["images"] = *input.Images
	}
	payloadRaw, err := json.Marshal(payload)
	if err != nil {
		return nil, handlerError(err)
	}
	return payloadRaw, nil
}

func (service *Service) appendActionStreamEvent(ctx context.Context, raw json.RawMessage) *core.RuntimeError {
	var params struct {
		TaskID      string          `json:"taskId"`
		EventID     string          `json:"eventId"`
		StreamEvent json.RawMessage `json:"streamEvent"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return runtimeErr
	}
	return service.appendActionStreamEventValue(ctx, params.TaskID, params.EventID, params.StreamEvent)
}

func (service *Service) appendActionStreamEventValue(ctx context.Context, taskID string, eventID string, streamEventRaw json.RawMessage) *core.RuntimeError {
	if strings.TrimSpace(taskID) == "" {
		return invalidParams("taskId is required")
	}
	if strings.TrimSpace(eventID) == "" {
		return invalidParams("eventId is required")
	}
	streamEventID, streamEvent, runtimeErr := validateStreamEvent(streamEventRaw)
	if runtimeErr != nil {
		return runtimeErr
	}
	task, event, payload, runtimeErr := service.actionEventPayload(ctx, taskID, eventID)
	if runtimeErr != nil {
		return runtimeErr
	}
	execution, runtimeErr := actionExecutionPayload(payload)
	if runtimeErr != nil {
		return runtimeErr
	}
	events := actionExecutionEvents(execution["events"])
	for _, existing := range events {
		existingID, ok := rawObjectString(existing, "id")
		if ok && existingID == streamEventID {
			return nil
		}
	}
	events = append(events, streamEvent)
	eventsRaw, err := json.Marshal(events)
	if err != nil {
		return handlerError(err)
	}
	execution["events"] = eventsRaw
	if runtimeErr := setActionExecutionPayload(payload, execution); runtimeErr != nil {
		return runtimeErr
	}
	payloadRaw, runtimeErr := marshalRawRecord(payload)
	if runtimeErr != nil {
		return runtimeErr
	}
	event.PayloadJSON = sql.NullString{String: string(payloadRaw), Valid: true}
	if _, _, _, err := service.store.WriteTaskEvent(ctx, storage.TaskEventWrite{
		Event:     event,
		UpdatedAt: time.Now().UTC(),
	}); err != nil {
		return taskEventWriteRuntimeError(err)
	}
	service.runtime.Notify("openade/task/updated", map[string]string{"repoId": task.RepoID, "taskId": task.ID})
	return nil
}

func (service *Service) terminalActionEvent(ctx context.Context, raw json.RawMessage, status string) *core.RuntimeError {
	var params struct {
		TaskID          string `json:"taskId"`
		EventID         string `json:"eventId"`
		Success         *bool  `json:"success"`
		CompletedAt     string `json:"completedAt"`
		SessionID       string `json:"sessionId"`
		ParentSessionID string `json:"parentSessionId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return runtimeErr
	}
	completedAt, runtimeErr := optionalParamTime("completedAt", params.CompletedAt, time.Now().UTC())
	if runtimeErr != nil {
		return runtimeErr
	}
	return service.updateActionTerminalState(ctx, actionTerminalUpdate{
		TaskID:          params.TaskID,
		EventID:         params.EventID,
		Status:          status,
		Success:         params.Success,
		CompletedAt:     completedAt,
		SessionID:       params.SessionID,
		ParentSessionID: params.ParentSessionID,
		FromReconcile:   false,
	})
}

type actionTerminalUpdate struct {
	TaskID          string
	EventID         string
	Status          string
	Success         *bool
	CompletedAt     time.Time
	SessionID       string
	ParentSessionID string
	FromReconcile   bool
}

func (service *Service) updateActionTerminalState(ctx context.Context, update actionTerminalUpdate) *core.RuntimeError {
	if strings.TrimSpace(update.TaskID) == "" {
		return invalidParams("taskId is required")
	}
	if strings.TrimSpace(update.EventID) == "" {
		return invalidParams("eventId is required")
	}
	task, event, payload, runtimeErr := service.actionEventPayload(ctx, update.TaskID, update.EventID)
	if runtimeErr != nil {
		return runtimeErr
	}
	currentStatus, _ := rawRecordString(payload, "status")
	if currentStatus != "" && currentStatus != "in_progress" {
		return nil
	}
	nextStatus := update.Status
	if nextStatus == "failed" {
		nextStatus = "error"
	}
	putRawString(payload, "status", nextStatus)
	putRawString(payload, "completedAt", formatTime(update.CompletedAt))
	event.Status = sql.NullString{String: nextStatus, Valid: true}
	if nextStatus == "completed" {
		success := true
		if update.Success != nil {
			success = *update.Success
		}
		resultRaw, err := json.Marshal(map[string]bool{"success": success})
		if err != nil {
			return handlerError(err)
		}
		payload["result"] = resultRaw
	}
	if nextStatus == "stopped" && (update.SessionID != "" || update.ParentSessionID != "") {
		execution, runtimeErr := actionExecutionPayload(payload)
		if runtimeErr != nil {
			return runtimeErr
		}
		if update.SessionID != "" {
			putRawString(execution, "sessionId", update.SessionID)
		}
		if update.ParentSessionID != "" {
			putRawString(execution, "parentSessionId", update.ParentSessionID)
		}
		if runtimeErr := setActionExecutionPayload(payload, execution); runtimeErr != nil {
			return runtimeErr
		}
	}
	payloadRaw, runtimeErr := marshalRawRecord(payload)
	if runtimeErr != nil {
		return runtimeErr
	}
	event.PayloadJSON = sql.NullString{String: string(payloadRaw), Valid: true}
	write := storage.TaskEventWrite{
		Event:         event,
		UpdatedAt:     update.CompletedAt,
		UpdatePreview: true,
		LastEventJSON: sql.NullString{String: string(payloadRaw), Valid: true},
	}
	if nextStatus == "completed" {
		write.UpdateLastEvent = true
		write.LastEventAt = sql.NullTime{Time: update.CompletedAt, Valid: true}
	}
	if _, _, _, err := service.store.WriteTaskEvent(ctx, write); err != nil {
		return taskEventWriteRuntimeError(err)
	}
	notification := map[string]string{"repoId": task.RepoID, "taskId": task.ID}
	service.runtime.Notify("openade/task/updated", notification)
	service.runtime.Notify("openade/task/previewChanged", notification)
	return nil
}

func (service *Service) reconcileActionRuntime(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		TaskID      string `json:"taskId"`
		EventID     string `json:"eventId"`
		ExecutionID string `json:"executionId"`
		Status      string `json:"status"`
		Success     *bool  `json:"success"`
		CompletedAt string `json:"completedAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.Status != "completed" && params.Status != "failed" && params.Status != "stopped" {
		return nil, invalidParams("status is invalid")
	}
	if strings.TrimSpace(params.EventID) == "" && strings.TrimSpace(params.ExecutionID) == "" {
		return nil, invalidParams("eventId is invalid")
	}
	task, ok, err := service.store.GetTask(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	event, found, runtimeErr := service.findActionEventForRuntime(ctx, params.TaskID, params.EventID, params.ExecutionID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if !found {
		return actionEventReconcileResultDTO{TaskID: params.TaskID, RepoID: task.RepoID, Changed: false, Reason: "event_not_found"}, nil
	}
	payload, runtimeErr := decodeActionPayload(event)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	currentStatus, _ := rawRecordString(payload, "status")
	if currentStatus != "in_progress" {
		return actionEventReconcileResultDTO{TaskID: params.TaskID, RepoID: task.RepoID, EventID: event.ID, Status: currentStatus, Changed: false, Reason: "already_terminal"}, nil
	}
	completedAt, runtimeErr := optionalParamTime("completedAt", params.CompletedAt, time.Now().UTC())
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	nextStatus := params.Status
	if nextStatus == "failed" {
		nextStatus = "error"
	}
	runtimeErr = service.updateActionTerminalState(ctx, actionTerminalUpdate{
		TaskID:        params.TaskID,
		EventID:       event.ID,
		Status:        nextStatus,
		Success:       params.Success,
		CompletedAt:   completedAt,
		FromReconcile: true,
	})
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	return actionEventReconcileResultDTO{TaskID: params.TaskID, RepoID: task.RepoID, EventID: event.ID, Status: nextStatus, Changed: true}, nil
}

func (service *Service) updateActionExecution(ctx context.Context, raw json.RawMessage) *core.RuntimeError {
	var params struct {
		TaskID          string          `json:"taskId"`
		EventID         string          `json:"eventId"`
		SessionID       string          `json:"sessionId"`
		ParentSessionID string          `json:"parentSessionId"`
		GitRefsAfter    json.RawMessage `json:"gitRefsAfter"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return runtimeErr
	}
	return service.updateActionExecutionState(ctx, params.TaskID, params.EventID, AgentExecutionUpdate{
		SessionID:       params.SessionID,
		ParentSessionID: params.ParentSessionID,
		GitRefsAfter:    params.GitRefsAfter,
	})
}

func (service *Service) updateActionExecutionState(ctx context.Context, taskID string, eventID string, update AgentExecutionUpdate) *core.RuntimeError {
	task, event, payload, runtimeErr := service.actionEventPayload(ctx, taskID, eventID)
	if runtimeErr != nil {
		return runtimeErr
	}
	execution, runtimeErr := actionExecutionPayload(payload)
	if runtimeErr != nil {
		return runtimeErr
	}
	if update.SessionID != "" {
		putRawString(execution, "sessionId", update.SessionID)
	}
	if update.ParentSessionID != "" {
		putRawString(execution, "parentSessionId", update.ParentSessionID)
	}
	gitRefsAfter, runtimeErr := compactOptionalGitRefs("gitRefsAfter", update.GitRefsAfter)
	if runtimeErr != nil {
		return runtimeErr
	}
	if len(gitRefsAfter) > 0 {
		execution["gitRefsAfter"] = gitRefsAfter
	}
	if runtimeErr := setActionExecutionPayload(payload, execution); runtimeErr != nil {
		return runtimeErr
	}
	payloadRaw, runtimeErr := marshalRawRecord(payload)
	if runtimeErr != nil {
		return runtimeErr
	}
	event.PayloadJSON = sql.NullString{String: string(payloadRaw), Valid: true}
	if _, _, _, err := service.store.WriteTaskEvent(ctx, storage.TaskEventWrite{
		Event:     event,
		UpdatedAt: time.Now().UTC(),
	}); err != nil {
		return taskEventWriteRuntimeError(err)
	}
	service.runtime.Notify("openade/task/updated", map[string]string{"repoId": task.RepoID, "taskId": task.ID})
	return nil
}

func (service *Service) actionEventPayload(ctx context.Context, taskID string, eventID string) (storage.Task, storage.TaskEvent, map[string]json.RawMessage, *core.RuntimeError) {
	if strings.TrimSpace(taskID) == "" {
		return storage.Task{}, storage.TaskEvent{}, nil, invalidParams("taskId is required")
	}
	if strings.TrimSpace(eventID) == "" {
		return storage.Task{}, storage.TaskEvent{}, nil, invalidParams("eventId is required")
	}
	task, ok, err := service.store.GetTask(ctx, taskID)
	if err != nil {
		return storage.Task{}, storage.TaskEvent{}, nil, handlerError(err)
	}
	if !ok {
		return storage.Task{}, storage.TaskEvent{}, nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	event, ok, err := service.store.GetTaskEvent(ctx, taskID, eventID)
	if err != nil {
		return storage.Task{}, storage.TaskEvent{}, nil, handlerError(err)
	}
	if !ok {
		return storage.Task{}, storage.TaskEvent{}, nil, &core.RuntimeError{Code: "not_found", Message: "Action event not found"}
	}
	payload, runtimeErr := decodeActionPayload(event)
	if runtimeErr != nil {
		return storage.Task{}, storage.TaskEvent{}, nil, runtimeErr
	}
	return task, event, payload, nil
}

func (service *Service) findActionEventForRuntime(ctx context.Context, taskID string, eventID string, executionID string) (storage.TaskEvent, bool, *core.RuntimeError) {
	if strings.TrimSpace(eventID) != "" {
		event, ok, err := service.store.GetTaskEvent(ctx, taskID, eventID)
		if err != nil {
			return storage.TaskEvent{}, false, handlerError(err)
		}
		if !ok {
			return storage.TaskEvent{}, false, nil
		}
		return event, true, nil
	}
	events, err := service.store.ListTaskEvents(ctx, taskID, true)
	if err != nil {
		return storage.TaskEvent{}, false, handlerError(err)
	}
	for _, event := range events {
		if event.Type != "action" {
			continue
		}
		payload, runtimeErr := decodeActionPayload(event)
		if runtimeErr != nil {
			return storage.TaskEvent{}, false, runtimeErr
		}
		execution, runtimeErr := actionExecutionPayload(payload)
		if runtimeErr != nil {
			return storage.TaskEvent{}, false, runtimeErr
		}
		if id, ok := rawRecordString(execution, "executionId"); ok && id == executionID {
			return event, true, nil
		}
	}
	return storage.TaskEvent{}, false, nil
}

func decodeActionPayload(event storage.TaskEvent) (map[string]json.RawMessage, *core.RuntimeError) {
	if event.Type != "action" {
		return nil, invalidParams("event is not an action")
	}
	if !event.PayloadJSON.Valid || event.PayloadJSON.String == "" {
		return nil, handlerError(errorString("action event payload is missing"))
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(event.PayloadJSON.String), &payload); err != nil {
		return nil, handlerError(err)
	}
	return payload, nil
}

func actionExecutionPayload(payload map[string]json.RawMessage) (map[string]json.RawMessage, *core.RuntimeError) {
	raw := payload["execution"]
	if len(raw) == 0 {
		return map[string]json.RawMessage{"events": json.RawMessage("[]")}, nil
	}
	var execution map[string]json.RawMessage
	if err := json.Unmarshal(raw, &execution); err != nil {
		return nil, handlerError(err)
	}
	if execution == nil {
		execution = map[string]json.RawMessage{}
	}
	return execution, nil
}

func setActionExecutionPayload(payload map[string]json.RawMessage, execution map[string]json.RawMessage) *core.RuntimeError {
	raw, err := json.Marshal(execution)
	if err != nil {
		return handlerError(err)
	}
	payload["execution"] = raw
	return nil
}

func actionExecutionEvents(raw json.RawMessage) []json.RawMessage {
	if len(raw) == 0 {
		return []json.RawMessage{}
	}
	var events []json.RawMessage
	if err := json.Unmarshal(raw, &events); err != nil {
		return []json.RawMessage{}
	}
	return events
}

func validateActionSource(raw json.RawMessage) (actionSourceDTO, json.RawMessage, *core.RuntimeError) {
	if len(raw) == 0 {
		return actionSourceDTO{}, nil, invalidParams("source.type is invalid")
	}
	var source actionSourceDTO
	if err := json.Unmarshal(raw, &source); err != nil {
		return actionSourceDTO{}, nil, invalidParams("source.type is invalid")
	}
	if !isAllowedActionSourceType(source.Type) {
		return actionSourceDTO{}, nil, invalidParams("source.type is invalid")
	}
	if source.UserLabel == "" {
		return actionSourceDTO{}, nil, invalidParams("source.userLabel is invalid")
	}
	compacted, err := compactRawJSON(raw)
	if err != nil {
		return actionSourceDTO{}, nil, invalidParams("source is invalid")
	}
	return source, compacted, nil
}

func isAllowedActionSourceType(value string) bool {
	switch value {
	case "plan", "revise", "run_plan", "do", "ask", "hyperplan", "review":
		return true
	default:
		return false
	}
}

func validateStreamEvent(raw json.RawMessage) (string, json.RawMessage, *core.RuntimeError) {
	if len(raw) == 0 {
		return "", nil, invalidParams("streamEvent.id is invalid")
	}
	compacted, err := compactRawJSON(raw)
	if err != nil {
		return "", nil, invalidParams("streamEvent is invalid")
	}
	id, ok := rawObjectString(compacted, "id")
	if !ok || id == "" {
		return "", nil, invalidParams("streamEvent.id is invalid")
	}
	return id, compacted, nil
}

func compactOptionalGitRefs(field string, raw json.RawMessage) (json.RawMessage, *core.RuntimeError) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var refs gitRefsDTO
	if err := json.Unmarshal(raw, &refs); err != nil {
		return nil, invalidParams(field + " is invalid")
	}
	if refs.SHA == "" {
		return nil, invalidParams(field + ".sha is required")
	}
	compacted, err := compactRawJSON(raw)
	if err != nil {
		return nil, invalidParams(field + " is invalid")
	}
	return compacted, nil
}

func optionalParamTime(field string, value string, fallback time.Time) (time.Time, *core.RuntimeError) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	return parseParamTime(field, value)
}

func putRawString(record map[string]json.RawMessage, key string, value string) {
	raw, _ := json.Marshal(value)
	record[key] = raw
}

func marshalRawRecord(record map[string]json.RawMessage) (json.RawMessage, *core.RuntimeError) {
	raw, err := json.Marshal(record)
	if err != nil {
		return nil, handlerError(err)
	}
	return raw, nil
}

func rawRecordString(record map[string]json.RawMessage, key string) (string, bool) {
	raw := record[key]
	if len(raw) == 0 {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func rawObjectString(raw json.RawMessage, key string) (string, bool) {
	var record map[string]json.RawMessage
	if err := json.Unmarshal(raw, &record); err != nil {
		return "", false
	}
	return rawRecordString(record, key)
}

func compactRawJSON(raw json.RawMessage) (json.RawMessage, error) {
	var buffer bytes.Buffer
	if err := json.Compact(&buffer, raw); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func taskEventWriteRuntimeError(err error) *core.RuntimeError {
	if errors.Is(err, sql.ErrNoRows) {
		return &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	return handlerError(err)
}
