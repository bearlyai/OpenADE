package product

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	cronlib "github.com/robfig/cron/v3"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/host"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

const defaultCronSchedulerInterval = time.Minute

var cronScheduleParser = cronlib.NewParser(cronlib.Minute | cronlib.Hour | cronlib.Dom | cronlib.Month | cronlib.Dow)

type CronSchedulerRunResult struct {
	At             string               `json:"at"`
	ScannedRepos   int                  `json:"scannedRepos"`
	InstalledCrons int                  `json:"installedCrons"`
	DueCrons       int                  `json:"dueCrons"`
	StartedTurns   int                  `json:"startedTurns"`
	SkippedCrons   int                  `json:"skippedCrons"`
	FailedCrons    int                  `json:"failedCrons"`
	Issues         []CronSchedulerIssue `json:"issues"`
}

type CronSchedulerIssue struct {
	RepoID string `json:"repoId"`
	CronID string `json:"cronId,omitempty"`
	Code   string `json:"code"`
}

type cronTurnIsolationDTO struct {
	Type         string `json:"type"`
	SourceBranch string `json:"sourceBranch,omitempty"`
}

type cronTurnStartRequestDTO struct {
	RepoID             string               `json:"repoId"`
	Type               string               `json:"type"`
	Input              string               `json:"input"`
	AppendSystemPrompt string               `json:"appendSystemPrompt,omitempty"`
	InTaskID           string               `json:"inTaskId,omitempty"`
	IsolationStrategy  cronTurnIsolationDTO `json:"isolationStrategy"`
	HarnessID          string               `json:"harnessId,omitempty"`
	Title              string               `json:"title"`
	ClientRequestID    string               `json:"clientRequestId"`
}

func (service *Service) StartCronScheduler(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = defaultCronSchedulerInterval
	}
	go func() {
		_, _ = service.RunDueCrons(ctx, time.Now().UTC())
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case at := <-ticker.C:
				_, _ = service.RunDueCrons(ctx, at.UTC())
			}
		}
	}()
}

func (service *Service) RunDueCrons(ctx context.Context, now time.Time) (CronSchedulerRunResult, *core.RuntimeError) {
	now = now.UTC()
	result := CronSchedulerRunResult{At: formatTime(now), Issues: []CronSchedulerIssue{}}
	repos, err := service.store.ListRepos(ctx)
	if err != nil {
		return result, handlerError(err)
	}
	for _, repo := range repos {
		if repo.Archived {
			continue
		}
		result.ScannedRepos++
		service.runDueCronsForRepo(ctx, repo, now, &result)
	}
	return result, nil
}

func (service *Service) runDueCronsForRepo(ctx context.Context, repo storage.Repo, now time.Time, result *CronSchedulerRunResult) {
	installations, runtimeErr := service.loadCronInstallState(ctx, repo.ID)
	if runtimeErr != nil {
		result.FailedCrons++
		result.Issues = append(result.Issues, CronSchedulerIssue{RepoID: repo.ID, Code: "install_state_read_failed"})
		return
	}
	if len(installations) == 0 {
		return
	}
	processes, err := host.ListProjectProcesses(ctx, repo.Path)
	if err != nil {
		result.FailedCrons += len(installations)
		result.Issues = append(result.Issues, CronSchedulerIssue{RepoID: repo.ID, Code: "process_config_read_failed"})
		return
	}
	definitions := cronDefinitionsByID(processes.Configs)
	changed := false
	for cronID, state := range installations {
		result.InstalledCrons++
		nextState, updated, started := service.runDueCron(ctx, repo, now, cronID, state, definitions[cronID], result)
		if updated {
			installations[cronID] = nextState
			changed = true
		}
		if started {
			result.StartedTurns++
		}
	}
	if changed {
		if runtimeErr := service.saveCronInstallState(ctx, repo.ID, installations); runtimeErr != nil {
			result.FailedCrons++
			result.Issues = append(result.Issues, CronSchedulerIssue{RepoID: repo.ID, Code: "install_state_save_failed"})
		}
	}
}

func (service *Service) runDueCron(
	ctx context.Context,
	repo storage.Repo,
	now time.Time,
	cronID string,
	state cronInstallStateRow,
	definition host.ProcsCronDef,
	result *CronSchedulerRunResult,
) (cronInstallStateRow, bool, bool) {
	if !state.Enabled {
		result.SkippedCrons++
		return state, false, false
	}
	if definition.ID == "" {
		result.FailedCrons++
		result.Issues = append(result.Issues, CronSchedulerIssue{RepoID: repo.ID, CronID: cronID, Code: "cron_definition_missing"})
		return state, false, false
	}
	dueAt, due, code := cronDueAt(definition.Schedule, state, now)
	if code != "" {
		result.FailedCrons++
		result.Issues = append(result.Issues, CronSchedulerIssue{RepoID: repo.ID, CronID: cronID, Code: code})
		return state, false, false
	}
	if !due {
		result.SkippedCrons++
		return state, false, false
	}
	result.DueCrons++
	if !service.claimCronRun(repo.ID, cronID) {
		result.SkippedCrons++
		return state, false, false
	}
	defer service.releaseCronRun(repo.ID, cronID)

	state.LastRunAt = formatTime(now)
	raw, err := json.Marshal(cronTurnStartRequest(repo.ID, definition, state, dueAt))
	if err != nil {
		result.FailedCrons++
		result.Issues = append(result.Issues, CronSchedulerIssue{RepoID: repo.ID, CronID: cronID, Code: "turn_request_encode_failed"})
		return state, true, false
	}
	payload, runtimeErr := service.startTurn(ctx, raw)
	if runtimeErr != nil {
		result.FailedCrons++
		result.Issues = append(result.Issues, CronSchedulerIssue{RepoID: repo.ID, CronID: cronID, Code: "turn_start_failed"})
		return state, true, false
	}
	started, ok := payload.(turnStartResultDTO)
	if !ok || strings.TrimSpace(started.TaskID) == "" {
		result.FailedCrons++
		result.Issues = append(result.Issues, CronSchedulerIssue{RepoID: repo.ID, CronID: cronID, Code: "turn_start_result_invalid"})
		return state, true, false
	}
	state.LastTaskID = started.TaskID
	return state, true, true
}

func cronDefinitionsByID(configs []host.ProcsConfig) map[string]host.ProcsCronDef {
	definitions := map[string]host.ProcsCronDef{}
	for _, config := range configs {
		for _, cron := range config.Crons {
			definitions[cron.ID] = cron
		}
	}
	return definitions
}

func cronDueAt(schedule string, state cronInstallStateRow, now time.Time) (time.Time, bool, string) {
	parsed, err := cronScheduleParser.Parse(strings.TrimSpace(schedule))
	if err != nil {
		return time.Time{}, false, "schedule_invalid"
	}
	anchorText := strings.TrimSpace(state.LastRunAt)
	if anchorText == "" {
		anchorText = strings.TrimSpace(state.InstalledAt)
	}
	anchor, err := time.Parse(time.RFC3339, anchorText)
	if err != nil {
		return time.Time{}, false, "anchor_time_invalid"
	}
	if anchor.After(now) {
		return time.Time{}, false, ""
	}
	next := parsed.Next(anchor.UTC())
	return next, !next.After(now), ""
}

func cronTurnStartRequest(repoID string, definition host.ProcsCronDef, state cronInstallStateRow, dueAt time.Time) cronTurnStartRequestDTO {
	isolation := cronTurnIsolationDTO{Type: "head"}
	if definition.Isolation == "worktree" {
		isolation = cronTurnIsolationDTO{Type: "worktree", SourceBranch: "HEAD"}
	}
	inTaskID := strings.TrimSpace(definition.InTaskID)
	if inTaskID == "" && definition.ReuseTask {
		inTaskID = strings.TrimSpace(state.LastTaskID)
	}
	return cronTurnStartRequestDTO{
		RepoID:             repoID,
		Type:               strings.TrimSpace(definition.Type),
		Input:              definition.Prompt,
		AppendSystemPrompt: definition.AppendSystemPrompt,
		InTaskID:           inTaskID,
		IsolationStrategy:  isolation,
		HarnessID:          strings.TrimSpace(definition.Harness),
		Title:              "[Cron] " + strings.TrimSpace(definition.Name),
		ClientRequestID:    cronClientRequestID(repoID, definition.ID, dueAt),
	}
}

func cronClientRequestID(repoID string, cronID string, dueAt time.Time) string {
	return fmt.Sprintf("cron:%s:%s:%d", repoID, cronID, dueAt.UTC().Unix())
}

func (service *Service) claimCronRun(repoID string, cronID string) bool {
	key := repoID + "::" + cronID
	service.cronMu.Lock()
	defer service.cronMu.Unlock()
	if service.runningCrons[key] {
		return false
	}
	service.runningCrons[key] = true
	return true
}

func (service *Service) releaseCronRun(repoID string, cronID string) {
	key := repoID + "::" + cronID
	service.cronMu.Lock()
	delete(service.runningCrons, key)
	service.cronMu.Unlock()
}
