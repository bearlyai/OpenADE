package product

import (
	"fmt"
	"strings"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

const PermissionProfilePaired = "paired"

var pairedClientPermissions = []string{
	"initialize",
	"server/status/read",
	"subscription/update",
	"remote/device/selfRevoke",
	"openade/snapshot/read",
	"openade/project/list",
	"openade/project/files/tree",
	"openade/project/file/read",
	"openade/project/files/fuzzySearch",
	"openade/project/search",
	"openade/project/git/info/read",
	"openade/project/git/branches/read",
	"openade/project/git/summary/read",
	"openade/project/process/list",
	"openade/project/process/reconnect",
	"openade/cron/definitions/read",
	"openade/task/list",
	"openade/task/read",
	"openade/task/create",
	"openade/task/metadata/update",
	"openade/task/delete",
	"openade/task/resourceInventory/read",
	"openade/task/image/read",
	"openade/task/changes/read",
	"openade/task/diff/read",
	"openade/task/filePair/read",
	"openade/task/git/summary/read",
	"openade/task/git/scopes/read",
	"openade/task/git/log",
	"openade/task/git/commit/files/read",
	"openade/task/git/fileAtTreeish/read",
	"openade/task/git/commit/filePatch/read",
	"openade/task/snapshot/patch/read",
	"openade/task/snapshot/index/read",
	"openade/task/snapshot/patch/readSlice",
	"openade/turn/start",
	"openade/turn/interrupt",
	"openade/review/start",
	"openade/queued-turn/enqueue",
	"openade/queued-turn/reorder",
	"openade/queued-turn/cancel",
	"openade/comment/create",
	"openade/comment/edit",
	"openade/comment/delete",
	"notify:connection/*",
	"notify:remote/device/changed",
	"notify:openade/*",
}

func PairedClientPermissions() []string {
	return append([]string(nil), pairedClientPermissions...)
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
