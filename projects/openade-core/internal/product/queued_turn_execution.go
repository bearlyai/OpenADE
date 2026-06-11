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

func (service *Service) drainNextQueuedTurn(ctx context.Context, taskID string) {
	if service.options.AgentExecutor == nil || strings.TrimSpace(taskID) == "" {
		return
	}
	service.queueDrainMu.Lock()
	defer service.queueDrainMu.Unlock()

	active, runtimeErr := service.taskHasActiveAgentRuntime(ctx, taskID)
	if runtimeErr != nil || active {
		return
	}
	task, ok, err := service.store.GetTask(ctx, taskID)
	if err != nil || !ok {
		return
	}
	repo, runtimeErr := service.repoByID(ctx, task.RepoID)
	if runtimeErr != nil {
		return
	}
	now := time.Now().UTC()
	turn, found, err := service.store.ClaimNextQueuedTurn(ctx, taskID, now)
	if err != nil || !found {
		return
	}
	if runtimeErr := service.startClaimedQueuedTurn(ctx, repo, task, turn, now); runtimeErr != nil {
		service.completeQueuedTurn(ctx, task, turn.ID, "error", now)
	}
}

func (service *Service) taskHasActiveAgentRuntime(ctx context.Context, taskID string) (bool, *core.RuntimeError) {
	runtimes, runtimeErr := service.listActiveOpenADETaskRuntimeRecords(ctx, taskID)
	if runtimeErr != nil {
		return false, runtimeErr
	}
	for _, dto := range runtimes {
		if dto.Kind == "agent" && dto.Scope.OwnerID == taskID {
			return true, nil
		}
	}
	return false, nil
}

func (service *Service) startClaimedQueuedTurn(ctx context.Context, repo storage.Repo, task storage.Task, turn storage.QueuedTurn, now time.Time) *core.RuntimeError {
	payload := decodeQueuedTurnPayload(turn.PayloadJSON)
	eventID := strings.TrimSpace(payload.EventID)
	if eventID == "" {
		eventID = "event-" + randomHexID()
	}
	payload.EventID = eventID
	payloadJSON, runtimeErr := queuedTurnPayloadJSON(payload)
	if runtimeErr != nil {
		return runtimeErr
	}
	turn, found, err := service.store.SetQueuedTurnRunningEvent(ctx, task.ID, turn.ID, payloadJSON, now)
	if err != nil {
		return handlerError(err)
	}
	if !found || turn.Status != "running" {
		return invalidParams("queued turn is not running")
	}

	source, runtimeErr := service.turnStartSource(ctx, task.ID, turn.Type, payload.Label)
	if runtimeErr != nil {
		return runtimeErr
	}
	harnessID := strings.TrimSpace(payload.HarnessID)
	if harnessID == "" {
		harnessID = "claude-code"
	}
	executionID := "headless-" + task.ID + "-" + randomHexID()
	actionPayload, runtimeErr := createActionPayload(actionPayloadCreateInput{
		EventID:            eventID,
		CreatedAt:          now,
		UserInput:          turn.Input,
		ExecutionID:        executionID,
		HarnessID:          harnessID,
		Source:             source.Raw,
		Images:             payload.Images,
		IncludesCommentIDs: []string{},
		ModelID:            strings.TrimSpace(payload.ModelID),
		FastMode:           payload.FastMode,
	})
	if runtimeErr != nil {
		return runtimeErr
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
			PayloadJSON: sql.NullString{String: string(actionPayload), Valid: true},
		},
		UpdatedAt:       now,
		UpdateLastEvent: true,
		UpdatePreview:   true,
	})
	if err != nil {
		return taskEventWriteRuntimeError(err)
	}
	runtimeID := "openade-turn:" + event.ID
	runtimeDTO := runtimeRecordDTO{
		RuntimeID:      runtimeID,
		Kind:           "agent",
		Status:         "running",
		Scope:          turnRuntimeScope(repo, task, event.ID, executionID, turn.ID),
		StartedAt:      formatTime(now),
		UpdatedAt:      formatTime(now),
		LastActivityAt: formatTime(now),
		NativeID:       executionID,
	}
	runtimeRecord, runtimeErr := runtimeDTOToStorage(runtimeDTO)
	if runtimeErr != nil {
		return runtimeErr
	}
	if err := service.store.UpsertRuntime(ctx, runtimeRecord); err != nil {
		return handlerError(err)
	}
	service.runtime.Notify("runtime/created", runtimeDTO)
	notification := actionEventTaskUpdatedNotification(task.RepoID, task.ID, event.ID, "in_progress")
	service.runtime.Notify("openade/task/updated", notification)
	service.runtime.Notify("openade/queuedTurn/updated", queuedTurnUpdatedNotificationDTO{
		RepoID: task.RepoID,
		TaskID: task.ID,
		Turn:   queuedTurnToDTO(turn),
		At:     formatTime(now),
	})
	service.notifyWorkingTasks(ctx, now)
	includeComments := payload.IncludeComments != nil && *payload.IncludeComments
	mcpServerConfigs, runtimeErr := service.agentMCPServerConfigs(ctx, payload.EnabledMCPServerIDs)
	if runtimeErr != nil {
		return runtimeErr
	}
	promptImages, runtimeErr := service.agentPromptImages(ctx, repo.ID, task.ID, payload.Images)
	if runtimeErr != nil {
		return runtimeErr
	}
	service.startAgentExecution(AgentExecutionRequest{
		RuntimeID:           runtimeID,
		RepoID:              repo.ID,
		RepoPath:            repo.Path,
		TaskID:              task.ID,
		EventID:             event.ID,
		QueuedTurnID:        turn.ID,
		ExecutionID:         executionID,
		HarnessID:           harnessID,
		ModelID:             strings.TrimSpace(payload.ModelID),
		TurnType:            turn.Type,
		Input:               turn.Input,
		AppendSystemPrompt:  payload.AppendSystemPrompt,
		EnabledMCPServerIDs: append([]string(nil), payload.EnabledMCPServerIDs...),
		MCPServerConfigs:    mcpServerConfigs,
		IncludeComments:     includeComments,
		Thinking:            validThinking(payload.Thinking),
		FastMode:            payload.FastMode,
		Source:              append(json.RawMessage(nil), source.Raw...),
		Images:              promptImages,
	})
	return nil
}

func (service *Service) completeQueuedTurn(ctx context.Context, task storage.Task, queuedTurnID string, status string, updatedAt time.Time) {
	turn, found, changed, err := service.store.CompleteQueuedTurn(ctx, task.ID, queuedTurnID, status, updatedAt)
	if err != nil || !found || !changed {
		return
	}
	service.runtime.Notify("openade/task/updated", map[string]string{"repoId": task.RepoID, "taskId": task.ID})
	service.runtime.Notify("openade/queuedTurn/updated", queuedTurnUpdatedNotificationDTO{
		RepoID: task.RepoID,
		TaskID: task.ID,
		Turn:   queuedTurnToDTO(turn),
		At:     formatTime(updatedAt),
	})
}

func queuedTurnStatusForAgentStatus(status AgentExecutionStatus) string {
	switch status {
	case AgentExecutionCompleted:
		return "completed"
	case AgentExecutionFailed:
		return "error"
	case AgentExecutionStopped:
		return "stopped"
	default:
		return ""
	}
}
