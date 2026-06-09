package product

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

type remoteDeviceDTO struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Platform   string `json:"platform"`
	PairedAt   string `json:"pairedAt"`
	LastSeenAt string `json:"lastSeenAt,omitempty"`
	RevokedAt  string `json:"revokedAt,omitempty"`
}

type remoteDeviceListDTO struct {
	Devices []remoteDeviceDTO `json:"devices"`
}

type remoteDeviceRevokeDTO struct {
	OK      bool              `json:"ok"`
	Revoked bool              `json:"revoked"`
	Devices []remoteDeviceDTO `json:"devices"`
}

type remoteDeviceDropAllDTO struct {
	OK      bool              `json:"ok"`
	Devices []remoteDeviceDTO `json:"devices"`
}

type remoteDeviceSelfRevokeDTO struct {
	OK      bool `json:"ok"`
	Revoked bool `json:"revoked"`
}

type remoteDeviceChangedNotificationDTO struct {
	Type string `json:"type"`
	At   string `json:"at"`
}

func (service *Service) handleRemoteDeviceList(ctx context.Context, _ *core.Connection, _ json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	devices, runtimeErr := service.remoteDevices(ctx)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	return remoteDeviceListDTO{Devices: devices}, nil
}

func (service *Service) handleRemoteDeviceRevoke(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		DeviceID string `json:"deviceId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if strings.TrimSpace(params.DeviceID) == "" {
		return nil, invalidParams("deviceId is required")
	}
	revoked, err := service.store.RevokeDevice(ctx, params.DeviceID, time.Now().UTC())
	if err != nil {
		return nil, handlerError(err)
	}
	devices, runtimeErr := service.remoteDevices(ctx)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if revoked {
		service.runtime.CloseDeviceConnections(params.DeviceID, "device revoked")
		service.notifyRemoteDevicesChanged()
	}
	return remoteDeviceRevokeDTO{OK: true, Revoked: revoked, Devices: devices}, nil
}

func (service *Service) handleRemoteDeviceDropAll(ctx context.Context, _ *core.Connection, _ json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	changed, err := service.store.RevokeAllDevices(ctx, time.Now().UTC())
	if err != nil {
		return nil, handlerError(err)
	}
	devices, runtimeErr := service.remoteDevices(ctx)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if changed > 0 {
		service.runtime.CloseDeviceConnections("", "device revoked")
		service.notifyRemoteDevicesChanged()
	}
	return remoteDeviceDropAllDTO{OK: true, Devices: devices}, nil
}

func (service *Service) handleRemoteDeviceSelfRevoke(ctx context.Context, conn *core.Connection, _ json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	deviceID := conn.DeviceID()
	if deviceID == "" {
		return nil, &core.RuntimeError{Code: "permission_denied", Message: "Self revoke is only available to paired remote devices"}
	}
	revoked, err := service.store.RevokeDevice(ctx, deviceID, time.Now().UTC())
	if err != nil {
		return nil, handlerError(err)
	}
	if revoked {
		service.runtime.CloseDeviceConnectionsExcept(deviceID, conn, "device revoked")
		conn.CloseAfterResponse("device revoked")
		service.notifyRemoteDevicesChanged()
	}
	return remoteDeviceSelfRevokeDTO{OK: true, Revoked: revoked}, nil
}

func (service *Service) remoteDevices(ctx context.Context) ([]remoteDeviceDTO, *core.RuntimeError) {
	devices, err := service.store.ListDevices(ctx)
	if err != nil {
		return nil, handlerError(err)
	}
	result := make([]remoteDeviceDTO, 0, len(devices))
	for _, device := range devices {
		result = append(result, remoteDeviceToDTO(device))
	}
	return result, nil
}

func remoteDeviceToDTO(device storage.Device) remoteDeviceDTO {
	dto := remoteDeviceDTO{
		ID:       device.ID,
		Name:     device.Label,
		Platform: device.Platform,
		PairedAt: formatTime(device.CreatedAt),
	}
	if device.LastSeenAt.Valid {
		dto.LastSeenAt = formatTime(device.LastSeenAt.Time)
	} else if !device.UpdatedAt.IsZero() {
		dto.LastSeenAt = formatTime(device.UpdatedAt)
	}
	if device.RevokedAt.Valid {
		dto.RevokedAt = formatTime(device.RevokedAt.Time)
	}
	return dto
}

func (service *Service) notifyRemoteDevicesChanged() {
	service.runtime.Notify("remote/device/changed", remoteDeviceChangedNotificationDTO{
		Type: "devices_changed",
		At:   formatTime(time.Now().UTC()),
	})
}
