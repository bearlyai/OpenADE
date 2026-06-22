package product

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

func (service *Service) handleHyperPlanSubExecutionAdd(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodHyperplanSubExecutionAdd, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			TaskID       string          `json:"taskId"`
			EventID      string          `json:"eventId"`
			SubExecution json.RawMessage `json:"subExecution"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		subExecution, runtimeErr := validateHyperPlanSubExecution(params.SubExecution)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		stepID, _ := rawObjectString(subExecution, "stepId")
		task, event, payload, runtimeErr := service.actionEventPayload(ctx, params.TaskID, params.EventID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		subExecutions := hyperPlanSubExecutions(payload["hyperplanSubExecutions"])
		if hyperPlanSubExecutionIndex(subExecutions, stepID) >= 0 {
			return mutationOKDTO{OK: true}, nil
		}
		subExecutions = append(subExecutions, subExecution)
		if runtimeErr := service.persistHyperPlanSubExecutions(ctx, task, event, payload, subExecutions); runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) handleHyperPlanSubExecutionStreamAppend(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodHyperplanSubExecutionStreamAppend, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			TaskID      string          `json:"taskId"`
			EventID     string          `json:"eventId"`
			StepID      string          `json:"stepId"`
			StreamEvent json.RawMessage `json:"streamEvent"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		if strings.TrimSpace(params.StepID) == "" {
			return nil, invalidParams("stepId is required")
		}
		streamEventID, streamEvent, runtimeErr := validateStreamEvent(params.StreamEvent)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		task, event, payload, runtimeErr := service.actionEventPayload(ctx, params.TaskID, params.EventID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		subExecutions := hyperPlanSubExecutions(payload["hyperplanSubExecutions"])
		index := hyperPlanSubExecutionIndex(subExecutions, params.StepID)
		if index < 0 {
			return mutationOKDTO{OK: true}, nil
		}
		sub, runtimeErr := hyperPlanSubExecutionRecord(subExecutions[index])
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		events := actionExecutionEvents(sub["events"])
		for _, existing := range events {
			existingID, ok := rawObjectString(existing, "id")
			if ok && existingID == streamEventID {
				return mutationOKDTO{OK: true}, nil
			}
		}
		events = append(events, streamEvent)
		eventsRaw, err := json.Marshal(events)
		if err != nil {
			return nil, handlerError(err)
		}
		sub["events"] = eventsRaw
		updated, runtimeErr := marshalRawRecord(sub)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		subExecutions[index] = updated
		if runtimeErr := service.persistHyperPlanSubExecutions(ctx, task, event, payload, subExecutions); runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) handleHyperPlanSubExecutionUpdate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodHyperplanSubExecutionUpdate, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			TaskID  string `json:"taskId"`
			EventID string `json:"eventId"`
			StepID  string `json:"stepId"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		if strings.TrimSpace(params.StepID) == "" {
			return nil, invalidParams("stepId is required")
		}
		fields, runtimeErr := hyperPlanUpdateFields(raw)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		task, event, payload, runtimeErr := service.actionEventPayload(ctx, params.TaskID, params.EventID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		subExecutions := hyperPlanSubExecutions(payload["hyperplanSubExecutions"])
		index := hyperPlanSubExecutionIndex(subExecutions, params.StepID)
		if index < 0 {
			return mutationOKDTO{OK: true}, nil
		}
		sub, runtimeErr := hyperPlanSubExecutionRecord(subExecutions[index])
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		for key, value := range fields {
			putRawString(sub, key, value)
		}
		updated, runtimeErr := marshalRawRecord(sub)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		subExecutions[index] = updated
		if runtimeErr := service.persistHyperPlanSubExecutions(ctx, task, event, payload, subExecutions); runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) handleHyperPlanReconcileLabelsSet(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodHyperplanReconcileLabelsSet, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			TaskID  string                  `json:"taskId"`
			EventID string                  `json:"eventId"`
			Mapping []hyperPlanLabelMapping `json:"mapping"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		for _, row := range params.Mapping {
			if strings.TrimSpace(row.StepID) == "" {
				return nil, invalidParams("mapping.stepId is required")
			}
			if strings.TrimSpace(row.Label) == "" {
				return nil, invalidParams("mapping.label is required")
			}
		}
		task, event, payload, runtimeErr := service.actionEventPayload(ctx, params.TaskID, params.EventID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		subExecutions := hyperPlanSubExecutions(payload["hyperplanSubExecutions"])
		changed := false
		for _, row := range params.Mapping {
			index := hyperPlanSubExecutionIndex(subExecutions, row.StepID)
			if index < 0 {
				continue
			}
			sub, runtimeErr := hyperPlanSubExecutionRecord(subExecutions[index])
			if runtimeErr != nil {
				return nil, runtimeErr
			}
			putRawString(sub, "reconcileLabel", row.Label)
			updated, runtimeErr := marshalRawRecord(sub)
			if runtimeErr != nil {
				return nil, runtimeErr
			}
			subExecutions[index] = updated
			changed = true
		}
		if !changed {
			return mutationOKDTO{OK: true}, nil
		}
		if runtimeErr := service.persistHyperPlanSubExecutions(ctx, task, event, payload, subExecutions); runtimeErr != nil {
			return nil, runtimeErr
		}
		return mutationOKDTO{OK: true}, nil
	})
}

type hyperPlanLabelMapping struct {
	StepID string `json:"stepId"`
	Label  string `json:"label"`
}

func validateHyperPlanSubExecution(raw json.RawMessage) (json.RawMessage, *core.RuntimeError) {
	if len(raw) == 0 {
		return nil, invalidParams("subExecution is required")
	}
	compacted, err := compactRawJSON(raw)
	if err != nil {
		return nil, invalidParams("subExecution is invalid")
	}
	record, runtimeErr := hyperPlanSubExecutionRecord(compacted)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if stepID, ok := rawRecordString(record, "stepId"); !ok || strings.TrimSpace(stepID) == "" {
		return nil, invalidParams("subExecution.stepId is required")
	}
	if primitive, ok := rawRecordString(record, "primitive"); !ok || !isAllowedHyperPlanPrimitive(primitive) {
		return nil, invalidParams("subExecution.primitive is invalid")
	}
	if harnessID, ok := rawRecordString(record, "harnessId"); !ok || strings.TrimSpace(harnessID) == "" {
		return nil, invalidParams("subExecution.harnessId is required")
	}
	if modelID, ok := rawRecordString(record, "modelId"); !ok || strings.TrimSpace(modelID) == "" {
		return nil, invalidParams("subExecution.modelId is required")
	}
	if status, ok := rawRecordString(record, "status"); !ok || !isAllowedHyperPlanStatus(status) {
		return nil, invalidParams("subExecution.status is invalid")
	}
	for _, event := range actionExecutionEvents(record["events"]) {
		id, ok := rawObjectString(event, "id")
		if !ok || id == "" {
			return nil, invalidParams("subExecution.events.id is invalid")
		}
	}
	return compacted, nil
}

func hyperPlanUpdateFields(raw json.RawMessage) (map[string]string, *core.RuntimeError) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, invalidParams("params must be an object")
	}
	result := map[string]string{}
	for _, key := range []string{"executionId", "sessionId", "parentSessionId", "resultText", "error", "reconcileLabel"} {
		value, ok, runtimeErr := optionalRawStringField(fields, key)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if ok {
			result[key] = value
		}
	}
	if value, ok, runtimeErr := optionalRawStringField(fields, "status"); runtimeErr != nil {
		return nil, runtimeErr
	} else if ok {
		if !isAllowedHyperPlanStatus(value) {
			return nil, invalidParams("status is invalid")
		}
		result["status"] = value
	}
	return result, nil
}

func optionalRawStringField(fields map[string]json.RawMessage, key string) (string, bool, *core.RuntimeError) {
	raw, ok := fields[key]
	if !ok {
		return "", false, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false, invalidParams(key + " is invalid")
	}
	return value, true, nil
}

func hyperPlanSubExecutions(raw json.RawMessage) []json.RawMessage {
	if len(raw) == 0 {
		return []json.RawMessage{}
	}
	var values []json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil {
		return []json.RawMessage{}
	}
	return values
}

func hyperPlanSubExecutionIndex(values []json.RawMessage, stepID string) int {
	for index, value := range values {
		existingStepID, ok := rawObjectString(value, "stepId")
		if ok && existingStepID == stepID {
			return index
		}
	}
	return -1
}

func hyperPlanSubExecutionRecord(raw json.RawMessage) (map[string]json.RawMessage, *core.RuntimeError) {
	var record map[string]json.RawMessage
	if err := json.Unmarshal(raw, &record); err != nil || record == nil {
		return nil, invalidParams("subExecution is invalid")
	}
	return record, nil
}

func (service *Service) persistHyperPlanSubExecutions(ctx context.Context, task storage.Task, event storage.TaskEvent, payload map[string]json.RawMessage, subExecutions []json.RawMessage) *core.RuntimeError {
	raw, err := json.Marshal(subExecutions)
	if err != nil {
		return handlerError(err)
	}
	payload["hyperplanSubExecutions"] = raw
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
	service.runtime.Notify(openADENotificationTaskUpdated, map[string]string{"repoId": task.RepoID, "taskId": task.ID})
	return nil
}

func isAllowedHyperPlanPrimitive(value string) bool {
	switch value {
	case "plan", "review", "reconcile", "revise":
		return true
	default:
		return false
	}
}

func isAllowedHyperPlanStatus(value string) bool {
	switch value {
	case "in_progress", "completed", "error", "stopped":
		return true
	default:
		return false
	}
}
