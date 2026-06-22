package product

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

const taskTitleSystemPrompt = "You are a title generator. Aim for exactly 3 words. Output a title in this exact format:\n" +
	"Title: <your 3 word title>\n" +
	"Do not output anything else."

const taskTitleContextMaxBytes = 2000

type taskTitleGenerateResultDTO struct {
	RepoID string `json:"repoId"`
	TaskID string `json:"taskId"`
	Title  string `json:"title"`
}

type taskTitleAgentEmitter struct {
	title string
}

func (service *Service) handleTaskTitleGenerate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodTaskTitleGenerate, raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.generateTaskTitle(ctx, raw)
	})
}

func (service *Service) generateTaskTitle(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID    string `json:"repoId"`
		TaskID    string `json:"taskId"`
		HarnessID string `json:"harnessId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, task, workDir, runtimeErr := service.taskWorkDir(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	events, err := service.store.ListTaskEvents(ctx, task.ID, true)
	if err != nil {
		return nil, handlerError(err)
	}

	title := fallbackGeneratedTaskTitle(firstNonEmptyString(task.Description, task.Title, "Untitled task"))
	description := strings.TrimSpace(task.Description)
	if description != "" && service.options.AgentExecutor != nil {
		prompt := buildTaskTitlePrompt(description, events)
		emitter := &taskTitleAgentEmitter{}
		result := service.options.AgentExecutor.Run(ctx, AgentExecutionRequest{
			RuntimeID:          "openade-title:" + task.ID,
			RepoID:             repo.ID,
			RepoPath:           workDir,
			TaskID:             task.ID,
			ExecutionID:        "title-" + randomHexID(),
			HarnessID:          firstNonEmptyString(strings.TrimSpace(params.HarnessID), latestCompletedActionHarnessID(events), "claude-code"),
			TurnType:           "title",
			Input:              prompt,
			AppendSystemPrompt: taskTitleSystemPrompt,
			ReadOnly:           true,
			EnvVars:            service.personalSettingsEnvVarsOrEmpty(ctx),
		}, emitter)
		if generated := cleanTaskTitle(emitter.title); generated != "" {
			title = generated
		} else if result.Status == AgentExecutionFailed && strings.TrimSpace(result.Error) != "" {
			title = fallbackGeneratedTaskTitle(firstNonEmptyString(task.Description, task.Title, "Untitled task"))
		}
	}

	task, ok, err := service.store.UpdateTaskMetadata(ctx, storage.TaskMetadataUpdate{
		TaskID:    task.ID,
		Title:     &title,
		UpdatedAt: time.Now().UTC(),
	})
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	notification := map[string]string{"repoId": task.RepoID, "taskId": task.ID}
	service.runtime.Notify(openADENotificationTaskUpdated, notification)
	service.runtime.Notify(openADENotificationTaskPreviewChanged, notification)
	return taskTitleGenerateResultDTO{RepoID: task.RepoID, TaskID: task.ID, Title: title}, nil
}

func (emitter *taskTitleAgentEmitter) AppendStreamEvent(_ context.Context, streamEvent json.RawMessage) error {
	if title := extractTaskTitleFromStreamEvent(streamEvent); title != "" {
		emitter.title = title
	}
	return nil
}

func (emitter *taskTitleAgentEmitter) UpdateExecution(_ context.Context, _ AgentExecutionUpdate) error {
	return nil
}

func buildTaskTitlePrompt(description string, events []storage.TaskEvent) string {
	prompt := "Generate a concise, descriptive title (aim for exactly 3 words) for this task:\n\n" + description
	context := boundedTaskTitleEventContext(events)
	if context != "" {
		prompt += "\n\nHere is some of the conversation so far:\n\n" + context
	}
	return prompt
}

func boundedTaskTitleEventContext(events []storage.TaskEvent) string {
	selected := []string{}
	usedBytes := 0
	for index := len(events) - 1; index >= 0; index-- {
		line := taskTitleEventLine(events[index])
		if line == "" {
			continue
		}
		if len(line) > 1000 {
			line = line[:1000] + "..."
		}
		lineBytes := len([]byte(line))
		if usedBytes > 0 && usedBytes+lineBytes > taskTitleContextMaxBytes {
			break
		}
		if lineBytes > taskTitleContextMaxBytes {
			continue
		}
		selected = append([]string{line}, selected...)
		usedBytes += lineBytes
	}
	return strings.Join(selected, "\n")
}

func taskTitleEventLine(event storage.TaskEvent) string {
	if event.PayloadJSON.Valid && strings.TrimSpace(event.PayloadJSON.String) != "" {
		return event.PayloadJSON.String
	}
	payload, err := json.Marshal(taskEventFallbackDTO{
		ID:        event.ID,
		Type:      event.Type,
		CreatedAt: formatTime(event.CreatedAt),
	})
	if err != nil {
		return ""
	}
	return string(payload)
}

func fallbackGeneratedTaskTitle(input string) string {
	cleaned := strings.TrimSpace(strings.Join(strings.Fields(input), " "))
	if cleaned == "" {
		return "Untitled task"
	}
	if len(cleaned) <= 50 {
		return cleaned
	}
	return strings.TrimSpace(cleaned[:50]) + "..."
}

func cleanTaskTitle(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	for _, line := range strings.Split(trimmed, "\n") {
		line = strings.TrimSpace(line)
		if strings.EqualFold(strings.TrimSpace(strings.SplitN(line, ":", 2)[0]), "title") && strings.Contains(line, ":") {
			return stripTaskTitleQuotes(strings.TrimSpace(strings.SplitN(line, ":", 2)[1]))
		}
	}
	for _, line := range strings.Split(trimmed, "\n") {
		if cleaned := stripTaskTitleQuotes(strings.TrimSpace(line)); cleaned != "" {
			return cleaned
		}
	}
	return ""
}

func stripTaskTitleQuotes(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "\"'")
	return strings.TrimSpace(value)
}

func latestCompletedActionHarnessID(events []storage.TaskEvent) string {
	for index := len(events) - 1; index >= 0; index-- {
		event := events[index]
		if event.Type != "action" {
			continue
		}
		payload, runtimeErr := decodeActionPayload(event)
		if runtimeErr != nil {
			continue
		}
		status, _ := rawRecordString(payload, "status")
		if status != "completed" {
			continue
		}
		execution, runtimeErr := actionExecutionPayload(payload)
		if runtimeErr != nil {
			continue
		}
		if harnessID, ok := rawRecordString(execution, "harnessId"); ok && strings.TrimSpace(harnessID) != "" {
			return strings.TrimSpace(harnessID)
		}
	}
	return ""
}

func extractTaskTitleFromStreamEvent(raw json.RawMessage) string {
	record, ok := rawJSONRecord(raw)
	if !ok {
		return ""
	}
	eventType, _ := rawRecordString(record, "type")
	switch eventType {
	case "result":
		if result, ok := rawRecordString(record, "result"); ok {
			return cleanTaskTitle(result)
		}
	case "raw_message", "message", "sdk_message":
		return cleanTaskTitle(taskTitleTextFromMessage(record["message"]))
	case "item.completed":
		item, ok := rawJSONRecord(record["item"])
		if !ok {
			return ""
		}
		itemType, _ := rawRecordString(item, "type")
		if itemType == "agent_message" {
			if text, ok := rawRecordString(item, "text"); ok {
				return cleanTaskTitle(text)
			}
		}
		role, _ := rawRecordString(item, "role")
		if itemType == "message" && role == "assistant" {
			return cleanTaskTitle(taskTitleTextFromContent(item["content"]))
		}
	}
	return ""
}

func taskTitleTextFromMessage(raw json.RawMessage) string {
	if text, ok := rawJSONString(raw); ok {
		return text
	}
	record, ok := rawJSONRecord(raw)
	if !ok {
		return ""
	}
	if text, ok := rawRecordString(record, "text"); ok {
		return text
	}
	return taskTitleTextFromContent(record["content"])
}

func taskTitleTextFromContent(raw json.RawMessage) string {
	if text, ok := rawJSONString(raw); ok {
		return text
	}
	var blocks []json.RawMessage
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return ""
	}
	parts := []string{}
	for _, blockRaw := range blocks {
		block, ok := rawJSONRecord(blockRaw)
		if !ok {
			continue
		}
		blockType, _ := rawRecordString(block, "type")
		if blockType != "text" {
			continue
		}
		if text, ok := rawRecordString(block, "text"); ok {
			parts = append(parts, text)
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func rawJSONRecord(raw json.RawMessage) (map[string]json.RawMessage, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, false
	}
	return record, true
}

func rawJSONString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}
