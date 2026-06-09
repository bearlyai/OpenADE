package product_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/product"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

const (
	runtimeHarnessReadLimit = 4 << 20
	snapshotReadBudget      = 250 * time.Millisecond
	boundedTaskReadBudget   = 200 * time.Millisecond
	gitSummaryReadBudget    = 750 * time.Millisecond
	processListReadBudget   = 500 * time.Millisecond
	fuzzySearchReadBudget   = 500 * time.Millisecond
	runtimeOutputReadLimit  = 20
)

type runtimeHarness struct {
	store           *storage.Store
	runtime         *core.Runtime
	productService  *product.Service
	httpServer      *httptest.Server
	conn            *websocket.Conn
	notifications   []map[string]any
	blobDir         string
	worktreeBaseDir string
}

func newRuntimeHarness(t *testing.T) *runtimeHarness {
	return newRuntimeHarnessWithStoreSetup(t, nil)
}

func newRuntimeHarnessWithStoreSetup(t *testing.T, setup func(context.Context, *storage.Store)) *runtimeHarness {
	return newRuntimeHarnessWithStoreSetupAndOptions(t, setup, nil)
}

func newRuntimeHarnessWithProductOptions(t *testing.T, configure func(*product.Options)) *runtimeHarness {
	return newRuntimeHarnessWithStoreSetupAndOptions(t, nil, configure)
}

func newRuntimeHarnessWithStoreSetupAndOptions(t *testing.T, setup func(context.Context, *storage.Store), configure func(*product.Options)) *runtimeHarness {
	return newRuntimeHarnessWithConfigStoreSetupAndOptions(t, nil, setup, configure)
}

func newRuntimeHarnessWithConfig(t *testing.T, configureConfig func(*core.Config)) *runtimeHarness {
	return newRuntimeHarnessWithConfigStoreSetupAndOptions(t, configureConfig, nil, nil)
}

func newRuntimeHarnessWithConfigStoreSetupAndOptions(t *testing.T, configureConfig func(*core.Config), setup func(context.Context, *storage.Store), configure func(*product.Options)) *runtimeHarness {
	t.Helper()
	ctx := context.Background()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "openade.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if setup != nil {
		setup(ctx, store)
	}
	cfg := core.DefaultConfig()
	cfg.Token = "test-token"
	cfg.ServerVersion = "test-version"
	if configureConfig != nil {
		configureConfig(&cfg)
	}
	blobDir := filepath.Join(t.TempDir(), "blobs")
	worktreeBaseDir := filepath.Join(t.TempDir(), "worktrees")
	processOutputDir := filepath.Join(t.TempDir(), "process-output")
	httpHandler := core.NewHTTPServer(cfg, slog.New(slog.NewTextHandler(&strings.Builder{}, nil)))
	product.ConfigureDeviceAuthentication(httpHandler, store)
	options := product.Options{
		Version:          "test-version",
		HostName:         "test-host",
		BlobDir:          blobDir,
		WorktreeBaseDir:  worktreeBaseDir,
		ProcessOutputDir: processOutputDir,
	}
	if configure != nil {
		configure(&options)
	}
	productService := product.Register(httpHandler.Runtime, store, options)
	productService.ConfigurePairing(httpHandler)
	httpServer := httptest.NewServer(httpHandler)
	conn, _, err := websocket.Dial(ctx, websocketURL(httpServer.URL, cfg.RuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer.test-token"},
	})
	if err != nil {
		httpServer.Close()
		_ = store.Close()
		t.Fatalf("dial runtime websocket: %v", err)
	}
	conn.SetReadLimit(runtimeHarnessReadLimit)

	harness := &runtimeHarness{store: store, runtime: httpHandler.Runtime, productService: productService, httpServer: httpServer, conn: conn, blobDir: blobDir, worktreeBaseDir: worktreeBaseDir}
	t.Cleanup(func() {
		_ = conn.Close(websocket.StatusNormalClosure, "")
		httpServer.Close()
		if err := store.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	response := harness.request(t, "initialize", map[string]any{
		"protocolVersion": core.DefaultProtocolVersion,
	})
	result := resultObject(t, response)
	capabilities := objectField(t, result, "capabilities")
	methods := stringSet(arrayField(t, capabilities, "methods"))
	if len(cfg.Permissions) > 0 {
		return harness
	}
	for _, method := range []string{
		"runtime/list",
		"runtime/read",
		"runtime/reconcile",
		"runtime/stop",
		"remote/pairing/start",
		"remote/device/list",
		"remote/device/revoke",
		"remote/device/dropAll",
		"remote/device/selfRevoke",
		"openade/import/legacyResources",
		"openade/settings/mcpServers/read",
		"openade/settings/mcpServers/replace",
		"openade/settings/mcpServers/upsert",
		"openade/settings/mcpServers/delete",
		"openade/settings/personal/read",
		"openade/settings/personal/replace",
		"openade/snapshot/read",
		"openade/project/list",
		"openade/project/files/tree",
		"openade/project/file/read",
		"openade/project/file/write",
		"openade/project/files/fuzzySearch",
		"openade/project/search",
		"openade/project/git/info/read",
		"openade/project/git/branches/read",
		"openade/project/git/summary/read",
		"openade/task/git/summary/read",
		"openade/task/git/scopes/read",
		"openade/task/changes/read",
		"openade/task/diff/read",
		"openade/task/filePair/read",
		"openade/task/git/log",
		"openade/task/git/commit/files/read",
		"openade/task/git/fileAtTreeish/read",
		"openade/task/git/commit/filePatch/read",
		"openade/task/git/commit",
		"openade/project/process/list",
		"openade/project/process/start",
		"openade/project/process/reconnect",
		"openade/project/process/stop",
		"openade/cron/installState/read",
		"openade/cron/installState/replace",
		"openade/task/terminal/start",
		"openade/task/terminal/reconnect",
		"openade/task/terminal/write",
		"openade/task/terminal/resize",
		"openade/task/terminal/stop",
		"openade/task/resourceInventory/read",
		"openade/task/image/read",
		"openade/task/image/staged/read",
		"openade/task/image/write",
		"openade/task/image/importLegacy",
		"openade/task/images/importLegacy",
		"openade/task/images/gcStaged",
		"openade/task/snapshot/patch/read",
		"openade/task/snapshot/index/read",
		"openade/task/snapshot/patch/readSlice",
		"openade/task/snapshots/importLegacy",
		"openade/snapshot/create",
		"openade/task/list",
		"openade/task/read",
		"openade/task/create",
		"openade/task/metadata/update",
		"openade/task/usage/recalculate",
		"openade/task/usage/backfill",
		"openade/task/title/generate",
		"openade/task/environment/setup",
		"openade/task/environment/prepare",
		"openade/turn/start",
		"openade/turn/interrupt",
		"openade/review/start",
		"openade/repo/create",
		"openade/repo/update",
		"openade/repo/delete",
		"openade/comment/create",
		"openade/comment/edit",
		"openade/comment/delete",
		"openade/task/delete",
		"openade/action/create",
		"openade/action/stream/append",
		"openade/action/complete",
		"openade/action/error",
		"openade/action/stopped",
		"openade/action/reconcileRuntime",
		"openade/action/execution/update",
		"openade/hyperplan/subExecution/add",
		"openade/hyperplan/subExecution/stream/append",
		"openade/hyperplan/subExecution/update",
		"openade/hyperplan/reconcileLabels/set",
		"openade/queued-turn/enqueue",
		"openade/queued-turn/importLegacy",
		"openade/queued-turn/reorder",
		"openade/queued-turn/cancel",
	} {
		if !methods[method] {
			t.Fatalf("initialize capabilities missing %s: %#v", method, methods)
		}
	}

	return harness
}

func TestProductPairedPermissionProfile(t *testing.T) {
	cfg := core.DefaultConfig()
	cfg.PermissionProfile = product.PermissionProfilePaired
	applied, err := product.ApplyPermissionProfile(cfg)
	if err != nil {
		t.Fatalf("apply paired profile: %v", err)
	}
	permissions := stringSliceSet(applied.Permissions)
	for _, permission := range []string{
		"initialize",
		"server/status/read",
		"subscription/update",
		"remote/device/selfRevoke",
		"openade/task/read",
		"openade/turn/start",
		"notify:remote/device/changed",
		"notify:openade/*",
	} {
		if !permissions[permission] {
			t.Fatalf("paired profile missing %s: %#v", permission, applied.Permissions)
		}
	}
	for _, permission := range []string{
		"openade/project/file/write",
		"openade/task/git/commit",
		"openade/task/usage/recalculate",
		"openade/task/usage/backfill",
		"openade/task/terminal/start",
		"openade/task/image/staged/read",
		"openade/task/images/gcStaged",
		"openade/queued-turn/importLegacy",
		"openade/action/create",
		"openade/import/legacyResources",
		"openade/cron/installState/read",
		"openade/cron/installState/replace",
		"openade/settings/mcpServers/read",
		"openade/settings/mcpServers/replace",
		"openade/settings/mcpServers/upsert",
		"openade/settings/mcpServers/delete",
		"openade/settings/personal/read",
		"openade/settings/personal/replace",
		"remote/device/list",
		"remote/device/revoke",
		"remote/device/dropAll",
		"remote/pairing/start",
		"data/yjs/read",
		"notify:pty/*",
		"notify:process/*",
		"notify:runtime/*",
	} {
		if permissions[permission] {
			t.Fatalf("paired profile unexpectedly grants %s: %#v", permission, applied.Permissions)
		}
	}

	explicit := core.DefaultConfig()
	explicit.PermissionProfile = product.PermissionProfilePaired
	explicit.Permissions = []string{"initialize"}
	appliedExplicit, err := product.ApplyPermissionProfile(explicit)
	if err != nil {
		t.Fatalf("apply paired profile with explicit permissions: %v", err)
	}
	if len(appliedExplicit.Permissions) != 1 || appliedExplicit.Permissions[0] != "initialize" {
		t.Fatalf("explicit permissions should override profile defaults: %#v", appliedExplicit.Permissions)
	}

	unknown := core.DefaultConfig()
	unknown.PermissionProfile = "unknown"
	if _, err := product.ApplyPermissionProfile(unknown); err == nil {
		t.Fatal("unknown permission profile should fail")
	}
}

func TestProductRemoteDeviceAdminOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertDevice(ctx, storage.Device{
		ID:        "device-admin-1",
		Label:     "iPhone",
		Platform:  "mobile",
		TokenHash: sql.NullString{String: product.HashBearerToken("device-token-1"), Valid: true},
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert first device: %v", err)
	}
	if err := harness.store.UpsertDevice(ctx, storage.Device{
		ID:        "device-admin-2",
		Label:     "Browser",
		Platform:  "web",
		TokenHash: sql.NullString{String: product.HashBearerToken("device-token-2"), Valid: true},
		CreatedAt: now.Add(time.Minute),
		UpdatedAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("upsert second device: %v", err)
	}

	listed := resultObject(t, harness.request(t, "remote/device/list", nil))
	devices := arrayField(t, listed, "devices")
	if len(devices) != 2 {
		t.Fatalf("listed devices = %#v", devices)
	}

	notificationStart := len(harness.notifications)
	revoked := resultObject(t, harness.request(t, "remote/device/revoke", map[string]any{"deviceId": "device-admin-1"}))
	if revoked["revoked"] != true {
		t.Fatalf("revoke result = %#v", revoked)
	}
	harness.waitForNotification(t, notificationStart, "remote/device/changed")
	revokedDevices := arrayField(t, revoked, "devices")
	device := deviceByID(t, revokedDevices, "device-admin-1")
	if device["revokedAt"] == "" {
		t.Fatalf("revoked device missing revokedAt = %#v", device)
	}
	revokedAgain := resultObject(t, harness.request(t, "remote/device/revoke", map[string]any{"deviceId": "device-admin-1"}))
	if revokedAgain["revoked"] != false {
		t.Fatalf("second revoke = %#v", revokedAgain)
	}

	dropAll := resultObject(t, harness.request(t, "remote/device/dropAll", nil))
	for _, value := range arrayField(t, dropAll, "devices") {
		device := objectValue(t, value)
		if device["revokedAt"] == "" {
			t.Fatalf("drop all left active device = %#v", device)
		}
	}
	invalid := harness.request(t, "remote/device/revoke", map[string]any{})
	if runtimeErrorCode(t, invalid) != "invalid_params" {
		t.Fatalf("invalid revoke = %#v", invalid)
	}
}

func TestProductRemoteDeviceRevocationClosesLiveRuntimeConnections(t *testing.T) {
	firstToken := "live-device-token-1"
	secondToken := "live-device-token-2"
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		now := time.Date(2026, 6, 8, 10, 30, 0, 0, time.UTC)
		for _, device := range []struct {
			id    string
			label string
			token string
		}{
			{id: "live-device-1", label: "Live Phone", token: firstToken},
			{id: "live-device-2", label: "Live Browser", token: secondToken},
		} {
			if err := store.UpsertDevice(ctx, storage.Device{
				ID:        device.id,
				Label:     device.label,
				Platform:  "web",
				TokenHash: sql.NullString{String: product.HashBearerToken(device.token), Valid: true},
				CreatedAt: now,
				UpdatedAt: now,
			}); err != nil {
				t.Fatalf("upsert %s: %v", device.id, err)
			}
		}
	})

	firstConn, firstResponse, err := websocket.Dial(context.Background(), websocketURL(harness.httpServer.URL, core.DefaultRuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer." + firstToken},
	})
	if err != nil {
		t.Fatalf("dial first paired device response=%#v: %v", firstResponse, err)
	}
	defer firstConn.Close(websocket.StatusNormalClosure, "")
	secondConn, secondResponse, err := websocket.Dial(context.Background(), websocketURL(harness.httpServer.URL, core.DefaultRuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer." + secondToken},
	})
	if err != nil {
		t.Fatalf("dial second paired device response=%#v: %v", secondResponse, err)
	}
	defer secondConn.Close(websocket.StatusNormalClosure, "")

	resultObject(t, requestOnConn(t, firstConn, "initialize", map[string]any{"protocolVersion": core.DefaultProtocolVersion}))
	resultObject(t, requestOnConn(t, secondConn, "initialize", map[string]any{"protocolVersion": core.DefaultProtocolVersion}))

	revoked := resultObject(t, harness.request(t, "remote/device/revoke", map[string]any{"deviceId": "live-device-1"}))
	if revoked["revoked"] != true {
		t.Fatalf("revoke live device = %#v", revoked)
	}
	expectRuntimeSocketClosed(t, firstConn)
	resultObject(t, requestOnConn(t, secondConn, "server/status/read", nil))

	resultObject(t, harness.request(t, "remote/device/dropAll", nil))
	expectRuntimeSocketClosed(t, secondConn)
}

func TestProductRemotePairingStartAndPairOverHTTP(t *testing.T) {
	harness := newRuntimeHarness(t)

	start := resultObject(t, harness.request(t, "remote/pairing/start", map[string]string{
		"baseUrl": harness.httpServer.URL + "/ignored-path",
	}))
	if start["url"] != harness.httpServer.URL {
		t.Fatalf("pairing url should normalize to origin: %#v", start)
	}
	token, ok := start["token"].(string)
	if !ok || len(token) < 16 {
		t.Fatalf("pairing token = %#v", start["token"])
	}
	hostID, ok := start["hostId"].(string)
	if !ok || !strings.HasPrefix(hostID, "core-") {
		t.Fatalf("pairing host id = %#v", start["hostId"])
	}
	expiresAt, ok := start["expiresAt"].(string)
	if !ok {
		t.Fatalf("pairing expiresAt = %#v", start["expiresAt"])
	}
	if _, err := time.Parse(time.RFC3339Nano, expiresAt); err != nil {
		t.Fatalf("parse pairing expiresAt %q: %v", expiresAt, err)
	}

	pairPage, err := http.Get(harness.httpServer.URL + "/pair?token=" + token)
	if err != nil {
		t.Fatalf("get pairing page: %v", err)
	}
	_ = pairPage.Body.Close()
	if pairPage.StatusCode != http.StatusOK {
		t.Fatalf("pairing page status = %d", pairPage.StatusCode)
	}

	pairBody, err := json.Marshal(map[string]string{
		"token":      token,
		"deviceName": "Test iPhone",
		"platform":   "ios",
	})
	if err != nil {
		t.Fatalf("marshal pair body: %v", err)
	}
	pairResponse, err := http.Post(harness.httpServer.URL+"/v1/pair", "application/json", bytes.NewReader(pairBody))
	if err != nil {
		t.Fatalf("post pair: %v", err)
	}
	defer pairResponse.Body.Close()
	if pairResponse.StatusCode != http.StatusOK {
		t.Fatalf("pair status = %d", pairResponse.StatusCode)
	}
	var paired struct {
		Device struct {
			ID         string `json:"id"`
			Name       string `json:"name"`
			Platform   string `json:"platform"`
			PairedAt   string `json:"pairedAt"`
			LastSeenAt string `json:"lastSeenAt"`
			RevokedAt  string `json:"revokedAt"`
		} `json:"device"`
		DeviceToken string `json:"deviceToken"`
	}
	if err := json.NewDecoder(pairResponse.Body).Decode(&paired); err != nil {
		t.Fatalf("decode pair response: %v", err)
	}
	if paired.Device.ID == "" || paired.Device.Name != "Test iPhone" || paired.Device.Platform != "ios" || paired.DeviceToken == "" {
		t.Fatalf("pair response = %#v", paired)
	}

	reusedResponse, err := http.Post(harness.httpServer.URL+"/v1/pair", "application/json", bytes.NewReader(pairBody))
	if err != nil {
		t.Fatalf("post reused pair: %v", err)
	}
	_ = reusedResponse.Body.Close()
	if reusedResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("reused pair status = %d", reusedResponse.StatusCode)
	}

	listed := resultObject(t, harness.request(t, "remote/device/list", nil))
	storedDevice := deviceByID(t, arrayField(t, listed, "devices"), paired.Device.ID)
	if storedDevice["name"] != "Test iPhone" || storedDevice["platform"] != "ios" || storedDevice["lastSeenAt"] == "" {
		t.Fatalf("paired device was not stored correctly: %#v", storedDevice)
	}

	pairedConn, pairedResponse, err := websocket.Dial(context.Background(), websocketURL(harness.httpServer.URL, core.DefaultRuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer." + paired.DeviceToken},
	})
	if err != nil {
		t.Fatalf("dial paired device websocket response=%#v: %v", pairedResponse, err)
	}
	defer pairedConn.Close(websocket.StatusNormalClosure, "")

	initialized := resultObject(t, requestOnConn(t, pairedConn, "initialize", map[string]any{"protocolVersion": core.DefaultProtocolVersion}))
	methods := stringSet(arrayField(t, objectField(t, initialized, "capabilities"), "methods"))
	if !methods["remote/device/selfRevoke"] || !methods["openade/task/read"] {
		t.Fatalf("paired capabilities missing safe methods: %#v", methods)
	}
	if methods["remote/pairing/start"] || methods["remote/device/list"] {
		t.Fatalf("paired capabilities expose trusted methods: %#v", methods)
	}
	denied := requestOnConn(t, pairedConn, "remote/pairing/start", map[string]string{"baseUrl": harness.httpServer.URL})
	if runtimeErrorCode(t, denied) != "permission_denied" {
		t.Fatalf("paired device should not start pairing: %#v", denied)
	}
}

func TestProductDeviceBearerTokenAuthenticatesPairedClientOverRuntime(t *testing.T) {
	deviceToken := "paired-device-token"
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		now := time.Date(2026, 6, 8, 11, 0, 0, 0, time.UTC)
		if err := store.UpsertDevice(ctx, storage.Device{
			ID:        "paired-device",
			Label:     "Paired Phone",
			Platform:  "mobile",
			TokenHash: sql.NullString{String: product.HashBearerToken(deviceToken), Valid: true},
			CreatedAt: now,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert paired device: %v", err)
		}
	})

	conn, response, err := websocket.Dial(context.Background(), websocketURL(harness.httpServer.URL, core.DefaultRuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer." + deviceToken},
	})
	if err != nil {
		t.Fatalf("dial paired device websocket response=%#v: %v", response, err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	siblingConn, siblingResponse, err := websocket.Dial(context.Background(), websocketURL(harness.httpServer.URL, core.DefaultRuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer." + deviceToken},
	})
	if err != nil {
		t.Fatalf("dial sibling paired device websocket response=%#v: %v", siblingResponse, err)
	}
	defer siblingConn.Close(websocket.StatusNormalClosure, "")

	initialized := resultObject(t, requestOnConn(t, conn, "initialize", map[string]any{"protocolVersion": core.DefaultProtocolVersion}))
	resultObject(t, requestOnConn(t, siblingConn, "initialize", map[string]any{"protocolVersion": core.DefaultProtocolVersion}))
	methods := stringSet(arrayField(t, objectField(t, initialized, "capabilities"), "methods"))
	if !methods["remote/device/selfRevoke"] || !methods["openade/task/read"] {
		t.Fatalf("paired device capabilities missing safe methods: %#v", methods)
	}
	for _, method := range []string{"remote/device/list", "remote/device/revoke", "openade/project/file/write", "openade/task/terminal/start"} {
		if methods[method] {
			t.Fatalf("paired device capabilities expose %s: %#v", method, methods)
		}
	}
	denied := requestOnConn(t, conn, "remote/device/list", nil)
	if runtimeErrorCode(t, denied) != "permission_denied" {
		t.Fatalf("paired device list should be denied: %#v", denied)
	}
	selfRevoked := resultObject(t, requestOnConn(t, conn, "remote/device/selfRevoke", nil))
	if selfRevoked["revoked"] != true {
		t.Fatalf("self revoke = %#v", selfRevoked)
	}
	refreshed, ok, err := harness.store.GetDeviceByTokenHash(context.Background(), product.HashBearerToken(deviceToken))
	if err != nil {
		t.Fatalf("get self revoked device: %v", err)
	}
	if !ok || !refreshed.RevokedAt.Valid || !refreshed.LastSeenAt.Valid {
		t.Fatalf("self revoked device = %#v ok=%v", refreshed, ok)
	}
	expectRuntimeSocketClosed(t, siblingConn)
	expectRuntimeSocketClosed(t, conn)

	_, reconnectResponse, reconnectErr := websocket.Dial(context.Background(), websocketURL(harness.httpServer.URL, core.DefaultRuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer." + deviceToken},
	})
	if reconnectErr == nil {
		t.Fatal("revoked device token should not reconnect")
	}
	if reconnectResponse == nil || reconnectResponse.StatusCode != 401 {
		t.Fatalf("revoked reconnect status = %#v err=%v", reconnectResponse, reconnectErr)
	}
}

func TestProductPairedPermissionProfileFiltersCapabilitiesOverRuntime(t *testing.T) {
	harness := newRuntimeHarnessWithConfig(t, func(cfg *core.Config) {
		cfg.PermissionProfile = product.PermissionProfilePaired
		applied, err := product.ApplyPermissionProfile(*cfg)
		if err != nil {
			t.Fatalf("apply paired profile: %v", err)
		}
		*cfg = applied
	})

	status := resultObject(t, harness.request(t, "server/status/read", nil))
	capabilities := objectField(t, status, "capabilities")
	methods := stringSet(arrayField(t, capabilities, "methods"))
	for _, method := range []string{
		"initialize",
		"server/status/read",
		"subscription/update",
		"remote/device/selfRevoke",
		"openade/snapshot/read",
		"openade/project/file/read",
		"openade/project/process/reconnect",
		"openade/task/read",
		"openade/task/create",
		"openade/turn/start",
		"openade/comment/create",
	} {
		if !methods[method] {
			t.Fatalf("paired capabilities missing %s: %#v", method, methods)
		}
	}
	for _, method := range []string{
		"openade/project/file/write",
		"openade/project/process/start",
		"openade/project/process/stop",
		"openade/task/git/commit",
		"openade/task/usage/backfill",
		"openade/task/terminal/start",
		"openade/task/image/staged/read",
		"openade/task/image/write",
		"openade/task/image/importLegacy",
		"openade/task/images/importLegacy",
		"openade/task/images/gcStaged",
		"openade/settings/mcpServers/read",
		"openade/settings/mcpServers/replace",
		"openade/settings/mcpServers/upsert",
		"openade/settings/mcpServers/delete",
		"openade/settings/personal/read",
		"openade/settings/personal/replace",
		"openade/cron/installState/read",
		"openade/cron/installState/replace",
		"openade/snapshot/create",
		"openade/action/create",
		"openade/hyperplan/subExecution/add",
		"openade/import/legacyResources",
		"remote/device/list",
		"remote/device/revoke",
		"remote/device/dropAll",
		"remote/pairing/start",
		"runtime/stop",
	} {
		if methods[method] {
			t.Fatalf("paired capabilities unexpectedly include %s: %#v", method, methods)
		}
	}

	notifications := stringSet(arrayField(t, capabilities, "notifications"))
	if !notifications["openade/task/updated"] || !notifications["openade/workingTasks"] {
		t.Fatalf("paired notification capabilities missing product updates: %#v", notifications)
	}
	if !notifications["remote/device/changed"] {
		t.Fatalf("paired notification capabilities missing device changes: %#v", notifications)
	}
	for _, notification := range []string{
		"runtime/created",
		"runtime/updated",
		"runtime/completed",
		"runtime/failed",
		"runtime/stopped",
		"pty/output",
		"process/output",
	} {
		if notifications[notification] {
			t.Fatalf("paired notification capabilities expose %s: %#v", notification, notifications)
		}
	}

	resultObject(t, harness.request(t, "openade/snapshot/read", map[string]any{}))
	denied := harness.request(t, "openade/project/file/write", map[string]any{})
	if runtimeErrorCode(t, denied) != "permission_denied" {
		t.Fatalf("file write should be permission denied: %#v", denied)
	}

	harness.runtime.Notify("openade/task/updated", map[string]string{"repoId": "repo-paired", "taskId": "task-paired"})
	notification := harness.readMessage(t, 2*time.Second)
	if notification["method"] != "openade/task/updated" {
		t.Fatalf("paired allowed notification = %#v", notification)
	}
	harness.runtime.Notify("runtime/completed", map[string]any{
		"runtimeId": "process:secret",
		"kind":      "process",
		"status":    "completed",
		"scope": map[string]string{
			"ownerType": "openade-task",
			"ownerId":   "task-paired",
			"repoPath":  "/private/repo",
			"rootPath":  "/private/repo",
		},
	})
	harness.runtime.Notify("pty/output", map[string]string{"ptyId": "pty-secret", "data": "secret terminal output"})
	resultObject(t, harness.request(t, "server/status/read", nil))
}

func TestProductPersonalSettingsReadReplace(t *testing.T) {
	harness := newRuntimeHarness(t)

	initial := objectField(t, resultObject(t, harness.request(t, "openade/settings/personal/read", map[string]any{})), "settings")
	if initial["theme"] != "system" || initial["renderMarkdownMessages"] != true {
		t.Fatalf("initial personal settings = %#v", initial)
	}
	if len(objectField(t, initial, "envVars")) != 0 {
		t.Fatalf("initial env vars should be empty: %#v", initial)
	}

	replaced := objectField(t, resultObject(t, harness.request(t, "openade/settings/personal/replace", map[string]any{
		"settings": map[string]any{
			"envVars": map[string]any{
				"OPENADE_ENV":      "core",
				"MULTILINE_SECRET": "first\nsecond",
			},
			"theme":                  "code-theme-black",
			"lastSettingsTab":        "system",
			"renderMarkdownMessages": false,
			"telemetryDisabled":      false,
			"onboardingCompleted":    true,
			"newTaskHarnessId":       "codex",
			"newTaskModelId":         "gpt-5.3-codex",
			"pinnedTaskIds":          []any{"task-1", "task-1", "task-2"},
			"hyperplanStrategyId":    "fanout",
			"hyperplanAgents": []any{
				map[string]any{"harnessId": "codex", "modelId": "gpt-5.3-codex"},
			},
			"hyperplanReconciler": map[string]any{"harnessId": "codex", "modelId": "gpt-5.3-codex"},
		},
		"clientRequestId": "personal-settings-replace",
	})), "settings")
	if replaced["theme"] != "code-theme-black" || replaced["renderMarkdownMessages"] != false || replaced["telemetryDisabled"] != false {
		t.Fatalf("replaced personal settings lost explicit false values: %#v", replaced)
	}
	envVars := objectField(t, replaced, "envVars")
	if envVars["OPENADE_ENV"] != "core" || envVars["MULTILINE_SECRET"] != "first\nsecond" {
		t.Fatalf("replaced env vars = %#v", envVars)
	}
	pinnedTaskIDs := arrayField(t, replaced, "pinnedTaskIds")
	if len(pinnedTaskIDs) != 2 || pinnedTaskIDs[0] != "task-1" || pinnedTaskIDs[1] != "task-2" {
		t.Fatalf("pinned task ids should be deduped: %#v", pinnedTaskIDs)
	}

	loaded := objectField(t, resultObject(t, harness.request(t, "openade/settings/personal/read", map[string]any{})), "settings")
	if loaded["theme"] != "code-theme-black" || loaded["renderMarkdownMessages"] != false || loaded["telemetryDisabled"] != false {
		t.Fatalf("loaded personal settings = %#v", loaded)
	}
	if objectField(t, loaded, "envVars")["MULTILINE_SECRET"] != "first\nsecond" {
		t.Fatalf("loaded multiline env var lost value: %#v", loaded)
	}

	invalid := harness.request(t, "openade/settings/personal/replace", map[string]any{
		"settings": map[string]any{"envVars": map[string]any{}, "theme": "theme-that-does-not-exist"},
	})
	if runtimeErrorCode(t, invalid) != "invalid_params" {
		t.Fatalf("invalid theme should be rejected: %#v", invalid)
	}
}

func (harness *runtimeHarness) request(t *testing.T, method string, params any) map[string]any {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"id":     method,
		"method": method,
		"params": params,
	})
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	if err := harness.conn.Write(context.Background(), websocket.MessageText, payload); err != nil {
		t.Fatalf("write request %s: %v", method, err)
	}
	for {
		message := harness.readMessage(t, 5*time.Second)
		if message["id"] == method {
			return message
		}
		if _, ok := message["id"]; ok {
			t.Fatalf("unexpected response while waiting for %s: %#v", method, message)
		}
		harness.notifications = append(harness.notifications, message)
	}
}

func requestOnConn(t *testing.T, conn *websocket.Conn, method string, params any) map[string]any {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"id":     method,
		"method": method,
		"params": params,
	})
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	if err := conn.Write(context.Background(), websocket.MessageText, payload); err != nil {
		t.Fatalf("write request %s: %v", method, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("read response %s: %v", method, err)
		}
		var message map[string]any
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatalf("decode response %s: %v", data, err)
		}
		if message["id"] == method {
			return message
		}
	}
}

func measureRuntimeRequest(t *testing.T, action func()) time.Duration {
	t.Helper()
	start := time.Now()
	action()
	return time.Since(start)
}

func expectRuntimeSocketClosed(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _, err := conn.Read(ctx)
	if err == nil {
		t.Fatal("runtime socket stayed open")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("runtime socket did not close before timeout")
	}
}

func (harness *runtimeHarness) readMessage(t *testing.T, timeout time.Duration) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	_, data, err := harness.conn.Read(ctx)
	if err != nil {
		t.Fatalf("read websocket message: %v", err)
	}
	var message map[string]any
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatalf("decode message %s: %v", data, err)
	}
	return message
}

func (harness *runtimeHarness) waitForNotifications(t *testing.T, start int, count int) []map[string]any {
	t.Helper()
	for len(harness.notifications)-start < count {
		message := harness.readMessage(t, time.Second)
		if _, ok := message["id"]; ok {
			t.Fatalf("unexpected response while waiting for notifications: %#v", message)
		}
		harness.notifications = append(harness.notifications, message)
	}
	return append([]map[string]any(nil), harness.notifications[start:]...)
}

func (harness *runtimeHarness) waitForNotification(t *testing.T, start int, method string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		for _, notification := range harness.notifications[start:] {
			if notification["method"] == method {
				return notification
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("notification %s not observed: %#v", method, harness.notifications[start:])
		}
		message := harness.readMessage(t, time.Until(deadline))
		if _, ok := message["id"]; ok {
			t.Fatalf("unexpected response while waiting for notification: %#v", message)
		}
		harness.notifications = append(harness.notifications, message)
	}
}

func (harness *runtimeHarness) waitForProcessNotification(t *testing.T, start int, method string, processID string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		for _, notification := range harness.notifications[start:] {
			if notification["method"] != method {
				continue
			}
			params := objectField(t, notification, "params")
			if params["processId"] == processID {
				return notification
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("process notification %s for %s not observed: %#v", method, processID, harness.notifications[start:])
		}
		message := harness.readMessage(t, time.Until(deadline))
		if _, ok := message["id"]; ok {
			t.Fatalf("unexpected response while waiting for process notification: %#v", message)
		}
		harness.notifications = append(harness.notifications, message)
	}
}

func (harness *runtimeHarness) waitForRuntimeNotification(t *testing.T, start int, method string, runtimeID string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		for _, notification := range harness.notifications[start:] {
			if notification["method"] != method {
				continue
			}
			params := objectField(t, notification, "params")
			if params["runtimeId"] == runtimeID {
				return notification
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("runtime notification %s for %s not observed: %#v", method, runtimeID, harness.notifications[start:])
		}
		message := harness.readMessage(t, time.Until(deadline))
		if _, ok := message["id"]; ok {
			t.Fatalf("unexpected response while waiting for runtime notification: %#v", message)
		}
		harness.notifications = append(harness.notifications, message)
	}
}

func (harness *runtimeHarness) waitForPtyNotification(t *testing.T, start int, method string, ptyID string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		for _, notification := range harness.notifications[start:] {
			if notification["method"] != method {
				continue
			}
			params := objectField(t, notification, "params")
			if params["ptyId"] == ptyID {
				return notification
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("pty notification %s for %s not observed: %#v", method, ptyID, harness.notifications[start:])
		}
		message := harness.readMessage(t, time.Until(deadline))
		if _, ok := message["id"]; ok {
			t.Fatalf("unexpected response while waiting for pty notification: %#v", message)
		}
		harness.notifications = append(harness.notifications, message)
	}
}

func seedProductData(t *testing.T, store *storage.Store) {
	t.Helper()
	ctx := context.Background()
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	lastEventAt := now.Add(100 * time.Second)
	if err := store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-1",
		Name:      "OpenADE",
		Path:      "/tmp/openade",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}
	if err := store.UpsertTask(ctx, storage.Task{
		ID:            "task-1",
		RepoID:        "repo-1",
		Slug:          "move-state",
		Title:         "Move state to core",
		Description:   "Replace hot Yjs reads with core storage.",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		MetadataJSON:  sql.NullString{String: `{"createdBy":{"id":"user-1","email":"user@example.com"},"sessionIds":{"codex":"session-1"},"enabledMcpServerIds":["filesystem"]}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     lastEventAt,
		LastViewedAt:  sql.NullTime{Time: now.Add(10 * time.Second), Valid: true},
		LastEventAt:   sql.NullTime{Time: lastEventAt, Valid: true},
	}); err != nil {
		t.Fatalf("upsert task: %v", err)
	}
	if err := store.UpsertTaskPreview(ctx, storage.TaskPreview{
		TaskID:        "task-1",
		RepoID:        "repo-1",
		Slug:          "move-state",
		Title:         "Move state to core",
		CreatedAt:     now,
		UpdatedAt:     lastEventAt,
		LastEventAt:   sql.NullTime{Time: lastEventAt, Valid: true},
		LastEventJSON: sql.NullString{String: `{"type":"assistant_message","summary":"done"}`, Valid: true},
		UsageJSON:     sql.NullString{String: `{"inputTokens":123,"outputTokens":456}`, Valid: true},
	}); err != nil {
		t.Fatalf("upsert task preview: %v", err)
	}
	for seq := 1; seq <= 100; seq++ {
		payload := fmt.Sprintf(`{"id":"event-%03d","type":"turn_delta","seq":%d}`, seq, seq)
		if err := store.UpsertTaskEvent(ctx, storage.TaskEvent{
			ID:          fmt.Sprintf("event-%03d", seq),
			TaskID:      "task-1",
			Seq:         int64(seq),
			Type:        "turn_delta",
			Status:      sql.NullString{String: "complete", Valid: true},
			SourceType:  sql.NullString{String: "agent", Valid: true},
			SourceLabel: sql.NullString{String: "Codex", Valid: true},
			CreatedAt:   now.Add(time.Duration(seq) * time.Second),
			PayloadJSON: sql.NullString{String: payload, Valid: true},
		}); err != nil {
			t.Fatalf("upsert event %d: %v", seq, err)
		}
	}
	if err := store.UpsertComment(ctx, storage.Comment{
		ID:         "comment-1",
		TaskID:     "task-1",
		Body:       "Use the runtime envelope.",
		AnchorJSON: sql.NullString{String: `{"type":"task"}`, Valid: true},
		CreatedAt:  now.Add(101 * time.Second),
		UpdatedAt:  now.Add(101 * time.Second),
	}); err != nil {
		t.Fatalf("upsert comment: %v", err)
	}
	if err := store.UpsertQueuedTurn(ctx, storage.QueuedTurn{
		ID:     "queued-1",
		TaskID: "task-1",
		Type:   "ask",
		Input:  "What should we migrate next?",
		Status: "queued",
		PayloadJSON: sql.NullString{
			String: `{"clientRequestId":"queued-request-1","appendSystemPrompt":"stay brief","enabledMcpServerIds":["filesystem"],"harnessId":"codex","modelId":"gpt-test","label":"Follow-up","includeComments":true,"images":[{"id":"img-1","ext":"png"}],"thinking":"high","fastMode":true}`,
			Valid:  true,
		},
		CreatedAt: now.Add(102 * time.Second),
		UpdatedAt: now.Add(102 * time.Second),
	}); err != nil {
		t.Fatalf("upsert queued turn: %v", err)
	}
}

func seedProductPerformanceData(t *testing.T, store *storage.Store, previewCount int, eventCount int) {
	t.Helper()
	ctx := context.Background()
	now := time.Date(2026, 6, 8, 13, 0, 0, 0, time.UTC)
	for repoIndex := 0; repoIndex < 3; repoIndex++ {
		repoID := fmt.Sprintf("repo-perf-%d", repoIndex)
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        repoID,
			Name:      fmt.Sprintf("Performance Repo %d", repoIndex),
			Path:      filepath.Join(t.TempDir(), repoID),
			CreatedAt: now,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert performance repo %s: %v", repoID, err)
		}
	}

	for index := 0; index < previewCount; index++ {
		repoID := fmt.Sprintf("repo-perf-%d", index%3)
		taskID := fmt.Sprintf("task-perf-%03d", index)
		if index == 0 {
			taskID = "task-perf-target"
			repoID = "repo-perf-0"
		}
		eventAt := now.Add(time.Duration(index) * time.Second)
		if err := store.UpsertTask(ctx, storage.Task{
			ID:            taskID,
			RepoID:        repoID,
			Slug:          taskID,
			Title:         fmt.Sprintf("Performance task %03d", index),
			Description:   "Performance budget fixture",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     now,
			UpdatedAt:     eventAt,
			LastEventAt:   sql.NullTime{Time: eventAt, Valid: true},
		}); err != nil {
			t.Fatalf("upsert performance task %s: %v", taskID, err)
		}
		if err := store.UpsertTaskPreview(ctx, storage.TaskPreview{
			TaskID:        taskID,
			RepoID:        repoID,
			Slug:          taskID,
			Title:         fmt.Sprintf("Performance task %03d", index),
			CreatedAt:     now,
			UpdatedAt:     eventAt,
			LastEventAt:   sql.NullTime{Time: eventAt, Valid: true},
			LastEventJSON: sql.NullString{String: fmt.Sprintf(`{"id":"preview-%03d","type":"action","status":"completed"}`, index), Valid: true},
		}); err != nil {
			t.Fatalf("upsert performance preview %s: %v", taskID, err)
		}
	}

	for seq := 1; seq <= eventCount; seq++ {
		eventID := fmt.Sprintf("perf-event-%04d", seq)
		payload := fmt.Sprintf(`{"id":%q,"type":"turn_delta","seq":%d,"text":%q}`, eventID, seq, strings.Repeat("x", 256))
		if err := store.UpsertTaskEvent(ctx, storage.TaskEvent{
			ID:          eventID,
			TaskID:      "task-perf-target",
			Seq:         int64(seq),
			Type:        "turn_delta",
			Status:      sql.NullString{String: "complete", Valid: true},
			SourceType:  sql.NullString{String: "agent", Valid: true},
			SourceLabel: sql.NullString{String: "Codex", Valid: true},
			CreatedAt:   now.Add(time.Duration(seq) * time.Millisecond),
			PayloadJSON: sql.NullString{String: payload, Valid: true},
		}); err != nil {
			t.Fatalf("upsert performance event %d: %v", seq, err)
		}
	}
}

type productHostPerformanceFixture struct {
	repoID             string
	targetPath         string
	processConfigCount int
}

func seedProductHostPerformanceData(t *testing.T, store *storage.Store) productHostPerformanceFixture {
	t.Helper()
	ctx := context.Background()
	repoRoot, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("resolve performance host repo path: %v", err)
	}
	gitCommand(t, repoRoot, "init", "-b", "main")
	gitCommand(t, repoRoot, "config", "user.email", "test@example.com")
	gitCommand(t, repoRoot, "config", "user.name", "OpenADE Test")

	writeFile(t, filepath.Join(repoRoot, "README.md"), []byte("performance repo\n"))
	writeFile(t, filepath.Join(repoRoot, "openade.toml"), []byte(`[[process]]
name = "Root"
command = "npm run root"
type = "daemon"
`))
	processConfigCount := 1
	targetPath := "packages/pkg-17/src/needle-hook-target.ts"
	for pkgIndex := 0; pkgIndex < 36; pkgIndex++ {
		srcDir := filepath.Join(repoRoot, "packages", fmt.Sprintf("pkg-%02d", pkgIndex), "src")
		mkdirAll(t, srcDir)
		if pkgIndex%4 == 0 {
			writeFile(t, filepath.Join(repoRoot, "packages", fmt.Sprintf("pkg-%02d", pkgIndex), "openade.toml"), []byte(fmt.Sprintf(`[[process]]
name = "Package%d"
command = "npm run pkg-%02d"
type = "daemon"
work_dir = "src"
`, pkgIndex, pkgIndex)))
			processConfigCount++
		}
		for fileIndex := 0; fileIndex < 8; fileIndex++ {
			fileName := fmt.Sprintf("module-%02d.ts", fileIndex)
			if pkgIndex == 17 && fileIndex == 4 {
				fileName = "needle-hook-target.ts"
			}
			writeFile(t, filepath.Join(srcDir, fileName), []byte(fmt.Sprintf("export const value%d_%d = %d\n", pkgIndex, fileIndex, pkgIndex+fileIndex)))
		}
	}
	mkdirAll(t, filepath.Join(repoRoot, "node_modules", "generated-package"))
	for index := 0; index < 40; index++ {
		writeFile(t, filepath.Join(repoRoot, "node_modules", "generated-package", fmt.Sprintf("ignored-%02d.js", index)), []byte("generated\n"))
	}

	gitCommand(t, repoRoot, "add", ".")
	gitCommand(t, repoRoot, "commit", "-m", "performance fixture")
	writeFile(t, filepath.Join(repoRoot, "staged-performance.txt"), []byte("staged performance\n"))
	gitCommand(t, repoRoot, "add", "staged-performance.txt")
	writeFile(t, filepath.Join(repoRoot, "README.md"), []byte("performance repo\nmodified\n"))
	writeFile(t, filepath.Join(repoRoot, "untracked-performance.txt"), []byte("untracked performance\n"))

	now := time.Date(2026, 6, 8, 13, 30, 0, 0, time.UTC)
	if err := store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-host-performance",
		Name:      "Host Performance Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert host performance repo: %v", err)
	}
	return productHostPerformanceFixture{
		repoID:             "repo-host-performance",
		targetPath:         targetPath,
		processConfigCount: processConfigCount,
	}
}

func TestProductSnapshotAndProjectMethodsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)

	snapshot := resultObject(t, harness.request(t, "openade/snapshot/read", map[string]any{}))
	server := objectField(t, snapshot, "server")
	if server["version"] != "test-version" || server["hostName"] != "test-host" {
		t.Fatalf("server = %#v", server)
	}
	repos := arrayField(t, snapshot, "repos")
	if len(repos) != 1 {
		t.Fatalf("snapshot repos = %#v", repos)
	}
	repo := objectValue(t, repos[0])
	if repo["id"] != "repo-1" || repo["name"] != "OpenADE" || repo["path"] != "/tmp/openade" {
		t.Fatalf("snapshot repo = %#v", repo)
	}
	tasks := arrayField(t, repo, "tasks")
	if len(tasks) != 1 {
		t.Fatalf("snapshot tasks = %#v", tasks)
	}
	preview := objectValue(t, tasks[0])
	if preview["id"] != "task-1" || preview["title"] != "Move state to core" {
		t.Fatalf("task preview = %#v", preview)
	}
	if objectField(t, preview, "usage")["inputTokens"] != float64(123) {
		t.Fatalf("usage = %#v", preview["usage"])
	}

	projects := resultArray(t, harness.request(t, "openade/project/list", map[string]any{}))
	if len(projects) != 1 {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestProductTaskReadBoundsEventsUnlessHydrated(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)

	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-1",
		"taskId":               "task-1",
		"hydrateSessionEvents": false,
	}))
	if task["id"] != "task-1" || task["description"] != "Replace hot Yjs reads with core storage." {
		t.Fatalf("task = %#v", task)
	}
	if objectField(t, task, "isolationStrategy")["type"] != "head" {
		t.Fatalf("isolation strategy = %#v", task["isolationStrategy"])
	}
	createdBy := objectField(t, task, "createdBy")
	if createdBy["id"] != "user-1" || createdBy["email"] != "user@example.com" {
		t.Fatalf("createdBy = %#v", createdBy)
	}
	assertStringSetEquals(t, stringsFromAny(arrayField(t, task, "enabledMcpServerIds")), []string{"filesystem"})
	sessionIDs := objectField(t, task, "sessionIds")
	if sessionIDs["codex"] != "session-1" {
		t.Fatalf("session ids = %#v", sessionIDs)
	}
	events := arrayField(t, task, "events")
	if len(events) != 80 {
		t.Fatalf("bounded events length = %d", len(events))
	}
	firstEvent := objectValue(t, events[0])
	lastEvent := objectValue(t, events[len(events)-1])
	if firstEvent["id"] != "event-021" || lastEvent["id"] != "event-100" {
		t.Fatalf("bounded event window = first %#v last %#v", firstEvent, lastEvent)
	}
	comments := arrayField(t, task, "comments")
	if len(comments) != 1 || objectValue(t, comments[0])["body"] != "Use the runtime envelope." || objectValue(t, comments[0])["content"] != "Use the runtime envelope." {
		t.Fatalf("comments = %#v", comments)
	}
	queuedTurns := arrayField(t, task, "queuedTurns")
	if len(queuedTurns) != 1 {
		t.Fatalf("queued turns = %#v", queuedTurns)
	}
	queuedTurn := objectValue(t, queuedTurns[0])
	if queuedTurn["id"] != "queued-1" || queuedTurn["status"] != "queued" || queuedTurn["input"] != "What should we migrate next?" {
		t.Fatalf("queued turn = %#v", queuedTurn)
	}
	if queuedTurn["clientRequestId"] != "queued-request-1" || queuedTurn["thinking"] != "high" || queuedTurn["fastMode"] != true {
		t.Fatalf("queued turn payload = %#v", queuedTurn)
	}
	images := arrayField(t, queuedTurn, "images")
	if len(images) != 1 || objectValue(t, images[0])["id"] != "img-1" {
		t.Fatalf("queued turn images = %#v", images)
	}

	hydrated := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-1",
		"taskId":               "task-1",
		"hydrateSessionEvents": true,
	}))
	allEvents := arrayField(t, hydrated, "events")
	if len(allEvents) != 100 {
		t.Fatalf("hydrated events length = %d", len(allEvents))
	}
	if objectValue(t, allEvents[0])["id"] != "event-001" {
		t.Fatalf("first hydrated event = %#v", allEvents[0])
	}
}

func TestProductReadPerformanceBudgetsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductPerformanceData(t, harness.store, 180, 1500)

	// Warm SQLite statement caches and the runtime path before measuring budgets.
	resultObject(t, harness.request(t, "openade/snapshot/read", map[string]any{}))
	resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-perf-0",
		"taskId":               "task-perf-target",
		"hydrateSessionEvents": false,
	}))

	snapshotDuration := measureRuntimeRequest(t, func() {
		snapshot := resultObject(t, harness.request(t, "openade/snapshot/read", map[string]any{}))
		repos := arrayField(t, snapshot, "repos")
		if len(repos) != 3 {
			t.Fatalf("performance snapshot repos = %#v", repos)
		}
	})
	if snapshotDuration > snapshotReadBudget {
		t.Fatalf("openade/snapshot/read exceeded hard gate: %s > %s", snapshotDuration, snapshotReadBudget)
	}

	taskDuration := measureRuntimeRequest(t, func() {
		task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
			"repoId":               "repo-perf-0",
			"taskId":               "task-perf-target",
			"hydrateSessionEvents": false,
		}))
		events := arrayField(t, task, "events")
		if len(events) != 80 {
			t.Fatalf("performance task read returned %d events", len(events))
		}
		if objectValue(t, events[0])["id"] != "perf-event-1421" || objectValue(t, events[len(events)-1])["id"] != "perf-event-1500" {
			t.Fatalf("performance task read window = first %#v last %#v", events[0], events[len(events)-1])
		}
	})
	if taskDuration > boundedTaskReadBudget {
		t.Fatalf("openade/task/read bounded events exceeded hard gate: %s > %s", taskDuration, boundedTaskReadBudget)
	}
}

func TestProductHostOperationPerformanceBudgetsOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	fixture := seedProductHostPerformanceData(t, harness.store)

	resultObject(t, harness.request(t, "openade/project/git/summary/read", map[string]any{
		"repoId": fixture.repoID,
	}))
	resultObject(t, harness.request(t, "openade/project/process/list", map[string]any{
		"repoId": fixture.repoID,
	}))
	resultObject(t, harness.request(t, "openade/project/files/fuzzySearch", map[string]any{
		"repoId": fixture.repoID,
		"query":  "needle-hook",
		"limit":  5,
	}))

	gitDuration := measureRuntimeRequest(t, func() {
		summary := resultObject(t, harness.request(t, "openade/project/git/summary/read", map[string]any{
			"repoId": fixture.repoID,
		}))
		if summary["branch"] != "main" || summary["hasChanges"] != true {
			t.Fatalf("performance git summary = %#v", summary)
		}
		assertChangedFile(t, arrayField(t, objectField(t, summary, "staged"), "files"), "staged-performance.txt", "added")
		assertChangedFile(t, arrayField(t, objectField(t, summary, "unstaged"), "files"), "README.md", "modified")
		assertChangedFile(t, arrayField(t, summary, "untracked"), "untracked-performance.txt", "added")
	})
	if gitDuration > gitSummaryReadBudget {
		t.Fatalf("openade/project/git/summary/read exceeded hard gate: %s > %s", gitDuration, gitSummaryReadBudget)
	}

	processDuration := measureRuntimeRequest(t, func() {
		processList := resultObject(t, harness.request(t, "openade/project/process/list", map[string]any{
			"repoId": fixture.repoID,
		}))
		configs := arrayField(t, processList, "configs")
		processes := arrayField(t, processList, "processes")
		if len(configs) != fixture.processConfigCount || len(processes) != fixture.processConfigCount {
			t.Fatalf("performance process list configs/processes = %d/%d, want %d", len(configs), len(processes), fixture.processConfigCount)
		}
	})
	if processDuration > processListReadBudget {
		t.Fatalf("openade/project/process/list exceeded hard gate: %s > %s", processDuration, processListReadBudget)
	}

	fuzzyDuration := measureRuntimeRequest(t, func() {
		fuzzy := resultObject(t, harness.request(t, "openade/project/files/fuzzySearch", map[string]any{
			"repoId": fixture.repoID,
			"query":  "needle-hook",
			"limit":  5,
		}))
		results := stringsFromAny(arrayField(t, fuzzy, "results"))
		if len(results) == 0 || results[0] != fixture.targetPath {
			t.Fatalf("performance fuzzy results = %#v, want first %s", results, fixture.targetPath)
		}
	})
	if fuzzyDuration > fuzzySearchReadBudget {
		t.Fatalf("openade/project/files/fuzzySearch exceeded hard gate: %s > %s", fuzzyDuration, fuzzySearchReadBudget)
	}
}

func TestProductTaskEnvironmentSetupAndPrepareOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot, _, _ := createGitHistoryRepo(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-env",
		Name:      "Environment Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert environment repo: %v", err)
	}
	for _, task := range []storage.Task{
		{
			ID:            "task-env-head",
			RepoID:        "repo-env",
			Slug:          "task-env-head",
			Title:         "Head environment",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     now,
			UpdatedAt:     now,
		},
		{
			ID:            "task-env-worktree",
			RepoID:        "repo-env",
			Slug:          "task-env-worktree",
			Title:         "Worktree environment",
			IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
			CreatedAt:     now,
			UpdatedAt:     now,
		},
		{
			ID:            "task-env-manual",
			RepoID:        "repo-env",
			Slug:          "task-env-manual",
			Title:         "Manual environment",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     now,
			UpdatedAt:     now,
		},
	} {
		if err := harness.store.UpsertTask(ctx, task); err != nil {
			t.Fatalf("upsert environment task %s: %v", task.ID, err)
		}
	}

	headPrepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId":          "repo-env",
		"taskId":          "task-env-head",
		"clientRequestId": "prepare-head",
	}))
	if headPrepared["repoId"] != "repo-env" || headPrepared["taskId"] != "task-env-head" || headPrepared["cwd"] != repoRoot || headPrepared["rootPath"] != repoRoot {
		t.Fatalf("head prepare result = %#v", headPrepared)
	}
	headEnvironment := objectField(t, headPrepared, "deviceEnvironment")
	if headEnvironment["id"] != "headless-runtime" || headEnvironment["deviceId"] != "headless-runtime" || headEnvironment["setupComplete"] != true {
		t.Fatalf("head prepare environment = %#v", headEnvironment)
	}
	if _, ok := headPrepared["setupEvent"]; ok {
		t.Fatalf("head prepare should not create setup event: %#v", headPrepared)
	}
	headTask := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-env",
		"taskId": "task-env-head",
	}))
	headEnvironments := arrayField(t, headTask, "deviceEnvironments")
	if len(headEnvironments) != 1 || objectValue(t, headEnvironments[0])["id"] != "headless-runtime" {
		t.Fatalf("head task environments = %#v", headEnvironments)
	}
	if events := arrayField(t, headTask, "events"); len(events) != 0 {
		t.Fatalf("head prepare events = %#v", events)
	}

	worktreePrepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId":          "repo-env",
		"taskId":          "task-env-worktree",
		"clientRequestId": "prepare-worktree",
	}))
	worktreeEnvironment := objectField(t, worktreePrepared, "deviceEnvironment")
	rootPath, ok := worktreePrepared["rootPath"].(string)
	if !ok || rootPath == "" || !strings.HasPrefix(rootPath, harness.worktreeBaseDir) {
		t.Fatalf("worktree root path = %#v", worktreePrepared)
	}
	if worktreePrepared["cwd"] != rootPath || worktreeEnvironment["worktreeDir"] != rootPath || worktreeEnvironment["setupComplete"] != true {
		t.Fatalf("worktree prepare result = %#v", worktreePrepared)
	}
	setupEvent := objectField(t, worktreePrepared, "setupEvent")
	if setupEvent["eventId"] != "setup-headless-runtime" || setupEvent["worktreeId"] != "task-env-worktree" || setupEvent["workingDir"] != rootPath {
		t.Fatalf("worktree setup event = %#v", setupEvent)
	}
	setupOutput, ok := setupEvent["setupOutput"].(string)
	if !ok || !strings.Contains(setupOutput, "Worktree: "+rootPath) || !strings.Contains(setupOutput, "Branch: main") {
		t.Fatalf("worktree setup output = %#v", setupEvent)
	}
	if branch := gitOutput(t, rootPath, "branch", "--show-current"); branch != "openade/task-env-worktree" {
		t.Fatalf("worktree branch = %q", branch)
	}
	if worktrees := gitOutput(t, repoRoot, "worktree", "list", "--porcelain"); !strings.Contains(worktrees, rootPath) {
		t.Fatalf("worktree list missing root %q:\n%s", rootPath, worktrees)
	}
	retried := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId":          "repo-env",
		"taskId":          "task-env-worktree",
		"clientRequestId": "prepare-worktree",
	}))
	if retried["rootPath"] != rootPath {
		t.Fatalf("retried prepare result = %#v", retried)
	}
	worktreeTask := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-env",
		"taskId": "task-env-worktree",
	}))
	worktreeEnvironments := arrayField(t, worktreeTask, "deviceEnvironments")
	if len(worktreeEnvironments) != 1 || objectValue(t, worktreeEnvironments[0])["worktreeDir"] != rootPath {
		t.Fatalf("worktree task environments = %#v", worktreeEnvironments)
	}
	worktreeEvents := arrayField(t, worktreeTask, "events")
	if len(worktreeEvents) != 1 || objectValue(t, worktreeEvents[0])["type"] != "setup_environment" || objectValue(t, worktreeEvents[0])["worktreeId"] != "task-env-worktree" {
		t.Fatalf("worktree task events = %#v", worktreeEvents)
	}

	manualCreatedAt := now.Add(10 * time.Minute).Format(time.RFC3339Nano)
	manualSetup := resultObject(t, harness.request(t, "openade/task/environment/setup", map[string]any{
		"taskId": "task-env-manual",
		"deviceEnvironment": map[string]any{
			"id":            "device-env-1",
			"deviceId":      "device-1",
			"setupComplete": true,
			"createdAt":     manualCreatedAt,
			"lastUsedAt":    manualCreatedAt,
		},
		"setupEvent": map[string]any{
			"eventId":     "setup-device-1",
			"worktreeId":  "task-env-manual",
			"deviceId":    "device-1",
			"workingDir":  repoRoot,
			"setupOutput": "manual setup",
			"createdAt":   manualCreatedAt,
			"completedAt": manualCreatedAt,
		},
		"clientRequestId": "manual-setup",
	}))
	if manualSetup["ok"] != true {
		t.Fatalf("manual setup result = %#v", manualSetup)
	}
	manualTask := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-env",
		"taskId": "task-env-manual",
	}))
	manualEnvironments := arrayField(t, manualTask, "deviceEnvironments")
	if len(manualEnvironments) != 1 || objectValue(t, manualEnvironments[0])["id"] != "device-env-1" {
		t.Fatalf("manual task environments = %#v", manualEnvironments)
	}
	manualEvents := arrayField(t, manualTask, "events")
	if len(manualEvents) != 1 || objectValue(t, manualEvents[0])["id"] != "setup-device-1" || objectValue(t, manualEvents[0])["setupOutput"] != "manual setup" {
		t.Fatalf("manual task events = %#v", manualEvents)
	}

	missing := harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId": "repo-env",
		"taskId": "missing-task",
	})
	if runtimeErrorCode(t, missing) != "not_found" {
		t.Fatalf("missing prepare response = %#v", missing)
	}
}

func TestProductTaskResourceInventoryOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot, _, _ := createGitHistoryRepo(t)
	gitCommand(t, repoRoot, "checkout", "-b", "openade/task-inventory")
	writeFile(t, filepath.Join(repoRoot, "worktree-change.txt"), []byte("worktree only\n"))
	gitCommand(t, repoRoot, "add", "worktree-change.txt")
	gitCommand(t, repoRoot, "commit", "-m", "worktree change")
	gitCommand(t, repoRoot, "checkout", "main")
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-inventory",
		Name:      "Inventory Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert inventory repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-inventory",
		RepoID:        "repo-inventory",
		Slug:          "task-inventory",
		Title:         "Inventory task",
		Description:   "Delete me",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		MetadataJSON:  sql.NullString{String: `{"sessionIds":{"main":"session-from-metadata"}}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert inventory task: %v", err)
	}
	events := []storage.TaskEvent{
		{
			ID:          "event-action",
			TaskID:      "task-inventory",
			Seq:         1,
			Type:        "action",
			CreatedAt:   now,
			PayloadJSON: sql.NullString{String: `{"id":"event-action","type":"action","execution":{"harnessId":"codex","sessionId":"session-from-event"},"images":[{"id":"image-1","ext":"png"},{"id":"image-1","ext":"png"}],"hyperplanSubExecutions":[{"harnessId":"claude-code","sessionId":"session-from-sub-execution"}]}`, Valid: true},
		},
		{
			ID:          "snapshot-1",
			TaskID:      "task-inventory",
			Seq:         2,
			Type:        "snapshot",
			CreatedAt:   now.Add(time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-1","type":"snapshot","patchFileId":"patch-1"}`, Valid: true},
		},
		{
			ID:          "snapshot-2",
			TaskID:      "task-inventory",
			Seq:         3,
			Type:        "snapshot",
			CreatedAt:   now.Add(2 * time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-2","type":"snapshot","patchFileId":"patch-1"}`, Valid: true},
		},
	}
	for _, event := range events {
		if err := harness.store.UpsertTaskEvent(ctx, event); err != nil {
			t.Fatalf("upsert inventory event %s: %v", event.ID, err)
		}
	}

	inventory := resultObject(t, harness.request(t, "openade/task/resourceInventory/read", map[string]any{
		"repoId": "repo-inventory",
		"taskId": "task-inventory",
	}))
	if inventory["repoId"] != "repo-inventory" || inventory["taskId"] != "task-inventory" || inventory["taskTitle"] != "Inventory task" || inventory["isRunning"] != false {
		t.Fatalf("inventory = %#v", inventory)
	}
	assertStringSetEquals(t, stringsFromAny(arrayField(t, inventory, "snapshotIds")), []string{"patch-1"})
	images := arrayField(t, inventory, "images")
	if len(images) != 1 {
		t.Fatalf("inventory images = %#v", images)
	}
	image := objectValue(t, images[0])
	if image["id"] != "image-1" || image["ext"] != "png" {
		t.Fatalf("inventory image = %#v", image)
	}
	sessions := arrayField(t, inventory, "sessions")
	if len(sessions) != 3 {
		t.Fatalf("inventory sessions = %#v", sessions)
	}
	if sessionByID(t, sessions, "session-from-event")["harnessId"] != "codex" {
		t.Fatalf("inventory event session = %#v", sessions)
	}
	if sessionByID(t, sessions, "session-from-sub-execution")["harnessId"] != "claude-code" {
		t.Fatalf("inventory sub-execution session = %#v", sessions)
	}
	if sessionByID(t, sessions, "session-from-metadata")["harnessId"] != "claude-code" {
		t.Fatalf("inventory metadata session = %#v", sessions)
	}
	worktree := objectField(t, inventory, "worktree")
	if worktree["slug"] != "task-inventory" || worktree["branchName"] != "openade/task-inventory" || worktree["sourceBranch"] != "main" || worktree["branchMerged"] != false {
		t.Fatalf("inventory worktree = %#v", worktree)
	}

	for _, runtimeRecord := range []storage.RuntimeRecord{
		{
			RuntimeID:      "agent:inventory-completed",
			Kind:           "agent",
			Status:         "completed",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"openade-task","ownerId":"task-inventory"}`, Valid: true},
			StartedAt:      now,
			UpdatedAt:      now,
			LastActivityAt: now,
		},
		{
			RuntimeID:      "agent:inventory-other-task",
			Kind:           "agent",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"openade-task","ownerId":"task-other"}`, Valid: true},
			StartedAt:      now,
			UpdatedAt:      now,
			LastActivityAt: now,
		},
	} {
		if err := harness.store.UpsertRuntime(ctx, runtimeRecord); err != nil {
			t.Fatalf("upsert inactive inventory runtime %s: %v", runtimeRecord.RuntimeID, err)
		}
	}
	notRunningInventory := resultObject(t, harness.request(t, "openade/task/resourceInventory/read", map[string]any{
		"repoId": "repo-inventory",
		"taskId": "task-inventory",
	}))
	if notRunningInventory["isRunning"] != false {
		t.Fatalf("inventory should ignore terminal and wrong-task runtimes = %#v", notRunningInventory)
	}
	if err := harness.store.UpsertRuntime(ctx, storage.RuntimeRecord{
		RuntimeID:      "agent:inventory-running",
		Kind:           "agent",
		Status:         "running",
		ScopeJSON:      sql.NullString{String: `{"ownerType":"openade-task","ownerId":"task-inventory"}`, Valid: true},
		StartedAt:      now,
		UpdatedAt:      now,
		LastActivityAt: now,
	}); err != nil {
		t.Fatalf("upsert active inventory runtime: %v", err)
	}
	runningInventory := resultObject(t, harness.request(t, "openade/task/resourceInventory/read", map[string]any{
		"repoId": "repo-inventory",
		"taskId": "task-inventory",
	}))
	if runningInventory["isRunning"] != true {
		t.Fatalf("inventory should include active task-owned runtime = %#v", runningInventory)
	}

	missing := harness.request(t, "openade/task/resourceInventory/read", map[string]any{
		"repoId": "repo-inventory",
		"taskId": "missing",
	})
	if runtimeErrorCode(t, missing) != "not_found" {
		t.Fatalf("missing inventory response = %#v", missing)
	}
}

func TestProductTaskImageReadOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	imageDir := t.TempDir()
	eventImagePath := filepath.Join(imageDir, "image-event.png")
	queuedImagePath := filepath.Join(imageDir, "image-queued.webp")
	unreferencedImagePath := filepath.Join(imageDir, "image-unreferenced.png")
	writeFile(t, eventImagePath, []byte("event image bytes"))
	writeFile(t, queuedImagePath, []byte("queued image bytes"))
	writeFile(t, unreferencedImagePath, []byte("unreferenced image bytes"))
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-image",
		Name:      "Image Repo",
		Path:      imageDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert image repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-image",
		RepoID:    "repo-image",
		Slug:      "task-image",
		Title:     "Image task",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert image task: %v", err)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:          "event-image",
		TaskID:      "task-image",
		Seq:         1,
		Type:        "action",
		CreatedAt:   now,
		PayloadJSON: sql.NullString{String: `{"id":"event-image","type":"action","images":[{"id":"image-event","ext":"png","mediaType":"image/png"},{"id":"image-missing","ext":"jpg","mediaType":"image/jpeg"}]}`, Valid: true},
	}); err != nil {
		t.Fatalf("upsert image event: %v", err)
	}
	if err := harness.store.UpsertQueuedTurn(ctx, storage.QueuedTurn{
		ID:          "queued-image",
		TaskID:      "task-image",
		Type:        "ask",
		Input:       "queued image",
		Status:      "queued",
		PayloadJSON: sql.NullString{String: `{"images":[{"id":"image-queued","ext":"webp","mediaType":"image/webp"}]}`, Valid: true},
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("upsert image queued turn: %v", err)
	}
	for _, blob := range []storage.BlobMetadata{
		{ID: "image-event", Kind: "task_image", ContentType: sql.NullString{String: "image/png", Valid: true}, SizeBytes: 17, SHA256: "sha-event", Path: eventImagePath, CreatedAt: now},
		{ID: "image-queued", Kind: "task_image", ContentType: sql.NullString{String: "image/webp", Valid: true}, SizeBytes: 18, SHA256: "sha-queued", Path: queuedImagePath, CreatedAt: now},
		{ID: "image-unreferenced", Kind: "task_image", ContentType: sql.NullString{String: "image/png", Valid: true}, SizeBytes: 24, SHA256: "sha-unreferenced", Path: unreferencedImagePath, CreatedAt: now},
	} {
		if err := harness.store.PutBlobMetadata(ctx, blob); err != nil {
			t.Fatalf("put image blob %s: %v", blob.ID, err)
		}
	}

	eventImage := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image",
		"taskId":  "task-image",
		"imageId": "image-event",
		"ext":     "png",
	}))
	if eventImage["mediaType"] != "image/png" || eventImage["data"] != base64.StdEncoding.EncodeToString([]byte("event image bytes")) {
		t.Fatalf("event image read = %#v", eventImage)
	}
	queuedImage := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image",
		"taskId":  "task-image",
		"imageId": "image-queued",
		"ext":     "webp",
	}))
	if queuedImage["mediaType"] != "image/webp" || queuedImage["data"] != base64.StdEncoding.EncodeToString([]byte("queued image bytes")) {
		t.Fatalf("queued image read = %#v", queuedImage)
	}
	missingBlob := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image",
		"taskId":  "task-image",
		"imageId": "image-missing",
		"ext":     "jpg",
	}))
	if missingBlob["data"] != nil || missingBlob["mediaType"] != "image/jpeg" {
		t.Fatalf("missing blob image read = %#v", missingBlob)
	}
	unreferenced := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image",
		"taskId":  "task-image",
		"imageId": "image-unreferenced",
		"ext":     "png",
	}))
	if unreferenced["data"] != nil {
		t.Fatalf("unreferenced image read = %#v", unreferenced)
	}
	invalid := harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image",
		"taskId":  "task-image",
		"imageId": "../image-event",
		"ext":     "png",
	})
	if runtimeErrorCode(t, invalid) != "invalid_params" {
		t.Fatalf("invalid image read response = %#v", invalid)
	}
}

func TestProductTaskImageWriteOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 11, 0, 0, 0, time.UTC)
	repoRoot := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-image-write",
		Name:      "Image Write Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert image write repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-image-write",
		RepoID:    "repo-image-write",
		Slug:      "task-image-write",
		Title:     "Image write task",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert image write task: %v", err)
	}

	imageBytes := []byte("core image bytes")
	encoded := base64.StdEncoding.EncodeToString(imageBytes)
	written := resultObject(t, harness.request(t, "openade/task/image/write", map[string]any{
		"imageId":         "image-core-write",
		"ext":             "png",
		"mediaType":       "image/png",
		"data":            encoded,
		"clientRequestId": "image-write-1",
	}))
	hash := sha256.Sum256(imageBytes)
	hashString := hex.EncodeToString(hash[:])
	if written["imageId"] != "image-core-write" || written["size"] != float64(len(imageBytes)) || written["sha256"] != hashString {
		t.Fatalf("image write result = %#v", written)
	}
	blob, ok, err := harness.store.GetBlobMetadata(ctx, "image-core-write")
	if err != nil {
		t.Fatalf("get image write blob: %v", err)
	}
	if !ok || blob.Kind != "task_image" || blob.ContentType.String != "image/png" || blob.Path != filepath.Join(harness.blobDir, "images", "image-core-write.png") {
		t.Fatalf("image write blob = %#v, ok %v", blob, ok)
	}
	data, err := os.ReadFile(blob.Path)
	if err != nil {
		t.Fatalf("read image write blob file: %v", err)
	}
	if string(data) != string(imageBytes) {
		t.Fatalf("image write blob file = %q", string(data))
	}

	unreferenced := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image-write",
		"taskId":  "task-image-write",
		"imageId": "image-core-write",
		"ext":     "png",
	}))
	if unreferenced["data"] != nil {
		t.Fatalf("unreferenced written image read = %#v", unreferenced)
	}
	staged := resultObject(t, harness.request(t, "openade/task/image/staged/read", map[string]any{
		"imageId": "image-core-write",
		"ext":     "png",
	}))
	if staged["imageId"] != "image-core-write" || staged["ext"] != "png" || staged["mediaType"] != "image/png" || staged["data"] != encoded {
		t.Fatalf("staged written image read = %#v", staged)
	}
	missingStaged := resultObject(t, harness.request(t, "openade/task/image/staged/read", map[string]any{
		"imageId": "image-core-missing",
		"ext":     "png",
	}))
	if missingStaged["data"] != nil {
		t.Fatalf("missing staged image read = %#v", missingStaged)
	}
	mismatchedStaged := resultObject(t, harness.request(t, "openade/task/image/staged/read", map[string]any{
		"imageId": "image-core-write",
		"ext":     "jpg",
	}))
	if mismatchedStaged["data"] != nil {
		t.Fatalf("mismatched staged image read = %#v", mismatchedStaged)
	}
	invalidStaged := harness.request(t, "openade/task/image/staged/read", map[string]any{
		"imageId": "../image-core-write",
		"ext":     "png",
	})
	if runtimeErrorCode(t, invalidStaged) != "invalid_params" {
		t.Fatalf("invalid staged image read response = %#v", invalidStaged)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-image-write",
		TaskID:    "task-image-write",
		Seq:       1,
		Type:      "action",
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: `{"id":"event-image-write","type":"action","images":[{"id":"image-core-write","ext":"png","mediaType":"image/png","originalWidth":1,"originalHeight":1,"resizedWidth":1,"resizedHeight":1}]}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert written image action: %v", err)
	}
	referenced := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image-write",
		"taskId":  "task-image-write",
		"imageId": "image-core-write",
		"ext":     "png",
	}))
	if referenced["data"] != encoded || referenced["mediaType"] != "image/png" {
		t.Fatalf("referenced written image read = %#v", referenced)
	}

	retried := resultObject(t, harness.request(t, "openade/task/image/write", map[string]any{
		"imageId":         "image-core-write",
		"ext":             "png",
		"mediaType":       "image/png",
		"data":            encoded,
		"clientRequestId": "image-write-1",
	}))
	if retried["sha256"] != written["sha256"] {
		t.Fatalf("image write retry result = %#v", retried)
	}
	sameContent := resultObject(t, harness.request(t, "openade/task/image/write", map[string]any{
		"imageId":         "image-core-write",
		"ext":             "png",
		"mediaType":       "image/png",
		"data":            encoded,
		"clientRequestId": "image-write-2",
	}))
	if sameContent["sha256"] != written["sha256"] {
		t.Fatalf("image write same-content result = %#v", sameContent)
	}
	conflict := harness.request(t, "openade/task/image/write", map[string]any{
		"imageId":         "image-core-write",
		"ext":             "png",
		"mediaType":       "image/png",
		"data":            base64.StdEncoding.EncodeToString([]byte("different image bytes")),
		"clientRequestId": "image-write-conflict",
	})
	if runtimeErrorCode(t, conflict) != "conflict" {
		t.Fatalf("image write conflict response = %#v", conflict)
	}
	invalidMediaType := harness.request(t, "openade/task/image/write", map[string]any{
		"imageId":   "image-core-invalid",
		"ext":       "png",
		"mediaType": "image/jpeg",
		"data":      encoded,
	})
	if runtimeErrorCode(t, invalidMediaType) != "invalid_params" {
		t.Fatalf("image write invalid media type response = %#v", invalidMediaType)
	}
}

func TestProductTaskImageImportLegacyOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	repoRoot := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-image-import",
		Name:      "Image Import Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert image import repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-image-import",
		RepoID:    "repo-image-import",
		Slug:      "task-image-import",
		Title:     "Image import task",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert image import task: %v", err)
	}

	legacyDir := t.TempDir()
	legacyImagePath := filepath.Join(legacyDir, "legacy-import.png")
	imageBytes := []byte("legacy image bytes")
	writeFile(t, legacyImagePath, imageBytes)

	imported := resultObject(t, harness.request(t, "openade/task/image/importLegacy", map[string]any{
		"imageId":         "image-legacy-import",
		"ext":             "png",
		"mediaType":       "image/png",
		"sourcePath":      legacyImagePath,
		"clientRequestId": "image-import-1",
	}))
	hash := sha256.Sum256(imageBytes)
	hashString := hex.EncodeToString(hash[:])
	if imported["imageId"] != "image-legacy-import" || imported["size"] != float64(len(imageBytes)) || imported["sha256"] != hashString {
		t.Fatalf("image import result = %#v", imported)
	}
	if _, err := os.Stat(legacyImagePath); err != nil {
		t.Fatalf("legacy source should remain after import: %v", err)
	}
	blob, ok, err := harness.store.GetBlobMetadata(ctx, "image-legacy-import")
	if err != nil {
		t.Fatalf("get image import blob: %v", err)
	}
	if !ok || blob.Kind != "task_image" || blob.ContentType.String != "image/png" || blob.Path != filepath.Join(harness.blobDir, "images", "image-legacy-import.png") {
		t.Fatalf("image import blob = %#v, ok %v", blob, ok)
	}
	copiedBytes, err := os.ReadFile(blob.Path)
	if err != nil {
		t.Fatalf("read imported image blob: %v", err)
	}
	if string(copiedBytes) != string(imageBytes) {
		t.Fatalf("imported image bytes = %q", string(copiedBytes))
	}

	unreferenced := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image-import",
		"taskId":  "task-image-import",
		"imageId": "image-legacy-import",
		"ext":     "png",
	}))
	if unreferenced["data"] != nil {
		t.Fatalf("unreferenced imported image read = %#v", unreferenced)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-image-import",
		TaskID:    "task-image-import",
		Seq:       1,
		Type:      "action",
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: `{"id":"event-image-import","type":"action","images":[{"id":"image-legacy-import","ext":"png","mediaType":"image/png","originalWidth":1,"originalHeight":1,"resizedWidth":1,"resizedHeight":1}]}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert imported image action: %v", err)
	}
	referenced := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image-import",
		"taskId":  "task-image-import",
		"imageId": "image-legacy-import",
		"ext":     "png",
	}))
	if referenced["data"] != base64.StdEncoding.EncodeToString(imageBytes) || referenced["mediaType"] != "image/png" {
		t.Fatalf("referenced imported image read = %#v", referenced)
	}

	retried := resultObject(t, harness.request(t, "openade/task/image/importLegacy", map[string]any{
		"imageId":         "image-legacy-import",
		"ext":             "png",
		"mediaType":       "image/png",
		"sourcePath":      legacyImagePath,
		"clientRequestId": "image-import-1",
	}))
	if retried["sha256"] != imported["sha256"] {
		t.Fatalf("image import retry result = %#v", retried)
	}
	conflictPath := filepath.Join(legacyDir, "legacy-conflict.png")
	writeFile(t, conflictPath, []byte("different legacy image bytes"))
	conflict := harness.request(t, "openade/task/image/importLegacy", map[string]any{
		"imageId":         "image-legacy-import",
		"ext":             "png",
		"mediaType":       "image/png",
		"sourcePath":      conflictPath,
		"clientRequestId": "image-import-conflict",
	})
	if runtimeErrorCode(t, conflict) != "conflict" {
		t.Fatalf("image import conflict response = %#v", conflict)
	}
	missing := harness.request(t, "openade/task/image/importLegacy", map[string]any{
		"imageId":    "image-legacy-missing",
		"ext":        "png",
		"mediaType":  "image/png",
		"sourcePath": filepath.Join(legacyDir, "missing.png"),
	})
	if runtimeErrorCode(t, missing) != "invalid_params" {
		t.Fatalf("image import missing source response = %#v", missing)
	}
	invalidMediaType := harness.request(t, "openade/task/image/importLegacy", map[string]any{
		"imageId":    "image-legacy-invalid",
		"ext":        "png",
		"mediaType":  "image/jpeg",
		"sourcePath": legacyImagePath,
	})
	if runtimeErrorCode(t, invalidMediaType) != "invalid_params" {
		t.Fatalf("image import invalid media type response = %#v", invalidMediaType)
	}
}

func TestProductLegacyResourcesImportOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 15, 0, 0, 0, time.UTC)
	repoRoot := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-legacy-resource-import",
		Name:      "Legacy Resource Import Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert legacy resource import repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-legacy-resource-import",
		RepoID:    "repo-legacy-resource-import",
		Slug:      "task-legacy-resource-import",
		Title:     "Legacy Resource Import",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert legacy resource import task: %v", err)
	}

	noReferenceResourceDir := t.TempDir()
	noReferenceImported := resultObject(t, harness.request(t, "openade/import/legacyResources", map[string]any{
		"dataDir":         noReferenceResourceDir,
		"clientRequestId": "legacy-resources-import-no-references",
	}))
	noReferenceImages := objectField(t, noReferenceImported, "images")
	noReferenceSnapshots := objectField(t, noReferenceImported, "snapshots")
	if noReferenceImages["referencedImages"] != float64(0) || noReferenceSnapshots["referencedPatches"] != float64(0) {
		t.Fatalf("legacy resource no-reference import result = %#v", noReferenceImported)
	}
	if skipped := arrayField(t, noReferenceImported, "skipped"); len(skipped) != 0 {
		t.Fatalf("legacy resource no-reference import skipped = %#v", skipped)
	}

	dataDir := t.TempDir()
	imageDir := filepath.Join(dataDir, "images")
	snapshotDir := filepath.Join(dataDir, "snapshots")
	mkdirAll(t, imageDir)
	mkdirAll(t, snapshotDir)
	imageBytes := []byte("legacy resource image bytes")
	patch := "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n"
	writeFile(t, filepath.Join(imageDir, "legacy-resource-image.png"), imageBytes)
	writeFile(t, filepath.Join(snapshotDir, "legacy-resource-patch.patch"), []byte(patch))
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-legacy-resource-action",
		TaskID:    "task-legacy-resource-import",
		Seq:       1,
		Type:      "action",
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: `{"id":"event-legacy-resource-action","type":"action","images":[{"id":"legacy-resource-image","ext":"png","mediaType":"image/png"}]}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert legacy resource action event: %v", err)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-legacy-resource-snapshot",
		TaskID:    "task-legacy-resource-import",
		Seq:       2,
		Type:      "snapshot",
		CreatedAt: now.Add(time.Second),
		PayloadJSON: sql.NullString{
			String: `{"id":"event-legacy-resource-snapshot","type":"snapshot","patchFileId":"legacy-resource-patch"}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert legacy resource snapshot event: %v", err)
	}

	imported := resultObject(t, harness.request(t, "openade/import/legacyResources", map[string]any{
		"dataDir":         dataDir,
		"clientRequestId": "legacy-resources-import-1",
	}))
	images := objectField(t, imported, "images")
	if images["scannedTasks"] != float64(1) ||
		images["referencedImages"] != float64(1) ||
		images["importedImages"] != float64(1) ||
		images["alreadyImportedImages"] != float64(0) {
		t.Fatalf("legacy resource images result = %#v", images)
	}
	snapshots := objectField(t, imported, "snapshots")
	if snapshots["scannedTasks"] != float64(1) ||
		snapshots["referencedPatches"] != float64(1) ||
		snapshots["importedPatches"] != float64(1) ||
		snapshots["alreadyImportedPatches"] != float64(0) {
		t.Fatalf("legacy resource snapshots result = %#v", snapshots)
	}
	if skipped := arrayField(t, imported, "skipped"); len(skipped) != 0 {
		t.Fatalf("legacy resource import skipped = %#v", skipped)
	}

	imageRead := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-legacy-resource-import",
		"taskId":  "task-legacy-resource-import",
		"imageId": "legacy-resource-image",
		"ext":     "png",
	}))
	if imageRead["data"] != base64.StdEncoding.EncodeToString(imageBytes) || imageRead["mediaType"] != "image/png" {
		t.Fatalf("legacy resource image read = %#v", imageRead)
	}
	patchRead := resultObject(t, harness.request(t, "openade/task/snapshot/patch/read", map[string]any{
		"repoId":  "repo-legacy-resource-import",
		"taskId":  "task-legacy-resource-import",
		"eventId": "event-legacy-resource-snapshot",
	}))
	if patchRead["patch"] != patch || patchRead["patchFileId"] != "legacy-resource-patch" {
		t.Fatalf("legacy resource snapshot read = %#v", patchRead)
	}

	retried := resultObject(t, harness.request(t, "openade/import/legacyResources", map[string]any{
		"dataDir":         dataDir,
		"clientRequestId": "legacy-resources-import-1",
	}))
	retriedImages := objectField(t, retried, "images")
	retriedSnapshots := objectField(t, retried, "snapshots")
	if retriedImages["importedImages"] != images["importedImages"] || retriedSnapshots["importedPatches"] != snapshots["importedPatches"] {
		t.Fatalf("legacy resource import retry result = %#v", retried)
	}

	emptyDataDir := t.TempDir()
	skippedResult := resultObject(t, harness.request(t, "openade/import/legacyResources", map[string]any{
		"dataDir":         emptyDataDir,
		"clientRequestId": "legacy-resources-import-skipped",
	}))
	if skippedResult["images"] != nil || skippedResult["snapshots"] != nil {
		t.Fatalf("legacy resource missing subdir result = %#v", skippedResult)
	}
	skipped := arrayField(t, skippedResult, "skipped")
	if len(skipped) != 2 ||
		objectValue(t, skipped[0])["code"] != "source_missing" ||
		objectValue(t, skipped[1])["code"] != "source_missing" {
		t.Fatalf("legacy resource missing subdir skipped = %#v", skipped)
	}
	explicitMissingImageDir := harness.request(t, "openade/import/legacyResources", map[string]any{
		"imageDir": filepath.Join(dataDir, "missing-images"),
	})
	if runtimeErrorCode(t, explicitMissingImageDir) != "invalid_params" {
		t.Fatalf("legacy resource explicit missing image dir response = %#v", explicitMissingImageDir)
	}
}

func TestProductTaskImagesImportLegacyOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 13, 0, 0, 0, time.UTC)
	repoRoot := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-image-import-bulk",
		Name:      "Bulk Image Import Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert bulk image import repo: %v", err)
	}
	for _, taskID := range []string{"task-image-import-bulk-a", "task-image-import-bulk-b"} {
		if err := harness.store.UpsertTask(ctx, storage.Task{
			ID:        taskID,
			RepoID:    "repo-image-import-bulk",
			Slug:      taskID,
			Title:     taskID,
			CreatedAt: now,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert bulk image import task %s: %v", taskID, err)
		}
	}

	legacyDir := t.TempDir()
	eventBytes := []byte("bulk event image bytes")
	queuedBytes := []byte("bulk queued image bytes")
	alreadyBytes := []byte("already imported image bytes")
	writeFile(t, filepath.Join(legacyDir, "bulk-event.png"), eventBytes)
	writeFile(t, filepath.Join(legacyDir, "bulk-queued.webp"), queuedBytes)
	writeFile(t, filepath.Join(legacyDir, "bulk-already.jpg"), alreadyBytes)
	conflictPath := filepath.Join(harness.blobDir, "images", "bulk-conflict.png")
	if err := os.MkdirAll(filepath.Dir(conflictPath), 0o755); err != nil {
		t.Fatalf("create conflict blob dir: %v", err)
	}
	writeFile(t, conflictPath, []byte("existing conflict bytes"))
	if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          "bulk-conflict",
		Kind:        "task_image",
		ContentType: sql.NullString{String: "image/jpeg", Valid: true},
		SizeBytes:   int64(len("existing conflict bytes")),
		SHA256:      sha256String([]byte("existing conflict bytes")),
		Path:        conflictPath,
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("put conflict blob metadata: %v", err)
	}
	alreadyPath := filepath.Join(harness.blobDir, "images", "bulk-already.jpg")
	if err := os.MkdirAll(filepath.Dir(alreadyPath), 0o755); err != nil {
		t.Fatalf("create already blob dir: %v", err)
	}
	writeFile(t, alreadyPath, alreadyBytes)
	if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          "bulk-already",
		Kind:        "task_image",
		ContentType: sql.NullString{String: "image/jpeg", Valid: true},
		SizeBytes:   int64(len(alreadyBytes)),
		SHA256:      sha256String(alreadyBytes),
		Path:        alreadyPath,
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("put already blob metadata: %v", err)
	}

	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-image-import-bulk-a",
		TaskID:    "task-image-import-bulk-a",
		Seq:       1,
		Type:      "action",
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: `{"id":"event-image-import-bulk-a","type":"action","images":[{"id":"bulk-event","ext":"png","mediaType":"image/png"},{"id":"bulk-missing","ext":"gif","mediaType":"image/gif"},{"id":"bulk-already","ext":"jpg","mediaType":"image/jpeg"},{"id":"bulk-conflict","ext":"png","mediaType":"image/png"}]}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert bulk import action a: %v", err)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-image-import-bulk-b",
		TaskID:    "task-image-import-bulk-b",
		Seq:       1,
		Type:      "action",
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: `{"id":"event-image-import-bulk-b","type":"action","images":[{"id":"bulk-event","ext":"png","mediaType":"image/png"}]}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert bulk import action b: %v", err)
	}
	if _, _, err := harness.store.CreateQueuedTurn(ctx, storage.QueuedTurn{
		ID:        "queued-image-import-bulk",
		TaskID:    "task-image-import-bulk-a",
		Type:      "do",
		Input:     "use queued image",
		Status:    "queued",
		CreatedAt: now,
		UpdatedAt: now,
		PayloadJSON: sql.NullString{
			String: `{"images":[{"id":"bulk-queued","ext":"webp","mediaType":"image/webp"}]}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("create queued turn for bulk image import: %v", err)
	}

	imported := resultObject(t, harness.request(t, "openade/task/images/importLegacy", map[string]any{
		"sourceDir":       legacyDir,
		"clientRequestId": "bulk-image-import-1",
	}))
	if imported["scannedTasks"] != float64(2) ||
		imported["referencedImages"] != float64(5) ||
		imported["importedImages"] != float64(2) ||
		imported["alreadyImportedImages"] != float64(1) {
		t.Fatalf("bulk image import result = %#v", imported)
	}
	missingImages := arrayField(t, imported, "missingImages")
	if len(missingImages) != 1 || objectValue(t, missingImages[0])["imageId"] != "bulk-missing" || objectValue(t, missingImages[0])["code"] != "missing" {
		t.Fatalf("bulk image import missing = %#v", missingImages)
	}
	conflictedImages := arrayField(t, imported, "conflictedImages")
	if len(conflictedImages) != 1 || objectValue(t, conflictedImages[0])["imageId"] != "bulk-conflict" || objectValue(t, conflictedImages[0])["code"] != "conflict" {
		t.Fatalf("bulk image import conflicts = %#v", conflictedImages)
	}
	if failedImages := arrayField(t, imported, "failedImages"); len(failedImages) != 0 {
		t.Fatalf("bulk image import failures = %#v", failedImages)
	}

	for _, importedImage := range []struct {
		id        string
		ext       string
		mediaType string
		data      []byte
	}{
		{id: "bulk-event", ext: "png", mediaType: "image/png", data: eventBytes},
		{id: "bulk-queued", ext: "webp", mediaType: "image/webp", data: queuedBytes},
	} {
		blob, ok, err := harness.store.GetBlobMetadata(ctx, importedImage.id)
		if err != nil {
			t.Fatalf("get imported bulk blob %s: %v", importedImage.id, err)
		}
		if !ok || blob.Kind != "task_image" || blob.ContentType.String != importedImage.mediaType || blob.Path != filepath.Join(harness.blobDir, "images", importedImage.id+"."+importedImage.ext) {
			t.Fatalf("imported bulk blob %s = %#v, ok %v", importedImage.id, blob, ok)
		}
		data, err := os.ReadFile(blob.Path)
		if err != nil {
			t.Fatalf("read imported bulk blob %s: %v", importedImage.id, err)
		}
		if string(data) != string(importedImage.data) {
			t.Fatalf("imported bulk blob %s bytes = %q", importedImage.id, string(data))
		}
	}

	eventRead := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image-import-bulk",
		"taskId":  "task-image-import-bulk-a",
		"imageId": "bulk-event",
		"ext":     "png",
	}))
	if eventRead["data"] != base64.StdEncoding.EncodeToString(eventBytes) || eventRead["mediaType"] != "image/png" {
		t.Fatalf("bulk imported event read = %#v", eventRead)
	}
	queuedRead := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image-import-bulk",
		"taskId":  "task-image-import-bulk-a",
		"imageId": "bulk-queued",
		"ext":     "webp",
	}))
	if queuedRead["data"] != base64.StdEncoding.EncodeToString(queuedBytes) || queuedRead["mediaType"] != "image/webp" {
		t.Fatalf("bulk imported queued read = %#v", queuedRead)
	}

	retried := resultObject(t, harness.request(t, "openade/task/images/importLegacy", map[string]any{
		"sourceDir":       legacyDir,
		"clientRequestId": "bulk-image-import-1",
	}))
	if retried["importedImages"] != imported["importedImages"] || retried["alreadyImportedImages"] != imported["alreadyImportedImages"] {
		t.Fatalf("bulk image import retry result = %#v", retried)
	}
	missingSourceDir := harness.request(t, "openade/task/images/importLegacy", map[string]any{
		"sourceDir": filepath.Join(legacyDir, "missing-dir"),
	})
	if runtimeErrorCode(t, missingSourceDir) != "invalid_params" {
		t.Fatalf("bulk image import missing source dir response = %#v", missingSourceDir)
	}
	fileSourceDir := harness.request(t, "openade/task/images/importLegacy", map[string]any{
		"sourceDir": filepath.Join(legacyDir, "bulk-event.png"),
	})
	if runtimeErrorCode(t, fileSourceDir) != "invalid_params" {
		t.Fatalf("bulk image import file source dir response = %#v", fileSourceDir)
	}
}

func TestProductTaskImagesGCStagedOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Now().UTC()
	old := now.Add(-48 * time.Hour)
	imageDir := filepath.Join(harness.blobDir, "images")
	snapshotDir := filepath.Join(harness.blobDir, "snapshots")
	mkdirAll(t, imageDir)
	mkdirAll(t, snapshotDir)

	repoRoot := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-image-gc",
		Name:      "Image GC Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert image gc repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-image-gc",
		RepoID:    "repo-image-gc",
		Slug:      "task-image-gc",
		Title:     "Image GC",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert image gc task: %v", err)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-image-gc",
		TaskID:    "task-image-gc",
		Seq:       1,
		Type:      "action",
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: `{"id":"event-image-gc","type":"action","images":[{"id":"image-gc-event","ext":"png","mediaType":"image/png"}]}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert image gc event: %v", err)
	}
	if err := harness.store.UpsertQueuedTurn(ctx, storage.QueuedTurn{
		ID:          "queued-image-gc",
		TaskID:      "task-image-gc",
		Type:        "do",
		Input:       "use queued image",
		Status:      "queued",
		PayloadJSON: sql.NullString{String: `{"images":[{"id":"image-gc-queued","ext":"webp","mediaType":"image/webp"}]}`, Valid: true},
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("upsert image gc queued turn: %v", err)
	}

	blobs := []struct {
		id          string
		kind        string
		contentType string
		filename    string
		data        []byte
		createdAt   time.Time
	}{
		{id: "image-gc-orphan-old", kind: "task_image", contentType: "image/png", filename: filepath.Join(imageDir, "image-gc-orphan-old.png"), data: []byte("old orphan image"), createdAt: old},
		{id: "image-gc-orphan-young", kind: "task_image", contentType: "image/png", filename: filepath.Join(imageDir, "image-gc-orphan-young.png"), data: []byte("young orphan image"), createdAt: now},
		{id: "image-gc-event", kind: "task_image", contentType: "image/png", filename: filepath.Join(imageDir, "image-gc-event.png"), data: []byte("event image"), createdAt: old},
		{id: "image-gc-queued", kind: "task_image", contentType: "image/webp", filename: filepath.Join(imageDir, "image-gc-queued.webp"), data: []byte("queued image"), createdAt: old},
		{id: "patch-gc-old", kind: "snapshot_patch", contentType: "text/x-patch", filename: filepath.Join(snapshotDir, "patch-gc-old.patch"), data: []byte("patch data"), createdAt: old},
	}
	for _, blob := range blobs {
		writeFile(t, blob.filename, blob.data)
		if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
			ID:          blob.id,
			Kind:        blob.kind,
			ContentType: sql.NullString{String: blob.contentType, Valid: true},
			SizeBytes:   int64(len(blob.data)),
			SHA256:      sha256String(blob.data),
			Path:        blob.filename,
			CreatedAt:   blob.createdAt,
		}); err != nil {
			t.Fatalf("put image gc blob %s: %v", blob.id, err)
		}
	}

	olderThanMs := int64(time.Hour / time.Millisecond)
	dryRun := resultObject(t, harness.request(t, "openade/task/images/gcStaged", map[string]any{
		"olderThanMs": olderThanMs,
		"dryRun":      true,
	}))
	if dryRun["scannedImages"] != float64(4) ||
		dryRun["scannedTasks"] != float64(1) ||
		dryRun["referencedImages"] != float64(2) ||
		dryRun["eligibleImages"] != float64(1) ||
		dryRun["deletedImages"] != float64(0) ||
		dryRun["retainedImages"] != float64(3) ||
		dryRun["dryRun"] != true {
		t.Fatalf("image gc dry run result = %#v", dryRun)
	}
	if failedImages := arrayField(t, dryRun, "failedImages"); len(failedImages) != 0 {
		t.Fatalf("image gc dry run failures = %#v", failedImages)
	}
	assertPathExists(t, filepath.Join(imageDir, "image-gc-orphan-old.png"))

	deleted := resultObject(t, harness.request(t, "openade/task/images/gcStaged", map[string]any{
		"olderThanMs": olderThanMs,
	}))
	if deleted["scannedImages"] != float64(4) ||
		deleted["referencedImages"] != float64(2) ||
		deleted["eligibleImages"] != float64(1) ||
		deleted["deletedImages"] != float64(1) ||
		deleted["retainedImages"] != float64(3) {
		t.Fatalf("image gc delete result = %#v", deleted)
	}
	if failedImages := arrayField(t, deleted, "failedImages"); len(failedImages) != 0 {
		t.Fatalf("image gc delete failures = %#v", failedImages)
	}
	if _, ok, err := harness.store.GetBlobMetadata(ctx, "image-gc-orphan-old"); err != nil {
		t.Fatalf("get gc-deleted image metadata: %v", err)
	} else if ok {
		t.Fatal("gc-deleted image metadata still exists")
	}
	assertPathMissing(t, filepath.Join(imageDir, "image-gc-orphan-old.png"))
	for _, id := range []string{"image-gc-orphan-young", "image-gc-event", "image-gc-queued", "patch-gc-old"} {
		if _, ok, err := harness.store.GetBlobMetadata(ctx, id); err != nil {
			t.Fatalf("get retained gc metadata %s: %v", id, err)
		} else if !ok {
			t.Fatalf("retained gc metadata %s was deleted", id)
		}
	}
	for _, path := range []string{
		filepath.Join(imageDir, "image-gc-orphan-young.png"),
		filepath.Join(imageDir, "image-gc-event.png"),
		filepath.Join(imageDir, "image-gc-queued.webp"),
		filepath.Join(snapshotDir, "patch-gc-old.patch"),
	} {
		assertPathExists(t, path)
	}

	referenced := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-image-gc",
		"taskId":  "task-image-gc",
		"imageId": "image-gc-event",
		"ext":     "png",
	}))
	if referenced["data"] != base64.StdEncoding.EncodeToString([]byte("event image")) {
		t.Fatalf("referenced image after gc = %#v", referenced)
	}
}

func TestProductTaskSnapshotPatchReadsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	patchDir := t.TempDir()
	externalPatch := "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n-old\n+new\n+line\n"
	inlinePatch := "diff --git a/src/app.ts b/src/app.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/app.ts\n@@ -0,0 +1 @@\n+export const value = 1\n"
	externalPatchPath := filepath.Join(patchDir, "patch-external.patch")
	writeFile(t, externalPatchPath, []byte(externalPatch))
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-snapshot",
		Name:      "Snapshot Repo",
		Path:      patchDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert snapshot repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-snapshot",
		RepoID:    "repo-snapshot",
		Slug:      "task-snapshot",
		Title:     "Snapshot task",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert snapshot task: %v", err)
	}
	for _, event := range []storage.TaskEvent{
		{
			ID:          "snapshot-inline",
			TaskID:      "task-snapshot",
			Seq:         1,
			Type:        "snapshot",
			CreatedAt:   now,
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-inline","type":"snapshot","fullPatch":` + jsonString(inlinePatch) + `}`, Valid: true},
		},
		{
			ID:          "snapshot-external",
			TaskID:      "task-snapshot",
			Seq:         2,
			Type:        "snapshot",
			CreatedAt:   now.Add(time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-external","type":"snapshot","patchFileId":"patch-external"}`, Valid: true},
		},
		{
			ID:          "snapshot-missing",
			TaskID:      "task-snapshot",
			Seq:         3,
			Type:        "snapshot",
			CreatedAt:   now.Add(2 * time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-missing","type":"snapshot","patchFileId":"patch-missing"}`, Valid: true},
		},
		{
			ID:          "snapshot-invalid",
			TaskID:      "task-snapshot",
			Seq:         4,
			Type:        "snapshot",
			CreatedAt:   now.Add(3 * time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-invalid","type":"snapshot","patchFileId":"../bad"}`, Valid: true},
		},
	} {
		if err := harness.store.UpsertTaskEvent(ctx, event); err != nil {
			t.Fatalf("upsert snapshot event %s: %v", event.ID, err)
		}
	}
	if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          "patch-external",
		Kind:        "snapshot_patch",
		ContentType: sql.NullString{String: "text/x-patch", Valid: true},
		SizeBytes:   int64(len([]byte(externalPatch))),
		SHA256:      "sha-patch",
		Path:        externalPatchPath,
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("put snapshot patch blob: %v", err)
	}

	inlineRead := resultObject(t, harness.request(t, "openade/task/snapshot/patch/read", map[string]any{
		"repoId":  "repo-snapshot",
		"taskId":  "task-snapshot",
		"eventId": "snapshot-inline",
	}))
	if inlineRead["patch"] != inlinePatch || inlineRead["patchFileId"] != nil {
		t.Fatalf("inline patch read = %#v", inlineRead)
	}
	externalRead := resultObject(t, harness.request(t, "openade/task/snapshot/patch/read", map[string]any{
		"repoId":  "repo-snapshot",
		"taskId":  "task-snapshot",
		"eventId": "snapshot-external",
	}))
	if externalRead["patch"] != externalPatch || externalRead["patchFileId"] != "patch-external" {
		t.Fatalf("external patch read = %#v", externalRead)
	}
	indexRead := resultObject(t, harness.request(t, "openade/task/snapshot/index/read", map[string]any{
		"repoId":  "repo-snapshot",
		"taskId":  "task-snapshot",
		"eventId": "snapshot-external",
	}))
	index := objectField(t, indexRead, "index")
	if index["version"] != float64(1) || index["patchSize"] != float64(len([]byte(externalPatch))) {
		t.Fatalf("snapshot patch index = %#v", index)
	}
	files := arrayField(t, index, "files")
	if len(files) != 1 {
		t.Fatalf("snapshot patch index files = %#v", files)
	}
	file := objectValue(t, files[0])
	if file["path"] != "README.md" || file["status"] != "modified" || file["insertions"] != float64(2) || file["deletions"] != float64(1) || file["hunkCount"] != float64(1) {
		t.Fatalf("snapshot patch index file = %#v", file)
	}
	sliceEnd := len([]byte("diff --git"))
	sliceRead := resultObject(t, harness.request(t, "openade/task/snapshot/patch/readSlice", map[string]any{
		"repoId":  "repo-snapshot",
		"taskId":  "task-snapshot",
		"eventId": "snapshot-external",
		"start":   0,
		"end":     sliceEnd,
	}))
	if sliceRead["patch"] != "diff --git" || sliceRead["patchFileId"] != "patch-external" {
		t.Fatalf("snapshot patch slice = %#v", sliceRead)
	}
	missingRead := resultObject(t, harness.request(t, "openade/task/snapshot/patch/read", map[string]any{
		"repoId":  "repo-snapshot",
		"taskId":  "task-snapshot",
		"eventId": "snapshot-missing",
	}))
	if missingRead["patch"] != nil || missingRead["patchFileId"] != "patch-missing" {
		t.Fatalf("missing snapshot patch read = %#v", missingRead)
	}
	invalidPatchID := harness.request(t, "openade/task/snapshot/patch/read", map[string]any{
		"repoId":  "repo-snapshot",
		"taskId":  "task-snapshot",
		"eventId": "snapshot-invalid",
	})
	if runtimeErrorCode(t, invalidPatchID) != "invalid_params" {
		t.Fatalf("invalid snapshot patch id response = %#v", invalidPatchID)
	}
	invalidSlice := harness.request(t, "openade/task/snapshot/patch/readSlice", map[string]any{
		"repoId":  "repo-snapshot",
		"taskId":  "task-snapshot",
		"eventId": "snapshot-external",
		"start":   0,
		"end":     len([]byte(externalPatch)) + 1,
	})
	if runtimeErrorCode(t, invalidSlice) != "invalid_params" {
		t.Fatalf("invalid snapshot slice response = %#v", invalidSlice)
	}
}

func TestProductSnapshotCreateWritesCoreBlobOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 10, 30, 0, 0, time.UTC)
	repoRoot := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-snapshot-create",
		Name:      "Snapshot Create Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert snapshot create repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-snapshot-create",
		RepoID:    "repo-snapshot-create",
		Slug:      "task-snapshot-create",
		Title:     "Snapshot create task",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert snapshot create task: %v", err)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:          "action-snapshot-create",
		TaskID:      "task-snapshot-create",
		Seq:         1,
		Type:        "action",
		Status:      sql.NullString{String: "completed", Valid: true},
		CreatedAt:   now,
		PayloadJSON: sql.NullString{String: `{"id":"action-snapshot-create","type":"action","status":"completed"}`, Valid: true},
	}); err != nil {
		t.Fatalf("upsert snapshot create action: %v", err)
	}

	patch := "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n-old\n+new\n+line\n"
	startNotifications := len(harness.notifications)
	createdAt := now.Add(time.Minute).Format(time.RFC3339Nano)
	created := resultObject(t, harness.request(t, "openade/snapshot/create", map[string]any{
		"taskId":          "task-snapshot-create",
		"actionEventId":   "action-snapshot-create",
		"referenceBranch": "main",
		"mergeBaseCommit": "abc123",
		"fullPatch":       patch,
		"stats": map[string]any{
			"filesChanged": 1,
			"insertions":   2,
			"deletions":    1,
		},
		"files": []map[string]any{
			{"path": "README.md", "status": "modified"},
		},
		"eventId":         "snapshot-core-create",
		"createdAt":       createdAt,
		"clientRequestId": "snapshot-create-1",
	}))
	if created["eventId"] != "snapshot-core-create" || created["createdAt"] != createdAt {
		t.Fatalf("snapshot create result = %#v", created)
	}
	harness.waitForNotification(t, startNotifications, "openade/task/updated")
	harness.waitForNotification(t, startNotifications, "openade/snapshotChanged")

	blob, ok, err := harness.store.GetBlobMetadata(ctx, "snapshot-core-create")
	if err != nil {
		t.Fatalf("get snapshot blob metadata: %v", err)
	}
	if !ok || blob.Kind != "snapshot_patch" || blob.Path != filepath.Join(harness.blobDir, "snapshots", "snapshot-core-create.patch") {
		t.Fatalf("snapshot blob metadata = %#v, ok %v", blob, ok)
	}
	hash := sha256.Sum256([]byte(patch))
	if blob.SizeBytes != int64(len([]byte(patch))) || blob.SHA256 != hex.EncodeToString(hash[:]) {
		t.Fatalf("snapshot blob size/hash = %#v", blob)
	}
	data, err := os.ReadFile(blob.Path)
	if err != nil {
		t.Fatalf("read snapshot blob file: %v", err)
	}
	if string(data) != patch {
		t.Fatalf("snapshot blob file = %q", string(data))
	}

	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-snapshot-create",
		"taskId":               "task-snapshot-create",
		"hydrateSessionEvents": true,
	}))
	events := arrayField(t, task, "events")
	if len(events) != 2 {
		t.Fatalf("snapshot create task events = %#v", events)
	}
	snapshot := objectValue(t, events[1])
	if snapshot["id"] != "snapshot-core-create" || snapshot["type"] != "snapshot" || snapshot["fullPatch"] != "" || snapshot["patchFileId"] != "snapshot-core-create" {
		t.Fatalf("snapshot event payload = %#v", snapshot)
	}
	if objectField(t, snapshot, "stats")["insertions"] != float64(2) {
		t.Fatalf("snapshot stats = %#v", objectField(t, snapshot, "stats"))
	}

	read := resultObject(t, harness.request(t, "openade/task/snapshot/patch/read", map[string]any{
		"repoId":  "repo-snapshot-create",
		"taskId":  "task-snapshot-create",
		"eventId": "snapshot-core-create",
	}))
	if read["patch"] != patch || read["patchFileId"] != "snapshot-core-create" {
		t.Fatalf("snapshot create patch read = %#v", read)
	}
	indexRead := resultObject(t, harness.request(t, "openade/task/snapshot/index/read", map[string]any{
		"repoId":  "repo-snapshot-create",
		"taskId":  "task-snapshot-create",
		"eventId": "snapshot-core-create",
	}))
	index := objectField(t, indexRead, "index")
	if index["patchSize"] != float64(len([]byte(patch))) || len(arrayField(t, index, "files")) != 1 {
		t.Fatalf("snapshot create index = %#v", index)
	}
	slice := resultObject(t, harness.request(t, "openade/task/snapshot/patch/readSlice", map[string]any{
		"repoId":  "repo-snapshot-create",
		"taskId":  "task-snapshot-create",
		"eventId": "snapshot-core-create",
		"start":   0,
		"end":     len([]byte("diff --git")),
	}))
	if slice["patch"] != "diff --git" {
		t.Fatalf("snapshot create slice = %#v", slice)
	}

	retried := resultObject(t, harness.request(t, "openade/snapshot/create", map[string]any{
		"taskId":          "task-snapshot-create",
		"actionEventId":   "action-snapshot-create",
		"referenceBranch": "main",
		"mergeBaseCommit": "abc123",
		"fullPatch":       "diff --git a/other b/other\n+ignored\n",
		"stats": map[string]any{
			"filesChanged": 1,
			"insertions":   1,
			"deletions":    0,
		},
		"eventId":         "snapshot-core-create",
		"createdAt":       now.Add(2 * time.Minute).Format(time.RFC3339Nano),
		"clientRequestId": "snapshot-create-1",
	}))
	if retried["createdAt"] != created["createdAt"] {
		t.Fatalf("snapshot create retry result = %#v", retried)
	}

	missingAction := harness.request(t, "openade/snapshot/create", map[string]any{
		"taskId":          "task-snapshot-create",
		"actionEventId":   "missing-action",
		"referenceBranch": "main",
		"mergeBaseCommit": "abc123",
		"fullPatch":       patch,
		"stats": map[string]any{
			"filesChanged": 1,
			"insertions":   2,
			"deletions":    1,
		},
	})
	if runtimeErrorCode(t, missingAction) != "not_found" {
		t.Fatalf("missing action snapshot create response = %#v", missingAction)
	}
}

func TestProductTaskSnapshotsImportLegacyOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 14, 0, 0, 0, time.UTC)
	repoRoot := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-snapshot-import",
		Name:      "Snapshot Import Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert snapshot import repo: %v", err)
	}
	for _, taskID := range []string{"task-snapshot-import-a", "task-snapshot-import-b"} {
		if err := harness.store.UpsertTask(ctx, storage.Task{
			ID:        taskID,
			RepoID:    "repo-snapshot-import",
			Slug:      taskID,
			Title:     taskID,
			CreatedAt: now,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert snapshot import task %s: %v", taskID, err)
		}
	}

	legacyDir := t.TempDir()
	patch := "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n"
	alreadyPatch := "diff --git a/already b/already\n+already\n"
	writeFile(t, filepath.Join(legacyDir, "patch-import.patch"), []byte(patch))
	writeFile(t, filepath.Join(legacyDir, "patch-already.patch"), []byte(alreadyPatch))
	alreadyPath := filepath.Join(harness.blobDir, "snapshots", "patch-already.patch")
	conflictPath := filepath.Join(harness.blobDir, "snapshots", "patch-conflict.patch")
	if err := os.MkdirAll(filepath.Dir(alreadyPath), 0o755); err != nil {
		t.Fatalf("create snapshot blob dir: %v", err)
	}
	writeFile(t, alreadyPath, []byte(alreadyPatch))
	writeFile(t, conflictPath, []byte("existing conflict patch"))
	if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          "patch-already",
		Kind:        "snapshot_patch",
		ContentType: sql.NullString{String: "text/x-patch", Valid: true},
		SizeBytes:   int64(len(alreadyPatch)),
		SHA256:      sha256String([]byte(alreadyPatch)),
		Path:        alreadyPath,
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("put already snapshot blob metadata: %v", err)
	}
	if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          "patch-conflict",
		Kind:        "snapshot_patch",
		ContentType: sql.NullString{String: "application/octet-stream", Valid: true},
		SizeBytes:   int64(len("existing conflict patch")),
		SHA256:      sha256String([]byte("existing conflict patch")),
		Path:        conflictPath,
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("put conflict snapshot blob metadata: %v", err)
	}

	for _, event := range []storage.TaskEvent{
		{
			ID:        "snapshot-import",
			TaskID:    "task-snapshot-import-a",
			Seq:       1,
			Type:      "snapshot",
			CreatedAt: now,
			PayloadJSON: sql.NullString{
				String: `{"id":"snapshot-import","type":"snapshot","patchFileId":"patch-import"}`,
				Valid:  true,
			},
		},
		{
			ID:        "snapshot-missing-import",
			TaskID:    "task-snapshot-import-a",
			Seq:       2,
			Type:      "snapshot",
			CreatedAt: now.Add(time.Second),
			PayloadJSON: sql.NullString{
				String: `{"id":"snapshot-missing-import","type":"snapshot","patchFileId":"patch-missing"}`,
				Valid:  true,
			},
		},
		{
			ID:        "snapshot-already-import",
			TaskID:    "task-snapshot-import-a",
			Seq:       3,
			Type:      "snapshot",
			CreatedAt: now.Add(2 * time.Second),
			PayloadJSON: sql.NullString{
				String: `{"id":"snapshot-already-import","type":"snapshot","patchFileId":"patch-already"}`,
				Valid:  true,
			},
		},
		{
			ID:        "snapshot-conflict-import",
			TaskID:    "task-snapshot-import-a",
			Seq:       4,
			Type:      "snapshot",
			CreatedAt: now.Add(3 * time.Second),
			PayloadJSON: sql.NullString{
				String: `{"id":"snapshot-conflict-import","type":"snapshot","patchFileId":"patch-conflict"}`,
				Valid:  true,
			},
		},
		{
			ID:        "snapshot-import-duplicate",
			TaskID:    "task-snapshot-import-b",
			Seq:       1,
			Type:      "snapshot",
			CreatedAt: now,
			PayloadJSON: sql.NullString{
				String: `{"id":"snapshot-import-duplicate","type":"snapshot","patchFileId":"patch-import"}`,
				Valid:  true,
			},
		},
		{
			ID:        "snapshot-invalid-import",
			TaskID:    "task-snapshot-import-b",
			Seq:       2,
			Type:      "snapshot",
			CreatedAt: now.Add(time.Second),
			PayloadJSON: sql.NullString{
				String: `{"id":"snapshot-invalid-import","type":"snapshot","patchFileId":"../bad"}`,
				Valid:  true,
			},
		},
	} {
		if err := harness.store.UpsertTaskEvent(ctx, event); err != nil {
			t.Fatalf("upsert snapshot import event %s: %v", event.ID, err)
		}
	}

	imported := resultObject(t, harness.request(t, "openade/task/snapshots/importLegacy", map[string]any{
		"sourceDir":       legacyDir,
		"clientRequestId": "snapshot-import-1",
	}))
	if imported["scannedTasks"] != float64(2) ||
		imported["referencedPatches"] != float64(4) ||
		imported["importedPatches"] != float64(1) ||
		imported["alreadyImportedPatches"] != float64(1) {
		t.Fatalf("snapshot patch import result = %#v", imported)
	}
	missingPatches := arrayField(t, imported, "missingPatches")
	if len(missingPatches) != 1 || objectValue(t, missingPatches[0])["patchFileId"] != "patch-missing" || objectValue(t, missingPatches[0])["code"] != "missing" {
		t.Fatalf("snapshot patch missing = %#v", missingPatches)
	}
	conflictedPatches := arrayField(t, imported, "conflictedPatches")
	if len(conflictedPatches) != 1 || objectValue(t, conflictedPatches[0])["patchFileId"] != "patch-conflict" || objectValue(t, conflictedPatches[0])["code"] != "conflict" {
		t.Fatalf("snapshot patch conflicts = %#v", conflictedPatches)
	}
	if failedPatches := arrayField(t, imported, "failedPatches"); len(failedPatches) != 0 {
		t.Fatalf("snapshot patch failures = %#v", failedPatches)
	}

	blob, ok, err := harness.store.GetBlobMetadata(ctx, "patch-import")
	if err != nil {
		t.Fatalf("get imported snapshot patch blob: %v", err)
	}
	if !ok || blob.Kind != "snapshot_patch" || blob.ContentType.String != "text/x-patch" || blob.Path != filepath.Join(harness.blobDir, "snapshots", "patch-import.patch") {
		t.Fatalf("imported snapshot patch blob = %#v, ok %v", blob, ok)
	}
	data, err := os.ReadFile(blob.Path)
	if err != nil {
		t.Fatalf("read imported snapshot patch blob: %v", err)
	}
	if string(data) != patch {
		t.Fatalf("imported snapshot patch bytes = %q", string(data))
	}
	read := resultObject(t, harness.request(t, "openade/task/snapshot/patch/read", map[string]any{
		"repoId":  "repo-snapshot-import",
		"taskId":  "task-snapshot-import-a",
		"eventId": "snapshot-import",
	}))
	if read["patch"] != patch || read["patchFileId"] != "patch-import" {
		t.Fatalf("imported snapshot patch read = %#v", read)
	}
	indexRead := resultObject(t, harness.request(t, "openade/task/snapshot/index/read", map[string]any{
		"repoId":  "repo-snapshot-import",
		"taskId":  "task-snapshot-import-a",
		"eventId": "snapshot-import",
	}))
	index := objectField(t, indexRead, "index")
	if index["patchSize"] != float64(len([]byte(patch))) || len(arrayField(t, index, "files")) != 1 {
		t.Fatalf("imported snapshot patch index = %#v", index)
	}

	retried := resultObject(t, harness.request(t, "openade/task/snapshots/importLegacy", map[string]any{
		"sourceDir":       legacyDir,
		"clientRequestId": "snapshot-import-1",
	}))
	if retried["importedPatches"] != imported["importedPatches"] || retried["alreadyImportedPatches"] != imported["alreadyImportedPatches"] {
		t.Fatalf("snapshot patch import retry result = %#v", retried)
	}
	missingSourceDir := harness.request(t, "openade/task/snapshots/importLegacy", map[string]any{
		"sourceDir": filepath.Join(legacyDir, "missing-dir"),
	})
	if runtimeErrorCode(t, missingSourceDir) != "invalid_params" {
		t.Fatalf("snapshot patch missing source dir response = %#v", missingSourceDir)
	}
	fileSourceDir := harness.request(t, "openade/task/snapshots/importLegacy", map[string]any{
		"sourceDir": filepath.Join(legacyDir, "patch-import.patch"),
	})
	if runtimeErrorCode(t, fileSourceDir) != "invalid_params" {
		t.Fatalf("snapshot patch file source dir response = %#v", fileSourceDir)
	}
}

func TestProductTaskHarnessSessionsImportLegacyWritesCoreBlobsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 8, 18, 0, 0, 0, time.UTC)
	repoRoot := t.TempDir()
	claudeHome := t.TempDir()
	codexHome := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-session-import",
		Name:      "Session import repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert session import repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:           "task-session-import",
		RepoID:       "repo-session-import",
		Slug:         "task-session-import",
		Title:        "Session import",
		MetadataJSON: sql.NullString{String: `{"sessionIds":{"main":"claude-main-session","already":"claude-already-session","missing":"claude-missing-session"}}`, Valid: true},
		CreatedAt:    now,
		UpdatedAt:    now,
	}); err != nil {
		t.Fatalf("upsert session import task: %v", err)
	}
	codexSessionID := "33333333-3333-3333-3333-333333333333"
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-session-import",
		TaskID:    "task-session-import",
		Seq:       1,
		Type:      "action",
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: fmt.Sprintf(`{"id":"event-session-import","type":"action","status":"completed","execution":{"harnessId":"codex","sessionId":%q},"hyperplanSubExecutions":[{"harnessId":"claude-code","sessionId":"claude-sub-session"}]}`, codexSessionID),
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert session import event: %v", err)
	}

	encodedRepoPath := strings.NewReplacer("/", "-", "\\", "-").Replace(repoRoot)
	claudeProjectDir := filepath.Join(claudeHome, "projects", encodedRepoPath)
	mkdirAll(t, claudeProjectDir)
	claudeMainPath := filepath.Join(claudeProjectDir, "claude-main-session.jsonl")
	claudeAlreadyPath := filepath.Join(claudeProjectDir, "claude-already-session.jsonl")
	claudeSubPath := filepath.Join(claudeProjectDir, "claude-sub-session.jsonl")
	claudeKeepPath := filepath.Join(claudeProjectDir, "claude-keep-session.jsonl")
	claudeMainData := []byte(`{"type":"main"}` + "\n")
	claudeAlreadyData := []byte(`{"type":"already"}` + "\n")
	claudeSubData := []byte(`{"type":"sub"}` + "\n")
	writeFile(t, claudeMainPath, claudeMainData)
	writeFile(t, claudeAlreadyPath, claudeAlreadyData)
	writeFile(t, claudeSubPath, claudeSubData)
	writeFile(t, claudeKeepPath, []byte("{}\n"))

	codexSessionPath := filepath.Join(codexHome, "sessions", "2026", "06", "08", "rollout-2026-06-08T18-00-00-"+codexSessionID+".jsonl")
	codexSessionData := []byte(`{"type":"codex"}` + "\n")
	mkdirAll(t, filepath.Dir(codexSessionPath))
	writeFile(t, codexSessionPath, codexSessionData)

	alreadyBlobPath := filepath.Join(harness.blobDir, "sessions", "claude-code", "claude-already-session.jsonl")
	mkdirAll(t, filepath.Dir(alreadyBlobPath))
	writeFile(t, alreadyBlobPath, claudeAlreadyData)
	if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          "harness_session:claude-code:claude-already-session",
		Kind:        "harness_session",
		ContentType: sql.NullString{String: "application/x-ndjson", Valid: true},
		SizeBytes:   int64(len(claudeAlreadyData)),
		SHA256:      sha256String(claudeAlreadyData),
		Path:        alreadyBlobPath,
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("put already session blob metadata: %v", err)
	}

	imported := resultObject(t, harness.request(t, "openade/task/sessions/importLegacy", map[string]any{
		"claudeConfigDir": claudeHome,
		"codexHome":       codexHome,
		"clientRequestId": "session-import-1",
	}))
	if imported["scannedTasks"] != float64(1) ||
		imported["referencedSessions"] != float64(5) ||
		imported["importedSessions"] != float64(3) ||
		imported["alreadyImportedSessions"] != float64(1) {
		t.Fatalf("session import result = %#v", imported)
	}
	missingSessions := arrayField(t, imported, "missingSessions")
	if len(missingSessions) != 1 || objectValue(t, missingSessions[0])["sessionId"] != "claude-missing-session" || objectValue(t, missingSessions[0])["code"] != "missing" {
		t.Fatalf("session import missing = %#v", missingSessions)
	}
	if conflictedSessions := arrayField(t, imported, "conflictedSessions"); len(conflictedSessions) != 0 {
		t.Fatalf("session import conflicts = %#v", conflictedSessions)
	}
	if failedSessions := arrayField(t, imported, "failedSessions"); len(failedSessions) != 0 {
		t.Fatalf("session import failures = %#v", failedSessions)
	}

	for _, importedSession := range []struct {
		blobID    string
		harnessID string
		sessionID string
		data      []byte
	}{
		{blobID: "harness_session:claude-code:claude-main-session", harnessID: "claude-code", sessionID: "claude-main-session", data: claudeMainData},
		{blobID: "harness_session:claude-code:claude-sub-session", harnessID: "claude-code", sessionID: "claude-sub-session", data: claudeSubData},
		{blobID: "harness_session:codex:" + codexSessionID, harnessID: "codex", sessionID: codexSessionID, data: codexSessionData},
	} {
		blob, ok, err := harness.store.GetBlobMetadata(ctx, importedSession.blobID)
		if err != nil {
			t.Fatalf("get imported session blob %s: %v", importedSession.blobID, err)
		}
		expectedPath := filepath.Join(harness.blobDir, "sessions", importedSession.harnessID, importedSession.sessionID+".jsonl")
		if !ok || blob.Kind != "harness_session" || blob.ContentType.String != "application/x-ndjson" || blob.Path != expectedPath {
			t.Fatalf("imported session blob %s = %#v, ok %v", importedSession.blobID, blob, ok)
		}
		data, err := os.ReadFile(blob.Path)
		if err != nil {
			t.Fatalf("read imported session blob %s: %v", importedSession.blobID, err)
		}
		if string(data) != string(importedSession.data) {
			t.Fatalf("imported session blob %s bytes = %q", importedSession.blobID, string(data))
		}
	}
	for _, sourcePath := range []string{claudeMainPath, claudeAlreadyPath, claudeSubPath, claudeKeepPath, codexSessionPath} {
		assertPathExists(t, sourcePath)
	}

	retried := resultObject(t, harness.request(t, "openade/task/sessions/importLegacy", map[string]any{
		"claudeConfigDir": claudeHome,
		"codexHome":       codexHome,
		"clientRequestId": "session-import-1",
	}))
	if retried["importedSessions"] != imported["importedSessions"] || retried["alreadyImportedSessions"] != imported["alreadyImportedSessions"] {
		t.Fatalf("session import retry result = %#v", retried)
	}
	orchestrated := resultObject(t, harness.request(t, "openade/import/legacyResources", map[string]any{
		"importSessions":  true,
		"claudeConfigDir": claudeHome,
		"codexHome":       codexHome,
		"clientRequestId": "session-import-orchestrated",
	}))
	sessions := objectField(t, orchestrated, "sessions")
	if sessions["referencedSessions"] != float64(5) || sessions["alreadyImportedSessions"] != float64(4) {
		t.Fatalf("orchestrated session import = %#v", orchestrated)
	}
}

func TestProductTaskListAndErrorsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)

	previews := resultArray(t, harness.request(t, "openade/task/list", map[string]any{
		"repoId": "repo-1",
	}))
	if len(previews) != 1 || objectValue(t, previews[0])["id"] != "task-1" {
		t.Fatalf("task list = %#v", previews)
	}

	missing := harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-1",
		"taskId": "missing",
	})
	if runtimeErrorCode(t, missing) != "not_found" {
		t.Fatalf("missing task response = %#v", missing)
	}

	invalid := harness.request(t, "openade/task/list", map[string]any{})
	if runtimeErrorCode(t, invalid) != "invalid_params" {
		t.Fatalf("invalid task list response = %#v", invalid)
	}
}

func TestProductTaskCreateOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	createdAt := time.Date(2026, 6, 5, 13, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-task-create",
		Name:      "Task Create Repo",
		Path:      "/tmp/task-create",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert task create repo: %v", err)
	}

	notificationStart := len(harness.notifications)
	created := resultObject(t, harness.request(t, "openade/task/create", map[string]any{
		"repoId":    "repo-task-create",
		"taskId":    "task-created",
		"slug":      "task-created-slug",
		"title":     "Created through core",
		"input":     "Create this task through OpenADE Core",
		"createdAt": "2026-06-05T13:00:00Z",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"deviceId": "device-1",
		"isolationStrategy": map[string]any{
			"type":         "worktree",
			"sourceBranch": "main",
		},
		"enabledMcpServerIds": []string{"server-1", "server-2"},
		"deviceEnvironment": map[string]any{
			"id":              "device-env-1",
			"deviceId":        "device-1",
			"worktreeDir":     "openade/task-created",
			"setupComplete":   true,
			"mergeBaseCommit": "abcdef123456",
			"createdAt":       "2026-06-05T13:00:00Z",
			"lastUsedAt":      "2026-06-05T13:00:00Z",
		},
		"setupEvent": map[string]any{
			"eventId":     "setup-created",
			"worktreeId":  "task-created",
			"deviceId":    "device-1",
			"workingDir":  "/tmp/task-create-worktree",
			"setupOutput": "created worktree",
			"createdAt":   "2026-06-05T13:00:01Z",
			"completedAt": "2026-06-05T13:00:02Z",
		},
	}))
	if created["taskId"] != "task-created" || created["slug"] != "task-created-slug" || created["title"] != "Created through core" || created["createdAt"] != "2026-06-05T13:00:00Z" {
		t.Fatalf("created task result = %#v", created)
	}
	notifications := harness.waitForNotifications(t, notificationStart, 3)
	seen := map[string]bool{}
	for _, notification := range notifications {
		seen[notification["method"].(string)] = true
		params := objectField(t, notification, "params")
		if params["repoId"] != "repo-task-create" || params["taskId"] != "task-created" {
			t.Fatalf("task create notification params = %#v", params)
		}
	}
	if !seen["openade/task/updated"] || !seen["openade/task/previewChanged"] || !seen["openade/snapshotChanged"] {
		t.Fatalf("task create notifications = %#v", notifications)
	}

	read := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-task-create",
		"taskId": "task-created",
	}))
	if read["description"] != "Create this task through OpenADE Core" || read["title"] != "Created through core" {
		t.Fatalf("created task read = %#v", read)
	}
	isolation := objectField(t, read, "isolationStrategy")
	if isolation["type"] != "worktree" || isolation["sourceBranch"] != "main" {
		t.Fatalf("created task isolation = %#v", isolation)
	}
	createdBy := objectField(t, read, "createdBy")
	if createdBy["id"] != "user-1" || createdBy["email"] != "user@example.com" {
		t.Fatalf("created task createdBy = %#v", createdBy)
	}
	assertStringSetEquals(t, stringsFromAny(arrayField(t, read, "enabledMcpServerIds")), []string{"server-1", "server-2"})
	environments := arrayField(t, read, "deviceEnvironments")
	if len(environments) != 1 {
		t.Fatalf("created task environments = %#v", environments)
	}
	environment := objectValue(t, environments[0])
	if environment["id"] != "device-env-1" || environment["worktreeDir"] != "openade/task-created" || environment["mergeBaseCommit"] != "abcdef123456" {
		t.Fatalf("created task environment = %#v", environment)
	}
	events := arrayField(t, read, "events")
	if len(events) != 1 || objectValue(t, events[0])["id"] != "setup-created" || objectValue(t, events[0])["type"] != "setup_environment" {
		t.Fatalf("created task events = %#v", events)
	}
	previews := resultArray(t, harness.request(t, "openade/task/list", map[string]any{"repoId": "repo-task-create"}))
	if len(previews) != 1 {
		t.Fatalf("created task previews = %#v", previews)
	}
	preview := objectValue(t, previews[0])
	if preview["id"] != "task-created" || objectField(t, preview, "lastEvent")["id"] != "setup-created" {
		t.Fatalf("created task preview = %#v", preview)
	}
	stored, ok, err := harness.store.GetTask(ctx, "task-created")
	if err != nil {
		t.Fatalf("get created task: %v", err)
	}
	if !ok || !stored.MetadataJSON.Valid {
		t.Fatalf("stored created task = %#v", stored)
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(stored.MetadataJSON.String), &metadata); err != nil {
		t.Fatalf("decode created task metadata: %v", err)
	}
	if objectValue(t, metadata["createdBy"])["id"] != "user-1" {
		t.Fatalf("created task metadata = %#v", metadata)
	}
	enabledIDs := metadata["enabledMcpServerIds"].([]any)
	if len(enabledIDs) != 2 || enabledIDs[0] != "server-1" || enabledIDs[1] != "server-2" {
		t.Fatalf("created task enabled MCP ids = %#v", enabledIDs)
	}

	existing := resultObject(t, harness.request(t, "openade/task/create", map[string]any{
		"repoId": "repo-task-create",
		"taskId": "task-created",
		"title":  "Should not overwrite",
		"input":  "Should not overwrite",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"deviceId": "device-1",
	}))
	if existing["taskId"] != "task-created" || existing["title"] != "Created through core" || existing["slug"] != "task-created-slug" {
		t.Fatalf("existing task create result = %#v", existing)
	}
	unchanged := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-task-create",
		"taskId": "task-created",
	}))
	if unchanged["description"] != "Create this task through OpenADE Core" || unchanged["title"] != "Created through core" {
		t.Fatalf("existing task was overwritten = %#v", unchanged)
	}

	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-1",
		Name:      "Compatibility Repo",
		Path:      "/tmp/repo-1",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert compatibility repo: %v", err)
	}
	deterministic := resultObject(t, harness.request(t, "openade/task/create", map[string]any{
		"repoId": "repo-1",
		"input":  "Stable client request id",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"deviceId":        "device-1",
		"clientRequestId": "request-1",
	}))
	if deterministic["taskId"] != "task-42271778639f6147f5a66694bc" || deterministic["title"] != "New task" {
		t.Fatalf("deterministic task create = %#v", deterministic)
	}
	deterministicRetry := resultObject(t, harness.request(t, "openade/task/create", map[string]any{
		"repoId": "repo-1",
		"input":  "Changed retry input",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"deviceId":        "device-1",
		"clientRequestId": "request-1",
	}))
	if deterministicRetry["taskId"] != deterministic["taskId"] {
		t.Fatalf("deterministic task retry = first %#v second %#v", deterministic, deterministicRetry)
	}

	missingRepo := harness.request(t, "openade/task/create", map[string]any{
		"repoId": "missing",
		"input":  "Missing repo",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"deviceId": "device-1",
	})
	if runtimeErrorCode(t, missingRepo) != "not_found" {
		t.Fatalf("missing repo task create = %#v", missingRepo)
	}
	invalidIsolation := harness.request(t, "openade/task/create", map[string]any{
		"repoId": "repo-task-create",
		"input":  "Invalid isolation",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"deviceId":          "device-1",
		"isolationStrategy": map[string]any{"type": "worktree"},
	})
	if runtimeErrorCode(t, invalidIsolation) != "invalid_params" {
		t.Fatalf("invalid isolation task create = %#v", invalidIsolation)
	}
}

func TestProductTaskMetadataUpdateOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)
	viewedAt := "2026-06-05T12:05:00Z"
	lastEventAt := "2026-06-05T12:06:00Z"
	updatedAt := "2026-06-05T12:07:00Z"
	notificationStart := len(harness.notifications)

	result := resultObject(t, harness.request(t, "openade/task/metadata/update", map[string]any{
		"taskId":               "task-1",
		"title":                "  Updated core title  ",
		"closed":               true,
		"lastViewedAt":         viewedAt,
		"lastEventAt":          lastEventAt,
		"updatedAt":            updatedAt,
		"cancelledPlanEventId": " event-plan-cancelled ",
		"sessionIds": map[string]string{
			"codex":       "session-1-updated",
			"claude-code": "session-2",
			"empty":       "",
		},
		"usage": map[string]any{
			"usageVersion": 2,
			"inputTokens":  12,
			"outputTokens": 34,
			"totalCostUsd": 0.56,
			"eventCount":   7,
			"costByModel":  map[string]any{"gpt-test": 0.56},
			"durationMs":   890,
		},
	}))
	if result["ok"] != true {
		t.Fatalf("metadata update result = %#v", result)
	}

	notifications := harness.waitForNotifications(t, notificationStart, 2)
	seen := map[string]bool{}
	for _, notification := range notifications {
		seen[notification["method"].(string)] = true
		params := objectField(t, notification, "params")
		if params["repoId"] != "repo-1" || params["taskId"] != "task-1" {
			t.Fatalf("notification params = %#v", params)
		}
	}
	if !seen["openade/task/updated"] || !seen["openade/task/previewChanged"] {
		t.Fatalf("notifications = %#v", notifications)
	}

	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-1",
		"taskId": "task-1",
	}))
	if task["title"] != "Updated core title" || task["closed"] != true {
		t.Fatalf("updated task = %#v", task)
	}
	if task["lastViewedAt"] != "2026-06-05T12:05:00Z" || task["lastEventAt"] != "2026-06-05T12:06:00Z" {
		t.Fatalf("updated task times = %#v", task)
	}
	if task["cancelledPlanEventId"] != "event-plan-cancelled" {
		t.Fatalf("updated cancelled plan event = %#v", task)
	}
	sessionIDs := objectField(t, task, "sessionIds")
	if sessionIDs["codex"] != "session-1-updated" || sessionIDs["claude-code"] != "session-2" {
		t.Fatalf("updated session ids = %#v", sessionIDs)
	}
	if _, ok := sessionIDs["empty"]; ok {
		t.Fatalf("empty session id should be filtered = %#v", sessionIDs)
	}

	previews := resultArray(t, harness.request(t, "openade/task/list", map[string]any{"repoId": "repo-1"}))
	preview := objectValue(t, previews[0])
	if preview["title"] != "Updated core title" || preview["closed"] != true {
		t.Fatalf("updated preview = %#v", preview)
	}
	usage := objectField(t, preview, "usage")
	if usage["usageVersion"] != float64(2) || usage["inputTokens"] != float64(12) || usage["durationMs"] != float64(890) {
		t.Fatalf("updated usage = %#v", usage)
	}

	unsupported := harness.request(t, "openade/task/metadata/update", map[string]any{
		"taskId":      "task-1",
		"queuedTurns": []any{},
	})
	if runtimeErrorCode(t, unsupported) != "invalid_params" {
		t.Fatalf("unsupported metadata response = %#v", unsupported)
	}
	invalidSessionIDs := harness.request(t, "openade/task/metadata/update", map[string]any{
		"taskId":     "task-1",
		"sessionIds": []any{"not-an-object"},
	})
	if runtimeErrorCode(t, invalidSessionIDs) != "invalid_params" {
		t.Fatalf("invalid session ids metadata response = %#v", invalidSessionIDs)
	}
}

func TestProductTaskUsageRecalculateOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)
	ctx := context.Background()
	now := time.Date(2026, 6, 8, 14, 0, 0, 0, time.UTC)
	for _, event := range []storage.TaskEvent{
		{
			ID:          "event-usage-main",
			TaskID:      "task-1",
			Seq:         200,
			Type:        "action",
			Status:      sql.NullString{String: "completed", Valid: true},
			SourceType:  sql.NullString{String: "do", Valid: true},
			SourceLabel: sql.NullString{String: "Do", Valid: true},
			CreatedAt:   now,
			PayloadJSON: sql.NullString{String: `{"id":"event-usage-main","type":"action","status":"completed","createdAt":"2026-06-08T14:00:00Z","userInput":"main usage","source":{"type":"do","userLabel":"Do"},"execution":{"harnessId":"claude-code","executionId":"exec-usage-main","modelId":"claude-test","events":[{"id":"main-result","direction":"execution","type":"raw_message","executionId":"exec-usage-main","harnessId":"claude-code","message":{"type":"result","total_cost_usd":0.125,"duration_ms":1234,"usage":{"input_tokens":100,"output_tokens":40}}},{"id":"main-complete-ignored","direction":"execution","type":"complete","executionId":"exec-usage-main","harnessId":"claude-code","usage":{"inputTokens":999,"outputTokens":999,"costUsd":9.99,"durationMs":999}}]},"hyperplanSubExecutions":[{"stepId":"step-a","harnessId":"codex","modelId":"gpt-test","events":[{"id":"sub-complete","direction":"execution","type":"complete","executionId":"exec-sub","harnessId":"codex","usage":{"inputTokens":30,"outputTokens":12,"costUsd":0.02,"durationMs":456}}]}],"includesCommentIds":[]}`, Valid: true},
		},
		{
			ID:          "event-usage-codex-raw",
			TaskID:      "task-1",
			Seq:         201,
			Type:        "action",
			Status:      sql.NullString{String: "completed", Valid: true},
			SourceType:  sql.NullString{String: "ask", Valid: true},
			SourceLabel: sql.NullString{String: "Ask", Valid: true},
			CreatedAt:   now.Add(time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"event-usage-codex-raw","type":"action","status":"completed","createdAt":"2026-06-08T14:00:01Z","userInput":"raw codex usage","source":{"type":"ask","userLabel":"Ask"},"execution":{"harnessId":"codex","executionId":"exec-usage-codex-raw","modelId":"gpt-raw","events":[{"id":"codex-turn-completed","direction":"execution","type":"raw_message","executionId":"exec-usage-codex-raw","harnessId":"codex","message":{"type":"turn.completed","usage":{"input_tokens":8,"output_tokens":4,"cached_input_tokens":2}}}]},"includesCommentIds":[]}`, Valid: true},
		},
	} {
		if err := harness.store.UpsertTaskEvent(ctx, event); err != nil {
			t.Fatalf("upsert usage event %s: %v", event.ID, err)
		}
	}

	notificationStart := len(harness.notifications)
	result := resultObject(t, harness.request(t, "openade/task/usage/recalculate", map[string]any{
		"repoId":          "repo-1",
		"taskId":          "task-1",
		"clientRequestId": "usage-recalculate-1",
	}))
	usage := objectField(t, result, "usage")
	if usage["usageVersion"] != float64(2) || usage["inputTokens"] != float64(138) || usage["outputTokens"] != float64(56) {
		t.Fatalf("usage tokens = %#v", usage)
	}
	if usage["eventCount"] != float64(2) || usage["durationMs"] != float64(1690) || usage["totalCostUsd"] != float64(0.145) {
		t.Fatalf("usage totals = %#v", usage)
	}
	costByModel := objectField(t, usage, "costByModel")
	if costByModel["claude-test"] != float64(0.125) || costByModel["gpt-test"] != float64(0.02) {
		t.Fatalf("usage cost by model = %#v", costByModel)
	}
	notifications := harness.waitForNotifications(t, notificationStart, 2)
	seen := map[string]bool{}
	for _, notification := range notifications {
		seen[notification["method"].(string)] = true
		params := objectField(t, notification, "params")
		if params["repoId"] != "repo-1" || params["taskId"] != "task-1" {
			t.Fatalf("usage notification params = %#v", params)
		}
	}
	if !seen["openade/task/updated"] || !seen["openade/task/previewChanged"] {
		t.Fatalf("usage notifications = %#v", notifications)
	}

	previews := resultArray(t, harness.request(t, "openade/task/list", map[string]any{"repoId": "repo-1"}))
	previewUsage := objectField(t, objectValue(t, previews[0]), "usage")
	if previewUsage["inputTokens"] != float64(138) || previewUsage["durationMs"] != float64(1690) {
		t.Fatalf("preview usage = %#v", previewUsage)
	}

	missing := harness.request(t, "openade/task/usage/recalculate", map[string]any{
		"repoId": "repo-1",
		"taskId": "missing-task",
	})
	if runtimeErrorCode(t, missing) != "not_found" {
		t.Fatalf("missing usage recalc response = %#v", missing)
	}
}

func TestProductTaskUsageBackfillOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)
	ctx := context.Background()
	now := time.Date(2026, 6, 8, 15, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:          "event-backfill-task-1",
		TaskID:      "task-1",
		Seq:         200,
		Type:        "action",
		Status:      sql.NullString{String: "completed", Valid: true},
		SourceType:  sql.NullString{String: "do", Valid: true},
		SourceLabel: sql.NullString{String: "Do", Valid: true},
		CreatedAt:   now,
		PayloadJSON: sql.NullString{String: `{"id":"event-backfill-task-1","type":"action","status":"completed","createdAt":"2026-06-08T15:00:00Z","source":{"type":"do","userLabel":"Do"},"execution":{"harnessId":"codex","executionId":"exec-backfill-task-1","modelId":"gpt-backfill","events":[{"id":"complete-backfill-task-1","direction":"execution","type":"complete","executionId":"exec-backfill-task-1","harnessId":"codex","usage":{"inputTokens":11,"outputTokens":7,"costUsd":0.03,"durationMs":90}}]},"includesCommentIds":[]}`, Valid: true},
	}); err != nil {
		t.Fatalf("upsert task-1 usage event: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-usage-valid",
		RepoID:        "repo-1",
		Slug:          "valid-usage",
		Title:         "Valid usage",
		Description:   "Already has v2 usage.",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert valid usage task: %v", err)
	}
	if err := harness.store.UpsertTaskPreview(ctx, storage.TaskPreview{
		TaskID:    "task-usage-valid",
		RepoID:    "repo-1",
		Slug:      "valid-usage",
		Title:     "Valid usage",
		CreatedAt: now,
		UpdatedAt: now,
		UsageJSON: sql.NullString{String: `{"usageVersion":2,"inputTokens":99,"outputTokens":1,"totalCostUsd":0,"eventCount":1,"costByModel":{},"durationMs":1}`, Valid: true},
	}); err != nil {
		t.Fatalf("upsert valid usage preview: %v", err)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:          "event-backfill-valid",
		TaskID:      "task-usage-valid",
		Seq:         1,
		Type:        "action",
		Status:      sql.NullString{String: "completed", Valid: true},
		SourceType:  sql.NullString{String: "ask", Valid: true},
		SourceLabel: sql.NullString{String: "Ask", Valid: true},
		CreatedAt:   now.Add(time.Second),
		PayloadJSON: sql.NullString{String: `{"id":"event-backfill-valid","type":"action","status":"completed","createdAt":"2026-06-08T15:00:01Z","source":{"type":"ask","userLabel":"Ask"},"execution":{"harnessId":"codex","executionId":"exec-backfill-valid","modelId":"gpt-valid","events":[{"id":"complete-backfill-valid","direction":"execution","type":"complete","executionId":"exec-backfill-valid","harnessId":"codex","usage":{"inputTokens":5,"outputTokens":3,"costUsd":0.02,"durationMs":40}}]},"includesCommentIds":[]}`, Valid: true},
	}); err != nil {
		t.Fatalf("upsert valid usage event: %v", err)
	}

	notificationStart := len(harness.notifications)
	result := resultObject(t, harness.request(t, "openade/task/usage/backfill", map[string]any{
		"repoId":          "repo-1",
		"clientRequestId": "usage-backfill-1",
	}))
	if result["updatedTasks"] != float64(1) || result["skippedTasks"] != float64(1) {
		t.Fatalf("backfill counts = %#v", result)
	}
	tasks := arrayField(t, result, "tasks")
	if len(tasks) != 1 {
		t.Fatalf("backfill tasks = %#v", tasks)
	}
	updated := objectValue(t, tasks[0])
	if updated["repoId"] != "repo-1" || updated["taskId"] != "task-1" {
		t.Fatalf("backfill updated task = %#v", updated)
	}
	usage := objectField(t, updated, "usage")
	if usage["inputTokens"] != float64(11) || usage["durationMs"] != float64(90) {
		t.Fatalf("backfill usage = %#v", usage)
	}
	notifications := harness.waitForNotifications(t, notificationStart, 2)
	seen := map[string]bool{}
	for _, notification := range notifications {
		seen[notification["method"].(string)] = true
	}
	if !seen["openade/task/updated"] || !seen["openade/task/previewChanged"] {
		t.Fatalf("backfill notifications = %#v", notifications)
	}

	forced := resultObject(t, harness.request(t, "openade/task/usage/backfill", map[string]any{
		"repoId":          "repo-1",
		"taskIds":         []any{"task-usage-valid"},
		"force":           true,
		"clientRequestId": "usage-backfill-force-1",
	}))
	if forced["updatedTasks"] != float64(1) || forced["skippedTasks"] != float64(0) {
		t.Fatalf("forced backfill counts = %#v", forced)
	}
	forcedTask := objectValue(t, arrayField(t, forced, "tasks")[0])
	forcedUsage := objectField(t, forcedTask, "usage")
	if forcedUsage["inputTokens"] != float64(5) || forcedUsage["durationMs"] != float64(40) {
		t.Fatalf("forced usage = %#v", forcedUsage)
	}

	missing := harness.request(t, "openade/task/usage/backfill", map[string]any{
		"repoId":  "repo-1",
		"taskIds": []any{"missing-task"},
	})
	if runtimeErrorCode(t, missing) != "not_found" {
		t.Fatalf("missing backfill response = %#v", missing)
	}
}

type titleAgentExecutor struct {
	requests chan product.AgentExecutionRequest
}

func (executor titleAgentExecutor) Run(ctx context.Context, request product.AgentExecutionRequest, emitter product.AgentExecutionEmitter) product.AgentExecutionResult {
	executor.requests <- request
	_ = emitter.AppendStreamEvent(ctx, json.RawMessage(`{"type":"message","message":{"text":"Title: Login Redirect Fix"}}`))
	success := true
	return product.AgentExecutionResult{
		Status:      product.AgentExecutionCompleted,
		Success:     &success,
		CompletedAt: time.Date(2026, 6, 6, 17, 0, 0, 0, time.UTC),
	}
}

func TestProductTaskTitleGenerateUsesReadOnlyExecutorOverRuntime(t *testing.T) {
	requests := make(chan product.AgentExecutionRequest, 1)
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = titleAgentExecutor{requests: requests}
	})
	ctx := context.Background()
	projectDir := t.TempDir()
	now := time.Date(2026, 6, 6, 17, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-title-generate",
		Name:      "Title Generate Repo",
		Path:      projectDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert title repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-title-generate",
		RepoID:        "repo-title-generate",
		Slug:          "task-title-generate",
		Title:         "Old title",
		Description:   "Fix the login redirect loop after users complete SSO.",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert title task: %v", err)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-title-context",
		TaskID:    "task-title-generate",
		Seq:       1,
		Type:      "action",
		Status:    sql.NullString{String: "completed", Valid: true},
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: `{"id":"event-title-context","type":"action","status":"completed","userInput":"completed plan context","execution":{"harnessId":"claude-code","executionId":"exec-title-context","events":[]}}`,
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert title event: %v", err)
	}

	notificationStart := len(harness.notifications)
	generated := resultObject(t, harness.request(t, "openade/task/title/generate", map[string]any{
		"repoId":          "repo-title-generate",
		"taskId":          "task-title-generate",
		"harnessId":       "codex",
		"clientRequestId": "title-generate",
	}))
	if generated["repoId"] != "repo-title-generate" || generated["taskId"] != "task-title-generate" || generated["title"] != "Login Redirect Fix" {
		t.Fatalf("generated title result = %#v", generated)
	}
	request := receiveAgentExecutionRequest(t, requests)
	if request.RepoID != "repo-title-generate" || request.RepoPath != projectDir || request.TaskID != "task-title-generate" || request.HarnessID != "codex" {
		t.Fatalf("title executor scope = %#v", request)
	}
	if !request.ReadOnly || request.TurnType != "title" || !strings.Contains(request.AppendSystemPrompt, "Title: <your 3 word title>") {
		t.Fatalf("title executor mode fields = %#v", request)
	}
	if !strings.Contains(request.Input, "Fix the login redirect loop") || !strings.Contains(request.Input, "completed plan context") {
		t.Fatalf("title executor prompt = %q", request.Input)
	}
	notifications := harness.waitForNotifications(t, notificationStart, 2)
	seen := map[string]bool{}
	for _, notification := range notifications {
		seen[notification["method"].(string)] = true
	}
	if !seen["openade/task/updated"] || !seen["openade/task/previewChanged"] {
		t.Fatalf("title notifications = %#v", notifications)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-title-generate",
		"taskId": "task-title-generate",
	}))
	if task["title"] != "Login Redirect Fix" {
		t.Fatalf("title task after generation = %#v", task)
	}
	retried := resultObject(t, harness.request(t, "openade/task/title/generate", map[string]any{
		"repoId":          "repo-title-generate",
		"taskId":          "task-title-generate",
		"harnessId":       "codex",
		"clientRequestId": "title-generate",
	}))
	if retried["title"] != "Login Redirect Fix" {
		t.Fatalf("idempotent title retry = %#v", retried)
	}
	select {
	case request := <-requests:
		t.Fatalf("idempotent title retry should not run executor again: %#v", request)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestProductTaskTitleGenerateFallsBackWithoutExecutor(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 17, 10, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-title-fallback",
		Name:      "Title Fallback Repo",
		Path:      t.TempDir(),
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert fallback title repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-title-fallback",
		RepoID:        "repo-title-fallback",
		Slug:          "task-title-fallback",
		Title:         "Existing fallback title",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert fallback title task: %v", err)
	}

	generated := resultObject(t, harness.request(t, "openade/task/title/generate", map[string]any{
		"repoId":          "repo-title-fallback",
		"taskId":          "task-title-fallback",
		"clientRequestId": "title-fallback",
	}))
	if generated["title"] != "Existing fallback title" {
		t.Fatalf("fallback title result = %#v", generated)
	}
}

func TestProductRepoMutationsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	notificationStart := len(harness.notifications)

	created := resultObject(t, harness.request(t, "openade/repo/create", map[string]any{
		"repoId": "repo-created",
		"name":   "Created Repo",
		"path":   "/tmp/created",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"createdAt": "2026-06-05T12:00:00Z",
	}))
	if created["repoId"] != "repo-created" || created["createdAt"] != "2026-06-05T12:00:00Z" {
		t.Fatalf("created repo = %#v", created)
	}
	harness.waitForNotifications(t, notificationStart, 2)

	updated := resultObject(t, harness.request(t, "openade/repo/update", map[string]any{
		"repoId":    "repo-created",
		"name":      "Updated Repo",
		"path":      "/tmp/updated",
		"archived":  true,
		"updatedAt": "2026-06-05T12:01:00Z",
	}))
	if updated["ok"] != true {
		t.Fatalf("updated repo result = %#v", updated)
	}
	projects := resultArray(t, harness.request(t, "openade/project/list", map[string]any{}))
	if len(projects) != 1 {
		t.Fatalf("projects after update = %#v", projects)
	}
	project := objectValue(t, projects[0])
	if project["name"] != "Updated Repo" || project["path"] != "/tmp/updated" || project["archived"] != true {
		t.Fatalf("updated project = %#v", project)
	}

	deleted := resultObject(t, harness.request(t, "openade/repo/delete", map[string]any{
		"repoId": "repo-created",
	}))
	if deleted["ok"] != true {
		t.Fatalf("deleted repo result = %#v", deleted)
	}
	projects = resultArray(t, harness.request(t, "openade/project/list", map[string]any{}))
	if len(projects) != 0 {
		t.Fatalf("projects after delete = %#v", projects)
	}

	missing := harness.request(t, "openade/repo/update", map[string]any{"repoId": "missing", "name": "Nope"})
	if runtimeErrorCode(t, missing) != "not_found" {
		t.Fatalf("missing repo update = %#v", missing)
	}
}

func TestProductProjectFileAndSearchReadsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	projectDir := createProjectFilesFixture(t)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-files",
		Name:      "Files Repo",
		Path:      projectDir,
		CreatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("upsert files repo: %v", err)
	}
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-files-head",
		RepoID:        "repo-files",
		Slug:          "task-files-head",
		Title:         "Head file task",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert head file task: %v", err)
	}

	tree := resultObject(t, harness.request(t, "openade/project/files/tree", map[string]any{
		"repoId":   "repo-files",
		"maxDepth": 2,
	}))
	if tree["repoId"] != "repo-files" || tree["path"] != "" || tree["truncated"] != false {
		t.Fatalf("file tree = %#v", tree)
	}
	defaultPaths := treePaths(arrayField(t, tree, "entries"))
	assertStringSetEquals(t, defaultPaths, []string{"assets", "assets/logo.bin", "src", "src/app.ts", "src/upper.ts"})

	hiddenTree := resultObject(t, harness.request(t, "openade/project/files/tree", map[string]any{
		"repoId":        "repo-files",
		"maxDepth":      2,
		"includeHidden": true,
	}))
	hiddenPaths := treePaths(arrayField(t, hiddenTree, "entries"))
	assertStringSetEquals(t, hiddenPaths, []string{".env", ".hidden", ".hidden/secret.txt", "assets", "assets/logo.bin", "src", "src/app.ts", "src/upper.ts"})

	generatedTree := resultObject(t, harness.request(t, "openade/project/files/tree", map[string]any{
		"repoId":           "repo-files",
		"maxDepth":         2,
		"includeGenerated": true,
	}))
	generatedPaths := treePaths(arrayField(t, generatedTree, "entries"))
	assertStringSetEquals(t, generatedPaths, []string{"assets", "assets/logo.bin", "node_modules", "node_modules/pkg", "node_modules/pkg/index.js", "src", "src/app.ts", "src/upper.ts"})

	readme := resultObject(t, harness.request(t, "openade/project/file/read", map[string]any{
		"repoId": "repo-files",
		"path":   "src/app.ts",
	}))
	if readme["content"] != "const value = 'scoped search'\n" || readme["tooLarge"] != false || readme["isBinary"] == true {
		t.Fatalf("file read = %#v", readme)
	}

	binary := resultObject(t, harness.request(t, "openade/project/file/read", map[string]any{
		"repoId":   "repo-files",
		"path":     "assets/logo.bin",
		"encoding": "base64",
	}))
	if binary["content"] != base64.StdEncoding.EncodeToString([]byte{0, 1, 2, 3}) || binary["encoding"] != "base64" || binary["isBinary"] != true {
		t.Fatalf("binary read = %#v", binary)
	}

	tooLarge := resultObject(t, harness.request(t, "openade/project/file/read", map[string]any{
		"repoId":   "repo-files",
		"path":     "src/app.ts",
		"maxBytes": 4,
	}))
	if tooLarge["tooLarge"] != true || tooLarge["content"] != nil {
		t.Fatalf("too large file read = %#v", tooLarge)
	}

	written := resultObject(t, harness.request(t, "openade/project/file/write", map[string]any{
		"repoId":          "repo-files",
		"path":            "generated/result.txt",
		"content":         "saved through core",
		"createDirs":      true,
		"clientRequestId": "write-result",
	}))
	if written["repoId"] != "repo-files" || written["path"] != "generated/result.txt" || written["size"] != float64(18) {
		t.Fatalf("file write = %#v", written)
	}
	writtenRetry := resultObject(t, harness.request(t, "openade/project/file/write", map[string]any{
		"repoId":          "repo-files",
		"path":            "generated/result.txt",
		"content":         "changed by retry",
		"createDirs":      true,
		"clientRequestId": "write-result",
	}))
	if writtenRetry["size"] != float64(18) {
		t.Fatalf("idempotent file write retry = %#v", writtenRetry)
	}
	writtenRead := resultObject(t, harness.request(t, "openade/project/file/read", map[string]any{
		"repoId": "repo-files",
		"path":   "generated/result.txt",
	}))
	if writtenRead["content"] != "saved through core" {
		t.Fatalf("written file read = %#v", writtenRead)
	}

	base64Write := resultObject(t, harness.request(t, "openade/project/file/write", map[string]any{
		"repoId":   "repo-files",
		"path":     "assets/written.bin",
		"encoding": "base64",
		"content":  base64.StdEncoding.EncodeToString([]byte{4, 5, 6}),
	}))
	if base64Write["size"] != float64(3) {
		t.Fatalf("base64 file write = %#v", base64Write)
	}
	base64Read := resultObject(t, harness.request(t, "openade/project/file/read", map[string]any{
		"repoId":   "repo-files",
		"path":     "assets/written.bin",
		"encoding": "base64",
	}))
	if base64Read["content"] != base64.StdEncoding.EncodeToString([]byte{4, 5, 6}) {
		t.Fatalf("base64 written file read = %#v", base64Read)
	}

	fuzzyRoot := resultObject(t, harness.request(t, "openade/project/files/fuzzySearch", map[string]any{
		"repoId": "repo-files",
		"query":  "",
		"limit":  5,
	}))
	if fuzzyRoot["source"] != "filesystem" {
		t.Fatalf("fuzzy source = %#v", fuzzyRoot)
	}
	treeMatch := objectField(t, fuzzyRoot, "treeMatch")
	fuzzyChildren := arrayField(t, treeMatch, "children")
	assertTreeChildren(t, fuzzyChildren, []string{"assets", "generated", "src"})

	fuzzyUpper := resultObject(t, harness.request(t, "openade/project/files/fuzzySearch", map[string]any{
		"repoId": "repo-files",
		"query":  "upper",
		"limit":  5,
	}))
	assertStringSetEquals(t, stringsFromAny(arrayField(t, fuzzyUpper, "results")), []string{"src/upper.ts"})

	search := resultObject(t, harness.request(t, "openade/project/search", map[string]any{
		"repoId": "repo-files",
		"query":  "scoped",
	}))
	searchPaths := []string{}
	for _, item := range arrayField(t, search, "matches") {
		searchPaths = append(searchPaths, objectValue(t, item)["path"].(string))
	}
	assertStringSetEquals(t, searchPaths, []string{"src/app.ts", "src/upper.ts"})

	caseSensitive := resultObject(t, harness.request(t, "openade/project/search", map[string]any{
		"repoId":        "repo-files",
		"query":         "scoped",
		"caseSensitive": true,
	}))
	casePaths := []string{}
	for _, item := range arrayField(t, caseSensitive, "matches") {
		casePaths = append(casePaths, objectValue(t, item)["path"].(string))
	}
	assertStringSetEquals(t, casePaths, []string{"src/app.ts"})

	headTaskTree := resultObject(t, harness.request(t, "openade/project/files/tree", map[string]any{
		"repoId":   "repo-files",
		"taskId":   "task-files-head",
		"maxDepth": 1,
	}))
	if headTaskTree["repoId"] != "repo-files" || headTaskTree["taskId"] != "task-files-head" {
		t.Fatalf("head task file tree = %#v", headTaskTree)
	}
	headTaskRead := resultObject(t, harness.request(t, "openade/project/file/read", map[string]any{
		"repoId": "repo-files",
		"taskId": "task-files-head",
		"path":   "src/app.ts",
	}))
	if headTaskRead["content"] != "const value = 'scoped search'\n" {
		t.Fatalf("head task file read = %#v", headTaskRead)
	}

	traversal := harness.request(t, "openade/project/file/read", map[string]any{
		"repoId": "repo-files",
		"path":   "../outside.txt",
	})
	if runtimeErrorCode(t, traversal) != "invalid_params" {
		t.Fatalf("traversal response = %#v", traversal)
	}

	writeTraversal := harness.request(t, "openade/project/file/write", map[string]any{
		"repoId":  "repo-files",
		"path":    "../outside.txt",
		"content": "nope",
	})
	if runtimeErrorCode(t, writeTraversal) != "invalid_params" {
		t.Fatalf("write traversal response = %#v", writeTraversal)
	}

	invalidBase64 := harness.request(t, "openade/project/file/write", map[string]any{
		"repoId":   "repo-files",
		"path":     "assets/invalid.bin",
		"encoding": "base64",
		"content":  "not base64!",
	})
	if runtimeErrorCode(t, invalidBase64) != "invalid_params" {
		t.Fatalf("invalid base64 write response = %#v", invalidBase64)
	}

	missingTask := harness.request(t, "openade/project/files/tree", map[string]any{
		"repoId": "repo-files",
		"taskId": "task-missing",
	})
	if runtimeErrorCode(t, missingTask) != "not_found" {
		t.Fatalf("missing task scoped file tree response = %#v", missingTask)
	}
}

func TestProductProjectFileAndSearchTaskScopesOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot, _, _ := createGitHistoryRepo(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-task-files",
		Name:      "Task Files Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert task files repo: %v", err)
	}
	for _, task := range []storage.Task{
		{
			ID:            "task-files-worktree",
			RepoID:        "repo-task-files",
			Slug:          "task-files-worktree",
			Title:         "Worktree file task",
			IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
			CreatedAt:     now,
			UpdatedAt:     now,
		},
		{
			ID:            "task-files-unprepared",
			RepoID:        "repo-task-files",
			Slug:          "task-files-unprepared",
			Title:         "Unprepared worktree file task",
			IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
			CreatedAt:     now,
			UpdatedAt:     now,
		},
	} {
		if err := harness.store.UpsertTask(ctx, task); err != nil {
			t.Fatalf("upsert task files task %s: %v", task.ID, err)
		}
	}

	prepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId": "repo-task-files",
		"taskId": "task-files-worktree",
	}))
	worktreeRoot, ok := prepared["rootPath"].(string)
	if !ok || worktreeRoot == "" {
		t.Fatalf("prepared worktree root = %#v", prepared)
	}
	mkdirAll(t, filepath.Join(worktreeRoot, "notes"))
	writeFile(t, filepath.Join(worktreeRoot, "notes", "task-only.txt"), []byte("worktree unique phrase\n"))
	if _, err := os.Stat(filepath.Join(repoRoot, "notes", "task-only.txt")); !os.IsNotExist(err) {
		t.Fatalf("task-only file leaked into repo root: %v", err)
	}

	tree := resultObject(t, harness.request(t, "openade/project/files/tree", map[string]any{
		"repoId":   "repo-task-files",
		"taskId":   "task-files-worktree",
		"path":     "notes",
		"maxDepth": 2,
	}))
	if tree["repoId"] != "repo-task-files" || tree["taskId"] != "task-files-worktree" || tree["path"] != "notes" {
		t.Fatalf("worktree task tree = %#v", tree)
	}
	assertStringSetEquals(t, treePaths(arrayField(t, tree, "entries")), []string{"notes/task-only.txt"})

	read := resultObject(t, harness.request(t, "openade/project/file/read", map[string]any{
		"repoId": "repo-task-files",
		"taskId": "task-files-worktree",
		"path":   "notes/task-only.txt",
	}))
	if read["content"] != "worktree unique phrase\n" {
		t.Fatalf("worktree task file read = %#v", read)
	}

	write := resultObject(t, harness.request(t, "openade/project/file/write", map[string]any{
		"repoId":     "repo-task-files",
		"taskId":     "task-files-worktree",
		"path":       "generated/from-api.txt",
		"content":    "task scoped api write\n",
		"createDirs": true,
	}))
	if write["taskId"] != "task-files-worktree" || write["path"] != "generated/from-api.txt" {
		t.Fatalf("worktree task file write = %#v", write)
	}
	if _, err := os.Stat(filepath.Join(worktreeRoot, "generated", "from-api.txt")); err != nil {
		t.Fatalf("written task file missing from worktree: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repoRoot, "generated", "from-api.txt")); !os.IsNotExist(err) {
		t.Fatalf("task write leaked into repo root: %v", err)
	}

	fuzzy := resultObject(t, harness.request(t, "openade/project/files/fuzzySearch", map[string]any{
		"repoId": "repo-task-files",
		"taskId": "task-files-worktree",
		"query":  "task-only",
		"limit":  5,
	}))
	assertStringSetEquals(t, stringsFromAny(arrayField(t, fuzzy, "results")), []string{"notes/task-only.txt"})

	search := resultObject(t, harness.request(t, "openade/project/search", map[string]any{
		"repoId": "repo-task-files",
		"taskId": "task-files-worktree",
		"query":  "task scoped api write",
	}))
	matches := arrayField(t, search, "matches")
	if len(matches) != 1 || objectValue(t, matches[0])["path"] != "generated/from-api.txt" {
		t.Fatalf("worktree task search = %#v", search)
	}

	unprepared := harness.request(t, "openade/project/file/read", map[string]any{
		"repoId": "repo-task-files",
		"taskId": "task-files-unprepared",
		"path":   "README.md",
	})
	if runtimeErrorCode(t, unprepared) != "invalid_params" {
		t.Fatalf("unprepared worktree file read response = %#v", unprepared)
	}
}

func TestProductProjectGitReadsOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot := createGitRepo(t)
	nestedPath := filepath.Join(repoRoot, "nested")
	if err := os.MkdirAll(nestedPath, 0o755); err != nil {
		t.Fatalf("create nested repo path: %v", err)
	}
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-git",
		Name:      "Git Repo",
		Path:      nestedPath,
		CreatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("upsert git repo: %v", err)
	}

	info := resultObject(t, harness.request(t, "openade/project/git/info/read", map[string]any{
		"repoId": "repo-git",
	}))
	if info["repoId"] != "repo-git" || info["isGitRepo"] != true {
		t.Fatalf("git info = %#v", info)
	}
	if info["repoRoot"] != repoRoot || info["relativePath"] != "nested" || info["mainBranch"] != "main" {
		t.Fatalf("git info paths = %#v", info)
	}
	if _, ok := info["hasGhCli"].(bool); !ok {
		t.Fatalf("git info missing hasGhCli bool: %#v", info)
	}

	branches := resultObject(t, harness.request(t, "openade/project/git/branches/read", map[string]any{
		"repoId":        "repo-git",
		"includeRemote": true,
	}))
	if branches["repoId"] != "repo-git" || branches["defaultBranch"] != "main" {
		t.Fatalf("git branches = %#v", branches)
	}
	branchItems := arrayField(t, branches, "branches")
	branchNames := map[string]map[string]any{}
	for _, item := range branchItems {
		branch := objectValue(t, item)
		branchNames[branch["name"].(string)] = branch
	}
	if branchNames["main"] == nil || branchNames["feature"] == nil {
		t.Fatalf("git branch names = %#v", branchNames)
	}
	if branchNames["main"]["isDefault"] != true || branchNames["main"]["isRemote"] != false {
		t.Fatalf("main branch = %#v", branchNames["main"])
	}

	summary := resultObject(t, harness.request(t, "openade/project/git/summary/read", map[string]any{
		"repoId": "repo-git",
	}))
	if summary["repoId"] != "repo-git" || summary["branch"] != "main" || summary["headCommit"] == "" || summary["hasChanges"] != true {
		t.Fatalf("git summary = %#v", summary)
	}
	staged := objectField(t, summary, "staged")
	unstaged := objectField(t, summary, "unstaged")
	untracked := arrayField(t, summary, "untracked")
	assertChangedFile(t, arrayField(t, staged, "files"), "staged.txt", "added")
	assertChangedFile(t, arrayField(t, unstaged, "files"), "README.md", "modified")
	assertChangedFile(t, untracked, "untracked.txt", "added")
	if objectField(t, staged, "stats")["insertions"] != float64(1) {
		t.Fatalf("staged stats = %#v", staged["stats"])
	}
	if objectField(t, unstaged, "stats")["insertions"] != float64(1) {
		t.Fatalf("unstaged stats = %#v", unstaged["stats"])
	}
}

func TestProductProjectGitReadsForNonGitRepoOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	nonGitPath := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-not-git",
		Name:      "Not Git",
		Path:      nonGitPath,
		CreatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("upsert non-git repo: %v", err)
	}

	info := resultObject(t, harness.request(t, "openade/project/git/info/read", map[string]any{
		"repoId": "repo-not-git",
	}))
	if info["isGitRepo"] != false || info["repoId"] != "repo-not-git" {
		t.Fatalf("non-git info = %#v", info)
	}

	branches := resultObject(t, harness.request(t, "openade/project/git/branches/read", map[string]any{
		"repoId": "repo-not-git",
	}))
	if branches["defaultBranch"] != "main" || len(arrayField(t, branches, "branches")) != 0 {
		t.Fatalf("non-git branches = %#v", branches)
	}

	summary := resultObject(t, harness.request(t, "openade/project/git/summary/read", map[string]any{
		"repoId": "repo-not-git",
	}))
	if summary["branch"] != nil || summary["headCommit"] != "" || summary["hasChanges"] != false {
		t.Fatalf("non-git summary = %#v", summary)
	}
	if len(arrayField(t, objectField(t, summary, "staged"), "files")) != 0 || len(arrayField(t, summary, "untracked")) != 0 {
		t.Fatalf("non-git summary changes = %#v", summary)
	}
}

func TestProductTaskGitSummaryOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot := createGitRepo(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-task-summary",
		Name:      "Task Summary Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert task summary repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-summary",
		RepoID:        "repo-task-summary",
		Slug:          "task-summary",
		Title:         "Task summary",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert task summary task: %v", err)
	}

	summary := resultObject(t, harness.request(t, "openade/task/git/summary/read", map[string]any{
		"repoId": "repo-task-summary",
		"taskId": "task-summary",
	}))
	if summary["repoId"] != "repo-task-summary" || summary["taskId"] != "task-summary" || summary["branch"] != "main" || summary["headCommit"] == "" || summary["hasChanges"] != true {
		t.Fatalf("task git summary = %#v", summary)
	}
	staged := objectField(t, summary, "staged")
	unstaged := objectField(t, summary, "unstaged")
	untracked := arrayField(t, summary, "untracked")
	assertChangedFile(t, arrayField(t, staged, "files"), "staged.txt", "added")
	assertChangedFile(t, arrayField(t, unstaged, "files"), "README.md", "modified")
	assertChangedFile(t, untracked, "untracked.txt", "added")
	if objectField(t, staged, "stats")["insertions"] != float64(1) {
		t.Fatalf("task staged stats = %#v", staged["stats"])
	}
	if objectField(t, unstaged, "stats")["insertions"] != float64(1) {
		t.Fatalf("task unstaged stats = %#v", unstaged["stats"])
	}

	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-summary-worktree",
		RepoID:        "repo-task-summary",
		Slug:          "task-summary-worktree",
		Title:         "Task summary worktree",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert worktree task: %v", err)
	}
	worktreeTask := harness.request(t, "openade/task/git/summary/read", map[string]any{
		"repoId": "repo-task-summary",
		"taskId": "task-summary-worktree",
	})
	if runtimeErrorCode(t, worktreeTask) != "invalid_params" {
		t.Fatalf("worktree task summary response = %#v", worktreeTask)
	}

	wrongRepo := harness.request(t, "openade/task/git/summary/read", map[string]any{
		"repoId": "missing-repo",
		"taskId": "task-summary",
	})
	if runtimeErrorCode(t, wrongRepo) != "not_found" {
		t.Fatalf("wrong repo task summary response = %#v", wrongRepo)
	}
}

func TestProductTaskGitScopesOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot := createGitRepo(t)
	gitCommand(t, repoRoot, "update-ref", "refs/remotes/origin/remote-only", "HEAD")
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-task-scopes",
		Name:      "Task Scopes Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert task scopes repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-scopes",
		RepoID:        "repo-task-scopes",
		Slug:          "task-scopes",
		Title:         "Task scopes",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert task scopes task: %v", err)
	}

	result := resultObject(t, harness.request(t, "openade/task/git/scopes/read", map[string]any{
		"repoId":        "repo-task-scopes",
		"taskId":        "task-scopes",
		"includeRemote": true,
	}))
	if result["repoId"] != "repo-task-scopes" || result["taskId"] != "task-scopes" || result["defaultBranch"] != "main" {
		t.Fatalf("task git scopes result = %#v", result)
	}
	scopes := arrayField(t, result, "scopes")
	if len(scopes) != 5 {
		t.Fatalf("task git scopes = %#v", scopes)
	}
	headScope := objectValue(t, scopes[0])
	if headScope["id"] != "branch:HEAD" || headScope["type"] != "branch" || headScope["name"] != "HEAD" || headScope["ref"] != "HEAD" {
		t.Fatalf("HEAD scope = %#v", headScope)
	}
	mainScope := scopeByID(t, scopes, "branch:main")
	if mainScope["type"] != "branch" || mainScope["name"] != "main" || mainScope["ref"] != "main" || mainScope["isDefault"] != true || mainScope["isRemote"] != false {
		t.Fatalf("main scope = %#v", mainScope)
	}
	featureScope := scopeByID(t, scopes, "branch:feature")
	if featureScope["type"] != "branch" || featureScope["name"] != "feature" || featureScope["isRemote"] != false {
		t.Fatalf("feature scope = %#v", featureScope)
	}
	remoteScope := scopeByID(t, scopes, "branch:origin/remote-only")
	if remoteScope["type"] != "branch" || remoteScope["name"] != "origin/remote-only" || remoteScope["ref"] != "origin/remote-only" || remoteScope["isRemote"] != true {
		t.Fatalf("remote scope = %#v", remoteScope)
	}
	worktreeScope := scopeByID(t, scopes, "worktree:"+filepath.Base(repoRoot))
	if worktreeScope["type"] != "worktree" || worktreeScope["worktreeId"] != filepath.Base(repoRoot) || worktreeScope["branch"] != "main" || worktreeScope["head"] == "" || worktreeScope["label"] != filepath.Base(repoRoot) {
		t.Fatalf("worktree scope = %#v", worktreeScope)
	}

	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-scopes-worktree",
		RepoID:        "repo-task-scopes",
		Slug:          "task-scopes-worktree",
		Title:         "Task scopes worktree",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert worktree scopes task: %v", err)
	}
	worktreeTask := harness.request(t, "openade/task/git/scopes/read", map[string]any{
		"repoId": "repo-task-scopes",
		"taskId": "task-scopes-worktree",
	})
	if runtimeErrorCode(t, worktreeTask) != "invalid_params" {
		t.Fatalf("worktree task scopes response = %#v", worktreeTask)
	}
}

func TestProductTaskGitHistoryReadsOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot, initialCommit, secondCommit := createGitHistoryRepo(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-task-git",
		Name:      "Task Git Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert task git repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-git",
		RepoID:        "repo-task-git",
		Slug:          "task-git",
		Title:         "Task git",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert task git task: %v", err)
	}
	worktreeDir := filepath.Join(t.TempDir(), "task-git-worktree")
	gitCommand(t, repoRoot, "worktree", "add", "-b", "openade/task-git-worktree", worktreeDir, "main")
	writeFile(t, filepath.Join(worktreeDir, "worktree.txt"), []byte("worktree scoped\n"))
	gitCommand(t, worktreeDir, "add", "worktree.txt")
	gitCommand(t, worktreeDir, "commit", "-m", "worktree scoped")
	worktreeCommit := gitOutput(t, worktreeDir, "rev-parse", "HEAD")

	logResult := resultObject(t, harness.request(t, "openade/task/git/log", map[string]any{
		"repoId": "repo-task-git",
		"taskId": "task-git",
		"limit":  1,
	}))
	if logResult["repoId"] != "repo-task-git" || logResult["taskId"] != "task-git" || logResult["hasMore"] != true {
		t.Fatalf("task git log = %#v", logResult)
	}
	commits := arrayField(t, logResult, "commits")
	if len(commits) != 1 {
		t.Fatalf("task git log commits = %#v", commits)
	}
	latest := objectValue(t, commits[0])
	if latest["sha"] != secondCommit || latest["message"] != "second" || latest["author"] != "OpenADE Test" || latest["parentCount"] != float64(1) {
		t.Fatalf("latest commit = %#v", latest)
	}
	if latest["shortSha"] == "" || latest["date"] == "" || latest["relativeDate"] == "" {
		t.Fatalf("latest commit missing metadata = %#v", latest)
	}

	skippedLog := resultObject(t, harness.request(t, "openade/task/git/log", map[string]any{
		"repoId": "repo-task-git",
		"taskId": "task-git",
		"limit":  5,
		"skip":   1,
	}))
	skippedCommits := arrayField(t, skippedLog, "commits")
	if len(skippedCommits) != 1 {
		t.Fatalf("skipped git log commits = %#v", skippedCommits)
	}
	initial := objectValue(t, skippedCommits[0])
	if initial["sha"] != initialCommit || initial["message"] != "initial" || initial["parentCount"] != float64(0) {
		t.Fatalf("initial commit = %#v", initial)
	}

	commitFiles := resultObject(t, harness.request(t, "openade/task/git/commit/files/read", map[string]any{
		"repoId": "repo-task-git",
		"taskId": "task-git",
		"commit": secondCommit,
	}))
	if commitFiles["repoId"] != "repo-task-git" || commitFiles["taskId"] != "task-git" || commitFiles["commit"] != secondCommit {
		t.Fatalf("commit files result = %#v", commitFiles)
	}
	files := arrayField(t, commitFiles, "files")
	assertChangedFile(t, files, "README.md", "modified")
	assertChangedFile(t, files, "src/app.ts", "added")

	readmePatch := resultObject(t, harness.request(t, "openade/task/git/commit/filePatch/read", map[string]any{
		"repoId":       "repo-task-git",
		"taskId":       "task-git",
		"commit":       secondCommit,
		"filePath":     "README.md",
		"contextLines": 3,
	}))
	if readmePatch["repoId"] != "repo-task-git" || readmePatch["taskId"] != "task-git" || readmePatch["commit"] != secondCommit || readmePatch["filePath"] != "README.md" {
		t.Fatalf("commit file patch identity = %#v", readmePatch)
	}
	patch, ok := readmePatch["patch"].(string)
	if !ok || !strings.Contains(patch, "+++ b/README.md") || !strings.Contains(patch, "+second") {
		t.Fatalf("commit file patch body = %#v", readmePatch)
	}
	if readmePatch["truncated"] != false || readmePatch["heavy"] != false {
		t.Fatalf("commit file patch flags = %#v", readmePatch)
	}
	patchStats := objectField(t, readmePatch, "stats")
	if patchStats["insertions"] != float64(1) || patchStats["deletions"] != float64(0) || patchStats["changedLines"] != float64(1) || patchStats["hunkCount"] != float64(1) {
		t.Fatalf("commit file patch stats = %#v", patchStats)
	}

	rootPatch := resultObject(t, harness.request(t, "openade/task/git/commit/filePatch/read", map[string]any{
		"repoId":   "repo-task-git",
		"taskId":   "task-git",
		"commit":   initialCommit,
		"filePath": "README.md",
	}))
	rootStats := objectField(t, rootPatch, "stats")
	if rootStats["insertions"] != float64(1) || rootStats["hunkCount"] != float64(1) {
		t.Fatalf("root commit patch stats = %#v patch %#v", rootStats, rootPatch)
	}

	readme := resultObject(t, harness.request(t, "openade/task/git/fileAtTreeish/read", map[string]any{
		"repoId":   "repo-task-git",
		"taskId":   "task-git",
		"treeish":  initialCommit,
		"filePath": "README.md",
	}))
	if readme["content"] != "initial\n" || readme["exists"] != true || readme["tooLarge"] != nil {
		t.Fatalf("readme at initial commit = %#v", readme)
	}

	missing := resultObject(t, harness.request(t, "openade/task/git/fileAtTreeish/read", map[string]any{
		"repoId":   "repo-task-git",
		"taskId":   "task-git",
		"treeish":  secondCommit,
		"filePath": "missing.txt",
	}))
	if missing["exists"] != false || missing["content"] != "" {
		t.Fatalf("missing file at treeish = %#v", missing)
	}

	badCommit := harness.request(t, "openade/task/git/commit/files/read", map[string]any{
		"repoId": "repo-task-git",
		"taskId": "task-git",
		"commit": "../HEAD",
	})
	if runtimeErrorCode(t, badCommit) != "invalid_params" {
		t.Fatalf("bad commit response = %#v", badCommit)
	}

	badPath := harness.request(t, "openade/task/git/fileAtTreeish/read", map[string]any{
		"repoId":   "repo-task-git",
		"taskId":   "task-git",
		"treeish":  "HEAD",
		"filePath": "../README.md",
	})
	if runtimeErrorCode(t, badPath) != "invalid_params" {
		t.Fatalf("bad path response = %#v", badPath)
	}

	badPatchContext := harness.request(t, "openade/task/git/commit/filePatch/read", map[string]any{
		"repoId":       "repo-task-git",
		"taskId":       "task-git",
		"commit":       secondCommit,
		"filePath":     "README.md",
		"contextLines": 2,
	})
	if runtimeErrorCode(t, badPatchContext) != "invalid_params" {
		t.Fatalf("bad patch context response = %#v", badPatchContext)
	}

	scopedLog := resultObject(t, harness.request(t, "openade/task/git/log", map[string]any{
		"repoId":  "repo-task-git",
		"taskId":  "task-git",
		"scopeId": "worktree:task-git-worktree",
		"limit":   1,
	}))
	scopedCommits := arrayField(t, scopedLog, "commits")
	if len(scopedCommits) != 1 || objectValue(t, scopedCommits[0])["sha"] != worktreeCommit || objectValue(t, scopedCommits[0])["message"] != "worktree scoped" {
		t.Fatalf("scoped worktree task git log response = %#v", scopedLog)
	}
	missingScope := harness.request(t, "openade/task/git/log", map[string]any{
		"repoId":  "repo-task-git",
		"taskId":  "task-git",
		"scopeId": "worktree:missing",
	})
	if runtimeErrorCode(t, missingScope) != "invalid_params" {
		t.Fatalf("missing task git scope response = %#v", missingScope)
	}

	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-worktree",
		RepoID:        "repo-task-git",
		Slug:          "task-worktree",
		Title:         "Task worktree",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert worktree task: %v", err)
	}
	worktreeTask := harness.request(t, "openade/task/git/log", map[string]any{
		"repoId": "repo-task-git",
		"taskId": "task-worktree",
	})
	if runtimeErrorCode(t, worktreeTask) != "invalid_params" {
		t.Fatalf("unprepared worktree task git log response = %#v", worktreeTask)
	}
	prepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId":          "repo-task-git",
		"taskId":          "task-worktree",
		"clientRequestId": "prepare-history-worktree",
	}))
	if prepared["rootPath"] == "" {
		t.Fatalf("prepared worktree = %#v", prepared)
	}
	worktreeLog := resultObject(t, harness.request(t, "openade/task/git/log", map[string]any{
		"repoId": "repo-task-git",
		"taskId": "task-worktree",
		"limit":  1,
	}))
	worktreeCommits := arrayField(t, worktreeLog, "commits")
	if len(worktreeCommits) != 1 || objectValue(t, worktreeCommits[0])["sha"] != secondCommit {
		t.Fatalf("prepared worktree log = %#v", worktreeLog)
	}
}

func TestProductTaskGitCommitOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot, _, _ := createGitHistoryRepo(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-task-commit",
		Name:      "Task Commit Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert task commit repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-commit",
		RepoID:        "repo-task-commit",
		Slug:          "task-commit",
		Title:         "Task commit",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert task commit task: %v", err)
	}

	writeFile(t, filepath.Join(repoRoot, "commit-me.txt"), []byte("commit me\n"))
	committed := resultObject(t, harness.request(t, "openade/task/git/commit", map[string]any{
		"repoId":          "repo-task-commit",
		"taskId":          "task-commit",
		"message":         "  Core commit  ",
		"clientRequestId": "task-commit-once",
	}))
	if committed["repoId"] != "repo-task-commit" || committed["taskId"] != "task-commit" || committed["committed"] != true || committed["status"] != "committed" {
		t.Fatalf("commit result = %#v", committed)
	}
	sha, ok := committed["sha"].(string)
	if !ok || sha == "" {
		t.Fatalf("commit sha = %#v", committed)
	}
	if subject := gitOutput(t, repoRoot, "log", "-1", "--format=%s"); subject != "Core commit" {
		t.Fatalf("commit subject = %q", subject)
	}
	if status := gitOutput(t, repoRoot, "status", "--porcelain"); status != "" {
		t.Fatalf("git status after commit = %q", status)
	}
	if count := gitOutput(t, repoRoot, "rev-list", "--count", "HEAD"); count != "3" {
		t.Fatalf("commit count after first commit = %q", count)
	}

	retried := resultObject(t, harness.request(t, "openade/task/git/commit", map[string]any{
		"repoId":          "repo-task-commit",
		"taskId":          "task-commit",
		"message":         "Should not commit again",
		"clientRequestId": "task-commit-once",
	}))
	if retried["status"] != "committed" || retried["sha"] != sha {
		t.Fatalf("retried commit result = %#v", retried)
	}
	if count := gitOutput(t, repoRoot, "rev-list", "--count", "HEAD"); count != "3" {
		t.Fatalf("commit count after retry = %q", count)
	}

	empty := resultObject(t, harness.request(t, "openade/task/git/commit", map[string]any{
		"repoId":          "repo-task-commit",
		"taskId":          "task-commit",
		"message":         "No changes",
		"clientRequestId": "task-commit-empty",
	}))
	if empty["committed"] != false || empty["status"] != "nothing_to_commit" {
		t.Fatalf("empty commit result = %#v", empty)
	}
	if count := gitOutput(t, repoRoot, "rev-list", "--count", "HEAD"); count != "3" {
		t.Fatalf("commit count after empty commit = %q", count)
	}

	invalidMessage := harness.request(t, "openade/task/git/commit", map[string]any{
		"repoId":          "repo-task-commit",
		"taskId":          "task-commit",
		"message":         "   ",
		"clientRequestId": "task-commit-invalid",
	})
	if runtimeErrorCode(t, invalidMessage) != "invalid_params" {
		t.Fatalf("invalid commit message response = %#v", invalidMessage)
	}

	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-commit-worktree",
		RepoID:        "repo-task-commit",
		Slug:          "task-commit-worktree",
		Title:         "Task commit worktree",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert worktree commit task: %v", err)
	}
	worktreeTask := harness.request(t, "openade/task/git/commit", map[string]any{
		"repoId":  "repo-task-commit",
		"taskId":  "task-commit-worktree",
		"message": "Worktree commit",
	})
	if runtimeErrorCode(t, worktreeTask) != "invalid_params" {
		t.Fatalf("unprepared worktree commit response = %#v", worktreeTask)
	}
	prepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId":          "repo-task-commit",
		"taskId":          "task-commit-worktree",
		"clientRequestId": "prepare-commit-worktree",
	}))
	worktreeRoot, ok := prepared["rootPath"].(string)
	if !ok || worktreeRoot == "" {
		t.Fatalf("prepared commit worktree = %#v", prepared)
	}
	writeFile(t, filepath.Join(worktreeRoot, "worktree-commit.txt"), []byte("worktree commit\n"))
	worktreeCommit := resultObject(t, harness.request(t, "openade/task/git/commit", map[string]any{
		"repoId":          "repo-task-commit",
		"taskId":          "task-commit-worktree",
		"message":         "Worktree commit",
		"clientRequestId": "worktree-commit-once",
	}))
	if worktreeCommit["committed"] != true || worktreeCommit["status"] != "committed" {
		t.Fatalf("worktree commit result = %#v", worktreeCommit)
	}
	if branch := gitOutput(t, worktreeRoot, "branch", "--show-current"); branch != "openade/task-commit-worktree" {
		t.Fatalf("worktree commit branch = %q", branch)
	}
	if subject := gitOutput(t, worktreeRoot, "log", "-1", "--format=%s"); subject != "Worktree commit" {
		t.Fatalf("worktree commit subject = %q", subject)
	}
	if status := gitOutput(t, worktreeRoot, "status", "--porcelain"); status != "" {
		t.Fatalf("worktree git status after commit = %q", status)
	}
	if mainSubject := gitOutput(t, repoRoot, "log", "-1", "--format=%s"); mainSubject != "Core commit" {
		t.Fatalf("main worktree should not receive task commit, subject = %q", mainSubject)
	}
}

func TestProductTaskWorkingTreeReadsOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot, _, _ := createGitHistoryRepo(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	writeFile(t, filepath.Join(repoRoot, "README.md"), []byte("initial\nsecond\nworking\n"))
	mkdirAll(t, filepath.Join(repoRoot, "notes"))
	writeFile(t, filepath.Join(repoRoot, "notes", "out.txt"), []byte("untracked note\n"))
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-task-worktree",
		Name:      "Task Working Tree Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert working tree repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-working-tree",
		RepoID:        "repo-task-worktree",
		Slug:          "task-working-tree",
		Title:         "Task working tree",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert working tree task: %v", err)
	}

	changes := resultObject(t, harness.request(t, "openade/task/changes/read", map[string]any{
		"repoId": "repo-task-worktree",
		"taskId": "task-working-tree",
	}))
	if changes["repoId"] != "repo-task-worktree" || changes["taskId"] != "task-working-tree" || changes["fromTreeish"] != "HEAD" || changes["toTreeish"] != "" {
		t.Fatalf("task changes = %#v", changes)
	}
	changedFiles := arrayField(t, changes, "files")
	assertChangedFile(t, changedFiles, "README.md", "modified")
	assertChangedFile(t, changedFiles, "notes/out.txt", "added")

	readmeDiff := resultObject(t, harness.request(t, "openade/task/diff/read", map[string]any{
		"repoId":       "repo-task-worktree",
		"taskId":       "task-working-tree",
		"filePath":     "README.md",
		"contextLines": 3,
	}))
	readmePatch, ok := readmeDiff["patch"].(string)
	if !ok || !strings.Contains(readmePatch, "+++ b/README.md") || !strings.Contains(readmePatch, "+working") {
		t.Fatalf("readme diff patch = %#v", readmeDiff)
	}
	readmeStats := objectField(t, readmeDiff, "stats")
	if readmeStats["insertions"] != float64(1) || readmeStats["deletions"] != float64(0) || readmeStats["changedLines"] != float64(1) || readmeStats["hunkCount"] != float64(1) {
		t.Fatalf("readme diff stats = %#v", readmeStats)
	}

	readmePair := resultObject(t, harness.request(t, "openade/task/filePair/read", map[string]any{
		"repoId":   "repo-task-worktree",
		"taskId":   "task-working-tree",
		"filePath": "README.md",
	}))
	if readmePair["before"] != "initial\nsecond\n" || readmePair["after"] != "initial\nsecond\nworking\n" || readmePair["tooLarge"] != nil {
		t.Fatalf("readme file pair = %#v", readmePair)
	}

	untrackedDiff := resultObject(t, harness.request(t, "openade/task/diff/read", map[string]any{
		"repoId":   "repo-task-worktree",
		"taskId":   "task-working-tree",
		"filePath": "notes/out.txt",
	}))
	untrackedPatch, ok := untrackedDiff["patch"].(string)
	if !ok || !strings.Contains(untrackedPatch, "+++ b/notes/out.txt") || !strings.Contains(untrackedPatch, "+untracked note") {
		t.Fatalf("untracked diff patch = %#v", untrackedDiff)
	}
	untrackedStats := objectField(t, untrackedDiff, "stats")
	if untrackedStats["insertions"] != float64(1) || untrackedStats["changedLines"] != float64(1) || untrackedStats["hunkCount"] != float64(1) {
		t.Fatalf("untracked diff stats = %#v", untrackedStats)
	}

	untrackedPair := resultObject(t, harness.request(t, "openade/task/filePair/read", map[string]any{
		"repoId":   "repo-task-worktree",
		"taskId":   "task-working-tree",
		"filePath": "notes/out.txt",
	}))
	if untrackedPair["before"] != "" || untrackedPair["after"] != "untracked note\n" {
		t.Fatalf("untracked file pair = %#v", untrackedPair)
	}

	badDiffPath := harness.request(t, "openade/task/diff/read", map[string]any{
		"repoId":   "repo-task-worktree",
		"taskId":   "task-working-tree",
		"filePath": "../README.md",
	})
	if runtimeErrorCode(t, badDiffPath) != "invalid_params" {
		t.Fatalf("bad diff path response = %#v", badDiffPath)
	}

	badPairPath := harness.request(t, "openade/task/filePair/read", map[string]any{
		"repoId":   "repo-task-worktree",
		"taskId":   "task-working-tree",
		"filePath": "../README.md",
	})
	if runtimeErrorCode(t, badPairPath) != "invalid_params" {
		t.Fatalf("bad file pair path response = %#v", badPairPath)
	}

	badContext := harness.request(t, "openade/task/diff/read", map[string]any{
		"repoId":       "repo-task-worktree",
		"taskId":       "task-working-tree",
		"filePath":     "README.md",
		"contextLines": 2,
	})
	if runtimeErrorCode(t, badContext) != "invalid_params" {
		t.Fatalf("bad diff context response = %#v", badContext)
	}

	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-working-tree-worktree",
		RepoID:        "repo-task-worktree",
		Slug:          "task-working-tree-worktree",
		Title:         "Task working tree worktree",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert worktree task: %v", err)
	}
	worktreeTask := harness.request(t, "openade/task/changes/read", map[string]any{
		"repoId": "repo-task-worktree",
		"taskId": "task-working-tree-worktree",
	})
	if runtimeErrorCode(t, worktreeTask) != "invalid_params" {
		t.Fatalf("worktree task changes response = %#v", worktreeTask)
	}
	prepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId":          "repo-task-worktree",
		"taskId":          "task-working-tree-worktree",
		"clientRequestId": "prepare-working-tree-worktree",
	}))
	worktreeRoot, ok := prepared["rootPath"].(string)
	if !ok || worktreeRoot == "" {
		t.Fatalf("prepared working tree = %#v", prepared)
	}
	worktreeEnvironment := objectField(t, prepared, "deviceEnvironment")
	mergeBase, ok := worktreeEnvironment["mergeBaseCommit"].(string)
	if !ok || mergeBase == "" {
		t.Fatalf("prepared worktree merge base = %#v", prepared)
	}
	writeFile(t, filepath.Join(worktreeRoot, "README.md"), []byte("initial\nsecond\nworktree\n"))
	mkdirAll(t, filepath.Join(worktreeRoot, "worktree-notes"))
	writeFile(t, filepath.Join(worktreeRoot, "worktree-notes", "note.txt"), []byte("worktree note\n"))
	worktreeChanges := resultObject(t, harness.request(t, "openade/task/changes/read", map[string]any{
		"repoId": "repo-task-worktree",
		"taskId": "task-working-tree-worktree",
	}))
	if worktreeChanges["fromTreeish"] != mergeBase {
		t.Fatalf("worktree changes fromTreeish = %#v want %q", worktreeChanges, mergeBase)
	}
	worktreeChangedFiles := arrayField(t, worktreeChanges, "files")
	assertChangedFile(t, worktreeChangedFiles, "README.md", "modified")
	assertChangedFile(t, worktreeChangedFiles, "worktree-notes/note.txt", "added")
	worktreeDiff := resultObject(t, harness.request(t, "openade/task/diff/read", map[string]any{
		"repoId":   "repo-task-worktree",
		"taskId":   "task-working-tree-worktree",
		"filePath": "README.md",
	}))
	worktreePatch, ok := worktreeDiff["patch"].(string)
	if !ok || !strings.Contains(worktreePatch, "+++ b/README.md") || !strings.Contains(worktreePatch, "+worktree") {
		t.Fatalf("worktree diff patch = %#v", worktreeDiff)
	}
	worktreePair := resultObject(t, harness.request(t, "openade/task/filePair/read", map[string]any{
		"repoId":   "repo-task-worktree",
		"taskId":   "task-working-tree-worktree",
		"filePath": "README.md",
	}))
	if worktreePair["before"] != "initial\nsecond\n" || worktreePair["after"] != "initial\nsecond\nworktree\n" {
		t.Fatalf("worktree file pair = %#v", worktreePair)
	}
	worktreeUntrackedPair := resultObject(t, harness.request(t, "openade/task/filePair/read", map[string]any{
		"repoId":   "repo-task-worktree",
		"taskId":   "task-working-tree-worktree",
		"filePath": "worktree-notes/note.txt",
	}))
	if worktreeUntrackedPair["before"] != "" || worktreeUntrackedPair["after"] != "worktree note\n" {
		t.Fatalf("worktree untracked pair = %#v", worktreeUntrackedPair)
	}
}

func TestProductProjectProcessListOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	projectDir := createProjectProcessesFixture(t)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-procs",
		Name:      "Process Repo",
		Path:      projectDir,
		CreatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("upsert process repo: %v", err)
	}
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-procs-head",
		RepoID:        "repo-procs",
		Slug:          "task-procs-head",
		Title:         "Head process task",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert head process task: %v", err)
	}

	processList := resultObject(t, harness.request(t, "openade/project/process/list", map[string]any{
		"repoId": "repo-procs",
	}))
	if processList["repoId"] != "repo-procs" || processList["searchRoot"] != projectDir || processList["repoRoot"] != projectDir || processList["isWorktree"] != false {
		t.Fatalf("process list root fields = %#v", processList)
	}
	if len(arrayField(t, processList, "instances")) != 0 {
		t.Fatalf("process instances should be empty before core owns process lifecycle: %#v", processList["instances"])
	}

	configsByPath := map[string]map[string]any{}
	for _, item := range arrayField(t, processList, "configs") {
		config := objectValue(t, item)
		configsByPath[config["relativePath"].(string)] = config
	}
	if configsByPath["openade.toml"] == nil || configsByPath["packages/app/openade.toml"] == nil || configsByPath["bad/openade.toml"] == nil {
		t.Fatalf("process configs = %#v", configsByPath)
	}
	if configsByPath["invalid/openade.toml"] != nil {
		t.Fatalf("invalid config should not be returned as parsed config: %#v", configsByPath["invalid/openade.toml"])
	}

	rootProcesses := arrayField(t, configsByPath["openade.toml"], "processes")
	if len(rootProcesses) != 1 {
		t.Fatalf("root processes = %#v", rootProcesses)
	}
	rootProcess := objectValue(t, rootProcesses[0])
	if rootProcess["id"] != "openade.toml::Echo" || rootProcess["name"] != "Echo" || rootProcess["command"] != "printf runtime-process" || rootProcess["type"] != "daemon" || rootProcess["url"] != "http://localhost:3000" {
		t.Fatalf("root process = %#v", rootProcess)
	}
	rootCrons := arrayField(t, configsByPath["openade.toml"], "crons")
	if len(rootCrons) != 1 {
		t.Fatalf("root crons = %#v", rootCrons)
	}
	rootCron := objectValue(t, rootCrons[0])
	if rootCron["id"] != "openade.toml::Sweep" || rootCron["appendSystemPrompt"] != "extra" || rootCron["isolation"] != "head" || rootCron["harness"] != "codex" || rootCron["inTaskId"] != "task-1" || rootCron["reuseTask"] != false {
		t.Fatalf("root cron = %#v", rootCron)
	}
	assertStringSetEquals(t, stringsFromAny(arrayField(t, rootCron, "images")), []string{"img-1"})

	processesByID := map[string]map[string]any{}
	for _, item := range arrayField(t, processList, "processes") {
		process := objectValue(t, item)
		processesByID[process["id"].(string)] = process
	}
	echo := processesByID["openade.toml::Echo"]
	if echo == nil || echo["configPath"] != "openade.toml" || echo["cwd"] != projectDir {
		t.Fatalf("echo process definition = %#v", echo)
	}
	build := processesByID["packages/app/openade.toml::Build"]
	if build == nil || build["type"] != "task" || build["workDir"] != "../api" || build["configPath"] != "packages/app/openade.toml" || build["cwd"] != filepath.Join(projectDir, "packages", "api") {
		t.Fatalf("build process definition = %#v", build)
	}
	if processesByID["bad/openade.toml::Outside"] != nil {
		t.Fatalf("outside cwd process should not be returned: %#v", processesByID["bad/openade.toml::Outside"])
	}

	errorsByPath := map[string]string{}
	for _, item := range arrayField(t, processList, "errors") {
		configError := objectValue(t, item)
		errorsByPath[configError["relativePath"].(string)] = configError["error"].(string)
	}
	if errorsByPath["bad/openade.toml"] != "process cwd is outside the repository" {
		t.Fatalf("bad process error = %#v", errorsByPath)
	}
	if !strings.Contains(errorsByPath["invalid/openade.toml"], "Invalid process key/value") {
		t.Fatalf("invalid process error = %#v", errorsByPath)
	}

	headTaskList := resultObject(t, harness.request(t, "openade/project/process/list", map[string]any{
		"repoId": "repo-procs",
		"taskId": "task-procs-head",
	}))
	if headTaskList["repoId"] != "repo-procs" || headTaskList["taskId"] != "task-procs-head" || headTaskList["searchRoot"] != projectDir {
		t.Fatalf("head task process list = %#v", headTaskList)
	}

	missingTask := harness.request(t, "openade/project/process/list", map[string]any{
		"repoId": "repo-procs",
		"taskId": "task-missing",
	})
	if runtimeErrorCode(t, missingTask) != "not_found" {
		t.Fatalf("missing task process list response = %#v", missingTask)
	}
}

func TestProductProjectProcessListTaskScopesOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot, _, _ := createGitHistoryRepo(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-task-procs",
		Name:      "Task Process Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert task process repo: %v", err)
	}
	for _, task := range []storage.Task{
		{
			ID:            "task-procs-worktree",
			RepoID:        "repo-task-procs",
			Slug:          "task-procs-worktree",
			Title:         "Worktree process task",
			IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
			CreatedAt:     now,
			UpdatedAt:     now,
		},
		{
			ID:            "task-procs-unprepared",
			RepoID:        "repo-task-procs",
			Slug:          "task-procs-unprepared",
			Title:         "Unprepared worktree process task",
			IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
			CreatedAt:     now,
			UpdatedAt:     now,
		},
	} {
		if err := harness.store.UpsertTask(ctx, task); err != nil {
			t.Fatalf("upsert process task %s: %v", task.ID, err)
		}
	}

	prepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId": "repo-task-procs",
		"taskId": "task-procs-worktree",
	}))
	worktreeRoot, ok := prepared["rootPath"].(string)
	if !ok || worktreeRoot == "" {
		t.Fatalf("prepared worktree root = %#v", prepared)
	}
	canonicalWorktreeRoot, err := filepath.EvalSymlinks(worktreeRoot)
	if err != nil {
		t.Fatalf("canonicalize worktree root: %v", err)
	}
	mkdirAll(t, filepath.Join(worktreeRoot, "services", "api"))
	writeFile(t, filepath.Join(worktreeRoot, "openade.toml"), []byte(`[[process]]
name = "TaskProc"
command = "printf task-process"
type = "daemon"
`))
	writeFile(t, filepath.Join(worktreeRoot, "services", "api", "openade.toml"), []byte(`[[process]]
name = "Nested"
command = "npm run dev"
type = "task"
work_dir = "."
`))
	if _, err := os.Stat(filepath.Join(repoRoot, "openade.toml")); !os.IsNotExist(err) {
		t.Fatalf("worktree process config leaked into repo root: %v", err)
	}

	processList := resultObject(t, harness.request(t, "openade/project/process/list", map[string]any{
		"repoId": "repo-task-procs",
		"taskId": "task-procs-worktree",
	}))
	if processList["repoId"] != "repo-task-procs" || processList["taskId"] != "task-procs-worktree" || processList["searchRoot"] != worktreeRoot || processList["repoRoot"] != canonicalWorktreeRoot || processList["isWorktree"] != true || processList["worktreeRoot"] != canonicalWorktreeRoot {
		t.Fatalf("worktree task process list roots = %#v", processList)
	}
	configsByPath := map[string]map[string]any{}
	for _, item := range arrayField(t, processList, "configs") {
		config := objectValue(t, item)
		configsByPath[config["relativePath"].(string)] = config
	}
	if configsByPath["openade.toml"] == nil || configsByPath["services/api/openade.toml"] == nil {
		t.Fatalf("worktree process configs = %#v", configsByPath)
	}
	processesByID := map[string]map[string]any{}
	for _, item := range arrayField(t, processList, "processes") {
		process := objectValue(t, item)
		processesByID[process["id"].(string)] = process
	}
	taskProc := processesByID["openade.toml::TaskProc"]
	if taskProc == nil || taskProc["cwd"] != canonicalWorktreeRoot || taskProc["command"] != "printf task-process" {
		t.Fatalf("worktree root process = %#v", taskProc)
	}
	nested := processesByID["services/api/openade.toml::Nested"]
	if nested == nil || nested["cwd"] != filepath.Join(canonicalWorktreeRoot, "services", "api") || nested["type"] != "task" {
		t.Fatalf("worktree nested process = %#v", nested)
	}
	if len(arrayField(t, processList, "instances")) != 0 {
		t.Fatalf("worktree process instances should stay empty before lifecycle ownership: %#v", processList["instances"])
	}

	unprepared := harness.request(t, "openade/project/process/list", map[string]any{
		"repoId": "repo-task-procs",
		"taskId": "task-procs-unprepared",
	})
	if runtimeErrorCode(t, unprepared) != "invalid_params" {
		t.Fatalf("unprepared worktree process list response = %#v", unprepared)
	}
}

func TestProductTaskTerminalOverRuntime(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PTY terminal test is Unix-only")
	}
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoPath := t.TempDir()
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-terminal",
		Name:      "Terminal Repo",
		Path:      repoPath,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert terminal repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-terminal",
		RepoID:        "repo-terminal",
		Slug:          "task-terminal",
		Title:         "Terminal task",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert terminal task: %v", err)
	}
	resultObject(t, harness.request(t, "openade/settings/personal/replace", map[string]any{
		"settings": map[string]any{
			"envVars": map[string]any{"OPENADE_CORE_TERMINAL_ENV_TEST": "terminal-env-from-core"},
		},
		"clientRequestId": "terminal-env-settings",
	}))

	expectedTerminalID := taskTerminalIDForTest("repo-terminal", "task-terminal")
	startIndex := len(harness.notifications)
	started := resultObject(t, harness.request(t, "openade/task/terminal/start", map[string]any{
		"repoId":          "repo-terminal",
		"taskId":          "task-terminal",
		"cols":            80,
		"rows":            24,
		"clientRequestId": "terminal-start",
	}))
	if started["repoId"] != "repo-terminal" || started["taskId"] != "task-terminal" || started["terminalId"] != expectedTerminalID || started["runtimeId"] != "pty:"+expectedTerminalID || started["ok"] != true {
		t.Fatalf("terminal start = %#v", started)
	}
	retried := resultObject(t, harness.request(t, "openade/task/terminal/start", map[string]any{
		"repoId":          "repo-terminal",
		"taskId":          "task-terminal",
		"clientRequestId": "terminal-start",
	}))
	if retried["terminalId"] != expectedTerminalID || retried["ok"] != true {
		t.Fatalf("terminal start retry = %#v", retried)
	}

	harness.waitForRuntimeNotification(t, startIndex, "runtime/created", "pty:"+expectedTerminalID)
	startedNotification := harness.waitForPtyNotification(t, startIndex, "pty/started", expectedTerminalID)
	startedParams := objectField(t, startedNotification, "params")
	if startedParams["runtimeId"] != "pty:"+expectedTerminalID || startedParams["cwd"] != repoPath {
		t.Fatalf("pty started notification = %#v", startedParams)
	}
	runtimeRecord := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "pty:" + expectedTerminalID,
	}))
	if runtimeRecord["kind"] != "pty" || runtimeRecord["status"] != "running" || runtimeRecord["nativeId"] != expectedTerminalID {
		t.Fatalf("terminal runtime record = %#v", runtimeRecord)
	}

	reconnected := resultObject(t, harness.request(t, "openade/task/terminal/reconnect", map[string]any{
		"repoId": "repo-terminal",
		"taskId": "task-terminal",
	}))
	if reconnected["terminalId"] != expectedTerminalID || reconnected["found"] != true {
		t.Fatalf("terminal reconnect = %#v", reconnected)
	}

	written := resultObject(t, harness.request(t, "openade/task/terminal/write", map[string]any{
		"repoId":          "repo-terminal",
		"taskId":          "task-terminal",
		"terminalId":      expectedTerminalID,
		"data":            "printf \"$OPENADE_CORE_TERMINAL_ENV_TEST\\n\"\n",
		"clientRequestId": "terminal-write",
	}))
	if written["ok"] != true {
		t.Fatalf("terminal write = %#v", written)
	}
	output := waitForTaskTerminalOutput(t, harness, "repo-terminal", "task-terminal", expectedTerminalID, "terminal-env-from-core")
	if !strings.Contains(output, "terminal-env-from-core") {
		t.Fatalf("terminal output = %q", output)
	}
	persistedTerminalOutput, err := harness.store.ListRuntimeOutputChunks(ctx, "pty:"+expectedTerminalID, runtimeOutputReadLimit)
	if err != nil {
		t.Fatalf("list persisted terminal output: %v", err)
	}
	if len(persistedTerminalOutput) == 0 || !strings.Contains(runtimeOutputData(persistedTerminalOutput), "terminal-env-from-core") {
		t.Fatalf("persisted terminal output = %#v", persistedTerminalOutput)
	}

	resized := resultObject(t, harness.request(t, "openade/task/terminal/resize", map[string]any{
		"repoId":          "repo-terminal",
		"taskId":          "task-terminal",
		"terminalId":      expectedTerminalID,
		"cols":            100,
		"rows":            30,
		"clientRequestId": "terminal-resize",
	}))
	if resized["ok"] != true {
		t.Fatalf("terminal resize = %#v", resized)
	}
	badWrite := harness.request(t, "openade/task/terminal/write", map[string]any{
		"repoId":     "repo-terminal",
		"taskId":     "task-terminal",
		"terminalId": "bad-terminal",
		"data":       "nope\n",
	})
	if runtimeErrorCode(t, badWrite) != "invalid_params" {
		t.Fatalf("bad terminal write response = %#v", badWrite)
	}

	stopIndex := len(harness.notifications)
	stopped := resultObject(t, harness.request(t, "openade/task/terminal/stop", map[string]any{
		"repoId":          "repo-terminal",
		"taskId":          "task-terminal",
		"terminalId":      expectedTerminalID,
		"clientRequestId": "terminal-stop",
	}))
	if stopped["ok"] != true {
		t.Fatalf("terminal stop = %#v", stopped)
	}
	harness.waitForPtyNotification(t, stopIndex, "pty/killed", expectedTerminalID)
	stoppedRuntime := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "pty:" + expectedTerminalID,
	}))
	if stoppedRuntime["status"] != "stopped" || stoppedRuntime["signal"] == "" {
		t.Fatalf("stopped terminal runtime = %#v", stoppedRuntime)
	}
	reconnectAfterStop := resultObject(t, harness.request(t, "openade/task/terminal/reconnect", map[string]any{
		"repoId":     "repo-terminal",
		"taskId":     "task-terminal",
		"terminalId": expectedTerminalID,
	}))
	if reconnectAfterStop["found"] != false {
		t.Fatalf("terminal reconnect after stop = %#v", reconnectAfterStop)
	}
}

func TestProductActionEventLifecycleOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 13, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-action",
		Name:      "Action Repo",
		Path:      t.TempDir(),
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert action repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-action",
		RepoID:        "repo-action",
		Slug:          "task-action",
		Title:         "Action task",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert action task: %v", err)
	}
	if err := harness.store.UpsertTaskPreview(ctx, storage.TaskPreview{
		TaskID:    "task-action",
		RepoID:    "repo-action",
		Slug:      "task-action",
		Title:     "Action task",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert action preview: %v", err)
	}

	created := resultObject(t, harness.request(t, "openade/action/create", map[string]any{
		"taskId":             "task-action",
		"eventId":            "event-action-1",
		"createdAt":          "2026-06-06T13:01:00Z",
		"userInput":          "run tests",
		"executionId":        "exec-1",
		"harnessId":          "codex",
		"modelId":            "gpt-test",
		"fastMode":           true,
		"source":             map[string]any{"type": "do", "userLabel": "Do"},
		"images":             []any{map[string]any{"id": "img-1", "ext": "png"}},
		"includesCommentIds": []any{"comment-1"},
		"gitRefsBefore":      map[string]any{"sha": "abc123", "branch": "main"},
		"clientRequestId":    "action-create-1",
	}))
	if created["eventId"] != "event-action-1" || created["createdAt"] != "2026-06-06T13:01:00Z" {
		t.Fatalf("action create = %#v", created)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-action",
		"taskId":               "task-action",
		"hydrateSessionEvents": true,
	}))
	event := actionEventFromTask(t, task, "event-action-1")
	if event["status"] != "in_progress" || event["userInput"] != "run tests" {
		t.Fatalf("created action event = %#v", event)
	}
	execution := objectField(t, event, "execution")
	if execution["executionId"] != "exec-1" || execution["harnessId"] != "codex" || execution["modelId"] != "gpt-test" || execution["fastMode"] != true {
		t.Fatalf("created action execution = %#v", execution)
	}
	if source := objectField(t, event, "source"); source["type"] != "do" || source["userLabel"] != "Do" {
		t.Fatalf("created action source = %#v", source)
	}
	if len(arrayField(t, event, "images")) != 1 || len(arrayField(t, event, "includesCommentIds")) != 1 {
		t.Fatalf("created action attachments/comments = %#v", event)
	}

	for index := 0; index < 2; index++ {
		resultObject(t, harness.request(t, "openade/action/stream/append", map[string]any{
			"taskId":  "task-action",
			"eventId": "event-action-1",
			"streamEvent": map[string]any{
				"id":   "stream-1",
				"type": "assistant_message",
				"text": "hello",
			},
			"clientRequestId": fmt.Sprintf("stream-append-%d", index),
		}))
	}
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-action",
		"taskId":               "task-action",
		"hydrateSessionEvents": true,
	}))
	event = actionEventFromTask(t, task, "event-action-1")
	execution = objectField(t, event, "execution")
	streamEvents := arrayField(t, execution, "events")
	if len(streamEvents) != 1 || objectValue(t, streamEvents[0])["id"] != "stream-1" {
		t.Fatalf("stream events after duplicate append = %#v", streamEvents)
	}

	resultObject(t, harness.request(t, "openade/action/execution/update", map[string]any{
		"taskId":          "task-action",
		"eventId":         "event-action-1",
		"sessionId":       "session-1",
		"parentSessionId": "parent-1",
		"gitRefsAfter":    map[string]any{"sha": "def456", "branch": "feature"},
		"clientRequestId": "execution-update-1",
	}))
	completedAt := "2026-06-06T13:02:00Z"
	resultObject(t, harness.request(t, "openade/action/complete", map[string]any{
		"taskId":          "task-action",
		"eventId":         "event-action-1",
		"success":         true,
		"completedAt":     completedAt,
		"clientRequestId": "action-complete-1",
	}))
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-action",
		"taskId":               "task-action",
		"hydrateSessionEvents": true,
	}))
	event = actionEventFromTask(t, task, "event-action-1")
	if event["status"] != "completed" || event["completedAt"] != completedAt || objectField(t, event, "result")["success"] != true {
		t.Fatalf("completed action event = %#v", event)
	}
	execution = objectField(t, event, "execution")
	if execution["sessionId"] != "session-1" || execution["parentSessionId"] != "parent-1" || objectField(t, execution, "gitRefsAfter")["sha"] != "def456" {
		t.Fatalf("updated action execution = %#v", execution)
	}
	previews := resultArray(t, harness.request(t, "openade/task/list", map[string]any{"repoId": "repo-action"}))
	preview := objectValue(t, previews[0])
	if preview["lastEventAt"] != completedAt || objectField(t, preview, "lastEvent")["id"] != "event-action-1" {
		t.Fatalf("action preview after complete = %#v", preview)
	}
	reconciledTerminal := resultObject(t, harness.request(t, "openade/action/reconcileRuntime", map[string]any{
		"taskId":      "task-action",
		"eventId":     "event-action-1",
		"status":      "completed",
		"completedAt": "2026-06-06T13:03:00Z",
	}))
	if reconciledTerminal["changed"] != false || reconciledTerminal["reason"] != "already_terminal" || reconciledTerminal["status"] != "completed" {
		t.Fatalf("terminal action reconcile = %#v", reconciledTerminal)
	}

	resultObject(t, harness.request(t, "openade/action/create", map[string]any{
		"taskId":          "task-action",
		"eventId":         "event-action-2",
		"userInput":       "ask question",
		"executionId":     "exec-2",
		"harnessId":       "codex",
		"source":          map[string]any{"type": "ask", "userLabel": "Ask"},
		"clientRequestId": "action-create-2",
	}))
	reconciled := resultObject(t, harness.request(t, "openade/action/reconcileRuntime", map[string]any{
		"taskId":          "task-action",
		"executionId":     "exec-2",
		"status":          "failed",
		"completedAt":     "2026-06-06T13:04:00Z",
		"clientRequestId": "action-reconcile-2",
	}))
	if reconciled["changed"] != true || reconciled["eventId"] != "event-action-2" || reconciled["status"] != "error" {
		t.Fatalf("action reconcile by execution id = %#v", reconciled)
	}
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-action",
		"taskId":               "task-action",
		"hydrateSessionEvents": true,
	}))
	event = actionEventFromTask(t, task, "event-action-2")
	if event["status"] != "error" || event["completedAt"] != "2026-06-06T13:04:00Z" {
		t.Fatalf("reconciled failed event = %#v", event)
	}
}

func TestProductHyperPlanSubExecutionMutationsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 14, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-hyperplan",
		Name:      "HyperPlan Repo",
		Path:      t.TempDir(),
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert hyperplan repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-hyperplan",
		RepoID:        "repo-hyperplan",
		Slug:          "task-hyperplan",
		Title:         "HyperPlan task",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert hyperplan task: %v", err)
	}
	if err := harness.store.UpsertTaskPreview(ctx, storage.TaskPreview{
		TaskID:    "task-hyperplan",
		RepoID:    "repo-hyperplan",
		Slug:      "task-hyperplan",
		Title:     "HyperPlan task",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert hyperplan preview: %v", err)
	}

	resultObject(t, harness.request(t, "openade/action/create", map[string]any{
		"taskId":          "task-hyperplan",
		"eventId":         "event-hyperplan",
		"createdAt":       "2026-06-06T14:01:00Z",
		"userInput":       "coordinate sub agents",
		"executionId":     "exec-hyperplan",
		"harnessId":       "codex",
		"modelId":         "gpt-test",
		"source":          map[string]any{"type": "hyperplan", "userLabel": "HyperPlan"},
		"clientRequestId": "hyperplan-action-create",
	}))

	notificationStart := len(harness.notifications)
	resultObject(t, harness.request(t, "openade/hyperplan/subExecution/add", map[string]any{
		"taskId":  "task-hyperplan",
		"eventId": "event-hyperplan",
		"subExecution": map[string]any{
			"stepId":            "step-a",
			"primitive":         "plan",
			"harnessId":         "codex",
			"modelId":           "gpt-test",
			"executionId":       "sub-exec-a",
			"status":            "in_progress",
			"omittedEventCount": 2,
			"events": []any{
				map[string]any{"id": "sub-stream-1", "type": "assistant_message", "text": "first"},
			},
		},
		"clientRequestId": "hyperplan-sub-add",
	}))
	resultObject(t, harness.request(t, "openade/hyperplan/subExecution/add", map[string]any{
		"taskId":  "task-hyperplan",
		"eventId": "event-hyperplan",
		"subExecution": map[string]any{
			"stepId":      "step-a",
			"primitive":   "review",
			"harnessId":   "ignored",
			"modelId":     "ignored",
			"executionId": "ignored",
			"status":      "completed",
			"events":      []any{},
		},
		"clientRequestId": "hyperplan-sub-duplicate-add",
	}))
	for index := 0; index < 2; index++ {
		resultObject(t, harness.request(t, "openade/hyperplan/subExecution/stream/append", map[string]any{
			"taskId":  "task-hyperplan",
			"eventId": "event-hyperplan",
			"stepId":  "step-a",
			"streamEvent": map[string]any{
				"id":   "sub-stream-2",
				"type": "assistant_message",
				"text": "second",
			},
			"clientRequestId": fmt.Sprintf("hyperplan-stream-%d", index),
		}))
	}
	resultObject(t, harness.request(t, "openade/hyperplan/subExecution/update", map[string]any{
		"taskId":          "task-hyperplan",
		"eventId":         "event-hyperplan",
		"stepId":          "step-a",
		"executionId":     "sub-exec-a-done",
		"sessionId":       "session-a",
		"parentSessionId": "parent-a",
		"status":          "completed",
		"resultText":      "plan text",
		"clientRequestId": "hyperplan-sub-update",
	}))
	resultObject(t, harness.request(t, "openade/hyperplan/reconcileLabels/set", map[string]any{
		"taskId":  "task-hyperplan",
		"eventId": "event-hyperplan",
		"mapping": []any{
			map[string]any{"stepId": "step-a", "label": "accepted"},
			map[string]any{"stepId": "missing-step", "label": "ignored"},
		},
		"clientRequestId": "hyperplan-labels",
	}))
	harness.waitForNotification(t, notificationStart, "openade/task/updated")

	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-hyperplan",
		"taskId":               "task-hyperplan",
		"hydrateSessionEvents": true,
	}))
	event := actionEventFromTask(t, task, "event-hyperplan")
	subExecutions := arrayField(t, event, "hyperplanSubExecutions")
	if len(subExecutions) != 1 {
		t.Fatalf("hyperplan sub-executions = %#v", subExecutions)
	}
	subExecution := objectValue(t, subExecutions[0])
	if subExecution["stepId"] != "step-a" || subExecution["primitive"] != "plan" || subExecution["harnessId"] != "codex" || subExecution["modelId"] != "gpt-test" {
		t.Fatalf("hyperplan sub-execution identity = %#v", subExecution)
	}
	if subExecution["executionId"] != "sub-exec-a-done" || subExecution["sessionId"] != "session-a" || subExecution["parentSessionId"] != "parent-a" {
		t.Fatalf("hyperplan sub-execution session = %#v", subExecution)
	}
	if subExecution["status"] != "completed" || subExecution["resultText"] != "plan text" || subExecution["reconcileLabel"] != "accepted" {
		t.Fatalf("hyperplan sub-execution result = %#v", subExecution)
	}
	if subExecution["omittedEventCount"] != float64(2) {
		t.Fatalf("hyperplan sub-execution custom fields not preserved = %#v", subExecution)
	}
	streamEvents := arrayField(t, subExecution, "events")
	if len(streamEvents) != 2 || objectValue(t, streamEvents[0])["id"] != "sub-stream-1" || objectValue(t, streamEvents[1])["id"] != "sub-stream-2" {
		t.Fatalf("hyperplan sub-execution stream events = %#v", streamEvents)
	}

	invalidStatus := harness.request(t, "openade/hyperplan/subExecution/update", map[string]any{
		"taskId":  "task-hyperplan",
		"eventId": "event-hyperplan",
		"stepId":  "step-a",
		"status":  "done",
	})
	if runtimeErrorCode(t, invalidStatus) != "invalid_params" {
		t.Fatalf("invalid hyperplan status response = %#v", invalidStatus)
	}
}

type completingAgentExecutor struct {
	requests chan product.AgentExecutionRequest
}

func (executor completingAgentExecutor) Run(ctx context.Context, request product.AgentExecutionRequest, emitter product.AgentExecutionEmitter) product.AgentExecutionResult {
	executor.requests <- request
	_ = emitter.AppendStreamEvent(ctx, json.RawMessage(`{"id":"stream-complete-1","type":"assistant_message","text":"core executor streamed"}`))
	_ = emitter.UpdateExecution(ctx, product.AgentExecutionUpdate{
		SessionID:       "session-complete",
		ParentSessionID: "parent-complete",
		GitRefsAfter:    json.RawMessage(`{"sha":"abc123","branch":"core-executor"}`),
	})
	success := true
	return product.AgentExecutionResult{
		Status:      product.AgentExecutionCompleted,
		Success:     &success,
		CompletedAt: time.Date(2026, 6, 6, 15, 1, 0, 0, time.UTC),
	}
}

func TestProductMCPServerSettingsOverRuntime(t *testing.T) {
	requests := make(chan product.AgentExecutionRequest, 1)
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = completingAgentExecutor{requests: requests}
	})
	ctx := context.Background()
	projectDir := t.TempDir()
	now := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-mcp-settings",
		Name:      "MCP Settings Repo",
		Path:      projectDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert mcp settings repo: %v", err)
	}

	empty := resultObject(t, harness.request(t, "openade/settings/mcpServers/read", map[string]any{}))
	if servers := arrayField(t, empty, "servers"); len(servers) != 0 {
		t.Fatalf("initial mcp servers = %#v", servers)
	}

	replaced := resultObject(t, harness.request(t, "openade/settings/mcpServers/replace", map[string]any{
		"clientRequestId": "mcp-replace",
		"servers": []any{
			map[string]any{
				"id":            "mcp-http",
				"name":          "runtime-http",
				"enabled":       true,
				"transportType": "http",
				"presetId":      "github",
				"healthStatus":  "healthy",
				"createdAt":     "2026-06-08T12:00:00Z",
				"updatedAt":     "2026-06-08T12:01:00Z",
				"url":           "https://mcp.example.test",
				"headers":       map[string]any{"X-Test": "yes"},
				"oauthTokens": map[string]any{
					"accessToken":  "access-token",
					"refreshToken": "refresh-token",
					"expiresAt":    "2026-06-08T13:00:00Z",
					"tokenType":    "Bearer",
				},
			},
			map[string]any{
				"id":            "mcp-stdio",
				"name":          "runtime-stdio",
				"enabled":       true,
				"transportType": "stdio",
				"healthStatus":  "unknown",
				"createdAt":     "2026-06-08T12:02:00Z",
				"updatedAt":     "2026-06-08T12:03:00Z",
				"command":       "node",
				"args":          []any{"server.js", "--verbose"},
				"envVars":       map[string]any{"MCP_MODE": "test"},
				"cwd":           projectDir,
			},
			map[string]any{
				"id":            "mcp-disabled",
				"name":          "disabled-server",
				"enabled":       false,
				"transportType": "http",
				"healthStatus":  "unknown",
				"createdAt":     "2026-06-08T12:04:00Z",
				"updatedAt":     "2026-06-08T12:05:00Z",
				"url":           "https://disabled.example.test",
			},
		},
	}))
	if replaced["replacedServers"] != float64(3) {
		t.Fatalf("mcp replace result = %#v", replaced)
	}
	servers := arrayField(t, replaced, "servers")
	if len(servers) != 3 {
		t.Fatalf("mcp replaced servers = %#v", servers)
	}
	httpServer := objectValue(t, servers[0])
	oauthTokens := objectField(t, httpServer, "oauthTokens")
	if httpServer["id"] != "mcp-http" || httpServer["presetId"] != "github" || httpServer["healthStatus"] != "healthy" || oauthTokens["refreshToken"] != "refresh-token" {
		t.Fatalf("mcp http server read model = %#v", httpServer)
	}

	started := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":              "repo-mcp-settings",
		"type":                "do",
		"input":               "Use stored MCP settings",
		"harnessId":           "codex",
		"modelId":             "gpt-test",
		"enabledMcpServerIds": []any{"mcp-http", "mcp-stdio", "mcp-disabled"},
		"clientRequestId":     "mcp-settings-turn",
	}))
	if started["taskId"] == "" {
		t.Fatalf("mcp settings turn result = %#v", started)
	}
	request := receiveAgentExecutionRequest(t, requests)
	var mcpConfigs map[string]map[string]any
	if err := json.Unmarshal(request.MCPServerConfigs, &mcpConfigs); err != nil {
		t.Fatalf("decode mcp settings executor configs %s: %v", request.MCPServerConfigs, err)
	}
	httpConfig := mcpConfigs["runtime-http"]
	httpHeaders := objectValue(t, httpConfig["headers"])
	stdioConfig := mcpConfigs["runtime-stdio"]
	stdioEnv := objectValue(t, stdioConfig["env"])
	stdioArgs := arrayField(t, stdioConfig, "args")
	if len(mcpConfigs) != 2 ||
		httpConfig["type"] != "http" ||
		httpConfig["url"] != "https://mcp.example.test" ||
		httpHeaders["Authorization"] != "Bearer access-token" ||
		httpHeaders["X-Test"] != "yes" ||
		stdioConfig["type"] != "stdio" ||
		stdioConfig["command"] != "node" ||
		len(stdioArgs) != 2 ||
		stdioArgs[0] != "server.js" ||
		stdioEnv["MCP_MODE"] != "test" ||
		stdioConfig["cwd"] != projectDir {
		t.Fatalf("mcp settings executor configs = %#v", mcpConfigs)
	}

	upserted := resultObject(t, harness.request(t, "openade/settings/mcpServers/upsert", map[string]any{
		"clientRequestId": "mcp-upsert",
		"server": map[string]any{
			"id":            "mcp-http",
			"name":          "runtime-http-renamed",
			"enabled":       false,
			"transportType": "http",
			"healthStatus":  "needs_auth",
			"createdAt":     "2026-06-08T12:00:00Z",
			"updatedAt":     "2026-06-08T12:06:00Z",
			"url":           "https://mcp-renamed.example.test",
		},
	}))
	if upserted["created"] != false {
		t.Fatalf("mcp upsert result = %#v", upserted)
	}
	upsertedServer := objectField(t, upserted, "server")
	if upsertedServer["name"] != "runtime-http-renamed" || upsertedServer["healthStatus"] != "needs_auth" || upsertedServer["url"] != "https://mcp-renamed.example.test" {
		t.Fatalf("mcp upserted server = %#v", upsertedServer)
	}

	deleted := resultObject(t, harness.request(t, "openade/settings/mcpServers/delete", map[string]any{
		"clientRequestId": "mcp-delete",
		"serverId":        "mcp-stdio",
	}))
	if deleted["deleted"] != true {
		t.Fatalf("mcp delete result = %#v", deleted)
	}
	afterDelete := resultObject(t, harness.request(t, "openade/settings/mcpServers/read", map[string]any{}))
	remaining := arrayField(t, afterDelete, "servers")
	if len(remaining) != 2 || objectValue(t, remaining[0])["id"] != "mcp-http" || objectValue(t, remaining[1])["id"] != "mcp-disabled" {
		t.Fatalf("remaining mcp servers = %#v", remaining)
	}

	invalidURL := harness.request(t, "openade/settings/mcpServers/upsert", map[string]any{
		"server": map[string]any{
			"id":            "mcp-invalid",
			"name":          "Invalid",
			"enabled":       true,
			"transportType": "http",
			"url":           "file:///tmp/mcp",
		},
	})
	if runtimeErrorCode(t, invalidURL) != "invalid_params" {
		t.Fatalf("invalid mcp url response = %#v", invalidURL)
	}
}

func TestProductCronInstallStateOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)

	empty := resultObject(t, harness.request(t, "openade/cron/installState/read", map[string]any{
		"repoId": "repo-1",
	}))
	if empty["repoId"] != "repo-1" {
		t.Fatalf("empty cron install-state repo = %#v", empty)
	}
	if installations := objectField(t, empty, "installations"); len(installations) != 0 {
		t.Fatalf("initial cron install-state = %#v", installations)
	}

	params := map[string]any{
		"repoId":          "repo-1",
		"clientRequestId": "cron-install-state-replace",
		"installations": map[string]any{
			"openade.toml::Full Cron": map[string]any{
				"cronId":      "openade.toml::Full Cron",
				"enabled":     true,
				"installedAt": "2026-06-09T14:00:00Z",
				"lastRunAt":   "2026-06-09T14:05:00Z",
				"lastTaskId":  "task-1",
			},
			"packages/pkg/openade.toml::Nightly check": map[string]any{
				"cronId":      "packages/pkg/openade.toml::Nightly check",
				"enabled":     false,
				"installedAt": "2026-06-09T15:00:00Z",
			},
		},
	}
	replaced := resultObject(t, harness.request(t, "openade/cron/installState/replace", params))
	if replaced["repoId"] != "repo-1" || replaced["replacedInstallations"] != float64(2) {
		t.Fatalf("replace cron install-state = %#v", replaced)
	}
	replacedInstallations := objectField(t, replaced, "installations")
	fullCron := objectField(t, replacedInstallations, "openade.toml::Full Cron")
	if fullCron["cronId"] != "openade.toml::Full Cron" || fullCron["enabled"] != true || fullCron["lastTaskId"] != "task-1" {
		t.Fatalf("replaced full cron state = %#v", fullCron)
	}

	retried := resultObject(t, harness.request(t, "openade/cron/installState/replace", params))
	if retried["replacedInstallations"] != float64(2) {
		t.Fatalf("retried cron install-state = %#v", retried)
	}
	readBack := resultObject(t, harness.request(t, "openade/cron/installState/read", map[string]any{
		"repoId": "repo-1",
	}))
	readInstallations := objectField(t, readBack, "installations")
	if len(readInstallations) != 2 || objectField(t, readInstallations, "openade.toml::Full Cron")["lastRunAt"] != "2026-06-09T14:05:00Z" {
		t.Fatalf("read cron install-state = %#v", readBack)
	}

	invalidTimestamp := harness.request(t, "openade/cron/installState/replace", map[string]any{
		"repoId": "repo-1",
		"installations": map[string]any{
			"bad-time": map[string]any{
				"cronId":      "bad-time",
				"enabled":     true,
				"installedAt": "not-a-time",
			},
		},
	})
	if runtimeErrorCode(t, invalidTimestamp) != "invalid_params" {
		t.Fatalf("invalid cron install-state timestamp response = %#v", invalidTimestamp)
	}

	mismatchedID := harness.request(t, "openade/cron/installState/replace", map[string]any{
		"repoId": "repo-1",
		"installations": map[string]any{
			"cron-a": map[string]any{
				"cronId":      "cron-b",
				"enabled":     true,
				"installedAt": "2026-06-09T16:00:00Z",
			},
		},
	})
	if runtimeErrorCode(t, mismatchedID) != "invalid_params" {
		t.Fatalf("mismatched cron install-state response = %#v", mismatchedID)
	}

	missingRepo := harness.request(t, "openade/cron/installState/read", map[string]any{
		"repoId": "missing-repo",
	})
	if runtimeErrorCode(t, missingRepo) != "not_found" {
		t.Fatalf("missing repo cron install-state response = %#v", missingRepo)
	}
}

func TestProductCronSchedulerStartsDueTurnOverRuntime(t *testing.T) {
	requests := make(chan product.AgentExecutionRequest, 1)
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = completingAgentExecutor{requests: requests}
	})
	ctx := context.Background()
	projectDir := t.TempDir()
	now := time.Date(2026, 6, 9, 10, 0, 0, 0, time.UTC)
	writeFile(t, filepath.Join(projectDir, "openade.toml"), []byte(`[[cron]]
name = "Morning"
schedule = "* * * * *"
type = "do"
prompt = "Run scheduled maintenance"
append_system_prompt = "scheduled policy"
harness = "codex"
isolation = "head"
`))
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-cron-scheduler",
		Name:      "Cron Scheduler Repo",
		Path:      projectDir,
		CreatedAt: now.Add(-time.Hour),
		UpdatedAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("upsert cron scheduler repo: %v", err)
	}
	resultObject(t, harness.request(t, "openade/cron/installState/replace", map[string]any{
		"repoId":          "repo-cron-scheduler",
		"clientRequestId": "cron-scheduler-install-state",
		"installations": map[string]any{
			"openade.toml::Morning": map[string]any{
				"cronId":      "openade.toml::Morning",
				"enabled":     true,
				"installedAt": "2026-06-09T09:00:00Z",
				"lastRunAt":   "2026-06-09T09:59:00Z",
			},
		},
	}))

	notificationStart := len(harness.notifications)
	runResult, runtimeErr := harness.productService.RunDueCrons(ctx, now)
	if runtimeErr != nil {
		t.Fatalf("run due crons: %#v", runtimeErr)
	}
	if runResult.ScannedRepos != 1 || runResult.InstalledCrons != 1 || runResult.DueCrons != 1 || runResult.StartedTurns != 1 || runResult.FailedCrons != 0 {
		t.Fatalf("cron scheduler result = %#v", runResult)
	}
	request := receiveAgentExecutionRequest(t, requests)
	if request.RepoID != "repo-cron-scheduler" || request.RepoPath != projectDir || request.TurnType != "do" {
		t.Fatalf("cron executor scope = %#v", request)
	}
	if request.Input != "Run scheduled maintenance" || request.AppendSystemPrompt != "scheduled policy" || request.HarnessID != "codex" {
		t.Fatalf("cron executor request = %#v", request)
	}
	harness.waitForRuntimeNotification(t, notificationStart, "runtime/completed", request.RuntimeID)

	readBack := resultObject(t, harness.request(t, "openade/cron/installState/read", map[string]any{
		"repoId": "repo-cron-scheduler",
	}))
	state := objectField(t, objectField(t, readBack, "installations"), "openade.toml::Morning")
	if state["lastRunAt"] != "2026-06-09T10:00:00Z" || state["lastTaskId"] != request.TaskID {
		t.Fatalf("cron install-state after run = %#v", state)
	}

	secondResult, runtimeErr := harness.productService.RunDueCrons(ctx, now)
	if runtimeErr != nil {
		t.Fatalf("rerun due crons: %#v", runtimeErr)
	}
	if secondResult.DueCrons != 0 || secondResult.StartedTurns != 0 || secondResult.FailedCrons != 0 {
		t.Fatalf("cron scheduler duplicate result = %#v", secondResult)
	}
	select {
	case request := <-requests:
		t.Fatalf("cron scheduler started duplicate turn: %#v", request)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestProductTurnStartRunsAgentExecutorOverRuntime(t *testing.T) {
	requests := make(chan product.AgentExecutionRequest, 1)
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = completingAgentExecutor{requests: requests}
	})
	ctx := context.Background()
	projectDir := t.TempDir()
	now := time.Date(2026, 6, 6, 15, 0, 0, 0, time.UTC)
	imagePath := filepath.Join(projectDir, "image-turn.png")
	writeFile(t, imagePath, []byte("turn image bytes"))
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-turn-executor",
		Name:      "Turn Executor Repo",
		Path:      projectDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert turn executor repo: %v", err)
	}
	if err := harness.store.PutSetting(ctx, "mcp_servers", json.RawMessage(`{"mcp_servers":[{"id":"filesystem","name":"runtime-http","enabled":true,"transportType":"http","url":"https://mcp.example.test","headers":{"X-Test":"yes"},"oauthTokens":{"accessToken":"test-access-token","tokenType":"Bearer"}},{"id":"disabled","name":"disabled","enabled":false,"transportType":"stdio","command":"ignored"}]}`), now); err != nil {
		t.Fatalf("put mcp setting: %v", err)
	}
	if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          "image-turn",
		Kind:        "task_image",
		ContentType: sql.NullString{String: "image/png", Valid: true},
		SizeBytes:   int64(len("turn image bytes")),
		SHA256:      "turn-image-sha",
		Path:        imagePath,
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("put turn image blob: %v", err)
	}

	notificationStart := len(harness.notifications)
	started := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":              "repo-turn-executor",
		"type":                "do",
		"input":               "Run through core executor",
		"harnessId":           "codex",
		"modelId":             "gpt-test",
		"appendSystemPrompt":  "extra policy",
		"enabledMcpServerIds": []any{"filesystem"},
		"includeComments":     true,
		"images":              []any{map[string]any{"id": "image-turn", "ext": "png", "mediaType": "image/png"}},
		"thinking":            "max",
		"clientRequestId":     "turn-executor",
	}))
	taskID := started["taskId"].(string)
	eventID := started["eventId"].(string)
	request := receiveAgentExecutionRequest(t, requests)
	if request.RepoID != "repo-turn-executor" || request.RepoPath != projectDir || request.TaskID != taskID || request.EventID != eventID {
		t.Fatalf("executor request scope = %#v", request)
	}
	if request.Input != "Run through core executor" || request.AppendSystemPrompt != "extra policy" || request.IncludeComments != true || request.Thinking != "max" {
		t.Fatalf("executor request turn fields = %#v", request)
	}
	if request.HarnessID != "codex" || request.ModelID != "gpt-test" || len(request.EnabledMCPServerIDs) != 1 || request.EnabledMCPServerIDs[0] != "filesystem" {
		t.Fatalf("executor request execution fields = %#v", request)
	}
	var mcpConfigs map[string]map[string]any
	if err := json.Unmarshal(request.MCPServerConfigs, &mcpConfigs); err != nil {
		t.Fatalf("decode executor mcp configs %s: %v", request.MCPServerConfigs, err)
	}
	runtimeHTTP := mcpConfigs["runtime-http"]
	headers, _ := runtimeHTTP["headers"].(map[string]any)
	if len(mcpConfigs) != 1 || runtimeHTTP["type"] != "http" || runtimeHTTP["url"] != "https://mcp.example.test" || headers["Authorization"] != "Bearer test-access-token" || headers["X-Test"] != "yes" {
		t.Fatalf("executor mcp configs = %#v", mcpConfigs)
	}
	assertAgentPromptImages(t, request.Images, "image-turn", "png", "image/png", "turn image bytes")

	completedNotification := harness.waitForRuntimeNotification(t, notificationStart, "runtime/completed", "openade-turn:"+eventID)
	completedParams := objectField(t, completedNotification, "params")
	if completedParams["status"] != "completed" || completedParams["runtimeId"] != "openade-turn:"+eventID {
		t.Fatalf("executor runtime completed notification = %#v", completedNotification)
	}
	workingStopped := harness.waitForNotification(t, notificationStart, "openade/workingTasks")
	for len(arrayField(t, objectField(t, workingStopped, "params"), "taskIds")) != 0 {
		workingStopped = harness.waitForNotification(t, len(harness.notifications), "openade/workingTasks")
	}

	runtimeRead := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:" + eventID,
	}))
	if runtimeRead["status"] != "completed" || runtimeRead["exitedAt"] == "" {
		t.Fatalf("completed executor runtime read = %#v", runtimeRead)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-turn-executor",
		"taskId":               taskID,
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, eventID)
	if action["status"] != "completed" || action["completedAt"] != "2026-06-06T15:01:00Z" || objectField(t, action, "result")["success"] != true {
		t.Fatalf("executor-completed action = %#v", action)
	}
	execution := objectField(t, action, "execution")
	if execution["sessionId"] != "session-complete" || execution["parentSessionId"] != "parent-complete" {
		t.Fatalf("executor-completed execution session = %#v", execution)
	}
	if objectField(t, execution, "gitRefsAfter")["sha"] != "abc123" {
		t.Fatalf("executor-completed git refs = %#v", execution)
	}
	streamEvents := arrayField(t, execution, "events")
	if len(streamEvents) != 1 || objectValue(t, streamEvents[0])["id"] != "stream-complete-1" {
		t.Fatalf("executor-completed stream events = %#v", streamEvents)
	}
}

func TestProductTurnStartRunsCommandAgentExecutorOverRuntime(t *testing.T) {
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = product.CommandAgentExecutor{
			Command: []string{os.Args[0], "-test.run=^TestCommandAgentWorkerHelper$"},
			Env:     []string{"OPENADE_TEST_AGENT_WORKER=complete"},
		}
	})
	ctx := context.Background()
	projectDir := t.TempDir()
	now := time.Date(2026, 6, 6, 15, 10, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-command-executor",
		Name:      "Command Executor Repo",
		Path:      projectDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert command executor repo: %v", err)
	}
	resultObject(t, harness.request(t, "openade/settings/personal/replace", map[string]any{
		"settings": map[string]any{
			"envVars": map[string]any{"OPENADE_CORE_AGENT_ENV_TEST": "agent-env-from-core"},
		},
		"clientRequestId": "agent-env-settings",
	}))

	notificationStart := len(harness.notifications)
	started := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":              "repo-command-executor",
		"type":                "ask",
		"input":               "Run through command worker",
		"harnessId":           "codex",
		"modelId":             "gpt-test",
		"appendSystemPrompt":  "worker system prompt",
		"enabledMcpServerIds": []any{"filesystem"},
		"includeComments":     true,
		"thinking":            "high",
		"clientRequestId":     "command-executor",
	}))
	taskID := started["taskId"].(string)
	eventID := started["eventId"].(string)
	harness.waitForRuntimeNotification(t, notificationStart, "runtime/completed", "openade-turn:"+eventID)

	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-command-executor",
		"taskId":               taskID,
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, eventID)
	if action["status"] != "completed" || objectField(t, action, "result")["success"] != true {
		t.Fatalf("command executor action = %#v", action)
	}
	execution := objectField(t, action, "execution")
	if execution["sessionId"] != "worker-session-"+eventID || execution["parentSessionId"] != "worker-parent" {
		t.Fatalf("command executor execution = %#v", execution)
	}
	if objectField(t, execution, "gitRefsAfter")["branch"] != "worker-branch" {
		t.Fatalf("command executor git refs = %#v", execution)
	}
	streamEvents := arrayField(t, execution, "events")
	if len(streamEvents) != 1 {
		t.Fatalf("command executor stream events = %#v", streamEvents)
	}
	stream := objectValue(t, streamEvents[0])
	if stream["id"] != "worker-stream-"+eventID || stream["text"] != "Run through command worker" {
		t.Fatalf("command executor stream event = %#v", stream)
	}
	runtimeRead := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:" + eventID,
	}))
	if processStartedAt, ok := runtimeRead["processStartedAt"].(string); !ok || processStartedAt == "" {
		t.Fatalf("command executor runtime missing process start metadata = %#v", runtimeRead)
	}
	if pid, ok := runtimeRead["pid"].(float64); !ok || pid <= 0 {
		t.Fatalf("command executor runtime pid = %#v", runtimeRead)
	}
	if pgid, ok := runtimeRead["pgid"].(float64); ok && pgid <= 0 {
		t.Fatalf("command executor runtime pgid = %#v", runtimeRead)
	}
}

func TestProductTurnStartPassesPersonalSettingsEnvToCommandAgentExecutorOverRuntime(t *testing.T) {
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = product.CommandAgentExecutor{
			Command: []string{os.Args[0], "-test.run=^TestCommandAgentWorkerHelper$"},
			Env:     []string{"OPENADE_TEST_AGENT_WORKER=expect-env"},
		}
	})
	ctx := context.Background()
	projectDir := t.TempDir()
	now := time.Date(2026, 6, 6, 15, 15, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-command-env",
		Name:      "Command Env Repo",
		Path:      projectDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert command env repo: %v", err)
	}
	resultObject(t, harness.request(t, "openade/settings/personal/replace", map[string]any{
		"settings": map[string]any{
			"envVars": map[string]any{"OPENADE_CORE_AGENT_ENV_TEST": "agent-env-from-core"},
		},
		"clientRequestId": "command-agent-env-settings",
	}))

	notificationStart := len(harness.notifications)
	started := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":          "repo-command-env",
		"type":            "ask",
		"input":           "Check env",
		"harnessId":       "codex",
		"clientRequestId": "command-agent-env",
	}))
	eventID := started["eventId"].(string)
	harness.waitForRuntimeNotification(t, notificationStart, "runtime/completed", "openade-turn:"+eventID)
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-command-env",
		"taskId": started["taskId"],
	}))
	action := actionEventFromTask(t, task, eventID)
	if action["status"] != "completed" || objectField(t, action, "result")["success"] != true {
		t.Fatalf("command env action = %#v", action)
	}
}

type noopAgentExecutionEmitter struct{}

func (noopAgentExecutionEmitter) AppendStreamEvent(context.Context, json.RawMessage) error {
	return nil
}

func (noopAgentExecutionEmitter) UpdateExecution(context.Context, product.AgentExecutionUpdate) error {
	return nil
}

func TestCommandAgentExecutorSendsMCPServerConfigs(t *testing.T) {
	executor := product.CommandAgentExecutor{
		Command: []string{os.Args[0], "-test.run=^TestCommandAgentWorkerHelper$"},
		Env:     []string{"OPENADE_TEST_AGENT_WORKER=expect-mcp"},
	}
	result := executor.Run(context.Background(), product.AgentExecutionRequest{
		RuntimeID:           "runtime-mcp",
		RepoID:              "repo-mcp",
		RepoPath:            t.TempDir(),
		TaskID:              "task-mcp",
		EventID:             "event-mcp",
		ExecutionID:         "execution-mcp",
		HarnessID:           "codex",
		TurnType:            "do",
		Input:               "Use MCP",
		EnabledMCPServerIDs: []string{"mcp-http"},
		MCPServerConfigs:    json.RawMessage(`{"runtime-http":{"type":"http","url":"https://mcp.example.test","headers":{"Authorization":"Bearer test-token"}}}`),
	}, noopAgentExecutionEmitter{})
	if result.Status != product.AgentExecutionCompleted || result.Success == nil || *result.Success != true {
		t.Fatalf("command executor mcp result = %#v", result)
	}
}

func TestCommandAgentExecutorSendsReadOnly(t *testing.T) {
	executor := product.CommandAgentExecutor{
		Command: []string{os.Args[0], "-test.run=^TestCommandAgentWorkerHelper$"},
		Env:     []string{"OPENADE_TEST_AGENT_WORKER=expect-read-only"},
	}
	result := executor.Run(context.Background(), product.AgentExecutionRequest{
		RuntimeID:   "runtime-read-only",
		RepoID:      "repo-read-only",
		RepoPath:    t.TempDir(),
		TaskID:      "task-read-only",
		EventID:     "event-read-only",
		ExecutionID: "execution-read-only",
		HarnessID:   "codex",
		TurnType:    "review",
		Input:       "Review only",
		ReadOnly:    true,
	}, noopAgentExecutionEmitter{})
	if result.Status != product.AgentExecutionCompleted || result.Success == nil || *result.Success != true {
		t.Fatalf("command executor read-only result = %#v", result)
	}
}

func TestCommandAgentWorkerHelper(t *testing.T) {
	mode := os.Getenv("OPENADE_TEST_AGENT_WORKER")
	if mode == "" {
		return
	}
	var envelope struct {
		Type            string `json:"type"`
		ProtocolVersion int    `json:"protocolVersion"`
		Request         struct {
			EventID             string                    `json:"eventId"`
			Input               string                    `json:"input"`
			AppendSystemPrompt  string                    `json:"appendSystemPrompt"`
			EnabledMCPServerIDs []string                  `json:"enabledMcpServerIds"`
			IncludeComments     bool                      `json:"includeComments"`
			ReadOnly            bool                      `json:"readOnly"`
			Thinking            string                    `json:"thinking"`
			Cwd                 string                    `json:"cwd"`
			MCPServerConfigs    map[string]map[string]any `json:"mcpServerConfigs"`
		} `json:"request"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&envelope); err != nil {
		os.Exit(2)
	}
	if envelope.Type != "start" || envelope.ProtocolVersion != 1 || envelope.Request.EventID == "" || envelope.Request.Cwd == "" {
		os.Exit(3)
	}
	if mode == "expect-mcp" {
		httpConfig := envelope.Request.MCPServerConfigs["runtime-http"]
		headers, _ := httpConfig["headers"].(map[string]any)
		if httpConfig["type"] != "http" || httpConfig["url"] != "https://mcp.example.test" || headers["Authorization"] != "Bearer test-token" {
			os.Exit(5)
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"type":        "result",
			"status":      "completed",
			"success":     true,
			"completedAt": "2026-06-06T15:12:00Z",
		})
		os.Exit(0)
	}
	if mode == "expect-read-only" {
		if !envelope.Request.ReadOnly {
			os.Exit(6)
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"type":        "result",
			"status":      "completed",
			"success":     true,
			"completedAt": "2026-06-06T15:13:00Z",
		})
		os.Exit(0)
	}
	if mode == "expect-env" {
		if os.Getenv("OPENADE_CORE_AGENT_ENV_TEST") != "agent-env-from-core" {
			os.Exit(7)
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"type":        "result",
			"status":      "completed",
			"success":     true,
			"completedAt": "2026-06-06T15:14:00Z",
		})
		os.Exit(0)
	}
	if envelope.Request.AppendSystemPrompt != "worker system prompt" || len(envelope.Request.EnabledMCPServerIDs) != 1 || !envelope.Request.IncludeComments || envelope.Request.Thinking != "high" {
		os.Exit(4)
	}
	encoder := json.NewEncoder(os.Stdout)
	_ = encoder.Encode(map[string]any{
		"type": "stream",
		"event": map[string]any{
			"id":   "worker-stream-" + envelope.Request.EventID,
			"type": "assistant_message",
			"text": envelope.Request.Input,
		},
	})
	_ = encoder.Encode(map[string]any{
		"type":            "execution",
		"sessionId":       "worker-session-" + envelope.Request.EventID,
		"parentSessionId": "worker-parent",
		"gitRefsAfter": map[string]any{
			"sha":    "worker-sha",
			"branch": "worker-branch",
		},
	})
	_ = encoder.Encode(map[string]any{
		"type":        "result",
		"status":      "completed",
		"success":     true,
		"completedAt": "2026-06-06T15:11:00Z",
	})
	os.Exit(0)
}

func TestDeadProcessHelper(t *testing.T) {
	if os.Getenv("OPENADE_TEST_DEAD_PROCESS") != "1" {
		return
	}
	os.Exit(0)
}

func TestLongRunningProcessHelper(t *testing.T) {
	if os.Getenv("OPENADE_TEST_LONG_RUNNING_PROCESS") != "1" {
		return
	}
	select {}
}

func deadProcessID(t *testing.T) int {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestDeadProcessHelper$")
	cmd.Env = append(os.Environ(), "OPENADE_TEST_DEAD_PROCESS=1")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start dead process helper: %v", err)
	}
	pid := cmd.Process.Pid
	if err := cmd.Wait(); err != nil {
		t.Fatalf("wait dead process helper: %v", err)
	}
	return pid
}

func waitForProcessExit(t *testing.T, cmd *exec.Cmd, timeout time.Duration) {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()
	select {
	case <-done:
		return
	case <-time.After(timeout):
		t.Fatalf("process %d did not exit within %s", cmd.Process.Pid, timeout)
	}
}

func waitForRuntimeStatus(t *testing.T, harness *runtimeHarness, runtimeID string, status string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var last map[string]any
	for time.Now().Before(deadline) {
		last = resultObject(t, harness.request(t, "runtime/read", map[string]any{
			"runtimeId": runtimeID,
		}))
		if last["status"] == status {
			return last
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("runtime %s did not reach %s; last = %#v", runtimeID, status, last)
	return nil
}

type stopRaceAgentExecutor struct {
	started  chan struct{}
	finished chan struct{}
}

func (executor stopRaceAgentExecutor) Run(ctx context.Context, request product.AgentExecutionRequest, emitter product.AgentExecutionEmitter) product.AgentExecutionResult {
	close(executor.started)
	<-ctx.Done()
	_ = emitter.AppendStreamEvent(context.Background(), json.RawMessage(`{"id":"stream-after-stop","type":"assistant_message","text":"too late"}`))
	close(executor.finished)
	success := true
	return product.AgentExecutionResult{
		Status:      product.AgentExecutionCompleted,
		Success:     &success,
		CompletedAt: time.Date(2026, 6, 6, 15, 2, 0, 0, time.UTC),
	}
}

func TestProductTurnStartStopPreventsLateExecutorSettlement(t *testing.T) {
	startedExecutor := make(chan struct{})
	finishedExecutor := make(chan struct{})
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = stopRaceAgentExecutor{started: startedExecutor, finished: finishedExecutor}
	})
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 15, 30, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-turn-stop-race",
		Name:      "Turn Stop Race Repo",
		Path:      t.TempDir(),
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert stop race repo: %v", err)
	}
	started := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":          "repo-turn-stop-race",
		"type":            "do",
		"input":           "Stop me",
		"clientRequestId": "turn-stop-race",
	}))
	taskID := started["taskId"].(string)
	eventID := started["eventId"].(string)
	waitForChannel(t, startedExecutor, "agent executor start")

	stopped := resultObject(t, harness.request(t, "runtime/stop", map[string]any{
		"runtimeId": "openade-turn:" + eventID,
		"reason":    "user cancelled",
	}))
	if stopped["status"] != "stopped" || stopped["error"] != "user cancelled" {
		t.Fatalf("stopped runtime = %#v", stopped)
	}
	waitForChannel(t, finishedExecutor, "agent executor finish")

	runtimeRead := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:" + eventID,
	}))
	if runtimeRead["status"] != "stopped" || runtimeRead["error"] != "user cancelled" {
		t.Fatalf("runtime after late executor completion = %#v", runtimeRead)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-turn-stop-race",
		"taskId":               taskID,
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, eventID)
	if action["status"] != "stopped" || action["completedAt"] == "2026-06-06T15:02:00Z" {
		t.Fatalf("action after late executor completion = %#v", action)
	}
	if events := arrayField(t, objectField(t, action, "execution"), "events"); len(events) != 0 {
		t.Fatalf("late executor stream events should be ignored after stop: %#v", events)
	}
}

func TestProductTurnInterruptStopsActiveAgentRuntime(t *testing.T) {
	startedExecutor := make(chan struct{})
	finishedExecutor := make(chan struct{})
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = stopRaceAgentExecutor{started: startedExecutor, finished: finishedExecutor}
	})
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 15, 40, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-turn-interrupt",
		Name:      "Turn Interrupt Repo",
		Path:      t.TempDir(),
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert interrupt repo: %v", err)
	}
	started := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":          "repo-turn-interrupt",
		"type":            "ask",
		"input":           "Interrupt me",
		"clientRequestId": "turn-interrupt-start",
	}))
	taskID := started["taskId"].(string)
	eventID := started["eventId"].(string)
	waitForChannel(t, startedExecutor, "agent executor start")

	interrupted := resultObject(t, harness.request(t, "openade/turn/interrupt", map[string]any{
		"taskId":          taskID,
		"clientRequestId": "turn-interrupt",
	}))
	if interrupted["ok"] != true {
		t.Fatalf("interrupt result = %#v", interrupted)
	}
	retried := resultObject(t, harness.request(t, "openade/turn/interrupt", map[string]any{
		"taskId":          taskID,
		"clientRequestId": "turn-interrupt",
	}))
	if retried["ok"] != true {
		t.Fatalf("idempotent interrupt retry = %#v", retried)
	}
	waitForChannel(t, finishedExecutor, "agent executor finish")

	runtimeRead := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:" + eventID,
	}))
	if runtimeRead["status"] != "stopped" || runtimeRead["error"] != "user interrupt" {
		t.Fatalf("runtime after interrupt = %#v", runtimeRead)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-turn-interrupt",
		"taskId":               taskID,
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, eventID)
	if action["status"] != "stopped" {
		t.Fatalf("action after interrupt = %#v", action)
	}
	if events := arrayField(t, objectField(t, action, "execution"), "events"); len(events) != 0 {
		t.Fatalf("late executor stream events should be ignored after interrupt: %#v", events)
	}

	inactive := resultObject(t, harness.request(t, "openade/turn/interrupt", map[string]any{
		"taskId":          taskID,
		"clientRequestId": "turn-interrupt-inactive",
	}))
	if inactive["ok"] != false || inactive["error"] == "" {
		t.Fatalf("inactive interrupt result = %#v", inactive)
	}
}

type queuedDrainAgentExecutor struct {
	requests chan product.AgentExecutionRequest
	results  chan product.AgentExecutionResult
}

func (executor queuedDrainAgentExecutor) Run(ctx context.Context, request product.AgentExecutionRequest, emitter product.AgentExecutionEmitter) product.AgentExecutionResult {
	executor.requests <- request
	result := <-executor.results
	_ = emitter.AppendStreamEvent(ctx, json.RawMessage(fmt.Sprintf(`{"id":"stream-%s","type":"assistant_message","text":"%s"}`, request.EventID, request.Input)))
	return result
}

func TestProductQueuedTurnDrainsThroughAgentExecutor(t *testing.T) {
	requests := make(chan product.AgentExecutionRequest, 4)
	results := make(chan product.AgentExecutionResult, 4)
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = queuedDrainAgentExecutor{requests: requests, results: results}
	})
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 16, 0, 0, 0, time.UTC)
	repoDir := t.TempDir()
	imagePath := filepath.Join(repoDir, "queued-image.png")
	writeFile(t, imagePath, []byte("queued prompt image"))
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-queue-drain",
		Name:      "Queue Drain Repo",
		Path:      repoDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert queue drain repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-queue-drain",
		RepoID:        "repo-queue-drain",
		Slug:          "task-queue-drain",
		Title:         "Queue drain",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert queue drain task: %v", err)
	}
	if err := harness.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          "image-queued-turn",
		Kind:        "task_image",
		ContentType: sql.NullString{String: "image/png", Valid: true},
		SizeBytes:   int64(len("queued prompt image")),
		SHA256:      "queued-image-sha",
		Path:        imagePath,
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("put queued image blob: %v", err)
	}

	started := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":          "repo-queue-drain",
		"inTaskId":        "task-queue-drain",
		"type":            "do",
		"input":           "First turn",
		"clientRequestId": "queue-drain-start",
	}))
	firstEventID := started["eventId"].(string)
	firstRequest := receiveAgentExecutionRequest(t, requests)
	if firstRequest.EventID != firstEventID || firstRequest.QueuedTurnID != "" || firstRequest.Input != "First turn" {
		t.Fatalf("first executor request = %#v", firstRequest)
	}

	queued := resultObject(t, harness.request(t, "openade/queued-turn/enqueue", map[string]any{
		"repoId":              "repo-queue-drain",
		"taskId":              "task-queue-drain",
		"queuedTurnId":        "queued-follow-up",
		"type":                "ask",
		"input":               "Queued follow-up",
		"appendSystemPrompt":  "answer from queue",
		"enabledMcpServerIds": []string{"filesystem"},
		"harnessId":           "codex",
		"modelId":             "gpt-test",
		"label":               "Queued Ask",
		"includeComments":     true,
		"images":              []any{map[string]any{"id": "image-queued-turn", "ext": "png", "mediaType": "image/png"}},
		"thinking":            "high",
		"clientRequestId":     "queue-follow-up",
	}))
	if queued["queuedTurnId"] != "queued-follow-up" || queued["queued"] != true {
		t.Fatalf("queued follow-up result = %#v", queued)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-queue-drain",
		"taskId": "task-queue-drain",
	}))
	queuedTurn := objectValue(t, arrayField(t, task, "queuedTurns")[0])
	if queuedTurn["status"] != "queued" || queuedTurn["eventId"] != nil {
		t.Fatalf("queued turn while first active = %#v", queuedTurn)
	}

	firstSuccess := true
	results <- product.AgentExecutionResult{
		Status:      product.AgentExecutionCompleted,
		Success:     &firstSuccess,
		CompletedAt: time.Date(2026, 6, 6, 16, 1, 0, 0, time.UTC),
	}
	queuedRequest := receiveAgentExecutionRequest(t, requests)
	if queuedRequest.QueuedTurnID != "queued-follow-up" || queuedRequest.Input != "Queued follow-up" || queuedRequest.TurnType != "ask" {
		t.Fatalf("queued executor request = %#v", queuedRequest)
	}
	if queuedRequest.AppendSystemPrompt != "answer from queue" || queuedRequest.IncludeComments != true || queuedRequest.Thinking != "high" {
		t.Fatalf("queued executor payload fields = %#v", queuedRequest)
	}
	if len(queuedRequest.EnabledMCPServerIDs) != 1 || queuedRequest.EnabledMCPServerIDs[0] != "filesystem" || queuedRequest.ModelID != "gpt-test" {
		t.Fatalf("queued executor execution fields = %#v", queuedRequest)
	}
	assertAgentPromptImages(t, queuedRequest.Images, "image-queued-turn", "png", "image/png", "queued prompt image")
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-queue-drain",
		"taskId":               "task-queue-drain",
		"hydrateSessionEvents": true,
	}))
	queuedTurn = objectValue(t, arrayField(t, task, "queuedTurns")[0])
	if queuedTurn["status"] != "running" || queuedTurn["eventId"] != queuedRequest.EventID {
		t.Fatalf("running queued turn = %#v request=%#v", queuedTurn, queuedRequest)
	}
	queuedAction := actionEventFromTask(t, task, queuedRequest.EventID)
	if queuedAction["status"] != "in_progress" || queuedAction["userInput"] != "Queued follow-up" {
		t.Fatalf("queued action while running = %#v", queuedAction)
	}
	if source := objectField(t, queuedAction, "source"); source["type"] != "ask" || source["userLabel"] != "Queued Ask" {
		t.Fatalf("queued action source = %#v", queuedAction)
	}

	queuedSuccess := true
	results <- product.AgentExecutionResult{
		Status:      product.AgentExecutionCompleted,
		Success:     &queuedSuccess,
		CompletedAt: time.Date(2026, 6, 6, 16, 2, 0, 0, time.UTC),
	}
	harness.waitForRuntimeNotification(t, 0, "runtime/completed", "openade-turn:"+queuedRequest.EventID)
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-queue-drain",
		"taskId":               "task-queue-drain",
		"hydrateSessionEvents": true,
	}))
	queuedTurn = objectValue(t, arrayField(t, task, "queuedTurns")[0])
	if queuedTurn["status"] != "completed" || queuedTurn["updatedAt"] != "2026-06-06T16:02:00Z" {
		t.Fatalf("completed queued turn = %#v", queuedTurn)
	}
	queuedAction = actionEventFromTask(t, task, queuedRequest.EventID)
	if queuedAction["status"] != "completed" || objectField(t, queuedAction, "result")["success"] != true {
		t.Fatalf("completed queued action = %#v", queuedAction)
	}
	if events := arrayField(t, objectField(t, queuedAction, "execution"), "events"); len(events) != 1 {
		t.Fatalf("queued action stream events = %#v", events)
	}
}

func TestProductQueuedTurnImportLegacyDoesNotDrainOverRuntime(t *testing.T) {
	requests := make(chan product.AgentExecutionRequest, 1)
	results := make(chan product.AgentExecutionResult, 1)
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = queuedDrainAgentExecutor{requests: requests, results: results}
	})
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 17, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-queue-import",
		Name:      "Queue Import Repo",
		Path:      "/tmp/queue-import",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert queue import repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-queue-import",
		RepoID:    "repo-queue-import",
		Slug:      "task-queue-import",
		Title:     "Queue import",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert queue import task: %v", err)
	}

	notificationStart := len(harness.notifications)
	imported := resultObject(t, harness.request(t, "openade/queued-turn/importLegacy", map[string]any{
		"repoId": "repo-queue-import",
		"taskId": "task-queue-import",
		"turn": map[string]any{
			"id":                  "queued-imported",
			"clientRequestId":     "legacy-queued-request",
			"type":                "ask",
			"input":               "Imported queued question",
			"status":              "queued",
			"createdAt":           "2026-06-06T17:00:00Z",
			"updatedAt":           "2026-06-06T17:01:00Z",
			"eventId":             "legacy-queued-event",
			"appendSystemPrompt":  "Use migrated queue context",
			"enabledMcpServerIds": []string{"filesystem"},
			"harnessId":           "codex",
			"modelId":             "gpt-test",
			"label":               "Queued Ask",
			"includeComments":     true,
			"images":              []any{map[string]any{"id": "queued-import-image", "ext": "png"}},
			"thinking":            "high",
			"fastMode":            true,
		},
		"position":        7,
		"clientRequestId": "legacy-queue-import",
	}))
	if imported["taskId"] != "task-queue-import" || imported["queuedTurnId"] != "queued-imported" || imported["imported"] != true {
		t.Fatalf("import legacy queued turn result = %#v", imported)
	}
	importedTurn := objectField(t, imported, "turn")
	if importedTurn["clientRequestId"] != "legacy-queued-request" || importedTurn["eventId"] != "legacy-queued-event" || importedTurn["thinking"] != "high" || importedTurn["fastMode"] != true {
		t.Fatalf("import legacy queued turn dto = %#v", importedTurn)
	}
	notifications := harness.waitForNotifications(t, notificationStart, 2)
	seen := map[string]bool{}
	for _, notification := range notifications {
		seen[notification["method"].(string)] = true
	}
	if !seen["openade/task/updated"] || !seen["openade/queuedTurn/updated"] {
		t.Fatalf("import legacy queued turn notifications = %#v", notifications)
	}
	select {
	case request := <-requests:
		t.Fatalf("legacy queued turn import unexpectedly started executor: %#v", request)
	case <-time.After(100 * time.Millisecond):
	}
	runtimeList := resultArray(t, harness.request(t, "runtime/list", nil))
	if len(runtimeList) != 0 {
		t.Fatalf("legacy queued turn import created runtime records = %#v", runtimeList)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-queue-import",
		"taskId": "task-queue-import",
	}))
	if events := arrayField(t, task, "events"); len(events) != 0 {
		t.Fatalf("legacy queued turn import created task events = %#v", events)
	}
	queuedTurns := arrayField(t, task, "queuedTurns")
	if len(queuedTurns) != 1 {
		t.Fatalf("legacy queued turn task read = %#v", queuedTurns)
	}
	queuedTurn := objectValue(t, queuedTurns[0])
	if queuedTurn["id"] != "queued-imported" || queuedTurn["status"] != "queued" || queuedTurn["input"] != "Imported queued question" {
		t.Fatalf("legacy queued turn task read dto = %#v", queuedTurn)
	}

	duplicate := resultObject(t, harness.request(t, "openade/queued-turn/importLegacy", map[string]any{
		"repoId": "repo-queue-import",
		"taskId": "task-queue-import",
		"turn": map[string]any{
			"id":        "queued-imported",
			"type":      "do",
			"input":     "Should not overwrite",
			"status":    "completed",
			"createdAt": "2026-06-06T17:02:00Z",
			"updatedAt": "2026-06-06T17:02:00Z",
		},
		"clientRequestId": "legacy-queue-import-duplicate",
	}))
	duplicateTurn := objectField(t, duplicate, "turn")
	if duplicate["imported"] != false || duplicateTurn["input"] != "Imported queued question" || duplicateTurn["status"] != "queued" {
		t.Fatalf("duplicate legacy queued turn import overwrote row = %#v", duplicate)
	}

	invalid := harness.request(t, "openade/queued-turn/importLegacy", map[string]any{
		"repoId": "repo-queue-import",
		"taskId": "task-queue-import",
		"turn": map[string]any{
			"id":        "queued-invalid",
			"type":      "ask",
			"input":     "Invalid status",
			"status":    "pending",
			"createdAt": "2026-06-06T17:00:00Z",
			"updatedAt": "2026-06-06T17:00:00Z",
		},
	})
	if runtimeErrorCode(t, invalid) != "invalid_params" {
		t.Fatalf("invalid legacy queued turn import = %#v", invalid)
	}
}

type reviewAgentExecutor struct {
	requests chan product.AgentExecutionRequest
	results  chan product.AgentExecutionResult
}

func (executor reviewAgentExecutor) Run(ctx context.Context, request product.AgentExecutionRequest, emitter product.AgentExecutionEmitter) product.AgentExecutionResult {
	executor.requests <- request
	result := <-executor.results
	if request.TurnType == "review" {
		raw, _ := json.Marshal(map[string]any{
			"id":          "review-stream-" + request.EventID,
			"direction":   "execution",
			"type":        "raw_message",
			"executionId": request.ExecutionID,
			"harnessId":   request.HarnessID,
			"message": map[string]any{
				"type":   "result",
				"result": "Review output for " + request.EventID,
			},
		})
		_ = emitter.AppendStreamEvent(ctx, raw)
		return result
	}
	raw, _ := json.Marshal(map[string]any{
		"id":   "follow-up-stream-" + request.EventID,
		"type": "assistant_message",
		"text": request.Input,
	})
	_ = emitter.AppendStreamEvent(ctx, raw)
	return result
}

func TestProductReviewStartRunsReadOnlyReviewAndFollowUpOverRuntime(t *testing.T) {
	requests := make(chan product.AgentExecutionRequest, 4)
	results := make(chan product.AgentExecutionResult, 4)
	harness := newRuntimeHarnessWithProductOptions(t, func(options *product.Options) {
		options.AgentExecutor = reviewAgentExecutor{requests: requests, results: results}
	})
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 17, 0, 0, 0, time.UTC)
	repoDir := t.TempDir()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-review-start",
		Name:      "Review Start Repo",
		Path:      repoDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert review repo: %v", err)
	}
	if err := harness.store.PutSetting(ctx, "mcp_servers", json.RawMessage(`{"mcp_servers":[{"id":"filesystem","name":"runtime-http","enabled":true,"transportType":"http","url":"https://mcp.example.test"}]}`), now); err != nil {
		t.Fatalf("put review mcp setting: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-review-start",
		RepoID:        "repo-review-start",
		Slug:          "task-review-start",
		Title:         "Review start",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		MetadataJSON:  sql.NullString{String: `{"createdBy":{"id":"user-1"},"sessionIds":{},"enabledMcpServerIds":["filesystem"]}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert review task: %v", err)
	}
	planPayload := `{"id":"event-plan-review","type":"action","status":"completed","createdAt":"2026-06-06T17:00:00Z","userInput":"Plan the work","source":{"type":"plan","userLabel":"Plan"},"execution":{"harnessId":"claude-code","executionId":"execution-plan-review","events":[{"id":"plan-raw","direction":"execution","type":"raw_message","executionId":"execution-plan-review","harnessId":"claude-code","message":{"type":"result","result":"Plan text from prior turn"}}]},"includesCommentIds":[]}`
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:          "event-plan-review",
		TaskID:      "task-review-start",
		Seq:         1,
		Type:        "action",
		Status:      sql.NullString{String: "completed", Valid: true},
		SourceType:  sql.NullString{String: "plan", Valid: true},
		SourceLabel: sql.NullString{String: "Plan", Valid: true},
		CreatedAt:   now,
		PayloadJSON: sql.NullString{String: planPayload, Valid: true},
	}); err != nil {
		t.Fatalf("upsert review plan event: %v", err)
	}
	snapshotPayload := `{"id":"snapshot-review","type":"snapshot","createdAt":"2026-06-06T17:01:00Z","files":[{"path":"src/core.ts","status":"modified"},{"oldPath":"src/old.ts","path":"src/new.ts","status":"renamed"}]}`
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:          "snapshot-review",
		TaskID:      "task-review-start",
		Seq:         2,
		Type:        "snapshot",
		CreatedAt:   now.Add(time.Minute),
		PayloadJSON: sql.NullString{String: snapshotPayload, Valid: true},
	}); err != nil {
		t.Fatalf("upsert review snapshot event: %v", err)
	}

	notificationStart := len(harness.notifications)
	started := resultObject(t, harness.request(t, "openade/review/start", map[string]any{
		"repoId":             "repo-review-start",
		"taskId":             "task-review-start",
		"reviewType":         "plan",
		"harnessId":          "claude-code",
		"modelId":            "sonnet-test",
		"customInstructions": "Focus on runtime boundaries",
		"clientRequestId":    "review-start",
	}))
	eventID := started["eventId"].(string)
	retried := resultObject(t, harness.request(t, "openade/review/start", map[string]any{
		"repoId":             "repo-review-start",
		"taskId":             "task-review-start",
		"reviewType":         "plan",
		"harnessId":          "claude-code",
		"modelId":            "sonnet-test",
		"customInstructions": "Focus on runtime boundaries",
		"clientRequestId":    "review-start",
	}))
	if retried["taskId"] != "task-review-start" || retried["eventId"] != eventID {
		t.Fatalf("idempotent review start retry = %#v, want event %s", retried, eventID)
	}

	reviewRequest := receiveAgentExecutionRequest(t, requests)
	if reviewRequest.RuntimeID != "openade-review:"+eventID || reviewRequest.TurnType != "review" || !reviewRequest.ReadOnly {
		t.Fatalf("review executor request = %#v", reviewRequest)
	}
	if reviewRequest.Input == "" || !strings.Contains(reviewRequest.Input, "Review this plan") || !strings.Contains(reviewRequest.Input, "Plan text from prior turn") || !strings.Contains(reviewRequest.Input, "Focus on runtime boundaries") {
		t.Fatalf("review prompt missing expected content: %s", reviewRequest.Input)
	}
	if !strings.Contains(reviewRequest.Input, "modified: src/core.ts") || !strings.Contains(reviewRequest.Input, "renamed: src/old.ts -> src/new.ts") {
		t.Fatalf("review prompt missing changed files: %s", reviewRequest.Input)
	}
	if !strings.Contains(reviewRequest.AppendSystemPrompt, `current_operating_mode mode="review"`) {
		t.Fatalf("review system prompt = %q", reviewRequest.AppendSystemPrompt)
	}
	if len(reviewRequest.EnabledMCPServerIDs) != 1 || reviewRequest.EnabledMCPServerIDs[0] != "filesystem" {
		t.Fatalf("review mcp ids = %#v", reviewRequest.EnabledMCPServerIDs)
	}
	var mcpConfigs map[string]map[string]any
	if err := json.Unmarshal(reviewRequest.MCPServerConfigs, &mcpConfigs); err != nil {
		t.Fatalf("decode review mcp configs %s: %v", reviewRequest.MCPServerConfigs, err)
	}
	if mcpConfigs["runtime-http"]["url"] != "https://mcp.example.test" {
		t.Fatalf("review mcp configs = %#v", mcpConfigs)
	}
	var reviewSource struct {
		Type             string `json:"type"`
		UserLabel        string `json:"userLabel"`
		ReviewType       string `json:"reviewType"`
		UserInstructions string `json:"userInstructions"`
	}
	if err := json.Unmarshal(reviewRequest.Source, &reviewSource); err != nil {
		t.Fatalf("decode review source: %v", err)
	}
	if reviewSource.Type != "review" || reviewSource.UserLabel != "Review Plan" || reviewSource.ReviewType != "plan" || !strings.Contains(reviewSource.UserInstructions, "Focus on runtime boundaries") {
		t.Fatalf("review source = %#v", reviewSource)
	}

	reviewSuccess := true
	results <- product.AgentExecutionResult{
		Status:      product.AgentExecutionCompleted,
		Success:     &reviewSuccess,
		CompletedAt: time.Date(2026, 6, 6, 17, 1, 0, 0, time.UTC),
	}
	followUpRequest := receiveAgentExecutionRequest(t, requests)
	if followUpRequest.TurnType != "ask" || !followUpRequest.ReadOnly || followUpRequest.RuntimeID != "openade-review-follow-up:"+followUpRequest.EventID {
		t.Fatalf("follow-up executor request = %#v", followUpRequest)
	}
	if !strings.Contains(followUpRequest.Input, "<review_feedback>") || !strings.Contains(followUpRequest.Input, "Review output for "+eventID) || !strings.Contains(followUpRequest.Input, "Would you like me to proceed") {
		t.Fatalf("follow-up prompt missing review handoff: %s", followUpRequest.Input)
	}
	var followUpSource struct {
		Type      string `json:"type"`
		UserLabel string `json:"userLabel"`
		Origin    string `json:"origin"`
	}
	if err := json.Unmarshal(followUpRequest.Source, &followUpSource); err != nil {
		t.Fatalf("decode follow-up source: %v", err)
	}
	if followUpSource.Type != "ask" || followUpSource.UserLabel != "Review Plan Follow-up" || followUpSource.Origin != "review_follow_up" {
		t.Fatalf("follow-up source = %#v", followUpSource)
	}

	followUpSuccess := true
	results <- product.AgentExecutionResult{
		Status:      product.AgentExecutionCompleted,
		Success:     &followUpSuccess,
		CompletedAt: time.Date(2026, 6, 6, 17, 2, 0, 0, time.UTC),
	}
	harness.waitForRuntimeNotification(t, notificationStart, "runtime/completed", "openade-review:"+eventID)
	harness.waitForRuntimeNotification(t, notificationStart, "runtime/completed", "openade-review-follow-up:"+followUpRequest.EventID)
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-review-start",
		"taskId":               "task-review-start",
		"hydrateSessionEvents": true,
	}))
	reviewAction := actionEventFromTask(t, task, eventID)
	if reviewAction["status"] != "completed" || reviewAction["userInput"] != "Review Plan: Focus on runtime boundaries" {
		t.Fatalf("completed review action = %#v", reviewAction)
	}
	if len(arrayField(t, objectField(t, reviewAction, "execution"), "events")) != 1 {
		t.Fatalf("review action stream events = %#v", reviewAction)
	}
	followUpAction := actionEventFromTask(t, task, followUpRequest.EventID)
	if followUpAction["status"] != "completed" || followUpAction["userInput"] != "Review Plan Follow-up" {
		t.Fatalf("completed follow-up action = %#v", followUpAction)
	}
	if source := objectField(t, followUpAction, "source"); source["origin"] != "review_follow_up" {
		t.Fatalf("completed follow-up source = %#v", source)
	}

	invalid := harness.request(t, "openade/review/start", map[string]any{
		"repoId":     "repo-review-start",
		"taskId":     "task-review-start",
		"reviewType": "notes",
		"harnessId":  "claude-code",
		"modelId":    "sonnet-test",
	})
	if runtimeErrorCode(t, invalid) != "invalid_params" {
		t.Fatalf("invalid review start = %#v", invalid)
	}
}

func receiveAgentExecutionRequest(t *testing.T, requests <-chan product.AgentExecutionRequest) product.AgentExecutionRequest {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(5 * time.Second):
		t.Fatal("agent executor request not received")
	}
	return product.AgentExecutionRequest{}
}

func assertAgentPromptImages(t *testing.T, raw *json.RawMessage, imageID string, ext string, mediaType string, data string) {
	t.Helper()
	if raw == nil {
		t.Fatal("agent prompt images missing")
	}
	var images []struct {
		ID        string `json:"id"`
		Ext       string `json:"ext"`
		MediaType string `json:"mediaType"`
		Source    struct {
			Kind      string `json:"kind"`
			Data      string `json:"data"`
			MediaType string `json:"mediaType"`
		} `json:"source"`
	}
	if err := json.Unmarshal(*raw, &images); err != nil {
		t.Fatalf("decode agent prompt images %s: %v", *raw, err)
	}
	if len(images) != 1 {
		t.Fatalf("agent prompt images = %#v", images)
	}
	image := images[0]
	if image.ID != imageID || image.Ext != ext || image.MediaType != mediaType || image.Source.Kind != "base64" || image.Source.MediaType != mediaType {
		t.Fatalf("agent prompt image metadata = %#v", image)
	}
	if image.Source.Data != base64.StdEncoding.EncodeToString([]byte(data)) {
		t.Fatalf("agent prompt image data = %#v", image)
	}
}

func waitForChannel(t *testing.T, done <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("%s timed out", label)
	}
}

func TestProductTurnStartCreatesTaskActionAndRuntimeOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	projectDir := t.TempDir()
	now := time.Date(2026, 6, 6, 14, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-turn-start",
		Name:      "Turn Start Repo",
		Path:      projectDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert turn-start repo: %v", err)
	}

	notificationStart := len(harness.notifications)
	started := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":              "repo-turn-start",
		"type":                "do",
		"input":               "Implement the core turn boundary",
		"title":               "Core turn boundary",
		"harnessId":           "codex",
		"modelId":             "gpt-test",
		"label":               "Do",
		"enabledMcpServerIds": []any{"filesystem"},
		"images":              []any{map[string]any{"id": "img-turn", "ext": "png"}},
		"fastMode":            true,
		"thinking":            "high",
		"clientRequestId":     "turn-create",
	}))
	taskID, ok := started["taskId"].(string)
	if !ok || taskID != deterministicTaskID("repo-turn-start", "turn-create") {
		t.Fatalf("turn start task id = %#v", started)
	}
	eventID, ok := started["eventId"].(string)
	if !ok || eventID == "" {
		t.Fatalf("turn start event id = %#v", started)
	}
	retried := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":          "repo-turn-start",
		"type":            "ask",
		"input":           "Should not create a second event",
		"clientRequestId": "turn-create",
	}))
	if retried["taskId"] != taskID || retried["eventId"] != eventID {
		t.Fatalf("idempotent turn start retry = %#v, want task/event %s/%s", retried, taskID, eventID)
	}

	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-turn-start",
		"taskId":               taskID,
		"hydrateSessionEvents": true,
	}))
	if task["title"] != "Core turn boundary" || task["description"] != "Implement the core turn boundary" {
		t.Fatalf("turn-created task = %#v", task)
	}
	environments := arrayField(t, task, "deviceEnvironments")
	if len(environments) != 1 || objectValue(t, environments[0])["deviceId"] != "headless-runtime" {
		t.Fatalf("turn-created task environments = %#v", environments)
	}
	action := actionEventFromTask(t, task, eventID)
	if action["type"] != "action" || action["status"] != "in_progress" || action["userInput"] != "Implement the core turn boundary" {
		t.Fatalf("turn-created action = %#v", action)
	}
	source := objectField(t, action, "source")
	if source["type"] != "do" || source["userLabel"] != "Do" {
		t.Fatalf("turn action source = %#v", source)
	}
	execution := objectField(t, action, "execution")
	if execution["harnessId"] != "codex" || execution["modelId"] != "gpt-test" || execution["fastMode"] != true {
		t.Fatalf("turn action execution = %#v", execution)
	}
	executionID, ok := execution["executionId"].(string)
	if !ok || !strings.HasPrefix(executionID, "headless-"+taskID+"-") {
		t.Fatalf("turn action execution id = %#v", execution)
	}
	if len(arrayField(t, action, "images")) != 1 {
		t.Fatalf("turn action images = %#v", action)
	}

	runtimeNotification := harness.waitForRuntimeNotification(t, notificationStart, "runtime/created", "openade-turn:"+eventID)
	runtimeParams := objectField(t, runtimeNotification, "params")
	if runtimeParams["kind"] != "agent" || runtimeParams["status"] != "running" || runtimeParams["nativeId"] != executionID {
		t.Fatalf("turn runtime notification = %#v", runtimeNotification)
	}
	runtimeScope := objectField(t, runtimeParams, "scope")
	if runtimeScope["ownerType"] != "openade-task" || runtimeScope["ownerId"] != taskID || runtimeScope["repoPath"] != projectDir {
		t.Fatalf("turn runtime scope = %#v", runtimeScope)
	}
	runtimeLabels := objectField(t, runtimeScope, "labels")
	if runtimeLabels["eventId"] != eventID || runtimeLabels["executionId"] != executionID {
		t.Fatalf("turn runtime labels = %#v", runtimeLabels)
	}
	runtimeRead := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:" + eventID,
	}))
	if runtimeRead["status"] != "running" || runtimeRead["nativeId"] != executionID {
		t.Fatalf("turn runtime read = %#v", runtimeRead)
	}
	runtimeList := resultArray(t, harness.request(t, "runtime/list", map[string]any{
		"ownerType": "openade-task",
		"ownerId":   taskID,
	}))
	if len(runtimeList) != 1 || objectValue(t, runtimeList[0])["runtimeId"] != "openade-turn:"+eventID {
		t.Fatalf("turn runtime list = %#v", runtimeList)
	}
	workingStarted := harness.waitForNotification(t, notificationStart, "openade/workingTasks")
	workingStartedParams := objectField(t, workingStarted, "params")
	if workingStartedParams["type"] != "working_tasks" || len(arrayField(t, workingStartedParams, "taskIds")) != 1 || arrayField(t, workingStartedParams, "taskIds")[0] != taskID {
		t.Fatalf("working tasks after turn start = %#v", workingStarted)
	}

	stopStart := len(harness.notifications)
	stoppedRuntime := resultObject(t, harness.request(t, "runtime/stop", map[string]any{
		"runtimeId": "openade-turn:" + eventID,
		"reason":    "user stop",
	}))
	if stoppedRuntime["status"] != "stopped" || stoppedRuntime["signal"] != "stopped" || stoppedRuntime["error"] != "user stop" {
		t.Fatalf("stopped turn runtime = %#v", stoppedRuntime)
	}
	stoppedNotification := harness.waitForRuntimeNotification(t, stopStart, "runtime/stopped", "openade-turn:"+eventID)
	if objectField(t, stoppedNotification, "params")["status"] != "stopped" {
		t.Fatalf("turn runtime stopped notification = %#v", stoppedNotification)
	}
	workingStopped := harness.waitForNotification(t, stopStart, "openade/workingTasks")
	workingStoppedParams := objectField(t, workingStopped, "params")
	if workingStoppedParams["type"] != "working_tasks" || len(arrayField(t, workingStoppedParams, "taskIds")) != 0 {
		t.Fatalf("working tasks after turn stop = %#v", workingStopped)
	}
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-turn-start",
		"taskId":               taskID,
		"hydrateSessionEvents": true,
	}))
	stoppedAction := actionEventFromTask(t, task, eventID)
	if stoppedAction["status"] != "stopped" || stoppedAction["completedAt"] == "" {
		t.Fatalf("stopped turn action = %#v", stoppedAction)
	}

	existingTurn := resultObject(t, harness.request(t, "openade/turn/start", map[string]any{
		"repoId":          "repo-turn-start",
		"inTaskId":        taskID,
		"type":            "ask",
		"input":           "",
		"label":           "Ask follow-up",
		"clientRequestId": "turn-existing-task",
	}))
	if existingTurn["taskId"] != taskID || existingTurn["eventId"] == eventID {
		t.Fatalf("existing-task turn result = %#v", existingTurn)
	}
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-turn-start",
		"taskId":               taskID,
		"hydrateSessionEvents": true,
	}))
	existingAction := actionEventFromTask(t, task, existingTurn["eventId"].(string))
	if source := objectField(t, existingAction, "source"); source["type"] != "ask" || source["userLabel"] != "Ask follow-up" {
		t.Fatalf("existing-task turn source = %#v", existingAction)
	}

	runPlanMissing := harness.request(t, "openade/turn/start", map[string]any{
		"repoId":          "repo-turn-start",
		"inTaskId":        taskID,
		"type":            "run_plan",
		"input":           "Run it",
		"clientRequestId": "run-plan-missing",
	})
	if runtimeErrorCode(t, runPlanMissing) != "invalid_params" {
		t.Fatalf("run plan without completed plan = %#v", runPlanMissing)
	}
}

func TestProductRuntimeRecordsOrphanActiveOnStartup(t *testing.T) {
	startedAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	updatedAt := startedAt.Add(time.Minute)
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        "repo-orphan-action",
			Name:      "Orphan Action Repo",
			Path:      "/tmp/openade-orphan-action",
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("upsert orphan action repo: %v", err)
		}
		if err := store.UpsertTask(ctx, storage.Task{
			ID:            "task-orphan-action",
			RepoID:        "repo-orphan-action",
			Slug:          "task-orphan-action",
			Title:         "Orphan action",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     startedAt,
			UpdatedAt:     startedAt,
		}); err != nil {
			t.Fatalf("upsert orphan action task: %v", err)
		}
		if err := store.UpsertTaskEvent(ctx, storage.TaskEvent{
			ID:          "event-orphan-action",
			TaskID:      "task-orphan-action",
			Seq:         1,
			Type:        "action",
			Status:      sql.NullString{String: "in_progress", Valid: true},
			SourceType:  sql.NullString{String: "do", Valid: true},
			SourceLabel: sql.NullString{String: "Do", Valid: true},
			CreatedAt:   startedAt,
			PayloadJSON: sql.NullString{String: `{"id":"event-orphan-action","type":"action","status":"in_progress","createdAt":"2026-06-05T12:00:00Z","userInput":"orphan me","source":{"type":"do","userLabel":"Do"},"execution":{"harnessId":"codex","executionId":"exec-orphan-action","events":[]},"includesCommentIds":[]}`, Valid: true},
		}); err != nil {
			t.Fatalf("upsert orphan action event: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "openade-turn:event-orphan-action",
			Kind:           "agent",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"openade-task","ownerId":"task-orphan-action","repoPath":"/tmp/openade-orphan-action","rootPath":"/tmp/openade-orphan-action","labels":{"eventId":"event-orphan-action","executionId":"exec-orphan-action"}}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      updatedAt,
			LastActivityAt: updatedAt,
			PayloadJSON:    sql.NullString{String: `{"nativeId":"exec-orphan-action"}`, Valid: true},
		}); err != nil {
			t.Fatalf("upsert orphan action runtime: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "process:previous-active",
			Kind:           "process",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"process","ownerId":"previous-active","rootPath":"/tmp/openade"}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      updatedAt,
			LastActivityAt: updatedAt,
			PayloadJSON:    sql.NullString{String: `{"nativeId":"previous-active","processLabel":"sleep 30"}`, Valid: true},
		}); err != nil {
			t.Fatalf("upsert active runtime: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "process:previous-complete",
			Kind:           "process",
			Status:         "completed",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"process","ownerId":"previous-complete"}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      updatedAt,
			LastActivityAt: updatedAt,
			PayloadJSON:    sql.NullString{String: `{"nativeId":"previous-complete","exitCode":0}`, Valid: true},
		}); err != nil {
			t.Fatalf("upsert completed runtime: %v", err)
		}
	})

	orphaned := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:previous-active",
	}))
	if orphaned["status"] != "orphaned" || orphaned["nativeId"] != "previous-active" {
		t.Fatalf("startup-orphaned runtime = %#v", orphaned)
	}
	orphanedAgent := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:event-orphan-action",
	}))
	if orphanedAgent["status"] != "orphaned" || orphanedAgent["nativeId"] != "exec-orphan-action" {
		t.Fatalf("startup-orphaned agent runtime = %#v", orphanedAgent)
	}
	orphanedTask := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-orphan-action",
		"taskId":               "task-orphan-action",
		"hydrateSessionEvents": true,
	}))
	orphanedAction := actionEventFromTask(t, orphanedTask, "event-orphan-action")
	if orphanedAction["status"] != "stopped" || orphanedAction["completedAt"] == "" {
		t.Fatalf("startup-reconciled orphan action = %#v", orphanedAction)
	}
	reconciled := resultObject(t, harness.request(t, "runtime/reconcile", map[string]any{
		"runtimeId": "process:previous-active",
	}))
	if reconciled["state"] != "orphaned" {
		t.Fatalf("startup-orphaned reconcile = %#v", reconciled)
	}
	completed := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:previous-complete",
	}))
	if completed["status"] != "completed" || completed["exitCode"] != float64(0) {
		t.Fatalf("completed runtime after startup = %#v", completed)
	}
}

func seedAgentRecoveryFixture(t *testing.T, store *storage.Store, ctx context.Context, input agentRecoveryFixtureInput) {
	t.Helper()
	if err := store.UpsertRepo(ctx, storage.Repo{
		ID:        input.RepoID,
		Name:      input.Title + " Repo",
		Path:      "/tmp/" + input.RepoID,
		CreatedAt: input.StartedAt,
		UpdatedAt: input.StartedAt,
	}); err != nil {
		t.Fatalf("upsert %s repo: %v", input.RepoID, err)
	}
	if err := store.UpsertTask(ctx, storage.Task{
		ID:            input.TaskID,
		RepoID:        input.RepoID,
		Slug:          input.TaskID,
		Title:         input.Title,
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     input.StartedAt,
		UpdatedAt:     input.StartedAt,
	}); err != nil {
		t.Fatalf("upsert %s task: %v", input.TaskID, err)
	}
	actionPayload := fmt.Sprintf(`{"id":%q,"type":"action","status":"in_progress","createdAt":%q,"userInput":%q,"source":{"type":"do","userLabel":"Do"},"execution":{"harnessId":"codex","executionId":%q,"events":[]},"includesCommentIds":[]}`, input.EventID, input.StartedAt.Format(time.RFC3339Nano), input.UserInput, input.ExecutionID)
	if err := store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:          input.EventID,
		TaskID:      input.TaskID,
		Seq:         1,
		Type:        "action",
		Status:      sql.NullString{String: "in_progress", Valid: true},
		SourceType:  sql.NullString{String: "do", Valid: true},
		SourceLabel: sql.NullString{String: "Do", Valid: true},
		CreatedAt:   input.StartedAt,
		PayloadJSON: sql.NullString{String: actionPayload, Valid: true},
	}); err != nil {
		t.Fatalf("upsert %s action event: %v", input.EventID, err)
	}
	payload := map[string]any{
		"nativeId":     input.ExecutionID,
		"pid":          input.PID,
		"recoveryFile": input.RecoveryFile,
	}
	if input.PGID != nil {
		payload["pgid"] = *input.PGID
	}
	runtimePayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal %s runtime payload: %v", input.EventID, err)
	}
	scope := fmt.Sprintf(`{"ownerType":"openade-task","ownerId":%q,"repoPath":%q,"rootPath":%q,"labels":{"eventId":%q,"executionId":%q}}`, input.TaskID, "/tmp/"+input.RepoID, "/tmp/"+input.RepoID, input.EventID, input.ExecutionID)
	if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
		RuntimeID:      "openade-turn:" + input.EventID,
		Kind:           "agent",
		Status:         "running",
		ScopeJSON:      sql.NullString{String: scope, Valid: true},
		StartedAt:      input.StartedAt,
		UpdatedAt:      input.StartedAt,
		LastActivityAt: input.StartedAt,
		PayloadJSON:    sql.NullString{String: string(runtimePayload), Valid: true},
	}); err != nil {
		t.Fatalf("upsert %s runtime: %v", input.EventID, err)
	}
}

type agentRecoveryFixtureInput struct {
	RepoID       string
	TaskID       string
	EventID      string
	ExecutionID  string
	Title        string
	UserInput    string
	StartedAt    time.Time
	RecoveryFile string
	PID          int
	PGID         *int
}

func TestProductRuntimeStartupRecoversCompletedAgentWorkerTranscript(t *testing.T) {
	startedAt := time.Date(2026, 6, 8, 22, 0, 0, 0, time.UTC)
	completedAt := startedAt.Add(2 * time.Minute)
	completedAtString := completedAt.Format(time.RFC3339Nano)
	recoveryFile := filepath.Join(t.TempDir(), "openade-turn-event-recovered-agent.ndjson")
	recoveryLines := []string{
		`{"type":"stream","event":{"id":"stream-recovered-1","direction":"execution","type":"session_started","executionId":"exec-recovered-agent","harnessId":"codex","sessionId":"session-recovered-agent"}}`,
		`{"type":"stream","event":{"id":"stream-recovered-2","direction":"execution","type":"raw_message","executionId":"exec-recovered-agent","harnessId":"codex","message":{"type":"item.completed","item":{"type":"agent_message","text":"Recovered after Core restart."}}}}`,
		`{"type":"stream","event":{"id":"stream-recovered-3","direction":"execution","type":"complete","executionId":"exec-recovered-agent","harnessId":"codex","usage":{"inputTokens":3,"outputTokens":4}}}`,
		`{"type":"execution","sessionId":"session-recovered-agent","gitRefsAfter":{"sha":"abc123","branch":"main"}}`,
		fmt.Sprintf(`{"type":"result","status":"completed","success":true,"completedAt":%q}`, completedAtString),
	}
	if err := os.WriteFile(recoveryFile, []byte(strings.Join(recoveryLines, "\n")+"\n"), 0o600); err != nil {
		t.Fatalf("write recovery transcript: %v", err)
	}
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		seedAgentRecoveryFixture(t, store, ctx, agentRecoveryFixtureInput{
			RepoID:       "repo-recovered-agent",
			TaskID:       "task-recovered-agent",
			EventID:      "event-recovered-agent",
			ExecutionID:  "exec-recovered-agent",
			Title:        "Recovered agent",
			UserInput:    "recover completed worker",
			StartedAt:    startedAt,
			RecoveryFile: recoveryFile,
			PID:          deadProcessID(t),
		})
	})

	runtimeDTO := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:event-recovered-agent",
	}))
	if runtimeDTO["status"] != "completed" || runtimeDTO["nativeId"] != "exec-recovered-agent" || runtimeDTO["exitedAt"] != completedAtString {
		t.Fatalf("startup recovered agent runtime = %#v", runtimeDTO)
	}
	if _, ok := runtimeDTO["recoveryFile"]; ok {
		t.Fatalf("runtime DTO exposed recovery file path = %#v", runtimeDTO)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-recovered-agent",
		"taskId":               "task-recovered-agent",
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, "event-recovered-agent")
	if action["status"] != "completed" || action["completedAt"] != completedAtString {
		t.Fatalf("startup recovered action = %#v", action)
	}
	execution := objectField(t, action, "execution")
	if execution["sessionId"] != "session-recovered-agent" {
		t.Fatalf("startup recovered execution session = %#v", execution)
	}
	events := arrayField(t, execution, "events")
	if len(events) != 3 {
		t.Fatalf("startup recovered execution events = %#v", events)
	}
	if objectValue(t, events[1])["type"] != "raw_message" || objectField(t, objectValue(t, events[1]), "message")["type"] != "item.completed" {
		t.Fatalf("startup recovered stream events = %#v", events)
	}
	gitRefsAfter := objectField(t, execution, "gitRefsAfter")
	if gitRefsAfter["sha"] != "abc123" || gitRefsAfter["branch"] != "main" {
		t.Fatalf("startup recovered git refs = %#v", gitRefsAfter)
	}
	result := objectField(t, action, "result")
	if result["success"] != true {
		t.Fatalf("startup recovered action result = %#v", result)
	}
}

func TestProductRuntimeStartupAdoptsLiveAgentWorkerTranscript(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("live agent worker adoption uses Unix process groups")
	}
	worker, pid, pgid := startLongRunningProcessGroup(t)
	t.Cleanup(func() {
		if worker.Process != nil {
			_ = worker.Process.Kill()
		}
		_ = worker.Wait()
	})
	startedAt := time.Date(2026, 6, 8, 22, 30, 0, 0, time.UTC)
	completedAt := startedAt.Add(2 * time.Minute)
	completedAtString := completedAt.Format(time.RFC3339Nano)
	recoveryFile := filepath.Join(t.TempDir(), "openade-turn-event-live-adopted.ndjson")
	initialLine := `{"type":"stream","event":{"id":"stream-live-1","direction":"execution","type":"raw_message","executionId":"exec-live-adopted","harnessId":"codex","message":{"type":"item.completed","item":{"type":"agent_message","text":"Before restart."}}}}`
	if err := os.WriteFile(recoveryFile, []byte(initialLine+"\n"), 0o600); err != nil {
		t.Fatalf("write live recovery transcript: %v", err)
	}
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		seedAgentRecoveryFixture(t, store, ctx, agentRecoveryFixtureInput{
			RepoID:       "repo-live-adopted",
			TaskID:       "task-live-adopted",
			EventID:      "event-live-adopted",
			ExecutionID:  "exec-live-adopted",
			Title:        "Live adopted agent",
			UserInput:    "adopt live worker",
			StartedAt:    startedAt,
			RecoveryFile: recoveryFile,
			PID:          pid,
			PGID:         pgid,
		})
	})

	running := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:event-live-adopted",
	}))
	if running["status"] != "running" || running["nativeId"] != "exec-live-adopted" {
		t.Fatalf("adopted live runtime = %#v", running)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-live-adopted",
		"taskId":               "task-live-adopted",
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, "event-live-adopted")
	events := arrayField(t, objectField(t, action, "execution"), "events")
	if len(events) != 1 || objectValue(t, events[0])["id"] != "stream-live-1" {
		t.Fatalf("adopted live initial stream = %#v", events)
	}

	appendLines := []string{
		`{"type":"stream","event":{"id":"stream-live-2","direction":"execution","type":"complete","executionId":"exec-live-adopted","harnessId":"codex","usage":{"inputTokens":5,"outputTokens":6}}}`,
		`{"type":"execution","sessionId":"session-live-adopted","gitRefsAfter":{"sha":"def456"}}`,
		fmt.Sprintf(`{"type":"result","status":"completed","success":true,"completedAt":%q}`, completedAtString),
	}
	file, err := os.OpenFile(recoveryFile, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("open live recovery transcript for append: %v", err)
	}
	if _, err := file.WriteString(strings.Join(appendLines, "\n") + "\n"); err != nil {
		_ = file.Close()
		t.Fatalf("append live recovery transcript: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close live recovery transcript: %v", err)
	}

	completed := waitForRuntimeStatus(t, harness, "openade-turn:event-live-adopted", "completed")
	if completed["exitedAt"] != completedAtString {
		t.Fatalf("completed adopted runtime = %#v", completed)
	}
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-live-adopted",
		"taskId":               "task-live-adopted",
		"hydrateSessionEvents": true,
	}))
	action = actionEventFromTask(t, task, "event-live-adopted")
	if action["status"] != "completed" || action["completedAt"] != completedAtString {
		t.Fatalf("completed adopted action = %#v", action)
	}
	execution := objectField(t, action, "execution")
	if execution["sessionId"] != "session-live-adopted" {
		t.Fatalf("completed adopted execution = %#v", execution)
	}
	events = arrayField(t, execution, "events")
	if len(events) != 2 {
		t.Fatalf("completed adopted stream events = %#v", events)
	}
	waitForProcessExit(t, worker, 2*time.Second)
}

func TestProductRuntimeStopTerminatesAdoptedLiveAgentWorker(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("live agent worker adoption uses Unix process groups")
	}
	worker, pid, pgid := startLongRunningProcessGroup(t)
	t.Cleanup(func() {
		if worker.Process != nil {
			_ = worker.Process.Kill()
		}
		_ = worker.Wait()
	})
	startedAt := time.Date(2026, 6, 8, 23, 0, 0, 0, time.UTC)
	recoveryFile := filepath.Join(t.TempDir(), "openade-turn-event-live-stop.ndjson")
	if err := os.WriteFile(recoveryFile, []byte(`{"type":"stream","event":{"id":"stream-stop-1","direction":"execution","type":"raw_message","executionId":"exec-live-stop","harnessId":"codex","message":{"type":"item.completed","item":{"type":"agent_message","text":"Still running."}}}}`+"\n"), 0o600); err != nil {
		t.Fatalf("write stoppable recovery transcript: %v", err)
	}
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		seedAgentRecoveryFixture(t, store, ctx, agentRecoveryFixtureInput{
			RepoID:       "repo-live-stop",
			TaskID:       "task-live-stop",
			EventID:      "event-live-stop",
			ExecutionID:  "exec-live-stop",
			Title:        "Live stoppable agent",
			UserInput:    "stop adopted worker",
			StartedAt:    startedAt,
			RecoveryFile: recoveryFile,
			PID:          pid,
			PGID:         pgid,
		})
	})
	waitForRuntimeStatus(t, harness, "openade-turn:event-live-stop", "running")

	stopped := resultObject(t, harness.request(t, "runtime/stop", map[string]any{
		"runtimeId": "openade-turn:event-live-stop",
		"reason":    "user stop after adoption",
	}))
	if stopped["status"] != "stopped" || stopped["error"] != "user stop after adoption" {
		t.Fatalf("stopped adopted runtime = %#v", stopped)
	}
	waitForProcessExit(t, worker, 2*time.Second)
}

func TestProductRuntimeStopTerminatesStoredAgentWorkerWithoutMemory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("agent worker process termination is conservative on Windows")
	}
	for _, storedStatus := range []string{"running", "orphaned"} {
		t.Run(storedStatus, func(t *testing.T) {
			worker, pid, pgid := startLongRunningProcessGroup(t)
			t.Cleanup(func() {
				if worker.Process != nil {
					_ = worker.Process.Kill()
				}
				_ = worker.Wait()
			})
			startedAt := time.Date(2026, 6, 9, 17, 0, 0, 0, time.UTC)
			suffix := strings.ReplaceAll(storedStatus, "_", "-")
			repoID := "repo-stop-stored-agent-" + suffix
			taskID := "task-stop-stored-agent-" + suffix
			eventID := "event-stop-stored-agent-" + suffix
			executionID := "exec-stop-stored-agent-" + suffix
			harness := newRuntimeHarness(t)
			ctx := context.Background()
			if err := harness.store.UpsertRepo(ctx, storage.Repo{
				ID:        repoID,
				Name:      "Stop Stored Agent Repo " + storedStatus,
				Path:      "/tmp/openade-stop-stored-agent-" + suffix,
				CreatedAt: startedAt,
				UpdatedAt: startedAt,
			}); err != nil {
				t.Fatalf("upsert stop stored agent repo: %v", err)
			}
			if err := harness.store.UpsertTask(ctx, storage.Task{
				ID:            taskID,
				RepoID:        repoID,
				Slug:          taskID,
				Title:         "Stop stored agent " + storedStatus,
				IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
				CreatedAt:     startedAt,
				UpdatedAt:     startedAt,
			}); err != nil {
				t.Fatalf("upsert stop stored agent task: %v", err)
			}
			actionPayload := fmt.Sprintf(`{"id":%q,"type":"action","status":"in_progress","createdAt":"2026-06-09T17:00:00Z","userInput":%q,"source":{"type":"do","userLabel":"Do"},"execution":{"harnessId":"codex","executionId":%q,"events":[]},"includesCommentIds":[]}`, eventID, "stop stored "+storedStatus+" worker", executionID)
			if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
				ID:          eventID,
				TaskID:      taskID,
				Seq:         1,
				Type:        "action",
				Status:      sql.NullString{String: "in_progress", Valid: true},
				SourceType:  sql.NullString{String: "do", Valid: true},
				SourceLabel: sql.NullString{String: "Do", Valid: true},
				CreatedAt:   startedAt,
				PayloadJSON: sql.NullString{String: actionPayload, Valid: true},
			}); err != nil {
				t.Fatalf("upsert stop stored agent event: %v", err)
			}
			scope := fmt.Sprintf(`{"ownerType":"openade-task","ownerId":%q,"repoPath":%q,"rootPath":%q,"labels":{"eventId":%q,"executionId":%q}}`, taskID, "/tmp/openade-stop-stored-agent-"+suffix, "/tmp/openade-stop-stored-agent-"+suffix, eventID, executionID)
			if err := harness.store.UpsertRuntime(ctx, storage.RuntimeRecord{
				RuntimeID:      "openade-turn:" + eventID,
				Kind:           "agent",
				Status:         storedStatus,
				ScopeJSON:      sql.NullString{String: scope, Valid: true},
				StartedAt:      startedAt,
				UpdatedAt:      startedAt,
				LastActivityAt: startedAt,
				PayloadJSON:    sql.NullString{String: fmt.Sprintf(`{"nativeId":%q,"pid":%d,"pgid":%d,"processStartedAt":"2026-06-09T17:00:00Z"}`, executionID, pid, *pgid), Valid: true},
			}); err != nil {
				t.Fatalf("upsert stored %s agent runtime: %v", storedStatus, err)
			}

			notificationStart := len(harness.notifications)
			stopped := resultObject(t, harness.request(t, "runtime/stop", map[string]any{
				"runtimeId": "openade-turn:" + eventID,
				"reason":    "manual stored cleanup",
			}))
			if stopped["status"] != "stopped" || stopped["pid"] != float64(pid) || stopped["pgid"] != float64(*pgid) || stopped["error"] != "manual stored cleanup" {
				t.Fatalf("stopped stored %s agent runtime = %#v", storedStatus, stopped)
			}
			stoppedNotification := harness.waitForRuntimeNotification(t, notificationStart, "runtime/stopped", "openade-turn:"+eventID)
			stoppedParams := objectField(t, stoppedNotification, "params")
			if stoppedParams["status"] != "stopped" || stoppedParams["pid"] != float64(pid) {
				t.Fatalf("stored %s agent stopped notification = %#v", storedStatus, stoppedNotification)
			}
			task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
				"repoId":               repoID,
				"taskId":               taskID,
				"hydrateSessionEvents": true,
			}))
			action := actionEventFromTask(t, task, eventID)
			if action["status"] != "stopped" || action["completedAt"] == "" {
				t.Fatalf("stopped stored %s agent action = %#v", storedStatus, action)
			}
			waitForProcessExit(t, worker, 2*time.Second)
		})
	}
}

func TestProductRuntimeStartupStopsVerifiedDeadProcessBackedRuntimes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("process liveness reconciliation is conservative on Windows")
	}
	deadPID := deadProcessID(t)
	startedAt := time.Date(2026, 6, 8, 19, 0, 0, 0, time.UTC)
	terminalID := taskTerminalIDForTest("repo-startup-dead-agent", "task-startup-dead-agent")
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        "repo-startup-dead-agent",
			Name:      "Startup Dead Agent Repo",
			Path:      "/tmp/openade-startup-dead-agent",
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("upsert startup dead agent repo: %v", err)
		}
		if err := store.UpsertTask(ctx, storage.Task{
			ID:            "task-startup-dead-agent",
			RepoID:        "repo-startup-dead-agent",
			Slug:          "task-startup-dead-agent",
			Title:         "Startup dead agent",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     startedAt,
			UpdatedAt:     startedAt,
		}); err != nil {
			t.Fatalf("upsert startup dead agent task: %v", err)
		}
		if err := store.UpsertTaskEvent(ctx, storage.TaskEvent{
			ID:          "event-startup-dead-agent",
			TaskID:      "task-startup-dead-agent",
			Seq:         1,
			Type:        "action",
			Status:      sql.NullString{String: "in_progress", Valid: true},
			SourceType:  sql.NullString{String: "do", Valid: true},
			SourceLabel: sql.NullString{String: "Do", Valid: true},
			CreatedAt:   startedAt,
			PayloadJSON: sql.NullString{String: `{"id":"event-startup-dead-agent","type":"action","status":"in_progress","createdAt":"2026-06-08T19:00:00Z","userInput":"recover dead worker","source":{"type":"do","userLabel":"Do"},"execution":{"harnessId":"codex","executionId":"exec-startup-dead-agent","events":[]},"includesCommentIds":[]}`, Valid: true},
		}); err != nil {
			t.Fatalf("upsert startup dead agent event: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "openade-turn:event-startup-dead-agent",
			Kind:           "agent",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"openade-task","ownerId":"task-startup-dead-agent","repoPath":"/tmp/openade-startup-dead-agent","rootPath":"/tmp/openade-startup-dead-agent","labels":{"eventId":"event-startup-dead-agent","executionId":"exec-startup-dead-agent"}}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt,
			LastActivityAt: startedAt,
			PayloadJSON:    sql.NullString{String: fmt.Sprintf(`{"nativeId":"exec-startup-dead-agent","pid":%d,"processStartedAt":"2026-06-08T19:00:00Z"}`, deadPID), Valid: true},
		}); err != nil {
			t.Fatalf("upsert startup dead agent runtime: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "process:startup-dead-process",
			Kind:           "process",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"process","ownerId":"startup-dead-process","rootPath":"/tmp/openade-startup-dead-process"}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt,
			LastActivityAt: startedAt,
			PayloadJSON:    sql.NullString{String: fmt.Sprintf(`{"nativeId":"startup-dead-process","pid":%d,"processLabel":"sleep 1","processStartedAt":"2026-06-08T19:00:00Z"}`, deadPID), Valid: true},
		}); err != nil {
			t.Fatalf("upsert startup dead process runtime: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "pty:" + terminalID,
			Kind:           "pty",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"pty","ownerId":"` + terminalID + `","rootPath":"/tmp/openade-startup-dead-agent","labels":{"repoId":"repo-startup-dead-agent","taskId":"task-startup-dead-agent"}}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt,
			LastActivityAt: startedAt,
			PayloadJSON:    sql.NullString{String: fmt.Sprintf(`{"nativeId":"%s","pid":%d,"processLabel":"/bin/bash","processStartedAt":"2026-06-08T19:00:00Z"}`, terminalID, deadPID), Valid: true},
		}); err != nil {
			t.Fatalf("upsert startup dead terminal runtime: %v", err)
		}
		if err := store.AppendRuntimeOutputChunk(ctx, storage.RuntimeOutputChunk{
			RuntimeID:   "pty:" + terminalID,
			Stream:      "pty",
			Data:        "startup dead terminal output\n",
			TimestampMs: startedAt.UnixMilli(),
		}, runtimeOutputReadLimit); err != nil {
			t.Fatalf("append startup dead terminal output: %v", err)
		}
	})

	agentRuntime := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:event-startup-dead-agent",
	}))
	if agentRuntime["status"] != "stopped" || agentRuntime["pid"] != float64(deadPID) || agentRuntime["error"] != "agent worker process is no longer running" {
		t.Fatalf("startup reconciled dead agent runtime = %#v", agentRuntime)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-startup-dead-agent",
		"taskId":               "task-startup-dead-agent",
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, "event-startup-dead-agent")
	if action["status"] != "stopped" || action["completedAt"] == "" {
		t.Fatalf("startup reconciled dead agent action = %#v", action)
	}
	processRuntime := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:startup-dead-process",
	}))
	if processRuntime["status"] != "stopped" || processRuntime["pid"] != float64(deadPID) || processRuntime["error"] != "process is no longer running" {
		t.Fatalf("startup reconciled dead process runtime = %#v", processRuntime)
	}
	terminalRuntime := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "pty:" + terminalID,
	}))
	if terminalRuntime["status"] != "stopped" || terminalRuntime["pid"] != float64(deadPID) || terminalRuntime["error"] != "terminal process is no longer running" {
		t.Fatalf("startup reconciled dead terminal runtime = %#v", terminalRuntime)
	}
	terminalReconnect := resultObject(t, harness.request(t, "openade/task/terminal/reconnect", map[string]any{
		"repoId":     "repo-startup-dead-agent",
		"taskId":     "task-startup-dead-agent",
		"terminalId": terminalID,
	}))
	if terminalReconnect["found"] != true || terminalReconnect["exited"] != true || terminalReconnect["outputCount"] != float64(1) {
		t.Fatalf("startup dead terminal reconnect = %#v", terminalReconnect)
	}
	terminalOutput := arrayField(t, terminalReconnect, "output")
	if objectValue(t, terminalOutput[0])["data"] != "startup dead terminal output\n" {
		t.Fatalf("startup dead terminal output = %#v", terminalOutput)
	}
}

func TestProductRuntimeStartupTerminatesLiveOrphanedAgentWorker(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("agent worker process termination is conservative on Windows")
	}
	worker, pid, pgid := startLongRunningProcessGroup(t)
	t.Cleanup(func() {
		if worker.Process != nil {
			_ = worker.Process.Kill()
		}
		_ = worker.Wait()
	})
	startedAt := time.Date(2026, 6, 8, 21, 0, 0, 0, time.UTC)
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        "repo-live-orphan-agent",
			Name:      "Live Orphan Agent Repo",
			Path:      "/tmp/openade-live-orphan-agent",
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("upsert live orphan agent repo: %v", err)
		}
		if err := store.UpsertTask(ctx, storage.Task{
			ID:            "task-live-orphan-agent",
			RepoID:        "repo-live-orphan-agent",
			Slug:          "task-live-orphan-agent",
			Title:         "Live orphan agent",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     startedAt,
			UpdatedAt:     startedAt,
		}); err != nil {
			t.Fatalf("upsert live orphan agent task: %v", err)
		}
		if err := store.UpsertTaskEvent(ctx, storage.TaskEvent{
			ID:          "event-live-orphan-agent",
			TaskID:      "task-live-orphan-agent",
			Seq:         1,
			Type:        "action",
			Status:      sql.NullString{String: "in_progress", Valid: true},
			SourceType:  sql.NullString{String: "do", Valid: true},
			SourceLabel: sql.NullString{String: "Do", Valid: true},
			CreatedAt:   startedAt,
			PayloadJSON: sql.NullString{String: `{"id":"event-live-orphan-agent","type":"action","status":"in_progress","createdAt":"2026-06-08T21:00:00Z","userInput":"stop orphaned worker","source":{"type":"do","userLabel":"Do"},"execution":{"harnessId":"codex","executionId":"exec-live-orphan-agent","events":[]},"includesCommentIds":[]}`, Valid: true},
		}); err != nil {
			t.Fatalf("upsert live orphan agent event: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "openade-turn:event-live-orphan-agent",
			Kind:           "agent",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"openade-task","ownerId":"task-live-orphan-agent","repoPath":"/tmp/openade-live-orphan-agent","rootPath":"/tmp/openade-live-orphan-agent","labels":{"eventId":"event-live-orphan-agent","executionId":"exec-live-orphan-agent"}}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt,
			LastActivityAt: startedAt,
			PayloadJSON:    sql.NullString{String: fmt.Sprintf(`{"nativeId":"exec-live-orphan-agent","pid":%d,"pgid":%d,"processStartedAt":"2026-06-08T21:00:00Z"}`, pid, *pgid), Valid: true},
		}); err != nil {
			t.Fatalf("upsert live orphan agent runtime: %v", err)
		}
	})

	runtimeDTO := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "openade-turn:event-live-orphan-agent",
	}))
	if runtimeDTO["status"] != "stopped" || runtimeDTO["pid"] != float64(pid) || runtimeDTO["pgid"] != float64(*pgid) || runtimeDTO["error"] != "agent worker process was orphaned during core startup" {
		t.Fatalf("startup stopped live orphaned agent runtime = %#v", runtimeDTO)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-live-orphan-agent",
		"taskId":               "task-live-orphan-agent",
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, "event-live-orphan-agent")
	if action["status"] != "stopped" || action["completedAt"] == "" {
		t.Fatalf("startup stopped live orphaned agent action = %#v", action)
	}
	waitForProcessExit(t, worker, 2*time.Second)
}

func TestProductRuntimeReconcileStopsDeadAgentWorkerProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("agent worker process liveness reconciliation is conservative on Windows")
	}
	deadPID := deadProcessID(t)
	startedAt := time.Date(2026, 6, 6, 16, 0, 0, 0, time.UTC)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-dead-agent",
		Name:      "Dead Agent Repo",
		Path:      "/tmp/openade-dead-agent",
		CreatedAt: startedAt,
		UpdatedAt: startedAt,
	}); err != nil {
		t.Fatalf("upsert dead agent repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-dead-agent",
		RepoID:        "repo-dead-agent",
		Slug:          "task-dead-agent",
		Title:         "Dead agent",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		CreatedAt:     startedAt,
		UpdatedAt:     startedAt,
	}); err != nil {
		t.Fatalf("upsert dead agent task: %v", err)
	}
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:          "event-dead-agent",
		TaskID:      "task-dead-agent",
		Seq:         1,
		Type:        "action",
		Status:      sql.NullString{String: "in_progress", Valid: true},
		SourceType:  sql.NullString{String: "do", Valid: true},
		SourceLabel: sql.NullString{String: "Do", Valid: true},
		CreatedAt:   startedAt,
		PayloadJSON: sql.NullString{String: `{"id":"event-dead-agent","type":"action","status":"in_progress","createdAt":"2026-06-06T16:00:00Z","userInput":"verify worker death","source":{"type":"do","userLabel":"Do"},"execution":{"harnessId":"codex","executionId":"exec-dead-agent","events":[]},"includesCommentIds":[]}`, Valid: true},
	}); err != nil {
		t.Fatalf("upsert dead agent action event: %v", err)
	}
	if err := harness.store.UpsertRuntime(ctx, storage.RuntimeRecord{
		RuntimeID:      "openade-turn:event-dead-agent",
		Kind:           "agent",
		Status:         "running",
		ScopeJSON:      sql.NullString{String: `{"ownerType":"openade-task","ownerId":"task-dead-agent","repoPath":"/tmp/openade-dead-agent","rootPath":"/tmp/openade-dead-agent","labels":{"eventId":"event-dead-agent","executionId":"exec-dead-agent"}}`, Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      startedAt,
		LastActivityAt: startedAt,
		PayloadJSON:    sql.NullString{String: fmt.Sprintf(`{"nativeId":"exec-dead-agent","pid":%d,"processStartedAt":"2026-06-06T16:00:00Z"}`, deadPID), Valid: true},
	}); err != nil {
		t.Fatalf("upsert dead agent runtime: %v", err)
	}

	notificationStart := len(harness.notifications)
	reconciled := resultObject(t, harness.request(t, "runtime/reconcile", map[string]any{
		"runtimeId": "openade-turn:event-dead-agent",
	}))
	runtimeDTO := objectField(t, reconciled, "runtime")
	if reconciled["state"] != "stopped" || runtimeDTO["status"] != "stopped" || runtimeDTO["pid"] != float64(deadPID) || runtimeDTO["error"] != "agent worker process is no longer running" {
		t.Fatalf("dead agent reconcile = %#v", reconciled)
	}
	stoppedNotification := harness.waitForRuntimeNotification(t, notificationStart, "runtime/stopped", "openade-turn:event-dead-agent")
	stoppedParams := objectField(t, stoppedNotification, "params")
	if stoppedParams["status"] != "stopped" || stoppedParams["pid"] != float64(deadPID) {
		t.Fatalf("dead agent stopped notification = %#v", stoppedNotification)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId":               "repo-dead-agent",
		"taskId":               "task-dead-agent",
		"hydrateSessionEvents": true,
	}))
	action := actionEventFromTask(t, task, "event-dead-agent")
	if action["status"] != "stopped" || action["completedAt"] == "" {
		t.Fatalf("dead agent action after reconcile = %#v", action)
	}
}

func TestProductRuntimeReconcileStopsDeadProjectProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("process liveness reconciliation is conservative on Windows")
	}
	deadPID := deadProcessID(t)
	startedAt := time.Date(2026, 6, 8, 14, 0, 0, 0, time.UTC)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	if err := harness.store.UpsertRuntime(ctx, storage.RuntimeRecord{
		RuntimeID:      "process:dead-project-process",
		Kind:           "process",
		Status:         "orphaned",
		ScopeJSON:      sql.NullString{String: `{"ownerType":"process","ownerId":"dead-project-process","rootPath":"/tmp/openade-dead-process"}`, Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      startedAt,
		LastActivityAt: startedAt,
		PayloadJSON:    sql.NullString{String: fmt.Sprintf(`{"nativeId":"dead-project-process","pid":%d,"processLabel":"sleep 1","processStartedAt":"2026-06-08T14:00:00Z"}`, deadPID), Valid: true},
	}); err != nil {
		t.Fatalf("upsert dead process runtime: %v", err)
	}
	orphaned := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:dead-project-process",
	}))
	if orphaned["status"] != "orphaned" || orphaned["pid"] != float64(deadPID) {
		t.Fatalf("dead process runtime before reconcile = %#v", orphaned)
	}

	notificationStart := len(harness.notifications)
	reconciled := resultObject(t, harness.request(t, "runtime/reconcile", map[string]any{
		"runtimeId": "process:dead-project-process",
	}))
	runtimeDTO := objectField(t, reconciled, "runtime")
	if reconciled["state"] != "stopped" || runtimeDTO["status"] != "stopped" || runtimeDTO["pid"] != float64(deadPID) || runtimeDTO["error"] != "process is no longer running" {
		t.Fatalf("dead process reconcile = %#v", reconciled)
	}
	stoppedNotification := harness.waitForRuntimeNotification(t, notificationStart, "runtime/stopped", "process:dead-project-process")
	stoppedParams := objectField(t, stoppedNotification, "params")
	if stoppedParams["status"] != "stopped" || stoppedParams["pid"] != float64(deadPID) {
		t.Fatalf("dead process stopped notification = %#v", stoppedNotification)
	}
	stored := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:dead-project-process",
	}))
	if stored["status"] != "stopped" || stored["error"] != "process is no longer running" {
		t.Fatalf("dead process stored runtime = %#v", stored)
	}
}

func TestProductRuntimeReconcileStopsDeadTaskTerminal(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("terminal liveness reconciliation is conservative on Windows")
	}
	deadPID := deadProcessID(t)
	startedAt := time.Date(2026, 6, 8, 20, 0, 0, 0, time.UTC)
	repoPath := t.TempDir()
	terminalID := taskTerminalIDForTest("repo-dead-terminal", "task-dead-terminal")
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        "repo-dead-terminal",
			Name:      "Dead Terminal Repo",
			Path:      repoPath,
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("upsert dead terminal repo: %v", err)
		}
		if err := store.UpsertTask(ctx, storage.Task{
			ID:            "task-dead-terminal",
			RepoID:        "repo-dead-terminal",
			Slug:          "task-dead-terminal",
			Title:         "Dead terminal",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     startedAt,
			UpdatedAt:     startedAt,
		}); err != nil {
			t.Fatalf("upsert dead terminal task: %v", err)
		}
	})
	ctx := context.Background()
	if err := harness.store.UpsertRuntime(ctx, storage.RuntimeRecord{
		RuntimeID:      "pty:" + terminalID,
		Kind:           "pty",
		Status:         "orphaned",
		ScopeJSON:      sql.NullString{String: `{"ownerType":"pty","ownerId":"` + terminalID + `","rootPath":"` + repoPath + `","labels":{"repoId":"repo-dead-terminal","taskId":"task-dead-terminal"}}`, Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      startedAt,
		LastActivityAt: startedAt,
		PayloadJSON:    sql.NullString{String: fmt.Sprintf(`{"nativeId":"%s","pid":%d,"processLabel":"/bin/bash","processStartedAt":"2026-06-08T20:00:00Z"}`, terminalID, deadPID), Valid: true},
	}); err != nil {
		t.Fatalf("upsert dead terminal runtime: %v", err)
	}
	if err := harness.store.AppendRuntimeOutputChunk(ctx, storage.RuntimeOutputChunk{
		RuntimeID:   "pty:" + terminalID,
		Stream:      "pty",
		Data:        "dead terminal output\n",
		TimestampMs: startedAt.UnixMilli(),
	}, runtimeOutputReadLimit); err != nil {
		t.Fatalf("append dead terminal output: %v", err)
	}

	notificationStart := len(harness.notifications)
	reconciled := resultObject(t, harness.request(t, "runtime/reconcile", map[string]any{
		"runtimeId": "pty:" + terminalID,
	}))
	runtimeDTO := objectField(t, reconciled, "runtime")
	if reconciled["state"] != "stopped" || runtimeDTO["status"] != "stopped" || runtimeDTO["pid"] != float64(deadPID) || runtimeDTO["error"] != "terminal process is no longer running" {
		t.Fatalf("dead terminal reconcile = %#v", reconciled)
	}
	stoppedNotification := harness.waitForRuntimeNotification(t, notificationStart, "runtime/stopped", "pty:"+terminalID)
	stoppedParams := objectField(t, stoppedNotification, "params")
	if stoppedParams["status"] != "stopped" || stoppedParams["pid"] != float64(deadPID) {
		t.Fatalf("dead terminal stopped notification = %#v", stoppedNotification)
	}
	reconnect := resultObject(t, harness.request(t, "openade/task/terminal/reconnect", map[string]any{
		"repoId":     "repo-dead-terminal",
		"taskId":     "task-dead-terminal",
		"terminalId": terminalID,
	}))
	if reconnect["found"] != true || reconnect["exited"] != true || reconnect["outputCount"] != float64(1) {
		t.Fatalf("dead terminal reconnect = %#v", reconnect)
	}
	output := arrayField(t, reconnect, "output")
	if objectValue(t, output[0])["data"] != "dead terminal output\n" {
		t.Fatalf("dead terminal output = %#v", output)
	}
}

func TestProductRuntimeOutputReconnectsFromDurableStorageOverRuntime(t *testing.T) {
	startedAt := time.Date(2026, 6, 8, 17, 0, 0, 0, time.UTC)
	repoPath := t.TempDir()
	terminalID := taskTerminalIDForTest("repo-durable-output", "task-durable-output")
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        "repo-durable-output",
			Name:      "Durable output repo",
			Path:      repoPath,
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("upsert durable output repo: %v", err)
		}
		if err := store.UpsertTask(ctx, storage.Task{
			ID:            "task-durable-output",
			RepoID:        "repo-durable-output",
			Slug:          "task-durable-output",
			Title:         "Durable output",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     startedAt,
			UpdatedAt:     startedAt,
		}); err != nil {
			t.Fatalf("upsert durable output task: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "process:stored-process",
			Kind:           "process",
			Status:         "completed",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"process","ownerId":"stored-process","rootPath":"` + repoPath + `","labels":{"repoId":"repo-durable-output","taskId":""}}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt.Add(time.Second),
			LastActivityAt: startedAt.Add(time.Second),
			PayloadJSON:    sql.NullString{String: `{"nativeId":"stored-process","processLabel":"printf durable","exitCode":0,"exitedAt":"2026-06-08T17:00:01Z"}`, Valid: true},
		}); err != nil {
			t.Fatalf("upsert stored process runtime: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "pty:" + terminalID,
			Kind:           "pty",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: `{"ownerType":"pty","ownerId":"` + terminalID + `","rootPath":"` + repoPath + `","labels":{"repoId":"repo-durable-output","taskId":"task-durable-output"}}`, Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt.Add(time.Second),
			LastActivityAt: startedAt.Add(time.Second),
			PayloadJSON:    sql.NullString{String: `{"nativeId":"` + terminalID + `","processLabel":"/bin/bash"}`, Valid: true},
		}); err != nil {
			t.Fatalf("upsert stored pty runtime: %v", err)
		}
		for _, chunk := range []storage.RuntimeOutputChunk{
			{RuntimeID: "process:stored-process", Stream: "stdout", Data: "durable stdout\n", TimestampMs: startedAt.UnixMilli()},
			{RuntimeID: "process:stored-process", Stream: "stderr", Data: "durable stderr\n", TimestampMs: startedAt.Add(time.Millisecond).UnixMilli()},
			{RuntimeID: "pty:" + terminalID, Stream: "pty", Data: "durable terminal\n", TimestampMs: startedAt.UnixMilli()},
		} {
			if err := store.AppendRuntimeOutputChunk(ctx, chunk, 20); err != nil {
				t.Fatalf("append durable output chunk: %v", err)
			}
		}
	})

	processReconnect := resultObject(t, harness.request(t, "openade/project/process/reconnect", map[string]any{
		"repoId":    "repo-durable-output",
		"processId": "stored-process",
	}))
	if processReconnect["found"] != true || processReconnect["completed"] != true || processReconnect["exitCode"] != float64(0) || processReconnect["outputCount"] != float64(2) {
		t.Fatalf("stored process reconnect = %#v", processReconnect)
	}
	processOutput := arrayField(t, processReconnect, "output")
	if objectValue(t, processOutput[0])["type"] != "stdout" || objectValue(t, processOutput[0])["data"] != "durable stdout\n" || objectValue(t, processOutput[1])["type"] != "stderr" {
		t.Fatalf("stored process output = %#v", processOutput)
	}
	wrongScope := resultObject(t, harness.request(t, "openade/project/process/reconnect", map[string]any{
		"repoId":    "repo-other",
		"processId": "stored-process",
	}))
	if wrongScope["found"] != false {
		t.Fatalf("wrong-scope stored process reconnect = %#v", wrongScope)
	}

	terminalRuntime := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "pty:" + terminalID,
	}))
	if terminalRuntime["status"] != "orphaned" {
		t.Fatalf("stored terminal runtime after startup = %#v", terminalRuntime)
	}
	terminalReconnect := resultObject(t, harness.request(t, "openade/task/terminal/reconnect", map[string]any{
		"repoId":     "repo-durable-output",
		"taskId":     "task-durable-output",
		"terminalId": terminalID,
	}))
	if terminalReconnect["found"] != true || terminalReconnect["exited"] != true || terminalReconnect["outputCount"] != float64(1) {
		t.Fatalf("stored terminal reconnect = %#v", terminalReconnect)
	}
	terminalOutput := arrayField(t, terminalReconnect, "output")
	if objectValue(t, terminalOutput[0])["data"] != "durable terminal\n" {
		t.Fatalf("stored terminal output = %#v", terminalOutput)
	}
}

func TestProductProjectProcessLifecycleOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	projectDir := t.TempDir()
	writeFile(t, filepath.Join(projectDir, "openade.toml"), []byte(`[[process]]
name = "Echo"
command = "printf \"$OPENADE_CORE_PROCESS_ENV_TEST\""
type = "task"

[[process]]
name = "Sleeper"
command = "sleep 30"
type = "daemon"
`))
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-process-lifecycle",
		Name:      "Process Lifecycle Repo",
		Path:      projectDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert process lifecycle repo: %v", err)
	}
	resultObject(t, harness.request(t, "openade/settings/personal/replace", map[string]any{
		"settings": map[string]any{
			"envVars": map[string]any{"OPENADE_CORE_PROCESS_ENV_TEST": "process-env-from-core"},
		},
		"clientRequestId": "process-env-settings",
	}))

	notificationStart := len(harness.notifications)
	started := resultObject(t, harness.request(t, "openade/project/process/start", map[string]any{
		"repoId":          "repo-process-lifecycle",
		"definitionId":    "openade.toml::Echo",
		"timeoutMs":       5000,
		"clientRequestId": "start-echo",
	}))
	processID, ok := started["processId"].(string)
	if !ok || processID == "" || started["repoId"] != "repo-process-lifecycle" || started["definitionId"] != "openade.toml::Echo" || started["runtimeId"] != "process:"+processID {
		t.Fatalf("started process = %#v", started)
	}
	runtimeCreated := harness.waitForRuntimeNotification(t, notificationStart, "runtime/created", "process:"+processID)
	runtimeCreatedParams := objectField(t, runtimeCreated, "params")
	if runtimeCreatedParams["status"] != "running" || runtimeCreatedParams["nativeId"] != processID || runtimeCreatedParams["processLabel"] != `printf "$OPENADE_CORE_PROCESS_ENV_TEST"` {
		t.Fatalf("runtime created notification = %#v", runtimeCreated)
	}
	startedNotification := harness.waitForProcessNotification(t, notificationStart, "process/started", processID)
	startedParams := objectField(t, startedNotification, "params")
	if startedParams["runtimeId"] != "process:"+processID || startedParams["cwd"] != projectDir || startedParams["label"] != `printf "$OPENADE_CORE_PROCESS_ENV_TEST"` {
		t.Fatalf("process started notification = %#v", startedNotification)
	}
	retried := resultObject(t, harness.request(t, "openade/project/process/start", map[string]any{
		"repoId":          "repo-process-lifecycle",
		"definitionId":    "openade.toml::Sleeper",
		"clientRequestId": "start-echo",
	}))
	if retried["processId"] != processID {
		t.Fatalf("idempotent process start retry = %#v", retried)
	}
	reconnect := waitForProjectProcessOutput(t, harness, "repo-process-lifecycle", "", processID, "process-env-from-core", true)
	if reconnect["found"] != true || reconnect["completed"] != true || reconnect["exitCode"] != float64(0) {
		t.Fatalf("completed process reconnect = %#v", reconnect)
	}
	persistedOutput, err := harness.store.ListRuntimeOutputChunks(ctx, "process:"+processID, runtimeOutputReadLimit)
	if err != nil {
		t.Fatalf("list persisted process output: %v", err)
	}
	if len(persistedOutput) != 1 || persistedOutput[0].Stream != "stdout" || persistedOutput[0].Data != "process-env-from-core" {
		t.Fatalf("persisted process output = %#v", persistedOutput)
	}
	runtimeCompleted := harness.waitForRuntimeNotification(t, notificationStart, "runtime/completed", "process:"+processID)
	runtimeCompletedParams := objectField(t, runtimeCompleted, "params")
	if runtimeCompletedParams["status"] != "completed" || runtimeCompletedParams["exitCode"] != float64(0) {
		t.Fatalf("runtime completed notification = %#v", runtimeCompleted)
	}
	runtimeRead := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:" + processID,
	}))
	if runtimeRead["runtimeId"] != "process:"+processID || runtimeRead["kind"] != "process" || runtimeRead["status"] != "completed" || runtimeRead["nativeId"] != processID || runtimeRead["processLabel"] != `printf "$OPENADE_CORE_PROCESS_ENV_TEST"` || runtimeRead["exitCode"] != float64(0) {
		t.Fatalf("runtime read after process completion = %#v", runtimeRead)
	}
	runtimeScope := objectField(t, runtimeRead, "scope")
	if runtimeScope["ownerType"] != "process" || runtimeScope["ownerId"] != processID || runtimeScope["rootPath"] != projectDir {
		t.Fatalf("runtime scope after process completion = %#v", runtimeScope)
	}
	runtimeList := resultArray(t, harness.request(t, "runtime/list", map[string]any{
		"ownerType": "process",
		"ownerId":   processID,
	}))
	if len(runtimeList) != 1 || objectValue(t, runtimeList[0])["runtimeId"] != "process:"+processID {
		t.Fatalf("runtime list after process completion = %#v", runtimeList)
	}
	reconciled := resultObject(t, harness.request(t, "runtime/reconcile", map[string]any{
		"runtimeId": "process:" + processID,
	}))
	if reconciled["state"] != "completed" || objectField(t, reconciled, "runtime")["runtimeId"] != "process:"+processID {
		t.Fatalf("runtime reconcile after process completion = %#v", reconciled)
	}
	outputNotification := harness.waitForProcessNotification(t, notificationStart, "process/output", processID)
	outputChunk := objectField(t, objectField(t, outputNotification, "params"), "chunk")
	if outputChunk["type"] != "stdout" || outputChunk["data"] != "process-env-from-core" {
		t.Fatalf("process output notification = %#v", outputNotification)
	}
	exitNotification := harness.waitForProcessNotification(t, notificationStart, "process/exit", processID)
	exitParams := objectField(t, exitNotification, "params")
	if exitParams["exitCode"] != float64(0) || exitParams["signal"] != nil {
		t.Fatalf("process exit notification = %#v", exitNotification)
	}
	listAfterComplete := resultObject(t, harness.request(t, "openade/project/process/list", map[string]any{
		"repoId": "repo-process-lifecycle",
	}))
	completedInstances := arrayField(t, listAfterComplete, "instances")
	if len(completedInstances) != 1 {
		t.Fatalf("completed process instances = %#v", completedInstances)
	}
	completedInstance := objectValue(t, completedInstances[0])
	if completedInstance["processId"] != processID || completedInstance["definitionId"] != "openade.toml::Echo" || completedInstance["cwd"] != projectDir || completedInstance["completed"] != true {
		t.Fatalf("completed process instance = %#v", completedInstance)
	}
	wrongScope := resultObject(t, harness.request(t, "openade/project/process/reconnect", map[string]any{
		"repoId":    "repo-process-lifecycle",
		"taskId":    "task-other",
		"processId": processID,
	}))
	if wrongScope["found"] != false {
		t.Fatalf("wrong scope reconnect = %#v", wrongScope)
	}

	sleeperNotificationStart := len(harness.notifications)
	sleeper := resultObject(t, harness.request(t, "openade/project/process/start", map[string]any{
		"repoId":       "repo-process-lifecycle",
		"definitionId": "openade.toml::Sleeper",
		"timeoutMs":    30000,
	}))
	sleeperID, ok := sleeper["processId"].(string)
	if !ok || sleeperID == "" {
		t.Fatalf("sleeper start = %#v", sleeper)
	}
	listWhileRunning := resultObject(t, harness.request(t, "openade/project/process/list", map[string]any{
		"repoId": "repo-process-lifecycle",
	}))
	runningInstances := instancesByProcessID(arrayField(t, listWhileRunning, "instances"))
	if runningInstances[sleeperID] == nil || runningInstances[sleeperID]["completed"] != false {
		t.Fatalf("running process instances = %#v", runningInstances)
	}
	runtimeStopped := resultObject(t, harness.request(t, "runtime/stop", map[string]any{
		"runtimeId": "process:" + sleeperID,
		"reason":    "test stop",
	}))
	if runtimeStopped["runtimeId"] != "process:"+sleeperID || runtimeStopped["status"] != "stopped" || runtimeStopped["error"] != "test stop" || runtimeStopped["signal"] != "stopped" {
		t.Fatalf("runtime stop process = %#v", runtimeStopped)
	}
	runtimeStoppedNotification := harness.waitForRuntimeNotification(t, sleeperNotificationStart, "runtime/stopped", "process:"+sleeperID)
	runtimeStoppedParams := objectField(t, runtimeStoppedNotification, "params")
	if runtimeStoppedParams["status"] != "stopped" || runtimeStoppedParams["error"] != "test stop" || runtimeStoppedParams["signal"] != "stopped" {
		t.Fatalf("runtime stopped notification = %#v", runtimeStoppedNotification)
	}
	stoppedNotification := harness.waitForProcessNotification(t, sleeperNotificationStart, "process/exit", sleeperID)
	stoppedParams := objectField(t, stoppedNotification, "params")
	if stoppedParams["signal"] != "stopped" || stoppedParams["exitCode"] != nil {
		t.Fatalf("stopped process exit notification = %#v", stoppedNotification)
	}
	afterRuntimeStop := resultObject(t, harness.request(t, "openade/project/process/reconnect", map[string]any{
		"repoId":    "repo-process-lifecycle",
		"processId": sleeperID,
	}))
	if afterRuntimeStop["found"] != false {
		t.Fatalf("runtime-stopped process reconnect = %#v", afterRuntimeStop)
	}

	stopViaProduct := resultObject(t, harness.request(t, "openade/project/process/start", map[string]any{
		"repoId":       "repo-process-lifecycle",
		"definitionId": "openade.toml::Sleeper",
		"timeoutMs":    30000,
	}))
	stopViaProductID, ok := stopViaProduct["processId"].(string)
	if !ok || stopViaProductID == "" {
		t.Fatalf("start product-stopped sleeper = %#v", stopViaProduct)
	}
	stopped := resultObject(t, harness.request(t, "openade/project/process/stop", map[string]any{
		"repoId":          "repo-process-lifecycle",
		"processId":       stopViaProductID,
		"clientRequestId": "stop-sleeper",
	}))
	if stopped["ok"] != true {
		t.Fatalf("process stop = %#v", stopped)
	}
	stoppedRetry := resultObject(t, harness.request(t, "openade/project/process/stop", map[string]any{
		"repoId":          "repo-process-lifecycle",
		"processId":       stopViaProductID,
		"clientRequestId": "stop-sleeper",
	}))
	if stoppedRetry["ok"] != true {
		t.Fatalf("idempotent process stop retry = %#v", stoppedRetry)
	}
	afterStop := resultObject(t, harness.request(t, "openade/project/process/reconnect", map[string]any{
		"repoId":    "repo-process-lifecycle",
		"processId": stopViaProductID,
	}))
	if afterStop["found"] != false {
		t.Fatalf("stopped process reconnect = %#v", afterStop)
	}
	invalidDefinition := harness.request(t, "openade/project/process/start", map[string]any{
		"repoId":       "repo-process-lifecycle",
		"definitionId": "openade.toml::Missing",
	})
	if runtimeErrorCode(t, invalidDefinition) != "invalid_params" {
		t.Fatalf("invalid process definition response = %#v", invalidDefinition)
	}
}

func TestProductProjectProcessLifecycleTaskScopeOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot, _, _ := createGitHistoryRepo(t)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-process-worktree-lifecycle",
		Name:      "Process Worktree Lifecycle Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert process worktree lifecycle repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-process-worktree-lifecycle",
		RepoID:        "repo-process-worktree-lifecycle",
		Slug:          "task-process-worktree-lifecycle",
		Title:         "Worktree process lifecycle task",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert process worktree lifecycle task: %v", err)
	}

	prepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId": "repo-process-worktree-lifecycle",
		"taskId": "task-process-worktree-lifecycle",
	}))
	worktreeRoot, ok := prepared["rootPath"].(string)
	if !ok || worktreeRoot == "" {
		t.Fatalf("prepared worktree root = %#v", prepared)
	}
	writeFile(t, filepath.Join(worktreeRoot, "openade.toml"), []byte(`[[process]]
name = "WorktreeEcho"
command = "printf worktree-process-ok > process-output.txt; printf worktree-process-ok"
type = "task"
`))

	started := resultObject(t, harness.request(t, "openade/project/process/start", map[string]any{
		"repoId":       "repo-process-worktree-lifecycle",
		"taskId":       "task-process-worktree-lifecycle",
		"definitionId": "openade.toml::WorktreeEcho",
		"timeoutMs":    5000,
	}))
	processID, ok := started["processId"].(string)
	if !ok || processID == "" || started["taskId"] != "task-process-worktree-lifecycle" {
		t.Fatalf("worktree process start = %#v", started)
	}
	reconnect := waitForProjectProcessOutput(t, harness, "repo-process-worktree-lifecycle", "task-process-worktree-lifecycle", processID, "worktree-process-ok", true)
	if reconnect["exitCode"] != float64(0) {
		t.Fatalf("worktree process reconnect = %#v", reconnect)
	}
	if _, err := os.Stat(filepath.Join(worktreeRoot, "process-output.txt")); err != nil {
		t.Fatalf("worktree process output file missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repoRoot, "process-output.txt")); !os.IsNotExist(err) {
		t.Fatalf("worktree process wrote into repo root: %v", err)
	}
}

func TestProductCommentMutationsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)
	notificationStart := len(harness.notifications)

	created := resultObject(t, harness.request(t, "openade/comment/create", map[string]any{
		"taskId":  "task-1",
		"content": "Runtime comment",
		"source":  map[string]any{"type": "task"},
		"selectedText": map[string]any{
			"text":        "Runtime",
			"linesBefore": "",
			"linesAfter":  "",
		},
		"author": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"commentId": "comment-runtime",
		"createdAt": "2026-06-05T12:08:00Z",
	}))
	if created["commentId"] != "comment-runtime" || created["createdAt"] != "2026-06-05T12:08:00Z" {
		t.Fatalf("created comment = %#v", created)
	}
	harness.waitForNotifications(t, notificationStart, 1)

	edited := resultObject(t, harness.request(t, "openade/comment/edit", map[string]any{
		"taskId":    "task-1",
		"commentId": "comment-runtime",
		"content":   "Edited runtime comment",
		"updatedAt": "2026-06-05T12:09:00Z",
	}))
	if edited["ok"] != true {
		t.Fatalf("edited comment result = %#v", edited)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-1",
		"taskId": "task-1",
	}))
	comments := arrayField(t, task, "comments")
	if len(comments) != 2 {
		t.Fatalf("comments after create/edit = %#v", comments)
	}
	createdComment := objectValue(t, comments[1])
	if createdComment["body"] != "Edited runtime comment" || createdComment["content"] != "Edited runtime comment" {
		t.Fatalf("edited comment = %#v", createdComment)
	}
	anchor := objectField(t, createdComment, "anchor")
	if objectField(t, anchor, "source")["type"] != "task" || objectField(t, createdComment, "source")["type"] != "task" {
		t.Fatalf("comment anchor = %#v", anchor)
	}
	if objectField(t, createdComment, "selectedText")["text"] != "Runtime" || objectField(t, createdComment, "author")["email"] != "user@example.com" {
		t.Fatalf("comment compatibility fields = %#v", createdComment)
	}

	deleted := resultObject(t, harness.request(t, "openade/comment/delete", map[string]any{
		"taskId":    "task-1",
		"commentId": "comment-runtime",
		"updatedAt": "2026-06-05T12:10:00Z",
	}))
	if deleted["ok"] != true {
		t.Fatalf("deleted comment result = %#v", deleted)
	}
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-1",
		"taskId": "task-1",
	}))
	comments = arrayField(t, task, "comments")
	if len(comments) != 1 {
		t.Fatalf("comments after delete = %#v", comments)
	}

	missing := harness.request(t, "openade/comment/delete", map[string]any{
		"taskId":    "task-1",
		"commentId": "missing",
	})
	if runtimeErrorCode(t, missing) != "not_found" {
		t.Fatalf("missing comment delete = %#v", missing)
	}
}

func TestProductQueuedTurnEnqueueAndReorderOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	createdAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-queue",
		Name:      "Queue Repo",
		Path:      "/tmp/queue",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert queue repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:        "task-1",
		RepoID:    "repo-queue",
		Slug:      "task-1",
		Title:     "Queue task",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert queue task: %v", err)
	}

	notificationStart := len(harness.notifications)
	first := resultObject(t, harness.request(t, "openade/queued-turn/enqueue", map[string]any{
		"repoId":              "repo-queue",
		"taskId":              "task-1",
		"type":                "ask",
		"input":               "What should happen next?",
		"createdAt":           "2026-06-05T12:00:00Z",
		"eventId":             "event-next",
		"appendSystemPrompt":  "Answer briefly",
		"enabledMcpServerIds": []string{"server-1"},
		"harnessId":           "codex",
		"modelId":             "gpt-test",
		"label":               "Ask",
		"includeComments":     true,
		"images":              []any{map[string]any{"id": "image-1", "ext": "png"}},
		"thinking":            "high",
		"fastMode":            true,
		"clientRequestId":     "request-1",
	}))
	if first["taskId"] != "task-1" || first["queuedTurnId"] != "queued-057f079903fcd046085c8e8b9e" || first["queued"] != true {
		t.Fatalf("enqueue queued turn result = %#v", first)
	}
	firstTurn := objectField(t, first, "turn")
	if firstTurn["id"] != "queued-057f079903fcd046085c8e8b9e" || firstTurn["clientRequestId"] != "request-1" || firstTurn["input"] != "What should happen next?" || firstTurn["thinking"] != "high" || firstTurn["fastMode"] != true {
		t.Fatalf("enqueue queued turn dto = %#v", firstTurn)
	}
	if len(arrayField(t, firstTurn, "images")) != 1 {
		t.Fatalf("enqueue queued turn images = %#v", firstTurn)
	}
	notifications := harness.waitForNotifications(t, notificationStart, 2)
	seen := map[string]bool{}
	for _, notification := range notifications {
		method := notification["method"].(string)
		seen[method] = true
		params := objectField(t, notification, "params")
		if params["repoId"] != "repo-queue" || params["taskId"] != "task-1" {
			t.Fatalf("enqueue notification params = %#v", params)
		}
	}
	if !seen["openade/task/updated"] || !seen["openade/queuedTurn/updated"] {
		t.Fatalf("enqueue notifications = %#v", notifications)
	}

	retried := resultObject(t, harness.request(t, "openade/queued-turn/enqueue", map[string]any{
		"repoId":          "repo-queue",
		"taskId":          "task-1",
		"type":            "do",
		"input":           "Should not overwrite",
		"clientRequestId": "request-1",
	}))
	retriedTurn := objectField(t, retried, "turn")
	if retried["queuedTurnId"] != first["queuedTurnId"] || retriedTurn["type"] != "ask" || retriedTurn["input"] != "What should happen next?" {
		t.Fatalf("enqueue retry overwrote queued turn = %#v", retried)
	}

	second := resultObject(t, harness.request(t, "openade/queued-turn/enqueue", map[string]any{
		"repoId":       "repo-queue",
		"taskId":       "task-1",
		"queuedTurnId": "queued-second",
		"type":         "do",
		"input":        "Second turn",
		"createdAt":    "2026-06-05T12:01:00Z",
	}))
	if second["queuedTurnId"] != "queued-second" {
		t.Fatalf("second enqueue result = %#v", second)
	}

	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-queue",
		"taskId": "task-1",
	}))
	queuedTurns := arrayField(t, task, "queuedTurns")
	if len(queuedTurns) != 2 || objectValue(t, queuedTurns[0])["id"] != "queued-057f079903fcd046085c8e8b9e" || objectValue(t, queuedTurns[1])["id"] != "queued-second" {
		t.Fatalf("queued turns before reorder = %#v", queuedTurns)
	}

	reorderStart := len(harness.notifications)
	reordered := resultObject(t, harness.request(t, "openade/queued-turn/reorder", map[string]any{
		"repoId":        "repo-queue",
		"taskId":        "task-1",
		"queuedTurnIds": []string{"queued-second", "queued-057f079903fcd046085c8e8b9e"},
		"updatedAt":     "2026-06-05T12:02:00Z",
	}))
	if reordered["taskId"] != "task-1" || reordered["reordered"] != true {
		t.Fatalf("reorder result = %#v", reordered)
	}
	reorderedTurns := arrayField(t, reordered, "turns")
	if len(reorderedTurns) != 2 || objectValue(t, reorderedTurns[0])["id"] != "queued-second" || objectValue(t, reorderedTurns[1])["id"] != "queued-057f079903fcd046085c8e8b9e" {
		t.Fatalf("reordered turns = %#v", reorderedTurns)
	}
	reorderNotifications := harness.waitForNotifications(t, reorderStart, 3)
	reorderSeen := map[string]int{}
	for _, notification := range reorderNotifications {
		reorderSeen[notification["method"].(string)]++
	}
	if reorderSeen["openade/task/updated"] != 1 || reorderSeen["openade/queuedTurn/updated"] != 2 {
		t.Fatalf("reorder notifications = %#v", reorderNotifications)
	}
	task = resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-queue",
		"taskId": "task-1",
	}))
	queuedTurns = arrayField(t, task, "queuedTurns")
	if objectValue(t, queuedTurns[0])["id"] != "queued-second" || objectValue(t, queuedTurns[1])["id"] != "queued-057f079903fcd046085c8e8b9e" {
		t.Fatalf("queued turns after reorder = %#v", queuedTurns)
	}

	duplicate := harness.request(t, "openade/queued-turn/reorder", map[string]any{
		"repoId":        "repo-queue",
		"taskId":        "task-1",
		"queuedTurnIds": []string{"queued-second", "queued-second"},
	})
	if runtimeErrorCode(t, duplicate) != "invalid_params" {
		t.Fatalf("duplicate reorder response = %#v", duplicate)
	}
	invalidThinking := harness.request(t, "openade/queued-turn/enqueue", map[string]any{
		"repoId":   "repo-queue",
		"taskId":   "task-1",
		"type":     "ask",
		"input":    "Invalid thinking",
		"thinking": "very",
	})
	if runtimeErrorCode(t, invalidThinking) != "invalid_params" {
		t.Fatalf("invalid thinking enqueue = %#v", invalidThinking)
	}
}

func TestProductQueuedTurnCancelOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)

	notificationStart := len(harness.notifications)
	cancelled := resultObject(t, harness.request(t, "openade/queued-turn/cancel", map[string]any{
		"repoId":          "repo-1",
		"taskId":          "task-1",
		"queuedTurnId":    "queued-1",
		"updatedAt":       "2026-06-05T12:20:00Z",
		"clientRequestId": "cancel-queued-1",
	}))
	if cancelled["taskId"] != "task-1" || cancelled["queuedTurnId"] != "queued-1" || cancelled["cancelled"] != true {
		t.Fatalf("cancel queued turn result = %#v", cancelled)
	}
	notifications := harness.waitForNotifications(t, notificationStart, 2)
	seen := map[string]bool{}
	for _, notification := range notifications {
		method := notification["method"].(string)
		seen[method] = true
		params := objectField(t, notification, "params")
		if params["repoId"] != "repo-1" || params["taskId"] != "task-1" {
			t.Fatalf("queued turn notification params = %#v", params)
		}
		if method == "openade/queuedTurn/updated" {
			turn := objectField(t, params, "turn")
			if turn["id"] != "queued-1" || turn["status"] != "cancelled" || turn["updatedAt"] != "2026-06-05T12:20:00Z" {
				t.Fatalf("queued turn updated notification = %#v", turn)
			}
		}
	}
	if !seen["openade/task/updated"] || !seen["openade/queuedTurn/updated"] {
		t.Fatalf("queued turn cancel notifications = %#v", notifications)
	}

	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": "repo-1",
		"taskId": "task-1",
	}))
	queuedTurn := objectValue(t, arrayField(t, task, "queuedTurns")[0])
	if queuedTurn["status"] != "cancelled" || queuedTurn["updatedAt"] != "2026-06-05T12:20:00Z" {
		t.Fatalf("task queued turn after cancel = %#v", queuedTurn)
	}

	retried := resultObject(t, harness.request(t, "openade/queued-turn/cancel", map[string]any{
		"repoId":          "repo-1",
		"taskId":          "task-1",
		"queuedTurnId":    "queued-1",
		"updatedAt":       "2026-06-05T12:21:00Z",
		"clientRequestId": "cancel-queued-1",
	}))
	if retried["cancelled"] != true {
		t.Fatalf("idempotent queued turn cancel retry = %#v", retried)
	}

	again := resultObject(t, harness.request(t, "openade/queued-turn/cancel", map[string]any{
		"repoId":       "repo-1",
		"taskId":       "task-1",
		"queuedTurnId": "queued-1",
	}))
	if again["cancelled"] != false {
		t.Fatalf("already cancelled queued turn result = %#v", again)
	}

	missing := resultObject(t, harness.request(t, "openade/queued-turn/cancel", map[string]any{
		"repoId":       "repo-1",
		"taskId":       "task-1",
		"queuedTurnId": "missing",
	}))
	if missing["cancelled"] != false {
		t.Fatalf("missing queued turn result = %#v", missing)
	}
}

func TestProductTaskDeleteOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	seedProductData(t, harness.store)

	notificationStart := len(harness.notifications)
	deleted := resultObject(t, harness.request(t, "openade/task/delete", map[string]any{
		"repoId": "repo-1",
		"taskId": "task-1",
	}))
	if deleted["repoId"] != "repo-1" || deleted["taskId"] != "task-1" || deleted["deleted"] != true {
		t.Fatalf("deleted task = %#v", deleted)
	}
	notifications := harness.waitForNotifications(t, notificationStart, 3)
	seen := map[string]bool{}
	for _, notification := range notifications {
		seen[notification["method"].(string)] = true
	}
	if !seen["openade/task/deleted"] || !seen["openade/task/previewChanged"] || !seen["openade/snapshotChanged"] {
		t.Fatalf("task delete notifications = %#v", notifications)
	}
	previews := resultArray(t, harness.request(t, "openade/task/list", map[string]any{"repoId": "repo-1"}))
	if len(previews) != 0 {
		t.Fatalf("previews after task delete = %#v", previews)
	}
	missingRead := harness.request(t, "openade/task/read", map[string]any{"repoId": "repo-1", "taskId": "task-1"})
	if runtimeErrorCode(t, missingRead) != "not_found" {
		t.Fatalf("deleted task read = %#v", missingRead)
	}
}

func TestProductTaskDeleteCleansHarnessSessionsOverRuntime(t *testing.T) {
	claudeHome := t.TempDir()
	codexHome := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", claudeHome)
	t.Setenv("CODEX_HOME", codexHome)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	repoRoot := t.TempDir()
	now := time.Date(2026, 6, 8, 15, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-delete-sessions",
		Name:      "Delete Sessions Repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert session cleanup repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-delete-sessions",
		RepoID:        "repo-delete-sessions",
		Slug:          "task-delete-sessions",
		Title:         "Delete sessions",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		MetadataJSON:  sql.NullString{String: `{"sessionIds":{"main":"claude-metadata-session"}}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert session cleanup task: %v", err)
	}
	codexSessionID := "11111111-1111-1111-1111-111111111111"
	if err := harness.store.UpsertTaskEvent(ctx, storage.TaskEvent{
		ID:        "event-delete-session",
		TaskID:    "task-delete-sessions",
		Seq:       1,
		Type:      "action",
		CreatedAt: now,
		PayloadJSON: sql.NullString{
			String: fmt.Sprintf(`{"id":"event-delete-session","type":"action","status":"completed","execution":{"harnessId":"codex","sessionId":%q},"hyperplanSubExecutions":[{"harnessId":"claude-code","sessionId":"claude-sub-session"}]}`, codexSessionID),
			Valid:  true,
		},
	}); err != nil {
		t.Fatalf("upsert session cleanup event: %v", err)
	}

	encodedRepoPath := strings.NewReplacer("/", "-", "\\", "-").Replace(repoRoot)
	claudeProjectDir := filepath.Join(claudeHome, "projects", encodedRepoPath)
	mkdirAll(t, claudeProjectDir)
	claudeMetadataFile := filepath.Join(claudeProjectDir, "claude-metadata-session.jsonl")
	claudeSubFile := filepath.Join(claudeProjectDir, "claude-sub-session.jsonl")
	claudeKeepFile := filepath.Join(claudeProjectDir, "claude-keep-session.jsonl")
	writeFile(t, claudeMetadataFile, []byte("{}\n"))
	writeFile(t, claudeSubFile, []byte("{}\n"))
	writeFile(t, claudeKeepFile, []byte("{}\n"))
	mkdirAll(t, strings.TrimSuffix(claudeMetadataFile, ".jsonl"))
	writeFile(t, filepath.Join(strings.TrimSuffix(claudeMetadataFile, ".jsonl"), "subagent.jsonl"), []byte("{}\n"))
	mkdirAll(t, filepath.Join(claudeHome, "debug"))
	claudeDebugLog := filepath.Join(claudeHome, "debug", "claude-metadata-session.txt")
	writeFile(t, claudeDebugLog, []byte("debug\n"))

	codexSessionFile := filepath.Join(codexHome, "sessions", "2026", "06", "08", "rollout-2026-06-08T15-00-00-"+codexSessionID+".jsonl")
	codexArchivedFile := filepath.Join(codexHome, "archived_sessions", codexSessionID+".jsonl")
	codexKeepFile := filepath.Join(codexHome, "sessions", "2026", "06", "08", "rollout-2026-06-08T15-00-00-22222222-2222-2222-2222-222222222222.jsonl")
	mkdirAll(t, filepath.Dir(codexSessionFile))
	mkdirAll(t, filepath.Dir(codexArchivedFile))
	writeFile(t, codexSessionFile, []byte("{}\n"))
	writeFile(t, codexArchivedFile, []byte("{}\n"))
	writeFile(t, codexKeepFile, []byte("{}\n"))

	deleted := resultObject(t, harness.request(t, "openade/task/delete", map[string]any{
		"repoId": "repo-delete-sessions",
		"taskId": "task-delete-sessions",
		"options": map[string]any{
			"deleteSessions": true,
		},
	}))
	if deleted["deleted"] != true {
		t.Fatalf("deleted task with sessions = %#v", deleted)
	}
	assertPathMissing(t, claudeMetadataFile)
	assertPathMissing(t, strings.TrimSuffix(claudeMetadataFile, ".jsonl"))
	assertPathMissing(t, claudeSubFile)
	assertPathMissing(t, claudeDebugLog)
	assertPathMissing(t, codexSessionFile)
	assertPathMissing(t, codexArchivedFile)
	assertPathExists(t, claudeKeepFile)
	assertPathExists(t, codexKeepFile)
}

func TestProductTaskDeleteCleansSnapshotAndImageBlobsOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 11, 30, 0, 0, time.UTC)
	repoRoot := t.TempDir()
	blobRoot := t.TempDir()
	ownedImagePath := filepath.Join(blobRoot, "image-owned.png")
	queuedImagePath := filepath.Join(blobRoot, "image-queued.webp")
	sharedImagePath := filepath.Join(blobRoot, "image-shared.png")
	ownedPatchPath := filepath.Join(blobRoot, "patch-owned.patch")
	sharedPatchPath := filepath.Join(blobRoot, "patch-shared.patch")
	writeFile(t, ownedImagePath, []byte("owned image"))
	writeFile(t, queuedImagePath, []byte("queued image"))
	writeFile(t, sharedImagePath, []byte("shared image"))
	writeFile(t, ownedPatchPath, []byte("owned patch"))
	writeFile(t, sharedPatchPath, []byte("shared patch"))

	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-delete-cleanup",
		Name:      "Delete cleanup repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert delete cleanup repo: %v", err)
	}
	for _, task := range []storage.Task{
		{ID: "task-delete-cleanup", RepoID: "repo-delete-cleanup", Slug: "task-delete-cleanup", Title: "Delete cleanup", CreatedAt: now, UpdatedAt: now},
		{ID: "task-shared-cleanup", RepoID: "repo-delete-cleanup", Slug: "task-shared-cleanup", Title: "Shared cleanup", CreatedAt: now, UpdatedAt: now},
	} {
		if err := harness.store.UpsertTask(ctx, task); err != nil {
			t.Fatalf("upsert task %s: %v", task.ID, err)
		}
	}
	for _, event := range []storage.TaskEvent{
		{
			ID:          "action-delete-cleanup",
			TaskID:      "task-delete-cleanup",
			Seq:         1,
			Type:        "action",
			CreatedAt:   now,
			PayloadJSON: sql.NullString{String: `{"id":"action-delete-cleanup","type":"action","images":[{"id":"image-delete-owned","ext":"png","mediaType":"image/png"},{"id":"image-delete-shared","ext":"png","mediaType":"image/png"}]}`, Valid: true},
		},
		{
			ID:          "snapshot-delete-owned",
			TaskID:      "task-delete-cleanup",
			Seq:         2,
			Type:        "snapshot",
			CreatedAt:   now.Add(time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-delete-owned","type":"snapshot","patchFileId":"patch-delete-owned"}`, Valid: true},
		},
		{
			ID:          "snapshot-delete-shared",
			TaskID:      "task-delete-cleanup",
			Seq:         3,
			Type:        "snapshot",
			CreatedAt:   now.Add(2 * time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-delete-shared","type":"snapshot","patchFileId":"patch-delete-shared"}`, Valid: true},
		},
		{
			ID:          "action-shared-cleanup",
			TaskID:      "task-shared-cleanup",
			Seq:         1,
			Type:        "action",
			CreatedAt:   now,
			PayloadJSON: sql.NullString{String: `{"id":"action-shared-cleanup","type":"action","images":[{"id":"image-delete-shared","ext":"png","mediaType":"image/png"}]}`, Valid: true},
		},
		{
			ID:          "snapshot-shared-cleanup",
			TaskID:      "task-shared-cleanup",
			Seq:         2,
			Type:        "snapshot",
			CreatedAt:   now.Add(time.Second),
			PayloadJSON: sql.NullString{String: `{"id":"snapshot-shared-cleanup","type":"snapshot","patchFileId":"patch-delete-shared"}`, Valid: true},
		},
	} {
		if err := harness.store.UpsertTaskEvent(ctx, event); err != nil {
			t.Fatalf("upsert cleanup event %s: %v", event.ID, err)
		}
	}
	if err := harness.store.UpsertQueuedTurn(ctx, storage.QueuedTurn{
		ID:          "queued-delete-cleanup",
		TaskID:      "task-delete-cleanup",
		Type:        "ask",
		Input:       "queued image cleanup",
		Status:      "queued",
		PayloadJSON: sql.NullString{String: `{"images":[{"id":"image-delete-queued","ext":"webp","mediaType":"image/webp"}]}`, Valid: true},
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("upsert cleanup queued turn: %v", err)
	}
	for _, blob := range []storage.BlobMetadata{
		{ID: "image-delete-owned", Kind: "task_image", ContentType: sql.NullString{String: "image/png", Valid: true}, SizeBytes: int64(len([]byte("owned image"))), SHA256: "sha-owned-image", Path: ownedImagePath, CreatedAt: now},
		{ID: "image-delete-queued", Kind: "task_image", ContentType: sql.NullString{String: "image/webp", Valid: true}, SizeBytes: int64(len([]byte("queued image"))), SHA256: "sha-queued-image", Path: queuedImagePath, CreatedAt: now},
		{ID: "image-delete-shared", Kind: "task_image", ContentType: sql.NullString{String: "image/png", Valid: true}, SizeBytes: int64(len([]byte("shared image"))), SHA256: "sha-shared-image", Path: sharedImagePath, CreatedAt: now},
		{ID: "patch-delete-owned", Kind: "snapshot_patch", ContentType: sql.NullString{String: "text/x-patch", Valid: true}, SizeBytes: int64(len([]byte("owned patch"))), SHA256: "sha-owned-patch", Path: ownedPatchPath, CreatedAt: now},
		{ID: "patch-delete-shared", Kind: "snapshot_patch", ContentType: sql.NullString{String: "text/x-patch", Valid: true}, SizeBytes: int64(len([]byte("shared patch"))), SHA256: "sha-shared-patch", Path: sharedPatchPath, CreatedAt: now},
	} {
		if err := harness.store.PutBlobMetadata(ctx, blob); err != nil {
			t.Fatalf("put cleanup blob %s: %v", blob.ID, err)
		}
	}

	deleted := resultObject(t, harness.request(t, "openade/task/delete", map[string]any{
		"repoId": "repo-delete-cleanup",
		"taskId": "task-delete-cleanup",
		"options": map[string]any{
			"deleteImages":    true,
			"deleteSnapshots": true,
		},
	}))
	if deleted["deleted"] != true {
		t.Fatalf("delete cleanup result = %#v", deleted)
	}
	for _, id := range []string{"image-delete-owned", "image-delete-queued", "patch-delete-owned"} {
		if _, ok, err := harness.store.GetBlobMetadata(ctx, id); err != nil {
			t.Fatalf("get deleted cleanup blob %s: %v", id, err)
		} else if ok {
			t.Fatalf("deleted cleanup blob metadata %s still exists", id)
		}
	}
	for _, path := range []string{ownedImagePath, queuedImagePath, ownedPatchPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("owned cleanup blob file still exists or stat failed %s: %v", path, err)
		}
	}
	for _, id := range []string{"image-delete-shared", "patch-delete-shared"} {
		if _, ok, err := harness.store.GetBlobMetadata(ctx, id); err != nil {
			t.Fatalf("get shared cleanup blob %s: %v", id, err)
		} else if !ok {
			t.Fatalf("shared cleanup blob metadata %s was deleted", id)
		}
	}
	for _, path := range []string{sharedImagePath, sharedPatchPath} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("shared cleanup blob file missing %s: %v", path, err)
		}
	}

	sharedImage := resultObject(t, harness.request(t, "openade/task/image/read", map[string]any{
		"repoId":  "repo-delete-cleanup",
		"taskId":  "task-shared-cleanup",
		"imageId": "image-delete-shared",
		"ext":     "png",
	}))
	if sharedImage["data"] != base64.StdEncoding.EncodeToString([]byte("shared image")) {
		t.Fatalf("shared image after delete = %#v", sharedImage)
	}
	sharedPatch := resultObject(t, harness.request(t, "openade/task/snapshot/patch/read", map[string]any{
		"repoId":  "repo-delete-cleanup",
		"taskId":  "task-shared-cleanup",
		"eventId": "snapshot-shared-cleanup",
	}))
	if sharedPatch["patch"] != "shared patch" {
		t.Fatalf("shared patch after delete = %#v", sharedPatch)
	}
}

func TestProductTaskDeleteCleansCoreWorktreeOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 12, 15, 0, 0, time.UTC)
	repoRoot, _, _ := createGitHistoryRepo(t)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-delete-worktree",
		Name:      "Delete worktree repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert delete worktree repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-delete-worktree",
		RepoID:        "repo-delete-worktree",
		Slug:          "task-delete-worktree",
		Title:         "Delete worktree",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert delete worktree task: %v", err)
	}

	prepared := resultObject(t, harness.request(t, "openade/task/environment/prepare", map[string]any{
		"repoId": "repo-delete-worktree",
		"taskId": "task-delete-worktree",
	}))
	worktreeRoot, ok := prepared["rootPath"].(string)
	if !ok || worktreeRoot == "" || !strings.HasPrefix(worktreeRoot, harness.worktreeBaseDir) {
		t.Fatalf("prepared delete worktree = %#v", prepared)
	}
	writeFile(t, filepath.Join(worktreeRoot, "dirty.txt"), []byte("dirty worktree file\n"))
	if _, err := os.Stat(worktreeRoot); err != nil {
		t.Fatalf("prepared worktree missing before delete: %v", err)
	}
	if worktrees := gitOutput(t, repoRoot, "worktree", "list", "--porcelain"); !strings.Contains(worktrees, worktreeRoot) {
		t.Fatalf("git worktree list missing prepared worktree %q:\n%s", worktreeRoot, worktrees)
	}
	if branch := gitOutput(t, repoRoot, "branch", "--list", "openade/task-delete-worktree"); !strings.Contains(branch, "openade/task-delete-worktree") {
		t.Fatalf("prepared worktree branch = %q", branch)
	}

	deleted := resultObject(t, harness.request(t, "openade/task/delete", map[string]any{
		"repoId": "repo-delete-worktree",
		"taskId": "task-delete-worktree",
		"options": map[string]any{
			"deleteWorktrees": true,
		},
	}))
	if deleted["deleted"] != true {
		t.Fatalf("delete worktree result = %#v", deleted)
	}
	if _, err := os.Stat(worktreeRoot); !os.IsNotExist(err) {
		t.Fatalf("worktree root still exists or stat failed %s: %v", worktreeRoot, err)
	}
	if worktrees := gitOutput(t, repoRoot, "worktree", "list", "--porcelain"); strings.Contains(worktrees, worktreeRoot) {
		t.Fatalf("git worktree list still contains deleted worktree %q:\n%s", worktreeRoot, worktrees)
	}
	if branch := gitOutput(t, repoRoot, "branch", "--list", "openade/task-delete-worktree"); branch != "" {
		t.Fatalf("deleted worktree branch still exists: %q", branch)
	}
	missingRead := harness.request(t, "openade/task/read", map[string]any{"repoId": "repo-delete-worktree", "taskId": "task-delete-worktree"})
	if runtimeErrorCode(t, missingRead) != "not_found" {
		t.Fatalf("deleted worktree task read = %#v", missingRead)
	}
}

func TestProductTaskDeleteCleansImportedRegisteredWorktreeOverRuntime(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 8, 16, 30, 0, 0, time.UTC)
	repoRoot, _, _ := createGitHistoryRepo(t)
	externalBase, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("resolve external worktree base: %v", err)
	}
	externalWorktree := filepath.Join(externalBase, "imported-worktree")
	gitCommand(t, repoRoot, "worktree", "add", "-b", "openade/task-delete-imported-worktree", externalWorktree, "main")
	writeFile(t, filepath.Join(externalWorktree, "dirty.txt"), []byte("dirty imported worktree file\n"))

	if strings.HasPrefix(filepath.Clean(externalWorktree), filepath.Clean(harness.worktreeBaseDir)+string(filepath.Separator)) {
		t.Fatalf("imported worktree unexpectedly under core base: %s", externalWorktree)
	}
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-delete-imported-worktree",
		Name:      "Delete imported worktree repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert imported worktree repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-delete-imported-worktree",
		RepoID:        "repo-delete-imported-worktree",
		Slug:          "task-delete-imported-worktree",
		Title:         "Delete imported worktree",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert imported worktree task: %v", err)
	}
	if _, ok, err := harness.store.SetupTaskEnvironment(ctx, storage.TaskEnvironmentSetup{
		TaskID: "task-delete-imported-worktree",
		DeviceEnvironment: storage.TaskDeviceEnvironment{
			ID:            "device-imported",
			TaskID:        "task-delete-imported-worktree",
			DeviceID:      "device-imported",
			WorktreeDir:   sql.NullString{String: externalWorktree, Valid: true},
			SetupComplete: true,
			CreatedAt:     now,
			LastUsedAt:    now,
		},
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("setup imported worktree environment: %v", err)
	} else if !ok {
		t.Fatal("imported worktree task not found while setting environment")
	}
	if worktrees := gitOutput(t, repoRoot, "worktree", "list", "--porcelain"); !strings.Contains(worktrees, externalWorktree) {
		t.Fatalf("git worktree list missing imported worktree %q:\n%s", externalWorktree, worktrees)
	}

	deleted := resultObject(t, harness.request(t, "openade/task/delete", map[string]any{
		"repoId": "repo-delete-imported-worktree",
		"taskId": "task-delete-imported-worktree",
		"options": map[string]any{
			"deleteWorktrees": true,
		},
	}))
	if deleted["deleted"] != true {
		t.Fatalf("delete imported worktree result = %#v", deleted)
	}
	assertPathMissing(t, externalWorktree)
	if worktrees := gitOutput(t, repoRoot, "worktree", "list", "--porcelain"); strings.Contains(worktrees, externalWorktree) {
		t.Fatalf("git worktree list still contains imported worktree %q:\n%s", externalWorktree, worktrees)
	}
	if branch := gitOutput(t, repoRoot, "branch", "--list", "openade/task-delete-imported-worktree"); branch != "" {
		t.Fatalf("deleted imported worktree branch still exists: %q", branch)
	}
	missingRead := harness.request(t, "openade/task/read", map[string]any{"repoId": "repo-delete-imported-worktree", "taskId": "task-delete-imported-worktree"})
	if runtimeErrorCode(t, missingRead) != "not_found" {
		t.Fatalf("deleted imported worktree task read = %#v", missingRead)
	}
}

func TestProductTaskDeleteRejectsUnsafeWorktreeCleanupPath(t *testing.T) {
	requireGit(t)
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 7, 12, 45, 0, 0, time.UTC)
	repoRoot, _, _ := createGitHistoryRepo(t)
	unsafeWorktree := filepath.Join(t.TempDir(), "outside-core-worktree")
	mkdirAll(t, unsafeWorktree)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-delete-unsafe-worktree",
		Name:      "Delete unsafe worktree repo",
		Path:      repoRoot,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert unsafe worktree repo: %v", err)
	}
	if err := harness.store.UpsertTask(ctx, storage.Task{
		ID:            "task-delete-unsafe-worktree",
		RepoID:        "repo-delete-unsafe-worktree",
		Slug:          "task-delete-unsafe-worktree",
		Title:         "Unsafe worktree cleanup",
		IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("upsert unsafe worktree task: %v", err)
	}
	if _, ok, err := harness.store.SetupTaskEnvironment(ctx, storage.TaskEnvironmentSetup{
		TaskID: "task-delete-unsafe-worktree",
		DeviceEnvironment: storage.TaskDeviceEnvironment{
			ID:            "device-unsafe",
			TaskID:        "task-delete-unsafe-worktree",
			DeviceID:      "device-unsafe",
			WorktreeDir:   sql.NullString{String: unsafeWorktree, Valid: true},
			SetupComplete: true,
			CreatedAt:     now,
			LastUsedAt:    now,
		},
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("setup unsafe worktree environment: %v", err)
	} else if !ok {
		t.Fatal("unsafe worktree task not found while setting environment")
	}

	rejected := harness.request(t, "openade/task/delete", map[string]any{
		"repoId": "repo-delete-unsafe-worktree",
		"taskId": "task-delete-unsafe-worktree",
		"options": map[string]any{
			"deleteWorktrees": true,
		},
	})
	if runtimeErrorCode(t, rejected) != "invalid_params" {
		t.Fatalf("unsafe worktree delete response = %#v", rejected)
	}
	read := resultObject(t, harness.request(t, "openade/task/read", map[string]any{"repoId": "repo-delete-unsafe-worktree", "taskId": "task-delete-unsafe-worktree"}))
	if read["id"] != "task-delete-unsafe-worktree" {
		t.Fatalf("unsafe worktree task should remain = %#v", read)
	}
	if _, err := os.Stat(unsafeWorktree); err != nil {
		t.Fatalf("unsafe worktree path should remain: %v", err)
	}
}

func TestProductMutationsAreIdempotentByClientRequestID(t *testing.T) {
	harness := newRuntimeHarness(t)

	invalid := harness.request(t, "openade/repo/create", map[string]any{
		"name":            "Missing createdBy",
		"path":            "/tmp/missing-created-by",
		"clientRequestId": "repo-create-idempotent",
	})
	if runtimeErrorCode(t, invalid) != "invalid_params" {
		t.Fatalf("invalid repo create = %#v", invalid)
	}

	firstRepo := resultObject(t, harness.request(t, "openade/repo/create", map[string]any{
		"name": "Generated Repo",
		"path": "/tmp/generated",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"clientRequestId": "repo-create-idempotent",
	}))
	secondRepo := resultObject(t, harness.request(t, "openade/repo/create", map[string]any{
		"name": "Generated Repo",
		"path": "/tmp/generated",
		"createdBy": map[string]any{
			"id":    "user-1",
			"email": "user@example.com",
		},
		"clientRequestId": "repo-create-idempotent",
	}))
	if firstRepo["repoId"] == "" || firstRepo["repoId"] != secondRepo["repoId"] {
		t.Fatalf("repo idempotency results = first %#v second %#v", firstRepo, secondRepo)
	}
	projects := resultArray(t, harness.request(t, "openade/project/list", map[string]any{}))
	if len(projects) != 1 {
		t.Fatalf("repo create retry duplicated projects: %#v", projects)
	}

	repoID := firstRepo["repoId"].(string)
	if err := harness.store.UpsertTask(context.Background(), storage.Task{
		ID:        "task-idempotent",
		RepoID:    repoID,
		Slug:      "task-idempotent",
		Title:     "Idempotent task",
		CreatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("upsert idempotent task: %v", err)
	}

	firstComment := resultObject(t, harness.request(t, "openade/comment/create", map[string]any{
		"taskId":          "task-idempotent",
		"content":         "Retry comment",
		"source":          map[string]any{"type": "task"},
		"selectedText":    map[string]any{"text": "", "linesBefore": "", "linesAfter": ""},
		"author":          map[string]any{"id": "user-1", "email": "user@example.com"},
		"clientRequestId": "comment-create-idempotent",
	}))
	secondComment := resultObject(t, harness.request(t, "openade/comment/create", map[string]any{
		"taskId":          "task-idempotent",
		"content":         "Retry comment",
		"source":          map[string]any{"type": "task"},
		"selectedText":    map[string]any{"text": "", "linesBefore": "", "linesAfter": ""},
		"author":          map[string]any{"id": "user-1", "email": "user@example.com"},
		"clientRequestId": "comment-create-idempotent",
	}))
	if firstComment["commentId"] == "" || firstComment["commentId"] != secondComment["commentId"] {
		t.Fatalf("comment idempotency results = first %#v second %#v", firstComment, secondComment)
	}
	task := resultObject(t, harness.request(t, "openade/task/read", map[string]any{
		"repoId": repoID,
		"taskId": "task-idempotent",
	}))
	comments := arrayField(t, task, "comments")
	if len(comments) != 1 {
		t.Fatalf("comment create retry duplicated comments: %#v", comments)
	}

	firstDelete := resultObject(t, harness.request(t, "openade/task/delete", map[string]any{
		"repoId":          repoID,
		"taskId":          "task-idempotent",
		"clientRequestId": "task-delete-idempotent",
	}))
	secondDelete := resultObject(t, harness.request(t, "openade/task/delete", map[string]any{
		"repoId":          repoID,
		"taskId":          "task-idempotent",
		"clientRequestId": "task-delete-idempotent",
	}))
	if firstDelete["deleted"] != true || secondDelete["deleted"] != true {
		t.Fatalf("task delete idempotency results = first %#v second %#v", firstDelete, secondDelete)
	}
}

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is required for project git integration tests")
	}
}

func createProjectFilesFixture(t *testing.T) string {
	t.Helper()
	projectDir := t.TempDir()
	mkdirAll(t, filepath.Join(projectDir, "src"))
	mkdirAll(t, filepath.Join(projectDir, "assets"))
	mkdirAll(t, filepath.Join(projectDir, "node_modules", "pkg"))
	mkdirAll(t, filepath.Join(projectDir, ".git"))
	mkdirAll(t, filepath.Join(projectDir, ".hidden"))
	writeFile(t, filepath.Join(projectDir, "src", "app.ts"), []byte("const value = 'scoped search'\n"))
	writeFile(t, filepath.Join(projectDir, "src", "upper.ts"), []byte("SCOPEd search\n"))
	writeFile(t, filepath.Join(projectDir, "assets", "logo.bin"), []byte{0, 1, 2, 3})
	writeFile(t, filepath.Join(projectDir, "node_modules", "pkg", "index.js"), []byte("scoped search\n"))
	writeFile(t, filepath.Join(projectDir, ".git", "config"), []byte("scoped search\n"))
	writeFile(t, filepath.Join(projectDir, ".hidden", "secret.txt"), []byte("scoped search\n"))
	writeFile(t, filepath.Join(projectDir, ".env"), []byte("VISIBLE_WHEN_INCLUDED=1\n"))
	return projectDir
}

func createProjectProcessesFixture(t *testing.T) string {
	t.Helper()
	projectDir := t.TempDir()
	mkdirAll(t, filepath.Join(projectDir, "packages", "app"))
	mkdirAll(t, filepath.Join(projectDir, "packages", "api"))
	mkdirAll(t, filepath.Join(projectDir, "bad"))
	mkdirAll(t, filepath.Join(projectDir, "invalid"))
	writeFile(t, filepath.Join(projectDir, "openade.toml"), []byte(`[[process]]
name = "Echo"
command = "printf runtime-process"
type = "daemon"
url = "http://localhost:3000"

[[cron]]
name = "Sweep"
schedule = "*/5 * * * *"
type = "ask"
prompt = "check"
append_system_prompt = "extra"
images = ["img-1"]
isolation = "head"
harness = "codex"
in_task_id = "task-1"
reuse_task = false
`))
	writeFile(t, filepath.Join(projectDir, "packages", "app", "openade.toml"), []byte(`[[process]]
name = "Build"
command = "npm run build"
type = "task"
work_dir = "../api"
`))
	writeFile(t, filepath.Join(projectDir, "bad", "openade.toml"), []byte(`[[process]]
name = "Outside"
command = "npm run dev"
work_dir = "../.."
`))
	writeFile(t, filepath.Join(projectDir, "invalid", "openade.toml"), []byte(`[[process]]
name = 123
command = "npm run dev"
`))
	return projectDir
}

func mkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("create directory %s: %v", path, err)
	}
}

func writeFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write file %s: %v", path, err)
	}
}

func assertPathExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected path to exist %s: %v", path, err)
	}
}

func assertPathMissing(t *testing.T, path string) {
	t.Helper()
	_, err := os.Stat(path)
	if err == nil {
		t.Fatalf("expected path to be removed: %s", path)
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat removed path %s: %v", path, err)
	}
}

func sha256String(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func jsonString(value string) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}

func runtimeOutputData(chunks []storage.RuntimeOutputChunk) string {
	var builder strings.Builder
	for _, chunk := range chunks {
		builder.WriteString(chunk.Data)
	}
	return builder.String()
}

func createGitRepo(t *testing.T) string {
	t.Helper()
	repoRoot, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("resolve temp repo path: %v", err)
	}
	gitCommand(t, repoRoot, "init", "-b", "main")
	gitCommand(t, repoRoot, "config", "user.email", "test@example.com")
	gitCommand(t, repoRoot, "config", "user.name", "OpenADE Test")
	if err := os.WriteFile(filepath.Join(repoRoot, "README.md"), []byte("initial\n"), 0o644); err != nil {
		t.Fatalf("write readme: %v", err)
	}
	gitCommand(t, repoRoot, "add", "README.md")
	gitCommand(t, repoRoot, "commit", "-m", "initial")
	gitCommand(t, repoRoot, "branch", "feature")
	if err := os.WriteFile(filepath.Join(repoRoot, "staged.txt"), []byte("staged\n"), 0o644); err != nil {
		t.Fatalf("write staged file: %v", err)
	}
	gitCommand(t, repoRoot, "add", "staged.txt")
	if err := os.WriteFile(filepath.Join(repoRoot, "README.md"), []byte("initial\nchanged\n"), 0o644); err != nil {
		t.Fatalf("modify readme: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, "untracked.txt"), []byte("untracked\n"), 0o644); err != nil {
		t.Fatalf("write untracked file: %v", err)
	}
	return repoRoot
}

func createGitHistoryRepo(t *testing.T) (string, string, string) {
	t.Helper()
	repoRoot, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("resolve temp repo path: %v", err)
	}
	gitCommand(t, repoRoot, "init", "-b", "main")
	gitCommand(t, repoRoot, "config", "user.email", "test@example.com")
	gitCommand(t, repoRoot, "config", "user.name", "OpenADE Test")
	writeFile(t, filepath.Join(repoRoot, "README.md"), []byte("initial\n"))
	gitCommand(t, repoRoot, "add", "README.md")
	gitCommand(t, repoRoot, "commit", "-m", "initial")
	initialCommit := gitOutput(t, repoRoot, "rev-parse", "HEAD")

	mkdirAll(t, filepath.Join(repoRoot, "src"))
	writeFile(t, filepath.Join(repoRoot, "README.md"), []byte("initial\nsecond\n"))
	writeFile(t, filepath.Join(repoRoot, "src", "app.ts"), []byte("export const value = 1\n"))
	gitCommand(t, repoRoot, "add", "README.md", "src/app.ts")
	gitCommand(t, repoRoot, "commit", "-m", "second")
	secondCommit := gitOutput(t, repoRoot, "rev-parse", "HEAD")
	return repoRoot, initialCommit, secondCommit
}

func gitCommand(t *testing.T, cwd string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, output)
	}
}

func gitOutput(t *testing.T, cwd string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %s failed: %v", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(string(output))
}

func treePaths(entries []any) []string {
	paths := make([]string, 0, len(entries))
	for _, item := range entries {
		entry := objectValueNoTest(item)
		if path, ok := entry["path"].(string); ok {
			paths = append(paths, path)
		}
	}
	return paths
}

func waitForProjectProcessOutput(t *testing.T, harness *runtimeHarness, repoID string, taskID string, processID string, expectedOutput string, requireCompleted bool) map[string]any {
	t.Helper()
	var last map[string]any
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		params := map[string]any{
			"repoId":    repoID,
			"processId": processID,
		}
		if taskID != "" {
			params["taskId"] = taskID
		}
		last = resultObject(t, harness.request(t, "openade/project/process/reconnect", params))
		if last["found"] == true && strings.Contains(projectProcessOutputText(arrayField(t, last, "output")), expectedOutput) {
			if !requireCompleted || last["completed"] == true {
				return last
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("process output %q not observed for %s: %#v", expectedOutput, processID, last)
	return nil
}

func projectProcessOutputText(output []any) string {
	var builder strings.Builder
	for _, item := range output {
		chunk := objectValueNoTest(item)
		if data, ok := chunk["data"].(string); ok {
			builder.WriteString(data)
		}
	}
	return builder.String()
}

func taskTerminalIDForTest(repoID string, taskID string) string {
	sum := sha256.Sum256([]byte(repoID + "\x00" + taskID))
	return "openade-task-terminal-" + hex.EncodeToString(sum[:])[:24]
}

func waitForTaskTerminalOutput(t *testing.T, harness *runtimeHarness, repoID string, taskID string, terminalID string, expectedOutput string) string {
	t.Helper()
	var last string
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		reconnected := resultObject(t, harness.request(t, "openade/task/terminal/reconnect", map[string]any{
			"repoId":     repoID,
			"taskId":     taskID,
			"terminalId": terminalID,
		}))
		last = taskTerminalOutputText(arrayField(t, reconnected, "output"))
		if strings.Contains(last, expectedOutput) {
			return last
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("terminal output %q not observed for %s: %q", expectedOutput, terminalID, last)
	return ""
}

func taskTerminalOutputText(output []any) string {
	var builder strings.Builder
	for _, item := range output {
		chunk := objectValueNoTest(item)
		if data, ok := chunk["data"].(string); ok {
			builder.WriteString(data)
		}
	}
	return builder.String()
}

func actionEventFromTask(t *testing.T, task map[string]any, eventID string) map[string]any {
	t.Helper()
	for _, item := range arrayField(t, task, "events") {
		event := objectValue(t, item)
		if event["id"] == eventID {
			return event
		}
	}
	t.Fatalf("action event %s not found in task events: %#v", eventID, task["events"])
	return nil
}

func instancesByProcessID(instances []any) map[string]map[string]any {
	result := map[string]map[string]any{}
	for _, item := range instances {
		instance := objectValueNoTest(item)
		processID, ok := instance["processId"].(string)
		if ok {
			result[processID] = instance
		}
	}
	return result
}

func stringsFromAny(values []any) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

func assertStringSetEquals(t *testing.T, actual []string, expected []string) {
	t.Helper()
	actualCounts := map[string]int{}
	for _, value := range actual {
		actualCounts[value]++
	}
	expectedCounts := map[string]int{}
	for _, value := range expected {
		expectedCounts[value]++
	}
	if len(actualCounts) != len(expectedCounts) {
		t.Fatalf("strings = %#v, want %#v", actual, expected)
	}
	for value, expectedCount := range expectedCounts {
		if actualCounts[value] != expectedCount {
			t.Fatalf("strings = %#v, want %#v", actual, expected)
		}
	}
}

func assertTreeChildren(t *testing.T, children []any, expectedFullPaths []string) {
	t.Helper()
	actual := []string{}
	for _, item := range children {
		child := objectValue(t, item)
		actual = append(actual, child["fullPath"].(string))
	}
	assertStringSetEquals(t, actual, expectedFullPaths)
}

func objectValueNoTest(value any) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return object
}

func deviceByID(t *testing.T, devices []any, deviceID string) map[string]any {
	t.Helper()
	for _, value := range devices {
		device := objectValue(t, value)
		if device["id"] == deviceID {
			return device
		}
	}
	t.Fatalf("device %s not found in %#v", deviceID, devices)
	return map[string]any{}
}

func assertChangedFile(t *testing.T, files []any, path string, status string) {
	t.Helper()
	for _, item := range files {
		file := objectValue(t, item)
		if file["path"] == path {
			if file["status"] != status {
				t.Fatalf("file %s status = %#v, want %s", path, file, status)
			}
			return
		}
	}
	t.Fatalf("file %s not found in %#v", path, files)
}

func scopeByID(t *testing.T, scopes []any, id string) map[string]any {
	t.Helper()
	for _, item := range scopes {
		scope := objectValue(t, item)
		if scope["id"] == id {
			return scope
		}
	}
	t.Fatalf("scope %s not found in %#v", id, scopes)
	return map[string]any{}
}

func sessionByID(t *testing.T, sessions []any, id string) map[string]any {
	t.Helper()
	for _, item := range sessions {
		session := objectValue(t, item)
		if session["sessionId"] == id {
			return session
		}
	}
	t.Fatalf("session %s not found in %#v", id, sessions)
	return map[string]any{}
}

func websocketURL(httpURL string, path string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http") + path
}

func resultObject(t *testing.T, response map[string]any) map[string]any {
	t.Helper()
	if runtimeErr, ok := response["error"]; ok {
		t.Fatalf("unexpected runtime error: %#v", runtimeErr)
	}
	return objectField(t, response, "result")
}

func resultArray(t *testing.T, response map[string]any) []any {
	t.Helper()
	if runtimeErr, ok := response["error"]; ok {
		t.Fatalf("unexpected runtime error: %#v", runtimeErr)
	}
	return arrayField(t, response, "result")
}

func runtimeErrorCode(t *testing.T, response map[string]any) string {
	t.Helper()
	runtimeErr, ok := response["error"].(map[string]any)
	if !ok {
		t.Fatalf("missing runtime error: %#v", response)
	}
	code, ok := runtimeErr["code"].(string)
	if !ok {
		t.Fatalf("missing runtime error code: %#v", runtimeErr)
	}
	return code
}

func objectField(t *testing.T, value map[string]any, field string) map[string]any {
	t.Helper()
	return objectValue(t, value[field])
}

func arrayField(t *testing.T, value map[string]any, field string) []any {
	t.Helper()
	items, ok := value[field].([]any)
	if !ok {
		t.Fatalf("%s is not an array: %#v", field, value[field])
	}
	return items
}

func objectValue(t *testing.T, value any) map[string]any {
	t.Helper()
	object, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("value is not an object: %#v", value)
	}
	return object
}

func stringSet(values []any) map[string]bool {
	result := map[string]bool{}
	for _, value := range values {
		if text, ok := value.(string); ok {
			result[text] = true
		}
	}
	return result
}

func stringSliceSet(values []string) map[string]bool {
	result := map[string]bool{}
	for _, value := range values {
		result[value] = true
	}
	return result
}

func deterministicTaskID(repoID string, clientRequestID string) string {
	hash := sha256.Sum256([]byte(repoID + "\x00" + clientRequestID))
	return "task-" + hex.EncodeToString(hash[:])[:26]
}
