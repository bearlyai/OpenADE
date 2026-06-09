package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "openade.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})
	return store
}

func TestSettingRoundTrip(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	value := json.RawMessage(`{"mcp_servers":[{"id":"mcp-http","enabled":true}]}`)
	if err := store.PutSetting(ctx, "mcp_servers", value, time.Date(2026, 6, 7, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("put setting: %v", err)
	}
	loaded, ok, err := store.GetSetting(ctx, "mcp_servers")
	if err != nil {
		t.Fatalf("get setting: %v", err)
	}
	if !ok || string(loaded) != string(value) {
		t.Fatalf("loaded setting = %s, ok %v", loaded, ok)
	}
	if err := store.PutSetting(ctx, "broken", json.RawMessage(`{`), time.Time{}); err == nil {
		t.Fatal("expected invalid setting JSON error")
	}
}

func TestOpenAppliesMigrationsIdempotently(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "openade.db")
	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if err := store.ApplyMigrations(ctx); err != nil {
		t.Fatalf("apply migrations again: %v", err)
	}
	migrations, err := store.AppliedMigrations(ctx)
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	if len(migrations) != len(Migrations) {
		t.Fatalf("migration count = %d, want %d", len(migrations), len(Migrations))
	}
	if migrations[0].Version != 1 || migrations[0].Name != "initial_product_store" {
		t.Fatalf("unexpected migration: %#v", migrations[0])
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close first store: %v", err)
	}

	reopened, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer reopened.Close()
	reopenedMigrations, err := reopened.AppliedMigrations(ctx)
	if err != nil {
		t.Fatalf("read reopened migrations: %v", err)
	}
	if len(reopenedMigrations) != len(Migrations) {
		t.Fatalf("reopened migration count = %d", len(reopenedMigrations))
	}
}

func TestRepoAndTaskRoundTrip(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	createdAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(time.Minute)
	lastEventAt := sql.NullTime{Time: updatedAt.Add(time.Minute), Valid: true}

	if err := store.UpsertRepo(ctx, Repo{
		ID:        "repo-1",
		Name:      "OpenADE",
		Path:      "/tmp/openade",
		Archived:  false,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}
	if err := store.UpsertTask(ctx, Task{
		ID:            "task-1",
		RepoID:        "repo-1",
		Slug:          "first-task",
		Title:         "First task",
		Description:   "Move state to core",
		IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
		MetadataJSON:  sql.NullString{String: `{"createdBy":{"id":"user-1"}}`, Valid: true},
		Closed:        true,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
		LastEventAt:   lastEventAt,
	}); err != nil {
		t.Fatalf("upsert task: %v", err)
	}

	repo, ok, err := store.GetRepo(ctx, "repo-1")
	if err != nil {
		t.Fatalf("get repo: %v", err)
	}
	if !ok {
		t.Fatal("repo not found")
	}
	if repo.Name != "OpenADE" || repo.Path != "/tmp/openade" || repo.Archived {
		t.Fatalf("repo = %#v", repo)
	}

	task, ok, err := store.GetTask(ctx, "task-1")
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if !ok {
		t.Fatal("task not found")
	}
	if task.RepoID != "repo-1" || task.Title != "First task" || !task.Closed {
		t.Fatalf("task = %#v", task)
	}
	if !task.LastEventAt.Valid || !task.LastEventAt.Time.Equal(lastEventAt.Time) {
		t.Fatalf("last event = %#v", task.LastEventAt)
	}
}

func TestDeviceRoundTripAndRevocation(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	createdAt := time.Date(2026, 6, 8, 9, 0, 0, 0, time.UTC)
	lastSeenAt := createdAt.Add(time.Minute)
	if err := store.UpsertDevice(ctx, Device{
		ID:              "device-1",
		Label:           "Pia iPhone",
		Platform:        "mobile",
		PermissionsJSON: sql.NullString{String: `["openade/task/read"]`, Valid: true},
		TokenHash:       sql.NullString{String: "token-hash-1", Valid: true},
		CreatedAt:       createdAt,
		UpdatedAt:       createdAt,
	}); err != nil {
		t.Fatalf("upsert device: %v", err)
	}
	if err := store.UpsertDevice(ctx, Device{
		ID:        "device-2",
		Label:     "Browser",
		Platform:  "web",
		TokenHash: sql.NullString{String: "token-hash-2", Valid: true},
		CreatedAt: createdAt.Add(time.Minute),
		UpdatedAt: createdAt.Add(time.Minute),
	}); err != nil {
		t.Fatalf("upsert second device: %v", err)
	}

	device, ok, err := store.GetDeviceByTokenHash(ctx, "token-hash-1")
	if err != nil {
		t.Fatalf("get device by token: %v", err)
	}
	if !ok || device.ID != "device-1" || device.Label != "Pia iPhone" || !device.PermissionsJSON.Valid {
		t.Fatalf("device by token = %#v ok=%v", device, ok)
	}
	if err := store.TouchDeviceLastSeen(ctx, "device-1", lastSeenAt); err != nil {
		t.Fatalf("touch device last seen: %v", err)
	}
	devices, err := store.ListDevices(ctx)
	if err != nil {
		t.Fatalf("list devices: %v", err)
	}
	if len(devices) != 2 {
		t.Fatalf("devices = %#v", devices)
	}
	refreshed, _, err := store.GetDeviceByTokenHash(ctx, "token-hash-1")
	if err != nil {
		t.Fatalf("get refreshed device: %v", err)
	}
	if !refreshed.LastSeenAt.Valid || !refreshed.LastSeenAt.Time.Equal(lastSeenAt) {
		t.Fatalf("last seen = %#v", refreshed.LastSeenAt)
	}

	revoked, err := store.RevokeDevice(ctx, "device-1", lastSeenAt.Add(time.Minute))
	if err != nil {
		t.Fatalf("revoke device: %v", err)
	}
	if !revoked {
		t.Fatal("expected device revoke to change row")
	}
	revokedAgain, err := store.RevokeDevice(ctx, "device-1", lastSeenAt.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("revoke device again: %v", err)
	}
	if revokedAgain {
		t.Fatal("second revoke should not change row")
	}
	revokedCount, err := store.RevokeAllDevices(ctx, lastSeenAt.Add(3*time.Minute))
	if err != nil {
		t.Fatalf("revoke all devices: %v", err)
	}
	if revokedCount != 1 {
		t.Fatalf("revoked count = %d", revokedCount)
	}
	devices, err = store.ListDevices(ctx)
	if err != nil {
		t.Fatalf("list revoked devices: %v", err)
	}
	for _, device := range devices {
		if !device.RevokedAt.Valid {
			t.Fatalf("device not revoked after drop all = %#v", device)
		}
	}
}

func TestCreateTaskWithEnvironmentAndSetupEventDoesNotOverwriteExistingTask(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	createdAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := store.UpsertRepo(ctx, Repo{
		ID:        "repo-create-task",
		Name:      "Create Task Repo",
		Path:      "/tmp/create-task",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}

	task, created, err := store.CreateTask(ctx, TaskCreate{
		Task: Task{
			ID:            "task-create",
			RepoID:        "repo-create-task",
			Slug:          "task-create",
			Title:         "Created task",
			Description:   "Create through core",
			IsolationJSON: sql.NullString{String: `{"type":"worktree","sourceBranch":"main"}`, Valid: true},
			MetadataJSON:  sql.NullString{String: `{"sessionIds":{},"createdBy":{"id":"user-1","email":"user@example.com"}}`, Valid: true},
			CreatedAt:     createdAt,
			UpdatedAt:     createdAt,
		},
		DeviceEnvironment: &TaskDeviceEnvironment{
			ID:            "device-1",
			DeviceID:      "device-1",
			WorktreeDir:   sql.NullString{String: "openade/task-create", Valid: true},
			SetupComplete: true,
			CreatedAt:     createdAt,
			LastUsedAt:    createdAt,
		},
		SetupEvent: &TaskEvent{
			ID:          "setup-1",
			TaskID:      "task-create",
			Type:        "setup_environment",
			Status:      sql.NullString{String: "completed", Valid: true},
			CreatedAt:   createdAt.Add(time.Minute),
			PayloadJSON: sql.NullString{String: `{"id":"setup-1","type":"setup_environment"}`, Valid: true},
		},
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if !created || task.ID != "task-create" || !task.LastEventAt.Valid {
		t.Fatalf("created task = %#v created=%v", task, created)
	}
	environments, err := store.ListTaskDeviceEnvironments(ctx, "task-create")
	if err != nil {
		t.Fatalf("list task environments: %v", err)
	}
	if len(environments) != 1 || environments[0].WorktreeDir.String != "openade/task-create" {
		t.Fatalf("task environments = %#v", environments)
	}
	events, err := store.ListTaskEvents(ctx, "task-create", true)
	if err != nil {
		t.Fatalf("list task events: %v", err)
	}
	if len(events) != 1 || events[0].ID != "setup-1" || events[0].Seq != 1 {
		t.Fatalf("task events = %#v", events)
	}
	previews, err := store.ListTaskPreviews(ctx, "repo-create-task")
	if err != nil {
		t.Fatalf("list task previews: %v", err)
	}
	if len(previews) != 1 || !previews[0].LastEventJSON.Valid {
		t.Fatalf("task previews = %#v", previews)
	}

	existing, createdAgain, err := store.CreateTask(ctx, TaskCreate{
		Task: Task{
			ID:          "task-create",
			RepoID:      "repo-create-task",
			Slug:        "changed-slug",
			Title:       "Changed title",
			Description: "Should not overwrite",
			CreatedAt:   createdAt.Add(time.Hour),
			UpdatedAt:   createdAt.Add(time.Hour),
		},
	})
	if err != nil {
		t.Fatalf("create existing task: %v", err)
	}
	if createdAgain || existing.Title != "Created task" || existing.Slug != "task-create" {
		t.Fatalf("existing task create = %#v created=%v", existing, createdAgain)
	}
}

func TestTaskMetadataUpdateRefreshesPreview(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	createdAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	viewedAt := sql.NullTime{Time: createdAt.Add(5 * time.Minute), Valid: true}
	lastEventAt := sql.NullTime{Time: createdAt.Add(6 * time.Minute), Valid: true}
	closed := true
	title := "Updated title"

	if err := store.UpsertRepo(ctx, Repo{
		ID:        "repo-1",
		Name:      "OpenADE",
		Path:      "/tmp/openade",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}
	if err := store.UpsertTask(ctx, Task{
		ID:           "task-1",
		RepoID:       "repo-1",
		Slug:         "task-one",
		Title:        "Original title",
		MetadataJSON: sql.NullString{String: `{"createdBy":{"id":"user-1","email":"user@example.com"},"sessionIds":{}}`, Valid: true},
		CreatedAt:    createdAt,
		UpdatedAt:    createdAt,
	}); err != nil {
		t.Fatalf("upsert task: %v", err)
	}

	task, ok, err := store.UpdateTaskMetadata(ctx, TaskMetadataUpdate{
		TaskID:          "task-1",
		Title:           &title,
		Closed:          &closed,
		LastViewedAtSet: true,
		LastViewedAt:    viewedAt,
		LastEventAtSet:  true,
		LastEventAt:     lastEventAt,
		UsageJSONSet:    true,
		UsageJSON:       sql.NullString{String: `{"usageVersion":2,"inputTokens":10}`, Valid: true},
		MetadataJSONSet: true,
		MetadataJSON:    sql.NullString{String: `{"createdBy":{"id":"user-1","email":"user@example.com"},"sessionIds":{"codex":"session-1"},"cancelledPlanEventId":"event-plan-cancelled"}`, Valid: true},
		UpdatedAt:       createdAt.Add(7 * time.Minute),
	})
	if err != nil {
		t.Fatalf("update metadata: %v", err)
	}
	if !ok {
		t.Fatal("task not found")
	}
	if task.Title != "Updated title" || !task.Closed {
		t.Fatalf("updated task = %#v", task)
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(task.MetadataJSON.String), &metadata); err != nil {
		t.Fatalf("decode updated metadata: %v", err)
	}
	sessionIDs, ok := metadata["sessionIds"].(map[string]any)
	if !ok || sessionIDs["codex"] != "session-1" || metadata["cancelledPlanEventId"] != "event-plan-cancelled" {
		t.Fatalf("updated metadata = %#v", metadata)
	}

	previews, err := store.ListTaskPreviews(ctx, "repo-1")
	if err != nil {
		t.Fatalf("list previews: %v", err)
	}
	if len(previews) != 1 {
		t.Fatalf("previews = %#v", previews)
	}
	preview := previews[0]
	if preview.Title != "Updated title" || !preview.Closed {
		t.Fatalf("updated preview = %#v", preview)
	}
	if !preview.LastViewedAt.Valid || !preview.LastViewedAt.Time.Equal(viewedAt.Time) {
		t.Fatalf("preview last viewed = %#v", preview.LastViewedAt)
	}
	if !preview.LastEventAt.Valid || !preview.LastEventAt.Time.Equal(lastEventAt.Time) {
		t.Fatalf("preview last event = %#v", preview.LastEventAt)
	}
	if !preview.UsageJSON.Valid || preview.UsageJSON.String != `{"usageVersion":2,"inputTokens":10}` {
		t.Fatalf("preview usage = %#v", preview.UsageJSON)
	}
}

func TestRuntimeRecordRoundTripAndOrphaning(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	startedAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	updatedAt := startedAt.Add(time.Minute)
	activeRuntime := RuntimeRecord{
		RuntimeID:      "process:proc-1",
		Kind:           "process",
		Status:         "running",
		ScopeJSON:      sql.NullString{String: `{"ownerType":"process","ownerId":"proc-1","rootPath":"/tmp/openade"}`, Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      updatedAt,
		LastActivityAt: updatedAt,
		PayloadJSON:    sql.NullString{String: `{"nativeId":"proc-1","pid":123,"processLabel":"printf ok"}`, Valid: true},
	}
	if err := store.UpsertRuntime(ctx, activeRuntime); err != nil {
		t.Fatalf("upsert active runtime: %v", err)
	}
	if err := store.UpsertRuntime(ctx, RuntimeRecord{
		RuntimeID:      "process:proc-2",
		Kind:           "process",
		Status:         "completed",
		ScopeJSON:      sql.NullString{String: `{"ownerType":"process","ownerId":"proc-2"}`, Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      updatedAt,
		LastActivityAt: updatedAt,
		PayloadJSON:    sql.NullString{String: `{"nativeId":"proc-2","exitCode":0}`, Valid: true},
	}); err != nil {
		t.Fatalf("upsert completed runtime: %v", err)
	}
	if err := store.UpsertRuntime(ctx, RuntimeRecord{
		RuntimeID:      "process:bad-scope",
		Kind:           "process",
		Status:         "running",
		ScopeJSON:      sql.NullString{String: `{`, Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      updatedAt,
		LastActivityAt: updatedAt,
	}); err != nil {
		t.Fatalf("upsert bad-scope runtime: %v", err)
	}

	loaded, ok, err := store.GetRuntime(ctx, "process:proc-1")
	if err != nil {
		t.Fatalf("get active runtime: %v", err)
	}
	if !ok {
		t.Fatal("active runtime not found")
	}
	if loaded.RuntimeID != activeRuntime.RuntimeID || loaded.Kind != "process" || loaded.Status != "running" {
		t.Fatalf("loaded active runtime = %#v", loaded)
	}
	if !loaded.StartedAt.Equal(startedAt) || !loaded.LastActivityAt.Equal(updatedAt) {
		t.Fatalf("loaded runtime timestamps = %#v", loaded)
	}
	if !loaded.ScopeJSON.Valid || loaded.ScopeJSON.String != activeRuntime.ScopeJSON.String {
		t.Fatalf("loaded runtime scope = %#v", loaded.ScopeJSON)
	}
	if !loaded.PayloadJSON.Valid || loaded.PayloadJSON.String != activeRuntime.PayloadJSON.String {
		t.Fatalf("loaded runtime payload = %#v", loaded.PayloadJSON)
	}
	touchedAt := updatedAt.Add(2 * time.Minute)
	if err := store.TouchActiveRuntime(ctx, "process:proc-1", touchedAt); err != nil {
		t.Fatalf("touch active runtime: %v", err)
	}
	if err := store.TouchActiveRuntime(ctx, "process:proc-2", touchedAt); err != nil {
		t.Fatalf("touch completed runtime: %v", err)
	}
	touched, ok, err := store.GetRuntime(ctx, "process:proc-1")
	if err != nil {
		t.Fatalf("get touched active runtime: %v", err)
	}
	if !ok || !touched.UpdatedAt.Equal(touchedAt) || !touched.LastActivityAt.Equal(touchedAt) {
		t.Fatalf("touched active runtime = %#v", touched)
	}
	untouchedCompleted, ok, err := store.GetRuntime(ctx, "process:proc-2")
	if err != nil {
		t.Fatalf("get untouched completed runtime: %v", err)
	}
	if !ok || !untouchedCompleted.UpdatedAt.Equal(updatedAt) || !untouchedCompleted.LastActivityAt.Equal(updatedAt) {
		t.Fatalf("completed runtime was touched = %#v", untouchedCompleted)
	}

	runtimes, err := store.ListRuntimes(ctx)
	if err != nil {
		t.Fatalf("list runtimes: %v", err)
	}
	if len(runtimes) != 3 {
		t.Fatalf("runtime count = %d, want 3", len(runtimes))
	}
	filtered, err := store.ListRuntimesFiltered(ctx, RuntimeListFilter{
		OwnerType: "process",
		OwnerID:   "proc-1",
		Status:    "running",
	})
	if err != nil {
		t.Fatalf("list filtered runtimes: %v", err)
	}
	if len(filtered) != 1 || filtered[0].RuntimeID != "process:proc-1" {
		t.Fatalf("filtered runtimes = %#v", filtered)
	}
	completedFiltered, err := store.ListRuntimesFiltered(ctx, RuntimeListFilter{
		OwnerType: "process",
		Status:    "completed",
	})
	if err != nil {
		t.Fatalf("list completed runtimes: %v", err)
	}
	if len(completedFiltered) != 1 || completedFiltered[0].RuntimeID != "process:proc-2" {
		t.Fatalf("completed filtered runtimes = %#v", completedFiltered)
	}
	activeOrCompletedFiltered, err := store.ListRuntimesFiltered(ctx, RuntimeListFilter{
		OwnerType: "process",
		Statuses:  []string{"running", "completed"},
	})
	if err != nil {
		t.Fatalf("list active or completed runtimes: %v", err)
	}
	if len(activeOrCompletedFiltered) != 2 || activeOrCompletedFiltered[0].RuntimeID != "process:proc-1" || activeOrCompletedFiltered[1].RuntimeID != "process:proc-2" {
		t.Fatalf("active or completed filtered runtimes = %#v", activeOrCompletedFiltered)
	}
	noStatusMatches, err := store.ListRuntimesFiltered(ctx, RuntimeListFilter{
		OwnerType: "process",
		Statuses:  []string{"not-a-status"},
	})
	if err != nil {
		t.Fatalf("list invalid status filter runtimes: %v", err)
	}
	if len(noStatusMatches) != 0 {
		t.Fatalf("invalid status filter returned runtimes = %#v", noStatusMatches)
	}
	activeTaskFilteredPlan := runtimeListQueryPlan(t, store, `EXPLAIN QUERY PLAN `+runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?
  AND status = ?`+runtimeRecordOrderSQL, "openade-task", "running")
	if !strings.Contains(activeTaskFilteredPlan, "idx_runtimes_scope_type_status_activity") {
		t.Fatalf("active task runtime filter did not use ownerType/status index: %s", activeTaskFilteredPlan)
	}
	activeTaskStatusListPlan := runtimeListQueryPlan(t, store, `EXPLAIN QUERY PLAN `+runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?
  AND status IN ('starting', 'running')`+runtimeRecordOrderSQL, "openade-task")
	if !strings.Contains(activeTaskStatusListPlan, "idx_runtimes_scope_type_status_activity") {
		t.Fatalf("active task runtime status-list filter did not use ownerType/status index: %s", activeTaskStatusListPlan)
	}

	orphanedAt := updatedAt.Add(5 * time.Minute)
	if err := store.MarkActiveRuntimesOrphaned(ctx, orphanedAt); err != nil {
		t.Fatalf("mark active runtimes orphaned: %v", err)
	}
	orphaned, ok, err := store.GetRuntime(ctx, "process:proc-1")
	if err != nil {
		t.Fatalf("get orphaned runtime: %v", err)
	}
	if !ok || orphaned.Status != "orphaned" || !orphaned.UpdatedAt.Equal(orphanedAt) {
		t.Fatalf("orphaned runtime = %#v", orphaned)
	}
	completed, ok, err := store.GetRuntime(ctx, "process:proc-2")
	if err != nil {
		t.Fatalf("get completed runtime: %v", err)
	}
	if !ok || completed.Status != "completed" || !completed.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("completed runtime after orphaning = %#v", completed)
	}
}

func runtimeListQueryPlan(t *testing.T, store *Store, query string, args ...string) string {
	t.Helper()
	queryArgs := make([]interface{}, 0, len(args))
	for _, arg := range args {
		queryArgs = append(queryArgs, arg)
	}
	rows, err := store.db.QueryContext(context.Background(), query, queryArgs...)
	if err != nil {
		t.Fatalf("explain runtime query plan: %v", err)
	}
	defer rows.Close()

	details := []string{}
	for rows.Next() {
		var id int
		var parent int
		var notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatalf("scan runtime query plan: %v", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate runtime query plan: %v", err)
	}
	return strings.Join(details, "\n")
}

func TestRuntimeOutputChunksRoundTripPruneAndCascade(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	startedAt := time.Date(2026, 6, 8, 16, 0, 0, 0, time.UTC)
	if err := store.UpsertRuntime(ctx, RuntimeRecord{
		RuntimeID:      "process:runtime-output",
		Kind:           "process",
		Status:         "running",
		StartedAt:      startedAt,
		UpdatedAt:      startedAt,
		LastActivityAt: startedAt,
	}); err != nil {
		t.Fatalf("upsert runtime: %v", err)
	}

	for index, chunk := range []RuntimeOutputChunk{
		{RuntimeID: "process:runtime-output", Stream: "stdout", Data: "one", TimestampMs: 10, CreatedAt: startedAt},
		{RuntimeID: "process:runtime-output", Stream: "stderr", Data: "two", TimestampMs: 20, CreatedAt: startedAt.Add(time.Second)},
		{RuntimeID: "process:runtime-output", Stream: "stdout", Data: "three", TimestampMs: 30, CreatedAt: startedAt.Add(2 * time.Second)},
	} {
		if err := store.AppendRuntimeOutputChunk(ctx, chunk, 2); err != nil {
			t.Fatalf("append output chunk %d: %v", index, err)
		}
	}

	chunks, err := store.ListRuntimeOutputChunks(ctx, "process:runtime-output", 10)
	if err != nil {
		t.Fatalf("list runtime output chunks: %v", err)
	}
	if len(chunks) != 2 || chunks[0].Data != "two" || chunks[0].Stream != "stderr" || chunks[1].Data != "three" {
		t.Fatalf("pruned runtime output chunks = %#v", chunks)
	}
	latest, err := store.ListRuntimeOutputChunks(ctx, "process:runtime-output", 1)
	if err != nil {
		t.Fatalf("list latest runtime output chunk: %v", err)
	}
	if len(latest) != 1 || latest[0].Data != "three" {
		t.Fatalf("latest runtime output chunk = %#v", latest)
	}

	if _, err := store.DB().ExecContext(ctx, `DELETE FROM runtimes WHERE runtime_id = ?`, "process:runtime-output"); err != nil {
		t.Fatalf("delete runtime: %v", err)
	}
	afterDelete, err := store.ListRuntimeOutputChunks(ctx, "process:runtime-output", 10)
	if err != nil {
		t.Fatalf("list runtime output chunks after delete: %v", err)
	}
	if len(afterDelete) != 0 {
		t.Fatalf("runtime output chunks survived cascade: %#v", afterDelete)
	}
}

func TestRepoTaskAndCommentMutationRoundTrips(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	createdAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(time.Minute)
	name := "Updated repo"
	path := "/tmp/updated"
	archived := true

	if err := store.UpsertRepo(ctx, Repo{
		ID:        "repo-1",
		Name:      "OpenADE",
		Path:      "/tmp/openade",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}
	repo, ok, err := store.UpdateRepo(ctx, RepoMetadataUpdate{
		RepoID:    "repo-1",
		Name:      &name,
		Path:      &path,
		Archived:  &archived,
		UpdatedAt: updatedAt,
	})
	if err != nil {
		t.Fatalf("update repo: %v", err)
	}
	if !ok {
		t.Fatal("repo not found")
	}
	if repo.Name != "Updated repo" || repo.Path != "/tmp/updated" || !repo.Archived {
		t.Fatalf("repo = %#v", repo)
	}

	if err := store.UpsertTask(ctx, Task{
		ID:        "task-1",
		RepoID:    "repo-1",
		Slug:      "task-one",
		Title:     "Task",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert task: %v", err)
	}
	if err := store.UpsertComment(ctx, Comment{
		ID:        "comment-1",
		TaskID:    "task-1",
		Body:      "Original comment",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert comment: %v", err)
	}
	edited, err := store.EditComment(ctx, "task-1", "comment-1", "Edited comment", updatedAt)
	if err != nil {
		t.Fatalf("edit comment: %v", err)
	}
	if !edited {
		t.Fatal("comment not edited")
	}
	comments, err := store.ListComments(ctx, "task-1")
	if err != nil {
		t.Fatalf("list comments: %v", err)
	}
	if len(comments) != 1 || comments[0].Body != "Edited comment" {
		t.Fatalf("comments after edit = %#v", comments)
	}
	deletedComment, err := store.DeleteComment(ctx, "task-1", "comment-1", updatedAt.Add(time.Minute))
	if err != nil {
		t.Fatalf("delete comment: %v", err)
	}
	if !deletedComment {
		t.Fatal("comment not deleted")
	}
	comments, err = store.ListComments(ctx, "task-1")
	if err != nil {
		t.Fatalf("list comments after delete: %v", err)
	}
	if len(comments) != 0 {
		t.Fatalf("comments after delete = %#v", comments)
	}

	deletedTask, err := store.DeleteTask(ctx, "repo-1", "task-1")
	if err != nil {
		t.Fatalf("delete task: %v", err)
	}
	if !deletedTask {
		t.Fatal("task not deleted")
	}
	if _, ok, err := store.GetTask(ctx, "task-1"); err != nil {
		t.Fatalf("get deleted task: %v", err)
	} else if ok {
		t.Fatal("deleted task still exists")
	}

	deletedRepo, err := store.DeleteRepo(ctx, "repo-1")
	if err != nil {
		t.Fatalf("delete repo: %v", err)
	}
	if !deletedRepo {
		t.Fatal("repo not deleted")
	}
	if _, ok, err := store.GetRepo(ctx, "repo-1"); err != nil {
		t.Fatalf("get deleted repo: %v", err)
	} else if ok {
		t.Fatal("deleted repo still exists")
	}
}

func TestQueuedTurnRoundTripAndCancel(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	createdAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(time.Minute)

	if err := store.UpsertRepo(ctx, Repo{
		ID:        "repo-1",
		Name:      "OpenADE",
		Path:      "/tmp/openade",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}
	if err := store.UpsertTask(ctx, Task{
		ID:        "task-1",
		RepoID:    "repo-1",
		Slug:      "task-one",
		Title:     "Task",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert task: %v", err)
	}
	if err := store.UpsertQueuedTurn(ctx, QueuedTurn{
		ID:          "queued-1",
		TaskID:      "task-1",
		Type:        "ask",
		Input:       "What changed?",
		Status:      "queued",
		PayloadJSON: sql.NullString{String: `{"clientRequestId":"request-1","thinking":"high"}`, Valid: true},
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	}); err != nil {
		t.Fatalf("upsert queued turn: %v", err)
	}

	turns, err := store.ListQueuedTurns(ctx, "task-1")
	if err != nil {
		t.Fatalf("list queued turns: %v", err)
	}
	if len(turns) != 1 || turns[0].ID != "queued-1" || turns[0].Status != "queued" {
		t.Fatalf("queued turns = %#v", turns)
	}

	cancelledTurn, found, cancelled, err := store.CancelQueuedTurn(ctx, "task-1", "queued-1", updatedAt)
	if err != nil {
		t.Fatalf("cancel queued turn: %v", err)
	}
	if !found || !cancelled {
		t.Fatalf("cancel result found=%v cancelled=%v", found, cancelled)
	}
	if cancelledTurn.Status != "cancelled" || !cancelledTurn.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("cancelled turn = %#v", cancelledTurn)
	}

	unchanged, found, cancelled, err := store.CancelQueuedTurn(ctx, "task-1", "queued-1", updatedAt.Add(time.Minute))
	if err != nil {
		t.Fatalf("cancel already cancelled turn: %v", err)
	}
	if !found || cancelled || unchanged.Status != "cancelled" || !unchanged.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("unchanged cancel result = %#v found=%v cancelled=%v", unchanged, found, cancelled)
	}

	_, found, cancelled, err = store.CancelQueuedTurn(ctx, "task-1", "missing", updatedAt)
	if err != nil {
		t.Fatalf("cancel missing queued turn: %v", err)
	}
	if found || cancelled {
		t.Fatalf("missing cancel found=%v cancelled=%v", found, cancelled)
	}
}

func TestQueuedTurnCreateAndReorder(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	createdAt := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	if err := store.UpsertRepo(ctx, Repo{
		ID:        "repo-queue",
		Name:      "Queue Repo",
		Path:      "/tmp/queue",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}
	if err := store.UpsertTask(ctx, Task{
		ID:        "task-queue",
		RepoID:    "repo-queue",
		Slug:      "task-queue",
		Title:     "Queued task",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("upsert task: %v", err)
	}

	first, created, err := store.CreateQueuedTurn(ctx, QueuedTurn{
		ID:          "queued-first",
		TaskID:      "task-queue",
		Type:        "ask",
		Input:       "First",
		Status:      "queued",
		PayloadJSON: sql.NullString{String: `{"clientRequestId":"request-1"}`, Valid: true},
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	})
	if err != nil {
		t.Fatalf("create first queued turn: %v", err)
	}
	if !created || first.Position != 1 {
		t.Fatalf("first queued turn = %#v created=%v", first, created)
	}
	second, created, err := store.CreateQueuedTurn(ctx, QueuedTurn{
		ID:        "queued-second",
		TaskID:    "task-queue",
		Type:      "do",
		Input:     "Second",
		Status:    "queued",
		CreatedAt: createdAt.Add(time.Second),
		UpdatedAt: createdAt.Add(time.Second),
	})
	if err != nil {
		t.Fatalf("create second queued turn: %v", err)
	}
	if !created || second.Position != 2 {
		t.Fatalf("second queued turn = %#v created=%v", second, created)
	}
	existing, created, err := store.CreateQueuedTurn(ctx, QueuedTurn{
		ID:        "queued-first",
		TaskID:    "task-queue",
		Type:      "do",
		Input:     "Changed",
		Status:    "queued",
		CreatedAt: createdAt.Add(time.Hour),
		UpdatedAt: createdAt.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("create existing queued turn: %v", err)
	}
	if created || existing.Input != "First" || existing.Type != "ask" {
		t.Fatalf("existing queued turn create = %#v created=%v", existing, created)
	}

	reordered, changed, err := store.ReorderQueuedTurns(ctx, "task-queue", []string{"queued-second", "queued-first"}, createdAt.Add(time.Minute))
	if err != nil {
		t.Fatalf("reorder queued turns: %v", err)
	}
	if !changed || len(reordered) != 2 || reordered[0].ID != "queued-second" || reordered[1].ID != "queued-first" {
		t.Fatalf("reordered queued turns = %#v changed=%v", reordered, changed)
	}
	if reordered[0].Position != 1 || reordered[1].Position != 2 {
		t.Fatalf("reordered queued turn positions = %#v", reordered)
	}

	_, _, err = store.ReorderQueuedTurns(ctx, "task-queue", []string{"queued-second", "queued-second"}, createdAt)
	if err == nil {
		t.Fatal("duplicate queued turn ids did not fail")
	}

	claimed, found, err := store.ClaimNextQueuedTurn(ctx, "task-queue", createdAt.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("claim next queued turn: %v", err)
	}
	if !found || claimed.ID != "queued-second" || claimed.Status != "running" {
		t.Fatalf("claimed queued turn = %#v found=%v", claimed, found)
	}
	runningPayload := sql.NullString{String: `{"clientRequestId":"request-2","eventId":"event-queued-second"}`, Valid: true}
	running, found, err := store.SetQueuedTurnRunningEvent(ctx, "task-queue", "queued-second", runningPayload, createdAt.Add(3*time.Minute))
	if err != nil {
		t.Fatalf("set running queued turn event: %v", err)
	}
	if !found || running.Status != "running" || running.PayloadJSON.String != runningPayload.String {
		t.Fatalf("running queued turn = %#v found=%v", running, found)
	}
	completed, found, changed, err := store.CompleteQueuedTurn(ctx, "task-queue", "queued-second", "completed", createdAt.Add(4*time.Minute))
	if err != nil {
		t.Fatalf("complete queued turn: %v", err)
	}
	if !found || !changed || completed.Status != "completed" {
		t.Fatalf("completed queued turn = %#v found=%v changed=%v", completed, found, changed)
	}
	unchanged, found, changed, err := store.CompleteQueuedTurn(ctx, "task-queue", "queued-second", "error", createdAt.Add(5*time.Minute))
	if err != nil {
		t.Fatalf("complete terminal queued turn: %v", err)
	}
	if !found || changed || unchanged.Status != "completed" {
		t.Fatalf("unchanged terminal queued turn = %#v found=%v changed=%v", unchanged, found, changed)
	}
	next, found, err := store.ClaimNextQueuedTurn(ctx, "task-queue", createdAt.Add(6*time.Minute))
	if err != nil {
		t.Fatalf("claim next queued turn after completion: %v", err)
	}
	if !found || next.ID != "queued-first" || next.Status != "running" {
		t.Fatalf("next claimed queued turn = %#v found=%v", next, found)
	}
}

func TestTaskRequiresExistingRepo(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	err := store.UpsertTask(ctx, Task{
		ID:        "task-1",
		RepoID:    "missing-repo",
		Title:     "Orphan task",
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	})
	if err == nil {
		t.Fatal("expected foreign key error")
	}
}

func TestBlobMetadataRoundTripAndForeignKeyCheck(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	if err := store.PutBlobMetadata(ctx, BlobMetadata{
		ID:          "blob-1",
		Kind:        "task_stream",
		ContentType: sql.NullString{String: "application/json", Valid: true},
		SizeBytes:   123,
		SHA256:      "abc123",
		Path:        "blobs/ab/blob-1",
		CreatedAt:   time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("put blob metadata: %v", err)
	}
	blob, ok, err := store.GetBlobMetadata(ctx, "blob-1")
	if err != nil {
		t.Fatalf("get blob metadata: %v", err)
	}
	if !ok || blob.ID != "blob-1" || blob.Kind != "task_stream" || blob.Path != "blobs/ab/blob-1" || blob.ContentType.String != "application/json" {
		t.Fatalf("blob metadata = %#v, ok %v", blob, ok)
	}

	rows, err := store.DB().QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		t.Fatalf("foreign key check: %v", err)
	}
	defer rows.Close()
	if rows.Next() {
		t.Fatal("foreign_key_check returned violations")
	}
	if err := rows.Err(); err != nil && !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign key check rows: %v", err)
	}
}

func TestListAndDeleteBlobMetadataByKindIfUnchanged(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	createdAt := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	for _, blob := range []BlobMetadata{
		{ID: "image-one", Kind: "task_image", ContentType: sql.NullString{String: "image/png", Valid: true}, SizeBytes: 10, SHA256: "sha-one", Path: "blobs/images/image-one.png", CreatedAt: createdAt},
		{ID: "image-two", Kind: "task_image", ContentType: sql.NullString{String: "image/webp", Valid: true}, SizeBytes: 20, SHA256: "sha-two", Path: "blobs/images/image-two.webp", CreatedAt: createdAt.Add(time.Second)},
		{ID: "patch-one", Kind: "snapshot_patch", ContentType: sql.NullString{String: "text/x-patch", Valid: true}, SizeBytes: 30, SHA256: "sha-patch", Path: "blobs/snapshots/patch-one.patch", CreatedAt: createdAt.Add(2 * time.Second)},
	} {
		if err := store.PutBlobMetadata(ctx, blob); err != nil {
			t.Fatalf("put blob metadata %s: %v", blob.ID, err)
		}
	}

	images, err := store.ListBlobMetadataByKind(ctx, "task_image")
	if err != nil {
		t.Fatalf("list task image blobs: %v", err)
	}
	if len(images) != 2 || images[0].ID != "image-one" || images[1].ID != "image-two" {
		t.Fatalf("listed task image blobs = %#v", images)
	}

	changed := images[0]
	changed.SHA256 = "different"
	deleted, err := store.DeleteBlobMetadataIfUnchanged(ctx, changed)
	if err != nil {
		t.Fatalf("delete changed blob metadata: %v", err)
	}
	if deleted {
		t.Fatal("changed blob metadata was deleted")
	}
	if _, ok, err := store.GetBlobMetadata(ctx, "image-one"); err != nil {
		t.Fatalf("get unchanged image after stale delete: %v", err)
	} else if !ok {
		t.Fatal("stale delete removed image-one")
	}

	deleted, err = store.DeleteBlobMetadataIfUnchanged(ctx, images[0])
	if err != nil {
		t.Fatalf("delete unchanged blob metadata: %v", err)
	}
	if !deleted {
		t.Fatal("unchanged blob metadata was not deleted")
	}
	if _, ok, err := store.GetBlobMetadata(ctx, "image-one"); err != nil {
		t.Fatalf("get deleted image metadata: %v", err)
	} else if ok {
		t.Fatal("deleted image metadata still exists")
	}
	if _, ok, err := store.GetBlobMetadata(ctx, "image-two"); err != nil {
		t.Fatalf("get retained image metadata: %v", err)
	} else if !ok {
		t.Fatal("unselected task image metadata was deleted")
	}
	if _, ok, err := store.GetBlobMetadata(ctx, "patch-one"); err != nil {
		t.Fatalf("get retained patch metadata: %v", err)
	} else if !ok {
		t.Fatal("other kind metadata was deleted")
	}
}

func TestDeleteTaskAndBlobMetadataDeletesTaskAndSelectedBlobs(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	now := time.Date(2026, 6, 7, 11, 0, 0, 0, time.UTC)
	if err := store.UpsertRepo(ctx, Repo{
		ID:        "repo-delete-task-blobs",
		Name:      "Delete task blobs",
		Path:      "/tmp/delete-task-blobs",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}
	if err := store.UpsertTask(ctx, Task{
		ID:        "task-delete-blobs",
		RepoID:    "repo-delete-task-blobs",
		Slug:      "task-delete-blobs",
		Title:     "Delete blobs with task",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert task: %v", err)
	}
	for _, blob := range []BlobMetadata{
		{ID: "blob-delete-one", Kind: "task_image", SizeBytes: 10, SHA256: "sha-one", Path: "blobs/one", CreatedAt: now},
		{ID: "blob-delete-two", Kind: "snapshot_patch", SizeBytes: 20, SHA256: "sha-two", Path: "blobs/two", CreatedAt: now},
		{ID: "blob-keep", Kind: "task_image", SizeBytes: 30, SHA256: "sha-keep", Path: "blobs/keep", CreatedAt: now},
	} {
		if err := store.PutBlobMetadata(ctx, blob); err != nil {
			t.Fatalf("put blob metadata %s: %v", blob.ID, err)
		}
	}

	deleted, err := store.DeleteTaskAndBlobMetadata(ctx, "repo-delete-task-blobs", "task-delete-blobs", []string{"blob-delete-one", "blob-delete-two", "blob-delete-one"})
	if err != nil {
		t.Fatalf("delete task and blobs: %v", err)
	}
	if !deleted {
		t.Fatal("task was not deleted")
	}
	if _, ok, err := store.GetTask(ctx, "task-delete-blobs"); err != nil {
		t.Fatalf("get deleted task: %v", err)
	} else if ok {
		t.Fatal("deleted task still exists")
	}
	for _, id := range []string{"blob-delete-one", "blob-delete-two"} {
		if _, ok, err := store.GetBlobMetadata(ctx, id); err != nil {
			t.Fatalf("get deleted blob %s: %v", id, err)
		} else if ok {
			t.Fatalf("deleted blob metadata %s still exists", id)
		}
	}
	if blob, ok, err := store.GetBlobMetadata(ctx, "blob-keep"); err != nil {
		t.Fatalf("get kept blob: %v", err)
	} else if !ok || blob.ID != "blob-keep" {
		t.Fatalf("kept blob = %#v, ok %v", blob, ok)
	}

	missing, err := store.DeleteTaskAndBlobMetadata(ctx, "repo-delete-task-blobs", "task-delete-blobs", []string{"blob-keep"})
	if err != nil {
		t.Fatalf("delete missing task and blob: %v", err)
	}
	if missing {
		t.Fatal("missing task reported deleted")
	}
	if _, ok, err := store.GetBlobMetadata(ctx, "blob-keep"); err != nil {
		t.Fatalf("get kept blob after missing delete: %v", err)
	} else if !ok {
		t.Fatal("missing task delete removed unrelated blob")
	}
}
