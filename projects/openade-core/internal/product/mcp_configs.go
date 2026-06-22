package product

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

const mcpServersSettingKey = "mcp_servers"

type mcpServersSettingsDocument struct {
	MCPServers []mcpServerSettingsRow `json:"mcp_servers"`
}

type mcpServerSettingsRow struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Enabled       bool              `json:"enabled"`
	TransportType string            `json:"transportType"`
	PresetID      string            `json:"presetId,omitempty"`
	LastTested    string            `json:"lastTested,omitempty"`
	HealthStatus  string            `json:"healthStatus"`
	CreatedAt     string            `json:"createdAt"`
	UpdatedAt     string            `json:"updatedAt"`
	URL           string            `json:"url,omitempty"`
	Headers       map[string]string `json:"headers,omitempty"`
	OAuthTokens   *mcpOAuthTokens   `json:"oauthTokens,omitempty"`
	Command       string            `json:"command,omitempty"`
	Args          []string          `json:"args,omitempty"`
	EnvVars       map[string]string `json:"envVars,omitempty"`
	Cwd           string            `json:"cwd,omitempty"`
}

type mcpOAuthTokens struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken,omitempty"`
	ClientID     string `json:"clientId,omitempty"`
	ExpiresAt    string `json:"expiresAt,omitempty"`
	TokenType    string `json:"tokenType"`
}

type mcpServersReadDTO struct {
	Servers []mcpServerSettingsRow `json:"servers"`
}

type mcpServersReplaceDTO struct {
	Servers         []mcpServerSettingsRow `json:"servers"`
	ReplacedServers int                    `json:"replacedServers"`
}

type mcpServerUpsertDTO struct {
	Server  mcpServerSettingsRow `json:"server"`
	Created bool                 `json:"created"`
}

type mcpServerDeleteDTO struct {
	ServerID string `json:"serverId"`
	Deleted  bool   `json:"deleted"`
}

type mcpServerConfig struct {
	Type    string            `json:"type"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Cwd     string            `json:"cwd,omitempty"`
}

func (service *Service) agentMCPServerConfigs(ctx context.Context, enabledServerIDs []string) (json.RawMessage, *core.RuntimeError) {
	if len(enabledServerIDs) == 0 {
		return nil, nil
	}
	raw, ok, err := service.store.GetSetting(ctx, mcpServersSettingKey)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || len(raw) == 0 {
		return nil, nil
	}
	rows, runtimeErr := decodeMCPServerSettings(raw)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	enabled := map[string]bool{}
	for _, id := range enabledServerIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			enabled[trimmed] = true
		}
	}
	if len(enabled) == 0 {
		return nil, nil
	}

	configs := map[string]mcpServerConfig{}
	for _, row := range rows {
		if !row.Enabled || !enabled[strings.TrimSpace(row.ID)] {
			continue
		}
		name := strings.TrimSpace(row.Name)
		if name == "" {
			continue
		}
		switch row.TransportType {
		case "http":
			url := strings.TrimSpace(row.URL)
			if url == "" {
				continue
			}
			config := mcpServerConfig{Type: "http", URL: url}
			headers := cloneStringMap(row.Headers)
			if row.OAuthTokens != nil && strings.TrimSpace(row.OAuthTokens.AccessToken) != "" {
				token := strings.TrimSpace(row.OAuthTokens.AccessToken)
				headers["Authorization"] = "Bearer " + token
			}
			if len(headers) > 0 {
				config.Headers = headers
			}
			configs[name] = config
		case "stdio":
			command := strings.TrimSpace(row.Command)
			if command == "" {
				continue
			}
			config := mcpServerConfig{Type: "stdio", Command: command}
			if args := compactStringSlice(row.Args); len(args) > 0 {
				config.Args = args
			}
			if env := cloneStringMap(row.EnvVars); len(env) > 0 {
				config.Env = env
			}
			if cwd := strings.TrimSpace(row.Cwd); cwd != "" {
				config.Cwd = cwd
			}
			configs[name] = config
		}
	}
	if len(configs) == 0 {
		return nil, nil
	}
	result, err := json.Marshal(configs)
	if err != nil {
		return nil, handlerError(err)
	}
	return result, nil
}

func (service *Service) handleMCPServersRead(ctx context.Context, conn *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	if runtimeErr := decodeObject(raw, &struct{}{}); runtimeErr != nil {
		return nil, runtimeErr
	}
	rows, runtimeErr := service.loadMCPServerSettings(ctx)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if !canReadFullMCPServerSettings(conn) {
		rows = sanitizeMCPServerSettingsRows(rows)
	}
	return mcpServersReadDTO{Servers: rows}, nil
}

func canReadFullMCPServerSettings(conn *core.Connection) bool {
	if conn == nil {
		return true
	}
	return conn.CanInvoke(openADEMethodSettingsMcpServersReplace) ||
		conn.CanInvoke(openADEMethodSettingsMcpServersUpsert) ||
		conn.CanInvoke(openADEMethodSettingsMcpServersDelete)
}

func sanitizeMCPServerSettingsRows(rows []mcpServerSettingsRow) []mcpServerSettingsRow {
	sanitizedRows := make([]mcpServerSettingsRow, 0, len(rows))
	for _, row := range rows {
		sanitizedRows = append(sanitizedRows, mcpServerSettingsRow{
			ID:            row.ID,
			Name:          row.Name,
			Enabled:       row.Enabled,
			TransportType: row.TransportType,
			PresetID:      row.PresetID,
			LastTested:    row.LastTested,
			HealthStatus:  row.HealthStatus,
			CreatedAt:     row.CreatedAt,
			UpdatedAt:     row.UpdatedAt,
		})
	}
	return sanitizedRows
}

func (service *Service) handleMCPServersReplace(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodSettingsMcpServersReplace, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			Servers []mcpServerSettingsRow `json:"servers"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		existing, runtimeErr := service.loadMCPServerSettings(ctx)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		rows, runtimeErr := normalizeMCPServerSettingsRows(params.Servers, existing, time.Now().UTC())
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if runtimeErr := service.saveMCPServerSettings(ctx, rows); runtimeErr != nil {
			return nil, runtimeErr
		}
		return mcpServersReplaceDTO{Servers: rows, ReplacedServers: len(rows)}, nil
	})
}

func (service *Service) handleMCPServerUpsert(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodSettingsMcpServersUpsert, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			Server mcpServerSettingsRow `json:"server"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		existing, runtimeErr := service.loadMCPServerSettings(ctx)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		rows, runtimeErr := normalizeMCPServerSettingsRows([]mcpServerSettingsRow{params.Server}, existing, time.Now().UTC())
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		server := rows[0]
		result := make([]mcpServerSettingsRow, 0, len(existing)+1)
		created := true
		replaced := false
		for _, row := range existing {
			if strings.TrimSpace(row.ID) == server.ID {
				result = append(result, server)
				created = false
				replaced = true
				continue
			}
			result = append(result, row)
		}
		if !replaced {
			result = append(result, server)
		}
		if runtimeErr := service.saveMCPServerSettings(ctx, result); runtimeErr != nil {
			return nil, runtimeErr
		}
		return mcpServerUpsertDTO{Server: server, Created: created}, nil
	})
}

func (service *Service) handleMCPServerDelete(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodSettingsMcpServersDelete, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			ServerID string `json:"serverId"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		serverID := strings.TrimSpace(params.ServerID)
		if runtimeErr := validateMCPServerID(serverID); runtimeErr != nil {
			return nil, runtimeErr
		}
		existing, runtimeErr := service.loadMCPServerSettings(ctx)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		rows := make([]mcpServerSettingsRow, 0, len(existing))
		deleted := false
		for _, row := range existing {
			if strings.TrimSpace(row.ID) == serverID {
				deleted = true
				continue
			}
			rows = append(rows, row)
		}
		if deleted {
			if runtimeErr := service.saveMCPServerSettings(ctx, rows); runtimeErr != nil {
				return nil, runtimeErr
			}
		}
		return mcpServerDeleteDTO{ServerID: serverID, Deleted: deleted}, nil
	})
}

func (service *Service) loadMCPServerSettings(ctx context.Context) ([]mcpServerSettingsRow, *core.RuntimeError) {
	raw, ok, err := service.store.GetSetting(ctx, mcpServersSettingKey)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || len(raw) == 0 {
		return []mcpServerSettingsRow{}, nil
	}
	rows, runtimeErr := decodeMCPServerSettings(raw)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	normalized, runtimeErr := normalizeMCPServerSettingsRows(rows, nil, time.Now().UTC())
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	return normalized, nil
}

func (service *Service) saveMCPServerSettings(ctx context.Context, rows []mcpServerSettingsRow) *core.RuntimeError {
	document := mcpServersSettingsDocument{MCPServers: rows}
	raw, err := json.Marshal(document)
	if err != nil {
		return handlerError(err)
	}
	if err := service.store.PutSetting(ctx, mcpServersSettingKey, raw, time.Now().UTC()); err != nil {
		return handlerError(err)
	}
	return nil
}

func decodeMCPServerSettings(raw json.RawMessage) ([]mcpServerSettingsRow, *core.RuntimeError) {
	var rows []mcpServerSettingsRow
	if err := json.Unmarshal(raw, &rows); err == nil {
		return rows, nil
	}
	var document mcpServersSettingsDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, handlerError(err)
	}
	return document.MCPServers, nil
}

func normalizeMCPServerSettingsRows(rows []mcpServerSettingsRow, existing []mcpServerSettingsRow, now time.Time) ([]mcpServerSettingsRow, *core.RuntimeError) {
	existingByID := map[string]mcpServerSettingsRow{}
	for _, row := range existing {
		id := strings.TrimSpace(row.ID)
		if id != "" {
			existingByID[id] = row
		}
	}
	seen := map[string]bool{}
	result := make([]mcpServerSettingsRow, 0, len(rows))
	for _, row := range rows {
		normalized, runtimeErr := normalizeMCPServerSettingsRow(row, existingByID[strings.TrimSpace(row.ID)], now)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if seen[normalized.ID] {
			return nil, invalidParams("mcp server ids must be unique")
		}
		seen[normalized.ID] = true
		result = append(result, normalized)
	}
	return result, nil
}

func normalizeMCPServerSettingsRow(row mcpServerSettingsRow, existing mcpServerSettingsRow, now time.Time) (mcpServerSettingsRow, *core.RuntimeError) {
	normalized := mcpServerSettingsRow{
		ID:            strings.TrimSpace(row.ID),
		Name:          strings.TrimSpace(row.Name),
		Enabled:       row.Enabled,
		TransportType: strings.TrimSpace(row.TransportType),
		PresetID:      strings.TrimSpace(row.PresetID),
		LastTested:    strings.TrimSpace(row.LastTested),
		HealthStatus:  strings.TrimSpace(row.HealthStatus),
		CreatedAt:     strings.TrimSpace(row.CreatedAt),
		UpdatedAt:     strings.TrimSpace(row.UpdatedAt),
	}
	if runtimeErr := validateMCPServerID(normalized.ID); runtimeErr != nil {
		return mcpServerSettingsRow{}, runtimeErr
	}
	if runtimeErr := validateMCPText("name", normalized.Name, 120, true); runtimeErr != nil {
		return mcpServerSettingsRow{}, runtimeErr
	}
	if runtimeErr := validateMCPText("presetId", normalized.PresetID, 120, false); runtimeErr != nil {
		return mcpServerSettingsRow{}, runtimeErr
	}
	if normalized.HealthStatus == "" {
		normalized.HealthStatus = "unknown"
	}
	switch normalized.HealthStatus {
	case "unknown", "healthy", "unhealthy", "needs_auth":
	default:
		return mcpServerSettingsRow{}, invalidParams("healthStatus is invalid")
	}
	if normalized.CreatedAt == "" {
		normalized.CreatedAt = strings.TrimSpace(existing.CreatedAt)
	}
	if normalized.CreatedAt == "" {
		normalized.CreatedAt = now.Format(time.RFC3339Nano)
	}
	if normalized.UpdatedAt == "" {
		normalized.UpdatedAt = now.Format(time.RFC3339Nano)
	}
	for field, value := range map[string]string{"createdAt": normalized.CreatedAt, "updatedAt": normalized.UpdatedAt, "lastTested": normalized.LastTested} {
		if value == "" {
			continue
		}
		if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
			return mcpServerSettingsRow{}, invalidParams(field + " must be an ISO timestamp")
		}
	}

	switch normalized.TransportType {
	case "http":
		urlValue := strings.TrimSpace(row.URL)
		if runtimeErr := validateMCPHTTPURL(urlValue); runtimeErr != nil {
			return mcpServerSettingsRow{}, runtimeErr
		}
		normalized.URL = urlValue
		normalized.Headers = compactStringMap(row.Headers)
		tokens, runtimeErr := normalizeMCPOAuthTokens(row.OAuthTokens)
		if runtimeErr != nil {
			return mcpServerSettingsRow{}, runtimeErr
		}
		normalized.OAuthTokens = tokens
	case "stdio":
		command := strings.TrimSpace(row.Command)
		if runtimeErr := validateMCPText("command", command, 512, true); runtimeErr != nil {
			return mcpServerSettingsRow{}, runtimeErr
		}
		normalized.Command = command
		normalized.Args = compactStringSlice(row.Args)
		normalized.EnvVars = compactStringMap(row.EnvVars)
		normalized.Cwd = strings.TrimSpace(row.Cwd)
		if runtimeErr := validateMCPText("cwd", normalized.Cwd, 2048, false); runtimeErr != nil {
			return mcpServerSettingsRow{}, runtimeErr
		}
	default:
		return mcpServerSettingsRow{}, invalidParams("transportType must be http or stdio")
	}
	return normalized, nil
}

func validateMCPServerID(id string) *core.RuntimeError {
	if runtimeErr := validateMCPText("serverId", id, 128, true); runtimeErr != nil {
		return runtimeErr
	}
	for _, char := range id {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' || char == ':' || char == '.' {
			continue
		}
		return invalidParams("serverId is invalid")
	}
	return nil
}

func validateMCPText(field string, value string, maxLength int, required bool) *core.RuntimeError {
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

func validateMCPHTTPURL(value string) *core.RuntimeError {
	if runtimeErr := validateMCPText("url", value, 2048, true); runtimeErr != nil {
		return runtimeErr
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return invalidParams("url is invalid")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return invalidParams("url must use http or https")
	}
	return nil
}

func normalizeMCPOAuthTokens(tokens *mcpOAuthTokens) (*mcpOAuthTokens, *core.RuntimeError) {
	if tokens == nil {
		return nil, nil
	}
	normalized := &mcpOAuthTokens{
		AccessToken:  strings.TrimSpace(tokens.AccessToken),
		RefreshToken: strings.TrimSpace(tokens.RefreshToken),
		ClientID:     strings.TrimSpace(tokens.ClientID),
		ExpiresAt:    strings.TrimSpace(tokens.ExpiresAt),
		TokenType:    strings.TrimSpace(tokens.TokenType),
	}
	if normalized.AccessToken == "" && normalized.RefreshToken == "" && normalized.ClientID == "" && normalized.ExpiresAt == "" && normalized.TokenType == "" {
		return nil, nil
	}
	if normalized.TokenType == "" {
		normalized.TokenType = "Bearer"
	}
	if runtimeErr := validateMCPText("oauthTokens.tokenType", normalized.TokenType, 64, true); runtimeErr != nil {
		return nil, runtimeErr
	}
	if runtimeErr := validateMCPText("oauthTokens.clientId", normalized.ClientID, 512, false); runtimeErr != nil {
		return nil, runtimeErr
	}
	if normalized.ExpiresAt != "" {
		if _, err := time.Parse(time.RFC3339Nano, normalized.ExpiresAt); err != nil {
			return nil, invalidParams("oauthTokens.expiresAt must be an ISO timestamp")
		}
	}
	return normalized, nil
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return map[string]string{}
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		if strings.TrimSpace(key) == "" {
			continue
		}
		result[key] = value
	}
	return result
}

func compactStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := map[string]string{}
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" || strings.ContainsAny(trimmedKey, "\x00\r\n") {
			continue
		}
		result[trimmedKey] = value
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func compactStringSlice(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	return result
}
