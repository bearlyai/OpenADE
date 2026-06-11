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

type turnStartResultDTO struct {
	TaskID      string          `json:"taskId"`
	EventID     string          `json:"eventId,omitempty"`
	ExecutionID string          `json:"executionId,omitempty"`
	CreatedAt   string          `json:"createdAt,omitempty"`
	Task        *taskDTO        `json:"task,omitempty"`
	Preview     *taskPreviewDTO `json:"preview,omitempty"`
}

type turnStartActionSourceDTO struct {
	Type          string `json:"type"`
	UserLabel     string `json:"userLabel"`
	ParentEventID string `json:"parentEventId,omitempty"`
	PlanEventID   string `json:"planEventId,omitempty"`
	StrategyID    string `json:"strategyId,omitempty"`
}

func (service *Service) handleTurnStart(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/turn/start", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.startTurn(ctx, raw)
	})
}

func (service *Service) startTurn(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID              string          `json:"repoId"`
		Type                string          `json:"type"`
		Input               string          `json:"input"`
		AppendSystemPrompt  string          `json:"appendSystemPrompt"`
		InTaskID            *string         `json:"inTaskId"`
		IsolationStrategy   json.RawMessage `json:"isolationStrategy"`
		EnabledMCPServerIDs []string        `json:"enabledMcpServerIds"`
		HarnessID           string          `json:"harnessId"`
		ModelID             string          `json:"modelId"`
		Label               string          `json:"label"`
		IncludeComments     *bool           `json:"includeComments"`
		Images              json.RawMessage `json:"images"`
		Thinking            string          `json:"thinking"`
		FastMode            *bool           `json:"fastMode"`
		Title               string          `json:"title"`
		HyperPlanStrategy   json.RawMessage `json:"hyperplanStrategy"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, runtimeErr := service.repoByID(ctx, strings.TrimSpace(params.RepoID))
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	turnType := strings.TrimSpace(params.Type)
	if !isAllowedTurnType(turnType) {
		return nil, invalidParams("type is invalid")
	}
	if len(params.Input) > 200000 {
		return nil, invalidParams("input is invalid")
	}
	taskID := ""
	if params.InTaskID != nil {
		taskID = strings.TrimSpace(*params.InTaskID)
	}
	if taskID == "" && strings.TrimSpace(params.Input) == "" {
		return nil, invalidParams("input is invalid")
	}
	if params.Thinking != "" && validThinking(params.Thinking) == "" {
		return nil, invalidParams("thinking must be low, med, high, or max")
	}

	now := time.Now().UTC()
	task, createdTask, runtimeErr := service.turnStartTask(ctx, repo, taskID, turnStartTaskCreateInput{
		Raw:                 raw,
		Input:               params.Input,
		Title:               params.Title,
		IsolationStrategy:   params.IsolationStrategy,
		EnabledMCPServerIDs: params.EnabledMCPServerIDs,
		CreatedAt:           now,
	})
	if runtimeErr != nil {
		return nil, runtimeErr
	}

	source, runtimeErr := service.turnStartSource(ctx, task.ID, turnType, params.Label)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	executionID := "headless-" + task.ID + "-" + randomHexID()
	eventID := "event-" + randomHexID()
	harnessID := strings.TrimSpace(params.HarnessID)
	if harnessID == "" {
		harnessID = "claude-code"
	}
	images, runtimeErr := compactOptionalArrayParam("images", params.Images)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	payload, runtimeErr := createActionPayload(actionPayloadCreateInput{
		EventID:            eventID,
		CreatedAt:          now,
		UserInput:          params.Input,
		ExecutionID:        executionID,
		HarnessID:          harnessID,
		Source:             source.Raw,
		Images:             images,
		IncludesCommentIDs: []string{},
		ModelID:            strings.TrimSpace(params.ModelID),
		FastMode:           params.FastMode,
	})
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	task, event, _, err := service.store.WriteTaskEvent(ctx, storage.TaskEventWrite{
		Event: storage.TaskEvent{
			ID:          eventID,
			TaskID:      task.ID,
			Type:        "action",
			Status:      sql.NullString{String: "in_progress", Valid: true},
			SourceType:  sql.NullString{String: source.Type, Valid: true},
			SourceLabel: sql.NullString{String: source.Label, Valid: true},
			CreatedAt:   now,
			PayloadJSON: sql.NullString{String: string(payload), Valid: true},
		},
		UpdatedAt:       now,
		UpdateLastEvent: true,
		UpdatePreview:   true,
	})
	if err != nil {
		return nil, taskEventWriteRuntimeError(err)
	}

	runtimeID := "openade-turn:" + event.ID
	runtimeDTO := runtimeRecordDTO{
		RuntimeID:      runtimeID,
		Kind:           "agent",
		Status:         "running",
		Scope:          turnRuntimeScope(repo, task, event.ID, executionID, ""),
		StartedAt:      formatTime(now),
		UpdatedAt:      formatTime(now),
		LastActivityAt: formatTime(now),
		NativeID:       executionID,
	}
	runtimeRecord, runtimeErr := runtimeDTOToStorage(runtimeDTO)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, runtimeRecord); err != nil {
		return nil, handlerError(err)
	}
	service.runtime.Notify("runtime/created", runtimeDTO)
	notification := actionEventTaskUpdatedNotification(task.RepoID, task.ID, event.ID, "in_progress")
	service.runtime.Notify("openade/task/updated", notification)
	service.notifyWorkingTasks(ctx, now)
	includeComments := params.IncludeComments != nil && *params.IncludeComments
	mcpServerConfigs, runtimeErr := service.agentMCPServerConfigs(ctx, params.EnabledMCPServerIDs)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	promptImages, runtimeErr := service.agentPromptImages(ctx, repo.ID, task.ID, images)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	service.startAgentExecution(AgentExecutionRequest{
		RuntimeID:           runtimeID,
		RepoID:              repo.ID,
		RepoPath:            repo.Path,
		TaskID:              task.ID,
		EventID:             event.ID,
		ExecutionID:         executionID,
		HarnessID:           harnessID,
		ModelID:             strings.TrimSpace(params.ModelID),
		TurnType:            turnType,
		Input:               params.Input,
		AppendSystemPrompt:  params.AppendSystemPrompt,
		EnabledMCPServerIDs: append([]string(nil), params.EnabledMCPServerIDs...),
		MCPServerConfigs:    mcpServerConfigs,
		IncludeComments:     includeComments,
		Thinking:            validThinking(params.Thinking),
		FastMode:            params.FastMode,
		Source:              append(json.RawMessage(nil), source.Raw...),
		Images:              promptImages,
	})

	result := turnStartResultDTO{TaskID: task.ID, EventID: event.ID, ExecutionID: executionID, CreatedAt: formatTime(now)}
	if createdTask {
		acceptedTask, preview, runtimeErr := service.acceptedTurnStartDTOs(ctx, task)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		result.Task = acceptedTask
		result.Preview = preview
	}
	return result, nil
}

type turnStartTaskCreateInput struct {
	Raw                 json.RawMessage
	Input               string
	Title               string
	IsolationStrategy   json.RawMessage
	EnabledMCPServerIDs []string
	CreatedAt           time.Time
}

type workingTasksNotificationDTO struct {
	Type    string   `json:"type"`
	TaskIDs []string `json:"taskIds"`
	At      string   `json:"at"`
}

func (service *Service) notifyWorkingTasks(ctx context.Context, at time.Time) {
	runtimes, runtimeErr := service.listActiveOpenADETaskRuntimeRecords(ctx, "")
	if runtimeErr != nil {
		return
	}
	seen := map[string]bool{}
	taskIDs := []string{}
	for _, dto := range runtimes {
		if seen[dto.Scope.OwnerID] {
			continue
		}
		seen[dto.Scope.OwnerID] = true
		taskIDs = append(taskIDs, dto.Scope.OwnerID)
	}
	service.runtime.Notify("openade/workingTasks", workingTasksNotificationDTO{
		Type:    "working_tasks",
		TaskIDs: taskIDs,
		At:      formatTime(at),
	})
}

func (service *Service) turnStartTask(ctx context.Context, repo storage.Repo, taskID string, input turnStartTaskCreateInput) (storage.Task, bool, *core.RuntimeError) {
	if taskID != "" {
		_, task, runtimeErr := service.taskRepo(ctx, repo.ID, taskID)
		if runtimeErr != nil {
			return storage.Task{}, false, runtimeErr
		}
		return task, false, nil
	}
	clientRequestID := clientRequestIDFromRaw(input.Raw)
	taskID = openADETaskIDForClientRequest(repo.ID, clientRequestID)
	if taskID == "" {
		taskID = "task-" + randomHexID()
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = fallbackTaskTitle(input.Input)
	}
	isolationJSON, runtimeErr := taskCreateIsolationJSON(input.IsolationStrategy)
	if runtimeErr != nil {
		return storage.Task{}, false, runtimeErr
	}
	metadataJSON, runtimeErr := taskCreateMetadataJSON(userDTO{ID: headlessRuntimeDeviceID, Email: "headless@openade.local"}, input.EnabledMCPServerIDs)
	if runtimeErr != nil {
		return storage.Task{}, false, runtimeErr
	}
	setup, runtimeErr := service.taskEnvironmentSetupFromDTO(taskID, deviceEnvironmentDTO{
		ID:            headlessRuntimeDeviceID,
		DeviceID:      headlessRuntimeDeviceID,
		SetupComplete: true,
		CreatedAt:     formatTime(input.CreatedAt),
		LastUsedAt:    formatTime(input.CreatedAt),
	}, nil, input.CreatedAt)
	if runtimeErr != nil {
		return storage.Task{}, false, runtimeErr
	}
	task, created, err := service.store.CreateTask(ctx, storage.TaskCreate{
		Task: storage.Task{
			ID:            taskID,
			RepoID:        repo.ID,
			Slug:          randomTaskSlug(),
			Title:         title,
			Description:   input.Input,
			IsolationJSON: isolationJSON,
			MetadataJSON:  metadataJSON,
			CreatedAt:     input.CreatedAt,
			UpdatedAt:     input.CreatedAt,
		},
		DeviceEnvironment: &setup.DeviceEnvironment,
		SetupEvent:        setup.SetupEvent,
	})
	if err != nil {
		return storage.Task{}, false, handlerError(err)
	}
	if task.RepoID != repo.ID {
		return storage.Task{}, false, &core.RuntimeError{Code: "conflict", Message: "Task id already belongs to another repository"}
	}
	if created {
		notification := map[string]string{"repoId": task.RepoID, "taskId": task.ID}
		service.runtime.Notify("openade/task/updated", notification)
		service.runtime.Notify("openade/task/previewChanged", notification)
		service.runtime.Notify("openade/snapshotChanged", notification)
	}
	return task, created, nil
}

func (service *Service) acceptedTurnStartDTOs(ctx context.Context, task storage.Task) (*taskDTO, *taskPreviewDTO, *core.RuntimeError) {
	events, err := service.store.ListTaskEvents(ctx, task.ID, false)
	if err != nil {
		return nil, nil, handlerError(err)
	}
	comments, err := service.store.ListComments(ctx, task.ID)
	if err != nil {
		return nil, nil, handlerError(err)
	}
	deviceEnvironments, err := service.store.ListTaskDeviceEnvironments(ctx, task.ID)
	if err != nil {
		return nil, nil, handlerError(err)
	}
	queuedTurns, err := service.store.ListQueuedTurns(ctx, task.ID)
	if err != nil {
		return nil, nil, handlerError(err)
	}
	previews, err := service.store.ListTaskPreviews(ctx, task.RepoID)
	if err != nil {
		return nil, nil, handlerError(err)
	}

	taskDTOValue := taskToDTO(task, events, comments, deviceEnvironments, queuedTurns)
	for _, preview := range taskPreviewsDTO(previews) {
		if preview.ID == task.ID {
			previewValue := preview
			return &taskDTOValue, &previewValue, nil
		}
	}
	return &taskDTOValue, nil, nil
}

type turnStartSource struct {
	Type  string
	Label string
	Raw   json.RawMessage
}

func (service *Service) turnStartSource(ctx context.Context, taskID string, turnType string, label string) (turnStartSource, *core.RuntimeError) {
	userLabel := strings.TrimSpace(label)
	if userLabel == "" {
		userLabel = turnType
	}
	source := turnStartActionSourceDTO{Type: turnType, UserLabel: userLabel}
	if turnType == "revise" || turnType == "run_plan" {
		planEventID, runtimeErr := service.latestCompletedPlanEventID(ctx, taskID)
		if runtimeErr != nil {
			return turnStartSource{}, runtimeErr
		}
		if turnType == "revise" && planEventID == "" {
			source.Type = "plan"
		}
		if turnType == "revise" && planEventID != "" {
			source.ParentEventID = planEventID
		}
		if turnType == "run_plan" {
			if planEventID == "" {
				return turnStartSource{}, invalidParams("Run Plan requires a completed plan event")
			}
			source.PlanEventID = planEventID
		}
	}
	if turnType == "hyperplan" {
		source.StrategyID = "core-pending"
	}
	raw, err := json.Marshal(source)
	if err != nil {
		return turnStartSource{}, handlerError(err)
	}
	return turnStartSource{Type: source.Type, Label: source.UserLabel, Raw: raw}, nil
}

func (service *Service) latestCompletedPlanEventID(ctx context.Context, taskID string) (string, *core.RuntimeError) {
	events, err := service.store.ListTaskEvents(ctx, taskID, true)
	if err != nil {
		return "", handlerError(err)
	}
	for index := len(events) - 1; index >= 0; index-- {
		event := events[index]
		if event.Type != "action" {
			continue
		}
		payload, runtimeErr := decodeActionPayload(event)
		if runtimeErr != nil {
			return "", runtimeErr
		}
		status, _ := rawRecordString(payload, "status")
		if status != "completed" {
			continue
		}
		sourceRaw := payload["source"]
		if len(sourceRaw) == 0 {
			continue
		}
		var source turnStartActionSourceDTO
		if err := json.Unmarshal(sourceRaw, &source); err != nil {
			continue
		}
		if source.Type == "plan" {
			id, _ := rawRecordString(payload, "id")
			return id, nil
		}
	}
	return "", nil
}

func turnRuntimeScope(repo storage.Repo, task storage.Task, eventID string, executionID string, queuedTurnID string) runtimeScopeDTO {
	labels := map[string]string{
		"eventId":     eventID,
		"executionId": executionID,
	}
	if queuedTurnID != "" {
		labels["queuedTurnId"] = queuedTurnID
	}
	return runtimeScopeDTO{
		OwnerType: "openade-task",
		OwnerID:   task.ID,
		RepoPath:  repo.Path,
		RootPath:  repo.Path,
		Labels:    labels,
	}
}

func cloneRawMessagePointer(raw *json.RawMessage) *json.RawMessage {
	if raw == nil {
		return nil
	}
	cloned := json.RawMessage(append([]byte(nil), (*raw)...))
	return &cloned
}

func isAllowedTurnType(value string) bool {
	switch value {
	case "plan", "do", "ask", "revise", "run_plan", "hyperplan":
		return true
	default:
		return false
	}
}

func fallbackTaskTitle(input string) string {
	cleaned := strings.TrimSpace(strings.Join(strings.Fields(input), " "))
	if cleaned == "" {
		return "New task"
	}
	const maxLength = 50
	if len(cleaned) <= maxLength {
		return cleaned
	}
	return strings.TrimSpace(cleaned[:maxLength]) + "..."
}
