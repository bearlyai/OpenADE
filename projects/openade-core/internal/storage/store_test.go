package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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

func TestOpenUsesPooledFileConnectionsWithPragmas(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	if maxOpen := store.db.Stats().MaxOpenConnections; maxOpen != sqliteFileMaxOpenConns {
		t.Fatalf("max open connections = %d, want %d", maxOpen, sqliteFileMaxOpenConns)
	}

	conns := make([]*sql.Conn, 0, sqliteFileMaxOpenConns)
	for index := 0; index < sqliteFileMaxOpenConns; index++ {
		conn, err := store.db.Conn(ctx)
		if err != nil {
			t.Fatalf("open pooled sqlite connection %d: %v", index, err)
		}
		conns = append(conns, conn)
	}
	t.Cleanup(func() {
		for _, conn := range conns {
			if err := conn.Close(); err != nil {
				t.Fatalf("close pooled sqlite connection: %v", err)
			}
		}
	})

	for index, conn := range conns {
		assertSQLiteConnectionPragmas(t, ctx, conn, index)
	}
}

func TestOpenKeepsInMemoryStoresSingleConnection(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatalf("open in-memory store: %v", err)
	}
	defer store.Close()

	if maxOpen := store.db.Stats().MaxOpenConnections; maxOpen != 1 {
		t.Fatalf("in-memory max open connections = %d, want 1", maxOpen)
	}
	value := json.RawMessage(`{"ok":true}`)
	if err := store.PutSetting(ctx, "memory-check", value, time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("write in-memory setting: %v", err)
	}
	loaded, ok, err := store.GetSetting(ctx, "memory-check")
	if err != nil {
		t.Fatalf("read in-memory setting: %v", err)
	}
	if !ok || string(loaded) != string(value) {
		t.Fatalf("in-memory setting = %s, ok %v", loaded, ok)
	}
}

func TestFileStoreReadUsesAvailablePooledConnection(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	value := json.RawMessage(`{"source":"pooled"}`)
	if err := store.PutSetting(ctx, "pooled-read-check", value, time.Date(2026, 6, 17, 10, 30, 0, 0, time.UTC)); err != nil {
		t.Fatalf("write pooled setting: %v", err)
	}

	conn, err := store.db.Conn(ctx)
	if err != nil {
		t.Fatalf("borrow sqlite connection: %v", err)
	}
	defer conn.Close()
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin held read transaction: %v", err)
	}
	defer tx.Rollback()

	var migrationCount int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM schema_migrations").Scan(&migrationCount); err != nil {
		t.Fatalf("read through held transaction: %v", err)
	}
	if migrationCount == 0 {
		t.Fatal("held transaction did not see migrations")
	}

	readCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	loaded, ok, err := store.GetSetting(readCtx, "pooled-read-check")
	if err != nil {
		t.Fatalf("pooled read while another connection is held: %v", err)
	}
	if !ok || string(loaded) != string(value) {
		t.Fatalf("pooled read = %s, ok %v", loaded, ok)
	}
}

func assertSQLiteConnectionPragmas(t *testing.T, ctx context.Context, conn *sql.Conn, index int) {
	t.Helper()

	var foreignKeys int
	if err := conn.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
		t.Fatalf("read foreign_keys pragma for connection %d: %v", index, err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys pragma for connection %d = %d, want 1", index, foreignKeys)
	}

	var busyTimeout int
	if err := conn.QueryRowContext(ctx, "PRAGMA busy_timeout").Scan(&busyTimeout); err != nil {
		t.Fatalf("read busy_timeout pragma for connection %d: %v", index, err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("busy_timeout pragma for connection %d = %d, want 5000", index, busyTimeout)
	}

	var journalMode string
	if err := conn.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journalMode); err != nil {
		t.Fatalf("read journal_mode pragma for connection %d: %v", index, err)
	}
	if !strings.EqualFold(journalMode, "wal") {
		t.Fatalf("journal_mode pragma for connection %d = %q, want wal", index, journalMode)
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

func TestListTaskEventsLightweightOmitsOlderPayloadJSON(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)

	if err := store.UpsertRepo(ctx, Repo{
		ID:        "repo-lightweight-events",
		Name:      "Lightweight Events",
		Path:      "/tmp/lightweight-events",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert repo: %v", err)
	}
	if err := store.UpsertTask(ctx, Task{
		ID:        "task-lightweight-events",
		RepoID:    "repo-lightweight-events",
		Slug:      "lightweight-events",
		Title:     "Lightweight events",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert task: %v", err)
	}

	eventCount := LightweightTaskEventPayloadTailLimit + 3
	for seq := 1; seq <= eventCount; seq++ {
		eventID := fmt.Sprintf("event-%02d", seq)
		payload := sql.NullString{
			String: fmt.Sprintf(`{"id":%q,"type":"action","execution":{"events":[{"id":"stream-%02d"}]}}`, eventID, seq),
			Valid:  true,
		}
		if err := store.UpsertTaskEvent(ctx, TaskEvent{
			ID:          eventID,
			TaskID:      "task-lightweight-events",
			Seq:         int64(seq),
			Type:        "action",
			Status:      sql.NullString{String: "completed", Valid: true},
			SourceType:  sql.NullString{String: "do", Valid: true},
			SourceLabel: sql.NullString{String: "Do", Valid: true},
			CreatedAt:   now.Add(time.Duration(seq) * time.Second),
			PayloadJSON: payload,
		}); err != nil {
			t.Fatalf("upsert task event %d: %v", seq, err)
		}
	}

	lightweight, err := store.ListTaskEvents(ctx, "task-lightweight-events", false)
	if err != nil {
		t.Fatalf("list lightweight events: %v", err)
	}
	if len(lightweight) != eventCount {
		t.Fatalf("lightweight event count = %d", len(lightweight))
	}
	payloadTailStart := eventCount - LightweightTaskEventPayloadTailLimit
	for index, event := range lightweight {
		if index < payloadTailStart && event.PayloadJSON.Valid {
			t.Fatalf("older lightweight event loaded payload: %#v", event)
		}
		if index >= payloadTailStart && !event.PayloadJSON.Valid {
			t.Fatalf("tail lightweight event omitted payload: %#v", event)
		}
	}

	limited, err := store.ListTaskEventsWithLimit(ctx, "task-lightweight-events", false, 5)
	if err != nil {
		t.Fatalf("list limited lightweight events: %v", err)
	}
	if len(limited) != 5 {
		t.Fatalf("limited lightweight event count = %d", len(limited))
	}
	if limited[0].ID != "event-19" || limited[4].ID != "event-23" {
		t.Fatalf("limited lightweight event window = %#v", limited)
	}
	for _, event := range limited {
		if !event.PayloadJSON.Valid {
			t.Fatalf("limited lightweight event omitted payload: %#v", event)
		}
	}

	hydrated, err := store.ListTaskEvents(ctx, "task-lightweight-events", true)
	if err != nil {
		t.Fatalf("list hydrated events: %v", err)
	}
	for _, event := range hydrated {
		if !event.PayloadJSON.Valid {
			t.Fatalf("hydrated event omitted payload: %#v", event)
		}
	}
}

func TestListTaskEventsWithLimitUsesIndexedTailQuery(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	rows, err := store.db.QueryContext(
		ctx,
		"EXPLAIN QUERY PLAN "+lightweightTaskEventsQuery,
		"task-indexed-events",
		30,
		"task-indexed-events",
		LightweightTaskEventPayloadTailLimit,
	)
	if err != nil {
		t.Fatalf("explain lightweight task events query: %v", err)
	}
	defer rows.Close()

	details := []string{}
	for rows.Next() {
		var id int
		var parent int
		var unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatalf("scan query plan: %v", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate query plan: %v", err)
	}

	plan := strings.Join(details, "\n")
	if !strings.Contains(plan, "SEARCH task_events USING") || !strings.Contains(plan, "(task_id=?)") {
		t.Fatalf("lightweight task events query is not using an indexed task lookup:\n%s", plan)
	}
	if strings.Contains(plan, "SCAN task_events") {
		t.Fatalf("lightweight task events query scans task_events:\n%s", plan)
	}
}

func TestGetTaskEventUsesIndexedPointLookup(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	rows, err := store.db.QueryContext(
		ctx,
		`EXPLAIN QUERY PLAN SELECT id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
FROM task_events
WHERE task_id = ? AND id = ?`,
		"task-indexed-events",
		"event-indexed",
	)
	if err != nil {
		t.Fatalf("explain task event point lookup: %v", err)
	}
	defer rows.Close()

	details := []string{}
	for rows.Next() {
		var id int
		var parent int
		var unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatalf("scan query plan: %v", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate query plan: %v", err)
	}

	plan := strings.Join(details, "\n")
	if !strings.Contains(plan, "SEARCH task_events USING") {
		t.Fatalf("task event point lookup is not using an indexed lookup:\n%s", plan)
	}
	if strings.Contains(plan, "SCAN task_events") {
		t.Fatalf("task event point lookup scans task_events:\n%s", plan)
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

	noOpTask, ok, changed, err := store.UpdateTaskMetadataIfChanged(ctx, TaskMetadataUpdate{
		TaskID:          "task-1",
		Title:           &title,
		Closed:          &closed,
		LastViewedAtSet: true,
		LastViewedAt:    viewedAt,
		LastEventAtSet:  true,
		LastEventAt:     lastEventAt,
		MetadataJSONSet: true,
		MetadataJSON:    task.MetadataJSON,
		UsageJSONSet:    true,
		UsageJSON:       sql.NullString{String: `{"usageVersion":2,"inputTokens":10}`, Valid: true},
		UpdatedAt:       createdAt.Add(30 * time.Minute),
	})
	if err != nil {
		t.Fatalf("no-op update metadata: %v", err)
	}
	if !ok {
		t.Fatal("task not found for no-op metadata update")
	}
	if changed {
		t.Fatalf("unchanged metadata update reported changed task = %#v", noOpTask)
	}
	if !noOpTask.UpdatedAt.Equal(createdAt.Add(7 * time.Minute)) {
		t.Fatalf("no-op metadata update changed updatedAt = %#v", noOpTask.UpdatedAt)
	}

	restoredAt := createdAt.Add(8 * time.Minute)
	restoredTask, ok, restoredChanged, err := store.UpdateTaskMetadataIfChanged(ctx, TaskMetadataUpdate{
		TaskID:       "task-1",
		UpdatedAtSet: true,
		UpdatedAt:    restoredAt,
	})
	if err != nil {
		t.Fatalf("restore updatedAt metadata: %v", err)
	}
	if !ok {
		t.Fatal("task not found for updatedAt restore")
	}
	if !restoredChanged {
		t.Fatal("explicit updatedAt restore did not report a change")
	}
	if !restoredTask.UpdatedAt.Equal(restoredAt) {
		t.Fatalf("restored updatedAt = %#v", restoredTask.UpdatedAt)
	}

	viewedOnlyAt := sql.NullTime{Time: createdAt.Add(9 * time.Minute), Valid: true}
	viewedOnlyUpdatedAt := createdAt.Add(10 * time.Minute)
	viewedOnlyTask, ok, viewedOnlyChanged, err := store.UpdateTaskMetadataIfChanged(ctx, TaskMetadataUpdate{
		TaskID:          "task-1",
		LastViewedAtSet: true,
		LastViewedAt:    viewedOnlyAt,
		UpdatedAt:       viewedOnlyUpdatedAt,
	})
	if err != nil {
		t.Fatalf("update viewed metadata: %v", err)
	}
	if !ok {
		t.Fatal("task not found for viewed metadata update")
	}
	if !viewedOnlyChanged {
		t.Fatal("viewed metadata update did not report a change")
	}
	if !viewedOnlyTask.LastViewedAt.Valid || !viewedOnlyTask.LastViewedAt.Time.Equal(viewedOnlyAt.Time) {
		t.Fatalf("viewed-only task last viewed = %#v", viewedOnlyTask.LastViewedAt)
	}
	if !viewedOnlyTask.UpdatedAt.Equal(viewedOnlyUpdatedAt) {
		t.Fatalf("viewed-only task updatedAt = %#v", viewedOnlyTask.UpdatedAt)
	}

	previews, err = store.ListTaskPreviews(ctx, "repo-1")
	if err != nil {
		t.Fatalf("list previews after viewed update: %v", err)
	}
	preview = previews[0]
	if !preview.LastViewedAt.Valid || !preview.LastViewedAt.Time.Equal(viewedOnlyAt.Time) {
		t.Fatalf("viewed-only preview last viewed = %#v", preview.LastViewedAt)
	}
	if !preview.UpdatedAt.Equal(viewedOnlyUpdatedAt) {
		t.Fatalf("viewed-only preview updatedAt = %#v", preview.UpdatedAt)
	}
	if preview.Title != "Updated title" || !preview.Closed {
		t.Fatalf("viewed-only preview rewrote stable metadata = %#v", preview)
	}
	if !preview.LastEventAt.Valid || !preview.LastEventAt.Time.Equal(lastEventAt.Time) {
		t.Fatalf("viewed-only preview last event = %#v", preview.LastEventAt)
	}
	if !preview.UsageJSON.Valid || preview.UsageJSON.String != `{"usageVersion":2,"inputTokens":10}` {
		t.Fatalf("viewed-only preview usage = %#v", preview.UsageJSON)
	}

	noOpViewedTask, ok, noOpViewedChanged, err := store.UpdateTaskMetadataIfChanged(ctx, TaskMetadataUpdate{
		TaskID:          "task-1",
		LastViewedAtSet: true,
		LastViewedAt:    viewedOnlyAt,
		UpdatedAt:       createdAt.Add(11 * time.Minute),
	})
	if err != nil {
		t.Fatalf("no-op viewed metadata: %v", err)
	}
	if !ok {
		t.Fatal("task not found for no-op viewed metadata update")
	}
	if noOpViewedChanged {
		t.Fatalf("unchanged viewed metadata update reported changed task = %#v", noOpViewedTask)
	}
	if !noOpViewedTask.UpdatedAt.Equal(viewedOnlyUpdatedAt) {
		t.Fatalf("no-op viewed metadata changed updatedAt = %#v", noOpViewedTask.UpdatedAt)
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
	singleTaskActiveRuntimePlan := runtimeListQueryPlan(t, store, `EXPLAIN QUERY PLAN `+runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?
  AND json_extract(scope_json, '$.ownerId') = ?
  AND status IN ('running', 'starting')`+runtimeRecordOrderSQL, "openade-task", "task-1")
	if !strings.Contains(singleTaskActiveRuntimePlan, "idx_runtimes_scope_status_activity") {
		t.Fatalf("single task active runtime filter did not use ownerType/ownerId/status index: %s", singleTaskActiveRuntimePlan)
	}
	if strings.Contains(singleTaskActiveRuntimePlan, "SCAN runtimes") {
		t.Fatalf("single task active runtime filter scans runtime history: %s", singleTaskActiveRuntimePlan)
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

func TestListCommentsUsesTaskCreatedIndex(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	rows, err := store.db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+listCommentsQuery, "task-indexed-comments")
	if err != nil {
		t.Fatalf("explain comments query: %v", err)
	}
	defer rows.Close()

	details := []string{}
	for rows.Next() {
		var id int
		var parent int
		var unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatalf("scan comments query plan: %v", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate comments query plan: %v", err)
	}

	plan := strings.Join(details, "\n")
	if !strings.Contains(plan, "SEARCH comments USING INDEX idx_comments_task_created") || !strings.Contains(plan, "(task_id=?)") {
		t.Fatalf("comments query is not using the task-created index:\n%s", plan)
	}
	if strings.Contains(plan, "SCAN comments") || strings.Contains(plan, "USE TEMP B-TREE") {
		t.Fatalf("comments query is scanning or sorting instead of using the task-created index:\n%s", plan)
	}
}

func TestListTaskDeviceEnvironmentsUsesTaskLastUsedIndex(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	rows, err := store.db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+listTaskDeviceEnvironmentsQuery, "task-indexed-device-env")
	if err != nil {
		t.Fatalf("explain task device environments query: %v", err)
	}
	defer rows.Close()

	details := []string{}
	for rows.Next() {
		var id int
		var parent int
		var unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatalf("scan task device environments query plan: %v", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate task device environments query plan: %v", err)
	}

	plan := strings.Join(details, "\n")
	if !strings.Contains(plan, "SEARCH task_device_environments USING INDEX idx_task_device_environments_task_last_used_created_id") ||
		!strings.Contains(plan, "(task_id=?)") {
		t.Fatalf("task device environments query is not using the task-last-used index:\n%s", plan)
	}
	if strings.Contains(plan, "SCAN task_device_environments") || strings.Contains(plan, "USE TEMP B-TREE") {
		t.Fatalf("task device environments query is scanning or sorting instead of using the task-last-used index:\n%s", plan)
	}
}

func TestListQueuedTurnsUsesTaskPositionIndex(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	rows, err := store.db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+listQueuedTurnsQuery, "task-indexed-queued-turns")
	if err != nil {
		t.Fatalf("explain queued turns query: %v", err)
	}
	defer rows.Close()

	details := []string{}
	for rows.Next() {
		var id int
		var parent int
		var unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatalf("scan queued turns query plan: %v", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate queued turns query plan: %v", err)
	}

	plan := strings.Join(details, "\n")
	if !strings.Contains(plan, "SEARCH queued_turns USING INDEX idx_queued_turns_task_position_created_id") || !strings.Contains(plan, "(task_id=?)") {
		t.Fatalf("queued turns query is not using the task-position index:\n%s", plan)
	}
	if strings.Contains(plan, "SCAN queued_turns") || strings.Contains(plan, "USE TEMP B-TREE") {
		t.Fatalf("queued turns query is scanning or sorting instead of using the task-position index:\n%s", plan)
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
		Type:      "hyperplan",
		Input:     "Second",
		Status:    "queued",
		CreatedAt: createdAt.Add(time.Second),
		UpdatedAt: createdAt.Add(time.Second),
	})
	if err != nil {
		t.Fatalf("create second queued turn: %v", err)
	}
	if !created || second.Position != 2 || second.Type != "hyperplan" {
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
