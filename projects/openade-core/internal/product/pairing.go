package product

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

const (
	pairingTTL              = 2 * time.Minute
	pairingTokenBytes       = 32
	openadeCoreHostIDKey    = "openade_core_host_id"
	openadeCoreHostIDPrefix = "core-"
)

type pairingSession struct {
	tokenHash string
	payload   pairingPayloadDTO
	expiresAt time.Time
}

type remotePairingStartParams struct {
	BaseURL string `json:"baseUrl"`
	HostID  string `json:"hostId,omitempty"`
}

type pairingPayloadDTO struct {
	URL       string `json:"url"`
	Token     string `json:"token"`
	HostID    string `json:"hostId"`
	ExpiresAt string `json:"expiresAt"`
}

type pairDeviceResultDTO struct {
	Device      remoteDeviceDTO `json:"device"`
	DeviceToken string          `json:"deviceToken"`
}

func (service *Service) ConfigurePairing(server *core.HTTPServer) {
	server.PairDevice = service.pairDevice
}

func (service *Service) handleRemotePairingStart(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params remotePairingStartParams
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	baseURL, runtimeErr := normalizePairingBaseURL(params.BaseURL)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	hostID, runtimeErr := service.pairingHostID(ctx, params.HostID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	token, err := createPairingToken()
	if err != nil {
		return nil, handlerError(err)
	}
	expiresAt := time.Now().UTC().Add(pairingTTL)
	payload := pairingPayloadDTO{
		URL:       baseURL,
		Token:     token,
		HostID:    hostID,
		ExpiresAt: formatTime(expiresAt),
	}

	service.pairingMu.Lock()
	service.pairing = &pairingSession{
		tokenHash: HashBearerToken(token),
		payload:   payload,
		expiresAt: expiresAt,
	}
	service.pairingMu.Unlock()

	return payload, nil
}

func (service *Service) pairDevice(ctx context.Context, request core.PairDeviceRequest) (core.JSONPayload, *core.RuntimeError) {
	token := strings.TrimSpace(request.Token)
	deviceName := strings.TrimSpace(request.DeviceName)
	platform, runtimeErr := normalizePairingPlatform(request.Platform)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if len(token) < 16 {
		return nil, invalidParams("Pairing token is invalid or expired")
	}
	if len(deviceName) < 1 || len(deviceName) > 120 {
		return nil, invalidParams("deviceName is invalid")
	}

	now := time.Now().UTC()
	service.pairingMu.Lock()
	session := service.pairing
	if session != nil && !session.expiresAt.After(now) {
		service.pairing = nil
		session = nil
	}
	if session == nil || !pairingTokenMatches(session.tokenHash, token) {
		service.pairingMu.Unlock()
		return nil, invalidParams("Pairing token is invalid or expired")
	}
	service.pairing = nil
	service.pairingMu.Unlock()

	deviceToken, err := createPairingToken()
	if err != nil {
		return nil, handlerError(err)
	}
	device := storage.Device{
		ID:         "device-" + randomHexID() + randomHexID(),
		Label:      deviceName,
		Platform:   platform,
		TokenHash:  sql.NullString{String: HashBearerToken(deviceToken), Valid: true},
		CreatedAt:  now,
		UpdatedAt:  now,
		LastSeenAt: sql.NullTime{Time: now, Valid: true},
	}
	if err := service.store.UpsertDevice(ctx, device); err != nil {
		return nil, handlerError(err)
	}
	service.notifyRemoteDevicesChanged()
	return pairDeviceResultDTO{Device: remoteDeviceToDTO(device), DeviceToken: deviceToken}, nil
}

func (service *Service) pairingHostID(ctx context.Context, requestedHostID string) (string, *core.RuntimeError) {
	if hostID := strings.TrimSpace(requestedHostID); hostID != "" {
		return hostID, nil
	}
	raw, ok, err := service.store.GetSetting(ctx, openadeCoreHostIDKey)
	if err != nil {
		return "", handlerError(err)
	}
	if ok {
		var stored string
		if err := json.Unmarshal(raw, &stored); err != nil {
			return "", handlerError(err)
		}
		if hostID := strings.TrimSpace(stored); hostID != "" {
			return hostID, nil
		}
	}
	hostID := openadeCoreHostIDPrefix + randomHexID() + randomHexID()
	encoded, err := json.Marshal(hostID)
	if err != nil {
		return "", handlerError(err)
	}
	if err := service.store.PutSetting(ctx, openadeCoreHostIDKey, json.RawMessage(encoded), time.Now().UTC()); err != nil {
		return "", handlerError(err)
	}
	return hostID, nil
}

func normalizePairingBaseURL(value string) (string, *core.RuntimeError) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", invalidParams("baseUrl is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", invalidParams("baseUrl must be an HTTP or HTTPS URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", invalidParams("baseUrl must use HTTP or HTTPS")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func normalizePairingPlatform(value string) (string, *core.RuntimeError) {
	platform := strings.TrimSpace(value)
	if platform == "" {
		return "unknown", nil
	}
	switch platform {
	case "ios", "android", "web", "unknown":
		return platform, nil
	default:
		return "", invalidParams("platform is invalid")
	}
}

func pairingTokenMatches(expectedHash string, token string) bool {
	actualHash := HashBearerToken(token)
	if len(expectedHash) != len(actualHash) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expectedHash), []byte(actualHash)) == 1
}

func createPairingToken() (string, error) {
	data := make([]byte, pairingTokenBytes)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}
