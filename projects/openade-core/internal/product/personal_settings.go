package product

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

const personalSettingsSettingKey = "personal_settings"

type personalSettingsAgentCouplet struct {
	HarnessID string `json:"harnessId"`
	ModelID   string `json:"modelId"`
}

type personalSettingsDTO struct {
	EnvVars                map[string]string              `json:"envVars"`
	Theme                  string                         `json:"theme"`
	LastSettingsTab        string                         `json:"lastSettingsTab,omitempty"`
	DeviceID               string                         `json:"deviceId,omitempty"`
	TelemetryDisabled      *bool                          `json:"telemetryDisabled,omitempty"`
	OnboardingCompleted    *bool                          `json:"onboardingCompleted,omitempty"`
	DevHideTray            *bool                          `json:"devHideTray,omitempty"`
	DevForceAllCommands    *bool                          `json:"devForceAllCommands,omitempty"`
	ShortcutHintsHidden    *bool                          `json:"shortcutHintsHidden,omitempty"`
	RenderMarkdownMessages *bool                          `json:"renderMarkdownMessages,omitempty"`
	LastSeenReleaseVersion string                         `json:"lastSeenReleaseVersion,omitempty"`
	NewTaskHarnessID       string                         `json:"newTaskHarnessId,omitempty"`
	NewTaskModelID         string                         `json:"newTaskModelId,omitempty"`
	PinnedTaskIDs          []string                       `json:"pinnedTaskIds,omitempty"`
	HyperplanStrategyID    string                         `json:"hyperplanStrategyId,omitempty"`
	HyperplanAgents        []personalSettingsAgentCouplet `json:"hyperplanAgents,omitempty"`
	HyperplanReconciler    *personalSettingsAgentCouplet  `json:"hyperplanReconciler,omitempty"`
}

type personalSettingsReadDTO struct {
	Settings personalSettingsDTO `json:"settings"`
}

type personalSettingsReplaceDTO struct {
	Settings personalSettingsDTO `json:"settings"`
}

func (service *Service) handlePersonalSettingsRead(ctx context.Context, _ *core.Connection, _ json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	settings, runtimeErr := service.loadPersonalSettings(ctx)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	return personalSettingsReadDTO{Settings: settings}, nil
}

func (service *Service) handlePersonalSettingsReplace(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodSettingsPersonalReplace, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			Settings personalSettingsDTO `json:"settings"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		previous, runtimeErr := service.loadPersonalSettings(ctx)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		settings, runtimeErr := normalizePersonalSettings(params.Settings)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if runtimeErr := service.savePersonalSettings(ctx, settings); runtimeErr != nil {
			return nil, runtimeErr
		}
		if personalSettingsAffectSnapshotProjection(previous, settings) {
			notification := map[string]string{}
			if clientRequestID := clientRequestIDFromRaw(raw); clientRequestID != "" {
				notification["clientRequestId"] = clientRequestID
			}
			service.runtime.Notify(openADENotificationSnapshotChanged, notification)
		}
		return personalSettingsReplaceDTO{Settings: settings}, nil
	})
}

func personalSettingsAffectSnapshotProjection(previous personalSettingsDTO, next personalSettingsDTO) bool {
	if previous.Theme != next.Theme {
		return true
	}
	if len(previous.PinnedTaskIDs) != len(next.PinnedTaskIDs) {
		return true
	}
	for index, taskID := range previous.PinnedTaskIDs {
		if next.PinnedTaskIDs[index] != taskID {
			return true
		}
	}
	return false
}

func (service *Service) loadPersonalSettings(ctx context.Context) (personalSettingsDTO, *core.RuntimeError) {
	raw, ok, err := service.store.GetSetting(ctx, personalSettingsSettingKey)
	if err != nil {
		return personalSettingsDTO{}, handlerError(err)
	}
	if !ok || len(raw) == 0 {
		return normalizePersonalSettings(personalSettingsDTO{})
	}
	var settings personalSettingsDTO
	if err := json.Unmarshal(raw, &settings); err != nil {
		return personalSettingsDTO{}, handlerError(err)
	}
	return normalizePersonalSettings(settings)
}

func (service *Service) savePersonalSettings(ctx context.Context, settings personalSettingsDTO) *core.RuntimeError {
	raw, err := json.Marshal(settings)
	if err != nil {
		return handlerError(err)
	}
	if err := service.store.PutSetting(ctx, personalSettingsSettingKey, raw, time.Now().UTC()); err != nil {
		return handlerError(err)
	}
	return nil
}

func normalizePersonalSettings(settings personalSettingsDTO) (personalSettingsDTO, *core.RuntimeError) {
	theme := strings.TrimSpace(settings.Theme)
	if theme == "" {
		theme = "system"
	}
	if !validPersonalSettingsTheme(theme) {
		return personalSettingsDTO{}, invalidParams("theme is invalid")
	}
	tab := strings.TrimSpace(settings.LastSettingsTab)
	if tab != "" && !validPersonalSettingsTab(tab) {
		return personalSettingsDTO{}, invalidParams("lastSettingsTab is invalid")
	}
	envVars, runtimeErr := normalizePersonalSettingsStringMap("envVars", settings.EnvVars, 512, 10_000)
	if runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	pinnedTaskIDs, runtimeErr := normalizePersonalSettingsStringSlice("pinnedTaskIds", settings.PinnedTaskIDs, 240)
	if runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	agents, runtimeErr := normalizePersonalSettingsAgentCouplets("hyperplanAgents", settings.HyperplanAgents)
	if runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	reconciler, runtimeErr := normalizePersonalSettingsOptionalAgentCouplet("hyperplanReconciler", settings.HyperplanReconciler)
	if runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	if runtimeErr := validatePersonalSettingsText("deviceId", settings.DeviceID, 256, false); runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	if runtimeErr := validatePersonalSettingsText("lastSeenReleaseVersion", settings.LastSeenReleaseVersion, 120, false); runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	if runtimeErr := validatePersonalSettingsText("newTaskHarnessId", settings.NewTaskHarnessID, 120, false); runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	if runtimeErr := validatePersonalSettingsText("newTaskModelId", settings.NewTaskModelID, 240, false); runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	if runtimeErr := validatePersonalSettingsText("hyperplanStrategyId", settings.HyperplanStrategyID, 120, false); runtimeErr != nil {
		return personalSettingsDTO{}, runtimeErr
	}
	renderMarkdown := settings.RenderMarkdownMessages
	if renderMarkdown == nil {
		defaultRenderMarkdown := true
		renderMarkdown = &defaultRenderMarkdown
	}

	return personalSettingsDTO{
		EnvVars:                envVars,
		Theme:                  theme,
		LastSettingsTab:        tab,
		DeviceID:               strings.TrimSpace(settings.DeviceID),
		TelemetryDisabled:      settings.TelemetryDisabled,
		OnboardingCompleted:    settings.OnboardingCompleted,
		DevHideTray:            settings.DevHideTray,
		DevForceAllCommands:    settings.DevForceAllCommands,
		ShortcutHintsHidden:    settings.ShortcutHintsHidden,
		RenderMarkdownMessages: renderMarkdown,
		LastSeenReleaseVersion: strings.TrimSpace(settings.LastSeenReleaseVersion),
		NewTaskHarnessID:       strings.TrimSpace(settings.NewTaskHarnessID),
		NewTaskModelID:         strings.TrimSpace(settings.NewTaskModelID),
		PinnedTaskIDs:          pinnedTaskIDs,
		HyperplanStrategyID:    strings.TrimSpace(settings.HyperplanStrategyID),
		HyperplanAgents:        agents,
		HyperplanReconciler:    reconciler,
	}, nil
}

func validPersonalSettingsTheme(theme string) bool {
	switch theme {
	case "system", "code-theme-light", "code-theme-bright", "code-theme-clean", "code-theme-black", "code-theme-synthwave", "code-theme-dracula":
		return true
	default:
		return false
	}
}

func validPersonalSettingsTab(tab string) bool {
	switch tab {
	case "appearance", "connectors", "companion", "system", "stats", "dev":
		return true
	default:
		return false
	}
}

func normalizePersonalSettingsStringMap(field string, values map[string]string, maxKeyLength int, maxValueLength int) (map[string]string, *core.RuntimeError) {
	if len(values) == 0 {
		return map[string]string{}, nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		normalizedKey := strings.TrimSpace(key)
		if runtimeErr := validatePersonalSettingsText(field+" key", normalizedKey, maxKeyLength, true); runtimeErr != nil {
			return nil, runtimeErr
		}
		if strings.Contains(normalizedKey, "=") {
			return nil, invalidParams(field + " key is invalid")
		}
		if runtimeErr := validatePersonalSettingsValue(field+" value", value, maxValueLength); runtimeErr != nil {
			return nil, runtimeErr
		}
		result[normalizedKey] = value
	}
	return result, nil
}

func normalizePersonalSettingsStringSlice(field string, values []string, maxLength int) ([]string, *core.RuntimeError) {
	if len(values) == 0 {
		return nil, nil
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if runtimeErr := validatePersonalSettingsText(field, normalized, maxLength, true); runtimeErr != nil {
			return nil, runtimeErr
		}
		if seen[normalized] {
			continue
		}
		seen[normalized] = true
		result = append(result, normalized)
	}
	return result, nil
}

func normalizePersonalSettingsAgentCouplets(field string, values []personalSettingsAgentCouplet) ([]personalSettingsAgentCouplet, *core.RuntimeError) {
	if len(values) == 0 {
		return nil, nil
	}
	result := make([]personalSettingsAgentCouplet, 0, len(values))
	for _, value := range values {
		normalized, runtimeErr := normalizePersonalSettingsAgentCouplet(field, value)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		result = append(result, normalized)
	}
	return result, nil
}

func normalizePersonalSettingsOptionalAgentCouplet(field string, value *personalSettingsAgentCouplet) (*personalSettingsAgentCouplet, *core.RuntimeError) {
	if value == nil {
		return nil, nil
	}
	normalized, runtimeErr := normalizePersonalSettingsAgentCouplet(field, *value)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	return &normalized, nil
}

func normalizePersonalSettingsAgentCouplet(field string, value personalSettingsAgentCouplet) (personalSettingsAgentCouplet, *core.RuntimeError) {
	harnessID := strings.TrimSpace(value.HarnessID)
	modelID := strings.TrimSpace(value.ModelID)
	if runtimeErr := validatePersonalSettingsText(field+".harnessId", harnessID, 120, true); runtimeErr != nil {
		return personalSettingsAgentCouplet{}, runtimeErr
	}
	if runtimeErr := validatePersonalSettingsText(field+".modelId", modelID, 240, true); runtimeErr != nil {
		return personalSettingsAgentCouplet{}, runtimeErr
	}
	return personalSettingsAgentCouplet{HarnessID: harnessID, ModelID: modelID}, nil
}

func validatePersonalSettingsText(field string, value string, maxLength int, required bool) *core.RuntimeError {
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

func validatePersonalSettingsValue(field string, value string, maxLength int) *core.RuntimeError {
	if len(value) > maxLength {
		return invalidParams(field + " is too long")
	}
	if strings.Contains(value, "\x00") {
		return invalidParams(field + " is invalid")
	}
	return nil
}

func (service *Service) personalSettingsEnvVarsOrEmpty(ctx context.Context) map[string]string {
	settings, runtimeErr := service.loadPersonalSettings(ctx)
	if runtimeErr != nil {
		return map[string]string{}
	}
	return settings.EnvVars
}

func environmentWithOverrides(base []string, overrides map[string]string, extras ...string) []string {
	values := map[string]string{}
	for _, pair := range base {
		key, value, ok := environmentPair(pair)
		if ok {
			values[key] = value
		}
	}
	for key, value := range overrides {
		if strings.TrimSpace(key) != "" && !strings.Contains(key, "=") {
			values[key] = value
		}
	}
	for _, pair := range extras {
		key, value, ok := environmentPair(pair)
		if ok {
			values[key] = value
		}
	}

	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+values[key])
	}
	return result
}

func environmentPair(pair string) (string, string, bool) {
	index := strings.IndexByte(pair, '=')
	if index <= 0 {
		return "", "", false
	}
	return pair[:index], pair[index+1:], true
}
