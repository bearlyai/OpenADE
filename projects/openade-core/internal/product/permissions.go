package product

import (
	"fmt"
	"strings"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

const PermissionProfilePaired = "paired"

func PairedClientPermissions() []string {
	permissions := append([]string(nil), openADEPermissionProfilePairedPermissions...)
	for _, notificationPermission := range openADEPermissionProfilePairedNotificationPermissions {
		permissions = append(permissions, "notify:"+notificationPermission)
	}
	return permissions
}

func ApplyPermissionProfile(cfg core.Config) (core.Config, error) {
	profile := strings.TrimSpace(cfg.PermissionProfile)
	if profile == "" || profile == "trusted" {
		return cfg, nil
	}
	if profile != PermissionProfilePaired {
		return cfg, fmt.Errorf("unknown OpenADE Core permission profile %q", profile)
	}
	if len(cfg.Permissions) == 0 {
		cfg.Permissions = PairedClientPermissions()
	}
	return cfg, nil
}
