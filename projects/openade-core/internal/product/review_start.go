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

const (
	reviewThreadMaxBytes    = 240000
	reviewChangedFilesLimit = 40
	reviewModeInstructions  = `<current_operating_mode mode="review">
<capabilities>
- Analyze the provided context and produce concise, actionable review feedback.
- Use read-only exploration when needed.
- Inspect relevant git state, diffs, commits, and touched files before concluding.
</capabilities>

<constraints>
- Do not modify files.
- Do not create commits or branches.
- Do not run state-changing commands.
- Keep feedback short and specific.
</constraints>
</current_operating_mode>`
	reviewFindingFormat = "For each finding: Location, Issue, Criticality: N/10, Suggestion. Always write the score with the /10 denominator. Bullets only, no prose."
	reviewDimensions    = `Only raise findings you would be comfortable blocking a PR on. Do not make trivial, nitpicky, or speculative comments. Every finding should be a real bug, a real risk, or a meaningfully better approach.

Every finding must include a Criticality score written as N/10 so the user can decide whether the fix is worth the engineering effort. Score by severity, likelihood, user impact, and engineering risk: 10/10 is a release blocker, 7-9/10 is high risk, 4-6/10 is meaningful but not necessarily blocking, and 1-3/10 is low importance.

Evaluate through these lenses:

1. Bugs and correctness: logic errors, wrong assumptions, broken edge cases, and regressions.
2. Security: injection vectors, unsafe deserialization, secrets in code, missing input validation, and other trust-boundary issues.
3. Better approaches: clearly superior reuse, simplification, or architecture that avoids meaningful risk.
4. Test quality: tests that do not catch regressions, over-mocking, brittle assertions, and missing edge coverage.
5. Robustness: unexpected inputs, concurrency, partial failures, unhandled errors, and fragile assumptions.`
	reviewEngineeringGuidance = `Engineering standards to enforce when they affect correctness, maintainability, or test confidence:

- Tight contracts: flag loose typing, unchecked casts, broad public shapes, or missing validation where narrowing would prevent bugs.
- Modularity: point out interfaces that can be tightened to reduce coupling.
- Simplicity: prefer surgical fixes and existing patterns.
- High-signal tests: prefer tests that exercise behavior and real integration boundaries.
- Robustness: flag swallowed errors, missing status checks, race conditions, and weak failure handling.
- Operational visibility: flag missing logs, metrics, or docs where investigation would otherwise be hard.
- Infrastructure and data safety: flag hidden setup, unsafe migrations, destructive operations, and production-data risk.
- Docs and local instructions: flag stale CLAUDE.md or AGENTS.md guidance when workflow behavior changes.`
	reviewSensitivityGuidance = `Do not comment on style, formatting, naming, or conventions unless it causes a real bug.
Actively explore surrounding code to find existing patterns, utilities, or conventions.
If something may be intentional, flag it as a confirmation item instead of a bug.
Ignore unrelated changes from other agents or concurrent threads unless they directly affect the reviewed work.
If you have no blocking findings, say so clearly and briefly.
After findings, add a short section titled 'Things that might be intentional (confirm)' with up to 3 items.`
)

type reviewStartResultDTO struct {
	TaskID      string `json:"taskId"`
	EventID     string `json:"eventId,omitempty"`
	ExecutionID string `json:"executionId,omitempty"`
	CreatedAt   string `json:"createdAt,omitempty"`
}

type reviewPromptDTO struct {
	SystemPrompt string
	UserMessage  string
}

type reviewActionSourceDTO struct {
	Type             string `json:"type"`
	UserLabel        string `json:"userLabel"`
	ReviewType       string `json:"reviewType"`
	UserInstructions string `json:"userInstructions,omitempty"`
}

type reviewFollowUpSourceDTO struct {
	Type      string `json:"type"`
	UserLabel string `json:"userLabel"`
	Origin    string `json:"origin"`
}

func (service *Service) handleReviewStart(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/review/start", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.startReview(ctx, raw)
	})
}

func (service *Service) startReview(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID             string `json:"repoId"`
		TaskID             string `json:"taskId"`
		ReviewType         string `json:"reviewType"`
		HarnessID          string `json:"harnessId"`
		ModelID            string `json:"modelId"`
		Thinking           string `json:"thinking"`
		FastMode           *bool  `json:"fastMode"`
		CustomInstructions string `json:"customInstructions"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repoID := strings.TrimSpace(params.RepoID)
	taskID := strings.TrimSpace(params.TaskID)
	reviewType := strings.TrimSpace(params.ReviewType)
	harnessID := strings.TrimSpace(params.HarnessID)
	modelID := strings.TrimSpace(params.ModelID)
	if repoID == "" {
		return nil, invalidParams("repoId is invalid")
	}
	if taskID == "" {
		return nil, invalidParams("taskId is invalid")
	}
	if reviewType != "plan" && reviewType != "work" {
		return nil, invalidParams("reviewType is invalid")
	}
	if harnessID == "" {
		return nil, invalidParams("harnessId is invalid")
	}
	if modelID == "" {
		return nil, invalidParams("modelId is invalid")
	}
	if params.Thinking != "" && validThinking(params.Thinking) == "" {
		return nil, invalidParams("thinking must be low, med, high, or max")
	}

	repo, task, runtimeErr := service.taskRepo(ctx, repoID, taskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	events, err := service.store.ListTaskEvents(ctx, task.ID, true)
	if err != nil {
		return nil, handlerError(err)
	}
	threadJSON, runtimeErr := reviewThreadJSON(events)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	planText, runtimeErr := latestCompletedReviewPlanText(events, harnessID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	prompt := buildReviewPrompt(reviewType, threadJSON, planText, recentReviewSnapshotFiles(events), params.CustomInstructions)
	userLabel := reviewUserLabel(reviewType)
	displayInput := userLabel
	if trimmed := strings.TrimSpace(params.CustomInstructions); trimmed != "" {
		displayInput = userLabel + ": " + trimmed
	}

	now := time.Now().UTC()
	eventID := "event-" + randomHexID()
	executionID := "headless-" + task.ID + "-" + randomHexID()
	sourceRaw, runtimeErr := reviewActionSourceRaw(reviewActionSourceDTO{
		Type:             "review",
		UserLabel:        userLabel,
		ReviewType:       reviewType,
		UserInstructions: prompt.UserMessage,
	})
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	payload, runtimeErr := createActionPayload(actionPayloadCreateInput{
		EventID:            eventID,
		CreatedAt:          now,
		UserInput:          displayInput,
		ExecutionID:        executionID,
		HarnessID:          harnessID,
		Source:             sourceRaw,
		IncludesCommentIDs: []string{},
		ModelID:            modelID,
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
			SourceType:  sql.NullString{String: "review", Valid: true},
			SourceLabel: sql.NullString{String: userLabel, Valid: true},
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

	runtimeID := "openade-review:" + event.ID
	if runtimeErr := service.createAgentRuntime(ctx, repo, task, event.ID, executionID, runtimeID, now); runtimeErr != nil {
		return nil, runtimeErr
	}
	enabledMCPServerIDs := reviewTaskEnabledMCPServerIDs(task)
	mcpServerConfigs, runtimeErr := service.agentMCPServerConfigs(ctx, enabledMCPServerIDs)
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
		ModelID:             modelID,
		TurnType:            "review",
		Input:               prompt.UserMessage,
		AppendSystemPrompt:  prompt.SystemPrompt,
		EnabledMCPServerIDs: enabledMCPServerIDs,
		MCPServerConfigs:    mcpServerConfigs,
		ReadOnly:            true,
		Thinking:            validThinking(params.Thinking),
		FastMode:            params.FastMode,
		Source:              append(json.RawMessage(nil), sourceRaw...),
		OnCompleted:         service.reviewFollowUpCompletionHook(reviewType, userLabel, modelID, validThinking(params.Thinking), params.FastMode),
	})

	return reviewStartResultDTO{TaskID: task.ID, EventID: event.ID, ExecutionID: executionID, CreatedAt: formatTime(now)}, nil
}

func (service *Service) reviewFollowUpCompletionHook(reviewType string, userLabel string, modelID string, thinking string, fastMode *bool) func(context.Context, AgentExecutionRequest, AgentExecutionResult) {
	return func(ctx context.Context, request AgentExecutionRequest, _ AgentExecutionResult) {
		reviewText, runtimeErr := service.completedReviewText(ctx, request.TaskID, request.EventID, request.HarnessID)
		if runtimeErr != nil || strings.TrimSpace(reviewText) == "" {
			return
		}
		repo, task, runtimeErr := service.taskRepo(ctx, request.RepoID, request.TaskID)
		if runtimeErr != nil {
			return
		}
		_ = service.startReviewFollowUp(ctx, repo, task, reviewType, userLabel, request.HarnessID, modelID, thinking, fastMode, reviewText, time.Now().UTC())
	}
}

func (service *Service) startReviewFollowUp(ctx context.Context, repo storage.Repo, task storage.Task, reviewType string, userLabel string, harnessID string, modelID string, thinking string, fastMode *bool, reviewText string, now time.Time) *core.RuntimeError {
	followUpLabel := userLabel + " Follow-up"
	sourceRaw, runtimeErr := reviewFollowUpSourceRaw(reviewFollowUpSourceDTO{
		Type:      "ask",
		UserLabel: followUpLabel,
		Origin:    "review_follow_up",
	})
	if runtimeErr != nil {
		return runtimeErr
	}
	eventID := "event-" + randomHexID()
	executionID := "headless-" + task.ID + "-" + randomHexID()
	handoffPrompt := buildReviewHandoffPrompt(reviewType, reviewText)
	payload, runtimeErr := createActionPayload(actionPayloadCreateInput{
		EventID:            eventID,
		CreatedAt:          now,
		UserInput:          followUpLabel,
		ExecutionID:        executionID,
		HarnessID:          harnessID,
		Source:             sourceRaw,
		IncludesCommentIDs: []string{},
		ModelID:            modelID,
		FastMode:           fastMode,
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
			SourceType:  sql.NullString{String: "ask", Valid: true},
			SourceLabel: sql.NullString{String: followUpLabel, Valid: true},
			CreatedAt:   now,
			PayloadJSON: sql.NullString{String: string(payload), Valid: true},
		},
		UpdatedAt:       now,
		UpdateLastEvent: true,
		UpdatePreview:   true,
	})
	if err != nil {
		return taskEventWriteRuntimeError(err)
	}
	runtimeID := "openade-review-follow-up:" + event.ID
	if runtimeErr := service.createAgentRuntime(ctx, repo, task, event.ID, executionID, runtimeID, now); runtimeErr != nil {
		return runtimeErr
	}
	enabledMCPServerIDs := reviewTaskEnabledMCPServerIDs(task)
	mcpServerConfigs, runtimeErr := service.agentMCPServerConfigs(ctx, enabledMCPServerIDs)
	if runtimeErr != nil {
		return runtimeErr
	}
	service.startAgentExecution(AgentExecutionRequest{
		RuntimeID:           runtimeID,
		RepoID:              repo.ID,
		RepoPath:            repo.Path,
		TaskID:              task.ID,
		EventID:             event.ID,
		ExecutionID:         executionID,
		HarnessID:           harnessID,
		ModelID:             modelID,
		TurnType:            "ask",
		Input:               handoffPrompt,
		AppendSystemPrompt:  reviewModeInstructions,
		EnabledMCPServerIDs: enabledMCPServerIDs,
		MCPServerConfigs:    mcpServerConfigs,
		ReadOnly:            true,
		Thinking:            thinking,
		FastMode:            fastMode,
		Source:              append(json.RawMessage(nil), sourceRaw...),
	})
	return nil
}

func (service *Service) createAgentRuntime(ctx context.Context, repo storage.Repo, task storage.Task, eventID string, executionID string, runtimeID string, now time.Time) *core.RuntimeError {
	runtimeDTO := runtimeRecordDTO{
		RuntimeID:      runtimeID,
		Kind:           "agent",
		Status:         "running",
		Scope:          turnRuntimeScope(repo, task, eventID, executionID, ""),
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
	service.runtime.Notify("openade/task/updated", actionEventTaskUpdatedNotification(task.RepoID, task.ID, eventID, "in_progress"))
	service.notifyWorkingTasks(ctx, now)
	return nil
}

func reviewUserLabel(reviewType string) string {
	if reviewType == "plan" {
		return "Review Plan"
	}
	return "Review"
}

func reviewActionSourceRaw(source reviewActionSourceDTO) (json.RawMessage, *core.RuntimeError) {
	raw, err := json.Marshal(source)
	if err != nil {
		return nil, handlerError(err)
	}
	return raw, nil
}

func reviewFollowUpSourceRaw(source reviewFollowUpSourceDTO) (json.RawMessage, *core.RuntimeError) {
	raw, err := json.Marshal(source)
	if err != nil {
		return nil, handlerError(err)
	}
	return raw, nil
}

func reviewThreadJSON(events []storage.TaskEvent) (string, *core.RuntimeError) {
	included := []json.RawMessage{}
	byteLength := 0
	for index := len(events) - 1; index >= 0; index-- {
		event := events[index]
		if event.Type == "snapshot" {
			continue
		}
		eventRaw, runtimeErr := reviewEventRaw(event)
		if runtimeErr != nil {
			return "", runtimeErr
		}
		eventBytes := len(eventRaw)
		if len(included) > 0 && byteLength+eventBytes > reviewThreadMaxBytes {
			break
		}
		included = append([]json.RawMessage{eventRaw}, included...)
		byteLength += eventBytes
	}
	raw, err := json.MarshalIndent(included, "", "  ")
	if err != nil {
		return "", handlerError(err)
	}
	return string(raw), nil
}

func reviewEventRaw(event storage.TaskEvent) (json.RawMessage, *core.RuntimeError) {
	if event.PayloadJSON.Valid && strings.TrimSpace(event.PayloadJSON.String) != "" {
		return json.RawMessage(append([]byte(nil), event.PayloadJSON.String...)), nil
	}
	raw, err := json.Marshal(taskEventFallbackDTO{
		ID:          event.ID,
		Type:        event.Type,
		CreatedAt:   formatTime(event.CreatedAt),
		Status:      nullStringValue(event.Status),
		SourceType:  nullStringValue(event.SourceType),
		SourceLabel: nullStringValue(event.SourceLabel),
	})
	if err != nil {
		return nil, handlerError(err)
	}
	return raw, nil
}

func recentReviewSnapshotFiles(events []storage.TaskEvent) []string {
	summaries := make([]string, 0, reviewChangedFilesLimit)
	seen := map[string]bool{}
	for index := len(events) - 1; index >= 0 && len(summaries) < reviewChangedFilesLimit; index-- {
		event := events[index]
		if event.Type != "snapshot" || !event.PayloadJSON.Valid {
			continue
		}
		var payload struct {
			Files []struct {
				Path    string `json:"path"`
				Status  string `json:"status"`
				OldPath string `json:"oldPath"`
			} `json:"files"`
		}
		if err := json.Unmarshal([]byte(event.PayloadJSON.String), &payload); err != nil {
			continue
		}
		for _, file := range payload.Files {
			path := strings.TrimSpace(file.Path)
			status := strings.TrimSpace(file.Status)
			if path == "" || status == "" {
				continue
			}
			summary := status + ": " + path
			if status == "renamed" && strings.TrimSpace(file.OldPath) != "" {
				summary = "renamed: " + strings.TrimSpace(file.OldPath) + " -> " + path
			}
			if seen[summary] {
				continue
			}
			seen[summary] = true
			summaries = append(summaries, summary)
			if len(summaries) >= reviewChangedFilesLimit {
				break
			}
		}
	}
	return summaries
}

func latestCompletedReviewPlanText(events []storage.TaskEvent, fallbackHarnessID string) (string, *core.RuntimeError) {
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
		sourceType, ok := rawObjectString(payload["source"], "type")
		if !ok || (sourceType != "plan" && sourceType != "revise" && sourceType != "hyperplan") {
			continue
		}
		execution, runtimeErr := actionExecutionPayload(payload)
		if runtimeErr != nil {
			return "", runtimeErr
		}
		harnessID := fallbackHarnessID
		if value, ok := rawRecordString(execution, "harnessId"); ok && value != "" {
			harnessID = value
		}
		return extractOpenADEPlanText(actionExecutionEvents(execution["events"]), harnessID), nil
	}
	return "", nil
}

func (service *Service) completedReviewText(ctx context.Context, taskID string, eventID string, harnessID string) (string, *core.RuntimeError) {
	event, ok, err := service.store.GetTaskEvent(ctx, taskID, eventID)
	if err != nil {
		return "", handlerError(err)
	}
	if !ok {
		return "", &core.RuntimeError{Code: "not_found", Message: "Review event not found"}
	}
	payload, runtimeErr := decodeActionPayload(event)
	if runtimeErr != nil {
		return "", runtimeErr
	}
	execution, runtimeErr := actionExecutionPayload(payload)
	if runtimeErr != nil {
		return "", runtimeErr
	}
	return extractOpenADEPlanText(actionExecutionEvents(execution["events"]), harnessID), nil
}

func extractOpenADEPlanText(events []json.RawMessage, harnessID string) string {
	switch harnessID {
	case "claude-code":
		if text := extractClaudePlanText(events); text != "" {
			return text
		}
	case "codex", "codex-cli":
		if text := extractCodexPlanText(events); text != "" {
			return text
		}
	}
	for index := len(events) - 1; index >= 0; index-- {
		if text := rawAssistantMessageText(events[index]); text != "" {
			return text
		}
		if text := rawMessageResultText(events[index]); text != "" {
			return text
		}
	}
	return ""
}

func extractClaudePlanText(events []json.RawMessage) string {
	for index := len(events) - 1; index >= 0; index-- {
		if text := rawMessageResultText(events[index]); text != "" {
			return text
		}
	}
	for index := len(events) - 1; index >= 0; index-- {
		message := rawMessagePayload(events[index])
		if len(message) == 0 {
			continue
		}
		var payload struct {
			Type    string `json:"type"`
			Message struct {
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal(message, &payload); err != nil || payload.Type != "assistant" {
			continue
		}
		parts := []string{}
		for _, content := range payload.Message.Content {
			if content.Type == "text" && content.Text != "" {
				parts = append(parts, content.Text)
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	}
	return ""
}

func extractCodexPlanText(events []json.RawMessage) string {
	parts := []string{}
	for _, event := range events {
		message := rawMessagePayload(event)
		if len(message) == 0 {
			continue
		}
		var payload struct {
			Type string `json:"type"`
			Item struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"item"`
		}
		if err := json.Unmarshal(message, &payload); err != nil {
			continue
		}
		if payload.Type == "item.completed" && payload.Item.Type == "agent_message" && payload.Item.Text != "" {
			parts = append(parts, payload.Item.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func rawMessagePayload(event json.RawMessage) json.RawMessage {
	var envelope struct {
		Type    string          `json:"type"`
		Message json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal(event, &envelope); err != nil || envelope.Type != "raw_message" {
		return nil
	}
	return envelope.Message
}

func rawMessageResultText(event json.RawMessage) string {
	message := rawMessagePayload(event)
	if len(message) == 0 {
		return ""
	}
	var payload struct {
		Type   string `json:"type"`
		Result string `json:"result"`
	}
	if err := json.Unmarshal(message, &payload); err != nil {
		return ""
	}
	if payload.Type == "result" {
		return payload.Result
	}
	return ""
}

func rawAssistantMessageText(event json.RawMessage) string {
	var payload struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(event, &payload); err != nil {
		return ""
	}
	if payload.Type == "assistant_message" {
		return payload.Text
	}
	return ""
}

func buildReviewPrompt(reviewType string, threadJSON string, planText string, changedFiles []string, customInstructions string) reviewPromptDTO {
	if reviewType == "plan" {
		return reviewPromptDTO{
			SystemPrompt: reviewModeInstructions,
			UserMessage: "<task_thread_context>\n" + threadJSON + "\n</task_thread_context>\n\n" +
				"<plan_to_review>\n" + planText + "\n</plan_to_review>\n\n" +
				"Review this plan. " + reviewFindingFormat + "\n" +
				"Prioritize correctness gaps and blockers first.\n" +
				"If relevant, verify assumptions against the current code and recent diffs/commits.\n\n" +
				reviewDimensions + "\n\n" +
				reviewEngineeringGuidance + "\n\n" +
				reviewSensitivityGuidance +
				changedFilesBlock(changedFiles) +
				customInstructionsBlock(customInstructions),
		}
	}
	return reviewPromptDTO{
		SystemPrompt: reviewModeInstructions,
		UserMessage: "<task_thread_context>\n" + threadJSON + "\n</task_thread_context>\n\n" +
			"Review the recent work. Use read-only exploration as needed.\n" +
			"Inspect relevant git status/diff, recent commits, and touched files before writing conclusions.\n" +
			reviewFindingFormat + "\n" +
			"Prioritize bugs, regressions, and risky complexity.\n\n" +
			reviewDimensions + "\n\n" +
			reviewEngineeringGuidance + "\n\n" +
			reviewSensitivityGuidance +
			changedFilesBlock(changedFiles) +
			customInstructionsBlock(customInstructions),
	}
}

func changedFilesBlock(changedFiles []string) string {
	if len(changedFiles) == 0 {
		return ""
	}
	return "\n\n<recent_changed_files>\n- " + strings.Join(changedFiles, "\n- ") + "\n</recent_changed_files>"
}

func customInstructionsBlock(customInstructions string) string {
	text := strings.TrimSpace(customInstructions)
	if text == "" {
		return ""
	}
	return "\n\n<additional_instructions>\n" + text + "\n</additional_instructions>"
}

func buildReviewHandoffPrompt(reviewType string, reviewText string) string {
	reviewedSubject := "your recent work"
	if reviewType == "plan" {
		reviewedSubject = "your plan"
	}
	return "<review_feedback>\n" + reviewText + "\n</review_feedback>\n\n" +
		"A reviewer shared the feedback above on " + reviewedSubject + ". For each finding, respond in this exact format:\n\n" +
		"### Finding N: <short bug summary>\n" +
		"- Criticality: <1-10>/10, preserving the reviewer's score if present or assigning one from severity, likelihood, user impact, and engineering risk\n" +
		"- Decision: Agree | Disagree\n" +
		"- Why: <brief reasoning>\n" +
		"- Fix: <specific change you would make, or N/A if disagree>\n\n" +
		"After all findings, add:\n" +
		"### Proposed Changes\n" +
		"- <concise bullet list of all fixes you agree with>\n\n" +
		`Then ask: "Would you like me to proceed with the agreed-upon changes?"`
}

func reviewTaskEnabledMCPServerIDs(task storage.Task) []string {
	if !task.MetadataJSON.Valid || strings.TrimSpace(task.MetadataJSON.String) == "" {
		return []string{}
	}
	var metadata taskCreateMetadataDTO
	if err := json.Unmarshal([]byte(task.MetadataJSON.String), &metadata); err != nil {
		return []string{}
	}
	ids := make([]string, 0, len(metadata.EnabledMCPServerIDs))
	for _, id := range metadata.EnabledMCPServerIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			ids = append(ids, trimmed)
		}
	}
	return ids
}
