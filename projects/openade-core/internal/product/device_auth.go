package product

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

func HashBearerToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func ConfigureDeviceAuthentication(server *core.HTTPServer, store *storage.Store) {
	server.AuthenticateBearer = func(ctx context.Context, token string) (core.ConnectionAuth, bool) {
		if strings.TrimSpace(token) == "" {
			return core.ConnectionAuth{}, false
		}
		device, ok, err := store.GetDeviceByTokenHash(ctx, HashBearerToken(token))
		if err != nil || !ok || device.RevokedAt.Valid {
			return core.ConnectionAuth{}, false
		}
		permissions := PairedClientPermissions()
		if device.PermissionsJSON.Valid {
			var configured []string
			if err := json.Unmarshal([]byte(device.PermissionsJSON.String), &configured); err == nil && len(configured) > 0 {
				permissions = normalizePermissions(configured)
			}
		}
		_ = store.TouchDeviceLastSeen(ctx, device.ID, time.Now().UTC())
		return core.ConnectionAuth{Permissions: permissions, DeviceID: device.ID}, true
	}
}

func normalizePermissions(values []string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		permission := strings.TrimSpace(value)
		if permission == "" || seen[permission] {
			continue
		}
		seen[permission] = true
		result = append(result, permission)
	}
	return result
}

func permissionsJSON(values []string) sql.NullString {
	normalized := normalizePermissions(values)
	if len(normalized) == 0 {
		return sql.NullString{}
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return sql.NullString{}
	}
	return sql.NullString{String: string(raw), Valid: true}
}
