package product

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

const taskUsageStatsVersion = 2

type taskUsageRecalculateResultDTO struct {
	Usage taskPreviewUsageDTO `json:"usage"`
}

type taskUsageBackfillTaskResultDTO struct {
	RepoID string              `json:"repoId"`
	TaskID string              `json:"taskId"`
	Usage  taskPreviewUsageDTO `json:"usage"`
}

type taskUsageBackfillResultDTO struct {
	UpdatedTasks int64                            `json:"updatedTasks"`
	SkippedTasks int64                            `json:"skippedTasks"`
	Tasks        []taskUsageBackfillTaskResultDTO `json:"tasks"`
}

type taskPreviewUsageDTO struct {
	UsageVersion int                `json:"usageVersion"`
	InputTokens  int64              `json:"inputTokens"`
	OutputTokens int64              `json:"outputTokens"`
	TotalCostUSD float64            `json:"totalCostUsd"`
	EventCount   int64              `json:"eventCount"`
	CostByModel  map[string]float64 `json:"costByModel"`
	DurationMS   int64              `json:"durationMs"`
}

type taskUsageAccumulator struct {
	inputTokens  int64
	outputTokens int64
	totalCostUSD float64
	eventCount   int64
	durationMS   int64
	costByModel  map[string]float64
}

type executionUsage struct {
	inputTokens     int64
	outputTokens    int64
	cacheReadTokens int64
	costUSD         *float64
	durationMS      int64
}

type codexUsageSnapshot struct {
	inputTokens     int64
	outputTokens    int64
	cacheReadTokens int64
}

func (service *Service) handleTaskUsageRecalculate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/usage/recalculate", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID string `json:"repoId"`
			TaskID string `json:"taskId"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		if strings.TrimSpace(params.RepoID) == "" {
			return nil, invalidParams("repoId is required")
		}
		if strings.TrimSpace(params.TaskID) == "" {
			return nil, invalidParams("taskId is required")
		}

		usage, runtimeErr := service.recalculateTaskUsage(ctx, params.RepoID, params.TaskID, time.Now().UTC())
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		return taskUsageRecalculateResultDTO{Usage: usage}, nil
	})
}

func (service *Service) handleTaskUsageBackfill(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/usage/backfill", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID  string   `json:"repoId"`
			TaskIDs []string `json:"taskIds"`
			Force   bool     `json:"force"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}

		taskFilter := map[string]bool{}
		for _, taskID := range params.TaskIDs {
			taskID = strings.TrimSpace(taskID)
			if taskID == "" {
				return nil, invalidParams("taskIds must not include empty values")
			}
			taskFilter[taskID] = true
		}

		repos, err := service.store.ListRepos(ctx)
		if err != nil {
			return nil, handlerError(err)
		}
		result := taskUsageBackfillResultDTO{Tasks: []taskUsageBackfillTaskResultDTO{}}
		now := time.Now().UTC()
		for _, repo := range repos {
			if params.RepoID != "" && repo.ID != params.RepoID {
				continue
			}
			previews, err := service.store.ListTaskPreviews(ctx, repo.ID)
			if err != nil {
				return nil, handlerError(err)
			}
			for _, preview := range previews {
				if len(taskFilter) > 0 && !taskFilter[preview.TaskID] {
					continue
				}
				if !params.Force && !taskPreviewNeedsUsageBackfill(preview.UsageJSON) {
					result.SkippedTasks++
					continue
				}
				usage, runtimeErr := service.recalculateTaskUsage(ctx, repo.ID, preview.TaskID, now)
				if runtimeErr != nil {
					return nil, runtimeErr
				}
				result.UpdatedTasks++
				result.Tasks = append(result.Tasks, taskUsageBackfillTaskResultDTO{
					RepoID: repo.ID,
					TaskID: preview.TaskID,
					Usage:  usage,
				})
			}
		}
		if params.RepoID != "" && result.UpdatedTasks == 0 && result.SkippedTasks == 0 {
			if _, runtimeErr := service.repoByID(ctx, params.RepoID); runtimeErr != nil {
				return nil, runtimeErr
			}
		}
		if len(taskFilter) > 0 && int(result.UpdatedTasks+result.SkippedTasks) != len(taskFilter) {
			return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
		}
		return result, nil
	})
}

func (service *Service) recalculateTaskUsage(ctx context.Context, repoID string, taskID string, updatedAt time.Time) (taskPreviewUsageDTO, *core.RuntimeError) {
	task, ok, err := service.store.GetTask(ctx, taskID)
	if err != nil {
		return taskPreviewUsageDTO{}, handlerError(err)
	}
	if !ok || task.RepoID != repoID {
		return taskPreviewUsageDTO{}, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	events, err := service.store.ListTaskEvents(ctx, taskID, true)
	if err != nil {
		return taskPreviewUsageDTO{}, handlerError(err)
	}
	usage := computeTaskPreviewUsageFromEvents(events)
	usageRaw, err := json.Marshal(usage)
	if err != nil {
		return taskPreviewUsageDTO{}, handlerError(err)
	}
	if _, ok, err := service.store.UpdateTaskMetadata(ctx, storage.TaskMetadataUpdate{
		TaskID:       task.ID,
		UsageJSONSet: true,
		UsageJSON:    sql.NullString{String: string(usageRaw), Valid: true},
		UpdatedAt:    updatedAt,
	}); err != nil {
		return taskPreviewUsageDTO{}, handlerError(err)
	} else if !ok {
		return taskPreviewUsageDTO{}, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}

	notification := map[string]string{"repoId": task.RepoID, "taskId": task.ID}
	service.runtime.Notify("openade/task/updated", notification)
	service.runtime.Notify("openade/task/previewChanged", notification)
	return usage, nil
}

func taskPreviewNeedsUsageBackfill(raw sql.NullString) bool {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return true
	}
	var usage struct {
		UsageVersion *int   `json:"usageVersion"`
		DurationMS   *int64 `json:"durationMs"`
	}
	if err := json.Unmarshal([]byte(raw.String), &usage); err != nil {
		return true
	}
	return usage.UsageVersion == nil || *usage.UsageVersion != taskUsageStatsVersion || usage.DurationMS == nil
}

func computeTaskPreviewUsageFromEvents(events []storage.TaskEvent) taskPreviewUsageDTO {
	acc := taskUsageAccumulator{costByModel: map[string]float64{}}
	for _, event := range events {
		payload, ok := taskEventPayloadForUsage(event)
		if !ok {
			continue
		}
		eventType := event.Type
		if payloadType, ok := rawRecordString(payload, "type"); ok && payloadType != "" {
			eventType = payloadType
		}
		if eventType != "action" {
			continue
		}
		acc.eventCount++
		execution, runtimeErr := actionExecutionPayload(payload)
		if runtimeErr == nil {
			acc.addExecutionUsage(execution, "")
		}
		for _, subExecution := range hyperPlanSubExecutions(payload["hyperplanSubExecutions"]) {
			record, runtimeErr := hyperPlanSubExecutionRecord(subExecution)
			if runtimeErr != nil {
				continue
			}
			acc.addExecutionUsage(record, modelIDFromExecution(execution, "unknown"))
		}
	}
	return taskPreviewUsageDTO{
		UsageVersion: taskUsageStatsVersion,
		InputTokens:  acc.inputTokens,
		OutputTokens: acc.outputTokens,
		TotalCostUSD: roundCost(acc.totalCostUSD),
		EventCount:   acc.eventCount,
		CostByModel:  roundedCostByModel(acc.costByModel),
		DurationMS:   acc.durationMS,
	}
}

func taskEventPayloadForUsage(event storage.TaskEvent) (map[string]json.RawMessage, bool) {
	if event.PayloadJSON.Valid && strings.TrimSpace(event.PayloadJSON.String) != "" {
		payload, runtimeErr := decodeActionPayload(event)
		if runtimeErr == nil {
			return payload, true
		}
	}
	return nil, false
}

func (acc *taskUsageAccumulator) addExecutionUsage(execution map[string]json.RawMessage, fallbackModelID string) {
	harnessID := harnessIDFromExecution(execution, "claude-code")
	modelID := modelIDFromExecution(execution, fallbackModelID)
	if modelID == "" {
		modelID = "unknown"
	}

	var latestCodex *codexUsageSnapshot
	var completeUsage *executionUsage
	for _, eventRaw := range actionExecutionEvents(execution["events"]) {
		if direction, ok := rawObjectString(eventRaw, "direction"); ok && direction != "" && direction != "execution" {
			continue
		}
		eventType, ok := rawObjectString(eventRaw, "type")
		if !ok {
			continue
		}
		eventHarnessID := harnessID
		if rawHarnessID, ok := rawObjectString(eventRaw, "harnessId"); ok && rawHarnessID != "" {
			eventHarnessID = rawHarnessID
		}
		switch eventType {
		case "raw_message", "sdk_message":
			message, ok := rawObjectRecord(eventRaw, "message")
			if !ok {
				continue
			}
			messageType, _ := rawRecordString(message, "type")
			switch {
			case eventHarnessID == "claude-code" && messageType == "result":
				usage := recordObject(message, "usage")
				inputTokens := rawNumberInt(usage, "input_tokens")
				outputTokens := rawNumberInt(usage, "output_tokens")
				costUSD := rawNumberFloat(message, "total_cost_usd")
				acc.inputTokens += inputTokens
				acc.outputTokens += outputTokens
				if costUSD > 0 {
					acc.addCost(modelID, costUSD)
				}
				acc.durationMS += rawNumberInt(message, "duration_ms")
			case eventHarnessID == "codex" && messageType == "turn.completed":
				usage := recordObject(message, "usage")
				latestCodex = &codexUsageSnapshot{
					inputTokens:     rawNumberInt(usage, "input_tokens"),
					outputTokens:    rawNumberInt(usage, "output_tokens"),
					cacheReadTokens: rawNumberInt(usage, "cached_input_tokens"),
				}
			}
		case "complete":
			usage := recordObjectFromRaw(eventRaw, "usage")
			completeUsage = &executionUsage{
				inputTokens:     rawNumberInt(usage, "inputTokens"),
				outputTokens:    rawNumberInt(usage, "outputTokens"),
				cacheReadTokens: rawNumberInt(usage, "cacheReadTokens"),
				durationMS:      rawNumberInt(usage, "durationMs"),
			}
			if cost, ok := rawOptionalNumberFloat(usage, "costUsd"); ok {
				completeUsage.costUSD = &cost
			}
		}
	}

	if harnessID == "claude-code" {
		return
	}
	if completeUsage != nil {
		acc.inputTokens += completeUsage.inputTokens
		acc.outputTokens += completeUsage.outputTokens
		acc.durationMS += completeUsage.durationMS
		if completeUsage.costUSD != nil && *completeUsage.costUSD > 0 {
			acc.addCost(modelID, *completeUsage.costUSD)
		}
		return
	}
	if latestCodex != nil {
		acc.inputTokens += latestCodex.inputTokens
		acc.outputTokens += latestCodex.outputTokens
	}
}

func (acc *taskUsageAccumulator) addCost(modelID string, cost float64) {
	if cost <= 0 || math.IsNaN(cost) || math.IsInf(cost, 0) {
		return
	}
	acc.totalCostUSD += cost
	acc.costByModel[modelID] += cost
}

func harnessIDFromExecution(execution map[string]json.RawMessage, fallback string) string {
	if value, ok := rawRecordString(execution, "harnessId"); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func modelIDFromExecution(execution map[string]json.RawMessage, fallback string) string {
	if value, ok := rawRecordString(execution, "modelId"); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func rawObjectRecord(raw json.RawMessage, key string) (map[string]json.RawMessage, bool) {
	var record map[string]json.RawMessage
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, false
	}
	value := record[key]
	if len(value) == 0 {
		return nil, false
	}
	var nested map[string]json.RawMessage
	if err := json.Unmarshal(value, &nested); err != nil || nested == nil {
		return nil, false
	}
	return nested, true
}

func recordObject(record map[string]json.RawMessage, key string) map[string]json.RawMessage {
	value := record[key]
	if len(value) == 0 {
		return map[string]json.RawMessage{}
	}
	var nested map[string]json.RawMessage
	if err := json.Unmarshal(value, &nested); err != nil || nested == nil {
		return map[string]json.RawMessage{}
	}
	return nested
}

func recordObjectFromRaw(raw json.RawMessage, key string) map[string]json.RawMessage {
	record, ok := rawObjectRecord(raw, key)
	if !ok {
		return map[string]json.RawMessage{}
	}
	return record
}

func rawNumberInt(record map[string]json.RawMessage, key string) int64 {
	raw := record[key]
	if len(raw) == 0 {
		return 0
	}
	var number json.Number
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&number); err != nil {
		return 0
	}
	value, err := number.Int64()
	if err == nil {
		if value < 0 {
			return 0
		}
		return value
	}
	floatValue, err := number.Float64()
	if err != nil || math.IsNaN(floatValue) || math.IsInf(floatValue, 0) || floatValue <= 0 {
		return 0
	}
	return int64(floatValue)
}

func rawNumberFloat(record map[string]json.RawMessage, key string) float64 {
	value, _ := rawOptionalNumberFloat(record, key)
	return value
}

func rawOptionalNumberFloat(record map[string]json.RawMessage, key string) (float64, bool) {
	raw := record[key]
	if len(raw) == 0 {
		return 0, false
	}
	var number json.Number
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&number); err != nil {
		return 0, false
	}
	value, err := number.Float64()
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value, true
}

func roundedCostByModel(input map[string]float64) map[string]float64 {
	if len(input) == 0 {
		return map[string]float64{}
	}
	output := make(map[string]float64, len(input))
	for model, cost := range input {
		output[model] = roundCost(cost)
	}
	return output
}

func roundCost(value float64) float64 {
	return math.Round(value*1_000_000_000) / 1_000_000_000
}
