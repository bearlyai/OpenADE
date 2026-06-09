package product

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

const cronInstallStateSettingPrefix = "cron_install_state:"

type cronInstallStateRow struct {
	CronID      string `json:"cronId"`
	Enabled     bool   `json:"enabled"`
	InstalledAt string `json:"installedAt"`
	LastRunAt   string `json:"lastRunAt,omitempty"`
	LastTaskID  string `json:"lastTaskId,omitempty"`
}

type cronInstallStateDocument struct {
	Installations map[string]cronInstallStateRow `json:"installations"`
}

type cronInstallStateReadDTO struct {
	RepoID        string                         `json:"repoId"`
	Installations map[string]cronInstallStateRow `json:"installations"`
}

type cronInstallStateReplaceDTO struct {
	RepoID                string                         `json:"repoId"`
	Installations         map[string]cronInstallStateRow `json:"installations"`
	ReplacedInstallations int                            `json:"replacedInstallations"`
}

func (service *Service) handleCronInstallStateRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID string `json:"repoId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repoID := strings.TrimSpace(params.RepoID)
	if _, runtimeErr := service.repoByID(ctx, repoID); runtimeErr != nil {
		return nil, runtimeErr
	}
	installations, runtimeErr := service.loadCronInstallState(ctx, repoID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	return cronInstallStateReadDTO{RepoID: repoID, Installations: installations}, nil
}

func (service *Service) handleCronInstallStateReplace(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/cron/installState/replace", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID        string                         `json:"repoId"`
			Installations map[string]cronInstallStateRow `json:"installations"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		repoID := strings.TrimSpace(params.RepoID)
		if _, runtimeErr := service.repoByID(ctx, repoID); runtimeErr != nil {
			return nil, runtimeErr
		}
		installations, runtimeErr := normalizeCronInstallStateRows(params.Installations)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if runtimeErr := service.saveCronInstallState(ctx, repoID, installations); runtimeErr != nil {
			return nil, runtimeErr
		}
		return cronInstallStateReplaceDTO{
			RepoID:                repoID,
			Installations:         installations,
			ReplacedInstallations: len(installations),
		}, nil
	})
}

func (service *Service) loadCronInstallState(ctx context.Context, repoID string) (map[string]cronInstallStateRow, *core.RuntimeError) {
	raw, ok, err := service.store.GetSetting(ctx, cronInstallStateSettingKey(repoID))
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || len(raw) == 0 {
		return map[string]cronInstallStateRow{}, nil
	}
	rows, runtimeErr := decodeCronInstallStateDocument(raw)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	return normalizeCronInstallStateRows(rows)
}

func (service *Service) saveCronInstallState(ctx context.Context, repoID string, installations map[string]cronInstallStateRow) *core.RuntimeError {
	document := cronInstallStateDocument{Installations: installations}
	raw, err := json.Marshal(document)
	if err != nil {
		return handlerError(err)
	}
	if err := service.store.PutSetting(ctx, cronInstallStateSettingKey(repoID), raw, time.Now().UTC()); err != nil {
		return handlerError(err)
	}
	return nil
}

func decodeCronInstallStateDocument(raw json.RawMessage) (map[string]cronInstallStateRow, *core.RuntimeError) {
	var document cronInstallStateDocument
	if err := json.Unmarshal(raw, &document); err == nil && document.Installations != nil {
		return document.Installations, nil
	}
	var direct map[string]cronInstallStateRow
	if err := json.Unmarshal(raw, &direct); err != nil {
		return nil, handlerError(err)
	}
	if direct == nil {
		return map[string]cronInstallStateRow{}, nil
	}
	return direct, nil
}

func normalizeCronInstallStateRows(rows map[string]cronInstallStateRow) (map[string]cronInstallStateRow, *core.RuntimeError) {
	if len(rows) == 0 {
		return map[string]cronInstallStateRow{}, nil
	}
	seen := map[string]bool{}
	result := make(map[string]cronInstallStateRow, len(rows))
	for key, row := range rows {
		normalized, runtimeErr := normalizeCronInstallStateRow(key, row)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if seen[normalized.CronID] {
			return nil, invalidParams("cron ids must be unique")
		}
		seen[normalized.CronID] = true
		result[normalized.CronID] = normalized
	}
	return result, nil
}

func normalizeCronInstallStateRow(key string, row cronInstallStateRow) (cronInstallStateRow, *core.RuntimeError) {
	keyID := strings.TrimSpace(key)
	cronID := strings.TrimSpace(row.CronID)
	if cronID == "" {
		cronID = keyID
	}
	if keyID != "" && cronID != keyID {
		return cronInstallStateRow{}, invalidParams("cron install-state keys must match cronId")
	}
	if runtimeErr := validateCronInstallStateText("cronId", cronID, 512, true); runtimeErr != nil {
		return cronInstallStateRow{}, runtimeErr
	}

	installedAt := strings.TrimSpace(row.InstalledAt)
	if installedAt == "" {
		return cronInstallStateRow{}, invalidParams("installedAt is required")
	}
	if _, runtimeErr := parseParamTime("installedAt", installedAt); runtimeErr != nil {
		return cronInstallStateRow{}, runtimeErr
	}

	lastRunAt := strings.TrimSpace(row.LastRunAt)
	if lastRunAt != "" {
		if _, runtimeErr := parseParamTime("lastRunAt", lastRunAt); runtimeErr != nil {
			return cronInstallStateRow{}, runtimeErr
		}
	}

	lastTaskID := strings.TrimSpace(row.LastTaskID)
	if runtimeErr := validateCronInstallStateText("lastTaskId", lastTaskID, 240, false); runtimeErr != nil {
		return cronInstallStateRow{}, runtimeErr
	}

	return cronInstallStateRow{
		CronID:      cronID,
		Enabled:     row.Enabled,
		InstalledAt: installedAt,
		LastRunAt:   lastRunAt,
		LastTaskID:  lastTaskID,
	}, nil
}

func validateCronInstallStateText(field string, value string, maxLength int, required bool) *core.RuntimeError {
	if value == "" {
		if required {
			return invalidParams(field + " is required")
		}
		return nil
	}
	if len(value) > maxLength {
		return invalidParams(field + " is too long")
	}
	if strings.ContainsAny(value, "\x00\r\n") {
		return invalidParams(field + " is invalid")
	}
	return nil
}

func cronInstallStateSettingKey(repoID string) string {
	return cronInstallStateSettingPrefix + repoID
}
