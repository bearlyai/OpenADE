package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type Repo struct {
	ID        string
	Name      string
	Path      string
	Archived  bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Task struct {
	ID            string
	RepoID        string
	Slug          string
	Title         string
	Description   string
	IsolationJSON sql.NullString
	MetadataJSON  sql.NullString
	Closed        bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
	LastViewedAt  sql.NullTime
	LastEventAt   sql.NullTime
}

type TaskPreview struct {
	TaskID        string
	RepoID        string
	Slug          string
	Title         string
	Closed        bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
	LastViewedAt  sql.NullTime
	LastEventAt   sql.NullTime
	LastEventJSON sql.NullString
	UsageJSON     sql.NullString
}

type TaskEvent struct {
	ID            string
	TaskID        string
	Seq           int64
	Type          string
	Status        sql.NullString
	SourceType    sql.NullString
	SourceLabel   sql.NullString
	CreatedAt     time.Time
	PayloadJSON   sql.NullString
	PayloadBlobID sql.NullString
}

type TaskDeviceEnvironment struct {
	ID              string
	TaskID          string
	DeviceID        string
	WorktreeDir     sql.NullString
	SetupComplete   bool
	MergeBaseCommit sql.NullString
	CreatedAt       time.Time
	LastUsedAt      time.Time
}

type Comment struct {
	ID         string
	TaskID     string
	Body       string
	AnchorJSON sql.NullString
	CreatedAt  time.Time
	UpdatedAt  time.Time
	DeletedAt  sql.NullTime
}

type QueuedTurn struct {
	ID          string
	TaskID      string
	Type        string
	Input       string
	Status      string
	Position    int64
	PayloadJSON sql.NullString
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type BlobMetadata struct {
	ID          string
	Kind        string
	ContentType sql.NullString
	SizeBytes   int64
	SHA256      string
	Path        string
	CreatedAt   time.Time
}

type RuntimeRecord struct {
	RuntimeID      string
	Kind           string
	Status         string
	ScopeJSON      sql.NullString
	StartedAt      time.Time
	UpdatedAt      time.Time
	LastActivityAt time.Time
	PayloadJSON    sql.NullString
}

type RuntimeListFilter struct {
	OwnerType string
	OwnerID   string
	Status    string
	Statuses  []string
}

type RuntimeOutputChunk struct {
	ID          int64
	RuntimeID   string
	Stream      string
	Data        string
	TimestampMs int64
	CreatedAt   time.Time
}

type Device struct {
	ID              string
	SessionID       sql.NullString
	Label           string
	Platform        string
	PermissionsJSON sql.NullString
	TokenHash       sql.NullString
	CreatedAt       time.Time
	UpdatedAt       time.Time
	LastSeenAt      sql.NullTime
	RevokedAt       sql.NullTime
}

type TaskMetadataUpdate struct {
	TaskID          string
	Title           *string
	Closed          *bool
	LastViewedAtSet bool
	LastViewedAt    sql.NullTime
	LastEventAtSet  bool
	LastEventAt     sql.NullTime
	UsageJSONSet    bool
	UsageJSON       sql.NullString
	MetadataJSONSet bool
	MetadataJSON    sql.NullString
	UpdatedAt       time.Time
}

type TaskEnvironmentSetup struct {
	TaskID            string
	DeviceEnvironment TaskDeviceEnvironment
	SetupEvent        *TaskEvent
	UpdatedAt         time.Time
}

type TaskEventWrite struct {
	Event            TaskEvent
	UpdatedAt        time.Time
	UpdateLastEvent  bool
	LastEventAt      sql.NullTime
	UpdatePreview    bool
	LastEventJSON    sql.NullString
	PreserveExisting bool
}

type TaskCreate struct {
	Task              Task
	DeviceEnvironment *TaskDeviceEnvironment
	SetupEvent        *TaskEvent
}

type RepoMetadataUpdate struct {
	RepoID    string
	Name      *string
	Path      *string
	Archived  *bool
	UpdatedAt time.Time
}

func Open(ctx context.Context, dbPath string) (*Store, error) {
	if dbPath == "" {
		return nil, errors.New("database path is required")
	}
	if dbPath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	db.SetMaxOpenConns(1)

	store := &Store{db: db}
	if err := store.configure(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := store.ApplyMigrations(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (store *Store) Close() error {
	return store.db.Close()
}

func (store *Store) DB() *sql.DB {
	return store.db
}

func (store *Store) configure(ctx context.Context) error {
	statements := []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA journal_mode = WAL",
		"PRAGMA busy_timeout = 5000",
	}
	for _, statement := range statements {
		if _, err := store.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("configure sqlite %q: %w", statement, err)
		}
	}
	return nil
}

func (store *Store) ApplyMigrations(ctx context.Context) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration transaction: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`); err != nil {
		return fmt.Errorf("ensure migration table: %w", err)
	}

	for _, migration := range Migrations {
		var exists int
		if err := tx.QueryRowContext(ctx, "SELECT 1 FROM schema_migrations WHERE version = ?", migration.Version).Scan(&exists); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("read migration %d: %w", migration.Version, err)
		}
		if exists == 1 {
			continue
		}
		if _, err := tx.ExecContext(ctx, migration.SQL); err != nil {
			return fmt.Errorf("apply migration %d %s: %w", migration.Version, migration.Name, err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, name) VALUES (?, ?)", migration.Version, migration.Name); err != nil {
			return fmt.Errorf("record migration %d: %w", migration.Version, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migrations: %w", err)
	}
	tx = nil
	return nil
}

func (store *Store) AppliedMigrations(ctx context.Context) ([]Migration, error) {
	rows, err := store.db.QueryContext(ctx, "SELECT version, name, '' FROM schema_migrations ORDER BY version")
	if err != nil {
		return nil, fmt.Errorf("read applied migrations: %w", err)
	}
	defer rows.Close()

	migrations := []Migration{}
	for rows.Next() {
		var migration Migration
		if err := rows.Scan(&migration.Version, &migration.Name, &migration.SQL); err != nil {
			return nil, fmt.Errorf("scan migration: %w", err)
		}
		migrations = append(migrations, migration)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate migrations: %w", err)
	}
	return migrations, nil
}

func (store *Store) UpsertRepo(ctx context.Context, repo Repo) error {
	now := time.Now().UTC()
	if repo.ID == "" {
		return errors.New("repo id is required")
	}
	if repo.Name == "" {
		return errors.New("repo name is required")
	}
	if repo.Path == "" {
		return errors.New("repo path is required")
	}
	if repo.CreatedAt.IsZero() {
		repo.CreatedAt = now
	}
	if repo.UpdatedAt.IsZero() {
		repo.UpdatedAt = repo.CreatedAt
	}

	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO repos(id, name, path, archived, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    path = excluded.path,
    archived = excluded.archived,
    updated_at = excluded.updated_at`,
		repo.ID,
		repo.Name,
		repo.Path,
		boolInt(repo.Archived),
		formatTime(repo.CreatedAt),
		formatTime(repo.UpdatedAt),
	)
	if err != nil {
		return fmt.Errorf("upsert repo %s: %w", repo.ID, err)
	}
	return nil
}

func (store *Store) GetRepo(ctx context.Context, id string) (Repo, bool, error) {
	var repo Repo
	var archived int
	var createdAt string
	var updatedAt string
	err := store.db.QueryRowContext(
		ctx,
		"SELECT id, name, path, archived, created_at, updated_at FROM repos WHERE id = ?",
		id,
	).Scan(&repo.ID, &repo.Name, &repo.Path, &archived, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Repo{}, false, nil
	}
	if err != nil {
		return Repo{}, false, fmt.Errorf("read repo %s: %w", id, err)
	}
	repo.Archived = archived != 0
	var parseErr error
	repo.CreatedAt, parseErr = parseTime(createdAt)
	if parseErr != nil {
		return Repo{}, false, parseErr
	}
	repo.UpdatedAt, parseErr = parseTime(updatedAt)
	if parseErr != nil {
		return Repo{}, false, parseErr
	}
	return repo, true, nil
}

func (store *Store) UpdateRepo(ctx context.Context, update RepoMetadataUpdate) (Repo, bool, error) {
	if update.RepoID == "" {
		return Repo{}, false, errors.New("repo id is required")
	}
	repo, ok, err := store.GetRepo(ctx, update.RepoID)
	if err != nil || !ok {
		return repo, ok, err
	}
	if update.Name != nil {
		repo.Name = *update.Name
	}
	if update.Path != nil {
		repo.Path = *update.Path
	}
	if update.Archived != nil {
		repo.Archived = *update.Archived
	}
	if update.UpdatedAt.IsZero() {
		update.UpdatedAt = time.Now().UTC()
	}
	repo.UpdatedAt = update.UpdatedAt

	if _, err := store.db.ExecContext(
		ctx,
		`UPDATE repos
SET name = ?, path = ?, archived = ?, updated_at = ?
WHERE id = ?`,
		repo.Name,
		repo.Path,
		boolInt(repo.Archived),
		formatTime(repo.UpdatedAt),
		repo.ID,
	); err != nil {
		return Repo{}, false, fmt.Errorf("update repo %s: %w", repo.ID, err)
	}
	return repo, true, nil
}

func (store *Store) DeleteRepo(ctx context.Context, repoID string) (bool, error) {
	if repoID == "" {
		return false, errors.New("repo id is required")
	}
	result, err := store.db.ExecContext(ctx, "DELETE FROM repos WHERE id = ?", repoID)
	if err != nil {
		return false, fmt.Errorf("delete repo %s: %w", repoID, err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read deleted repo count %s: %w", repoID, err)
	}
	return deleted > 0, nil
}

func (store *Store) ListRepos(ctx context.Context) ([]Repo, error) {
	rows, err := store.db.QueryContext(ctx, "SELECT id, name, path, archived, created_at, updated_at FROM repos ORDER BY archived ASC, name COLLATE NOCASE ASC, updated_at DESC")
	if err != nil {
		return nil, fmt.Errorf("list repos: %w", err)
	}
	defer rows.Close()

	repos := []Repo{}
	for rows.Next() {
		var repo Repo
		var archived int
		var createdAt string
		var updatedAt string
		if err := rows.Scan(&repo.ID, &repo.Name, &repo.Path, &archived, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan repo: %w", err)
		}
		repo.Archived = archived != 0
		var parseErr error
		repo.CreatedAt, parseErr = parseTime(createdAt)
		if parseErr != nil {
			return nil, parseErr
		}
		repo.UpdatedAt, parseErr = parseTime(updatedAt)
		if parseErr != nil {
			return nil, parseErr
		}
		repos = append(repos, repo)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate repos: %w", err)
	}
	return repos, nil
}

func (store *Store) UpsertTask(ctx context.Context, task Task) error {
	now := time.Now().UTC()
	if task.ID == "" {
		return errors.New("task id is required")
	}
	if task.RepoID == "" {
		return errors.New("task repo id is required")
	}
	if task.Title == "" {
		return errors.New("task title is required")
	}
	if task.CreatedAt.IsZero() {
		task.CreatedAt = now
	}
	if task.UpdatedAt.IsZero() {
		task.UpdatedAt = task.CreatedAt
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin task upsert: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO tasks(
    id, repo_id, slug, title, description, isolation_json, metadata_json, closed,
    created_at, updated_at, last_viewed_at, last_event_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    repo_id = excluded.repo_id,
    slug = excluded.slug,
    title = excluded.title,
    description = excluded.description,
    isolation_json = excluded.isolation_json,
    metadata_json = excluded.metadata_json,
    closed = excluded.closed,
    updated_at = excluded.updated_at,
    last_viewed_at = excluded.last_viewed_at,
    last_event_at = excluded.last_event_at`,
		task.ID,
		task.RepoID,
		task.Slug,
		task.Title,
		task.Description,
		task.IsolationJSON,
		task.MetadataJSON,
		boolInt(task.Closed),
		formatTime(task.CreatedAt),
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastViewedAt),
		nullTimeString(task.LastEventAt),
	); err != nil {
		return fmt.Errorf("upsert task %s: %w", task.ID, err)
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO task_previews(task_id, repo_id, slug, title, closed, created_at, updated_at, last_viewed_at, last_event_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(task_id) DO UPDATE SET
    repo_id = excluded.repo_id,
    slug = excluded.slug,
    title = excluded.title,
    closed = excluded.closed,
    updated_at = excluded.updated_at,
    last_viewed_at = excluded.last_viewed_at,
    last_event_at = excluded.last_event_at`,
		task.ID,
		task.RepoID,
		task.Slug,
		task.Title,
		boolInt(task.Closed),
		formatTime(task.CreatedAt),
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastViewedAt),
		nullTimeString(task.LastEventAt),
	); err != nil {
		return fmt.Errorf("upsert task preview %s: %w", task.ID, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit task upsert %s: %w", task.ID, err)
	}
	tx = nil
	return nil
}

func (store *Store) CreateTask(ctx context.Context, create TaskCreate) (Task, bool, error) {
	task := create.Task
	now := time.Now().UTC()
	if task.ID == "" {
		return Task{}, false, errors.New("task id is required")
	}
	if task.RepoID == "" {
		return Task{}, false, errors.New("task repo id is required")
	}
	if task.Title == "" {
		return Task{}, false, errors.New("task title is required")
	}
	if task.CreatedAt.IsZero() {
		task.CreatedAt = now
	}
	if task.UpdatedAt.IsZero() {
		task.UpdatedAt = task.CreatedAt
	}

	if existing, ok, err := store.GetTask(ctx, task.ID); err != nil {
		return Task{}, false, err
	} else if ok {
		return existing, false, nil
	}

	lastEventJSON := sql.NullString{}
	hasSetupEvent := create.SetupEvent != nil
	if hasSetupEvent {
		event := *create.SetupEvent
		if event.ID == "" {
			return Task{}, false, errors.New("setup event id is required")
		}
		if event.TaskID == "" {
			event.TaskID = task.ID
		}
		if event.TaskID != task.ID {
			return Task{}, false, errors.New("setup event task id mismatch")
		}
		if event.Type == "" {
			event.Type = "setup_environment"
		}
		if event.CreatedAt.IsZero() {
			event.CreatedAt = task.CreatedAt
		}
		task.LastEventAt = sql.NullTime{Time: event.CreatedAt, Valid: true}
		lastEventJSON = event.PayloadJSON
		create.SetupEvent = &event
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, false, fmt.Errorf("begin task create: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO tasks(
    id, repo_id, slug, title, description, isolation_json, metadata_json, closed,
    created_at, updated_at, last_viewed_at, last_event_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		task.ID,
		task.RepoID,
		task.Slug,
		task.Title,
		task.Description,
		task.IsolationJSON,
		task.MetadataJSON,
		boolInt(task.Closed),
		formatTime(task.CreatedAt),
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastViewedAt),
		nullTimeString(task.LastEventAt),
	); err != nil {
		return Task{}, false, fmt.Errorf("create task %s: %w", task.ID, err)
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO task_previews(
    task_id, repo_id, slug, title, closed, created_at, updated_at, last_viewed_at, last_event_at, last_event_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		task.ID,
		task.RepoID,
		task.Slug,
		task.Title,
		boolInt(task.Closed),
		formatTime(task.CreatedAt),
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastViewedAt),
		nullTimeString(task.LastEventAt),
		lastEventJSON,
	); err != nil {
		return Task{}, false, fmt.Errorf("create task preview %s: %w", task.ID, err)
	}

	if create.DeviceEnvironment != nil {
		environment := *create.DeviceEnvironment
		if environment.ID == "" {
			return Task{}, false, errors.New("task device environment id is required")
		}
		if environment.DeviceID == "" {
			return Task{}, false, errors.New("task device environment device id is required")
		}
		if environment.TaskID == "" {
			environment.TaskID = task.ID
		}
		if environment.TaskID != task.ID {
			return Task{}, false, errors.New("task device environment task id mismatch")
		}
		if environment.CreatedAt.IsZero() {
			environment.CreatedAt = task.CreatedAt
		}
		if environment.LastUsedAt.IsZero() {
			environment.LastUsedAt = task.CreatedAt
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO task_device_environments(
    id, task_id, device_id, worktree_dir, setup_complete, merge_base_commit, created_at, last_used_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			environment.ID,
			environment.TaskID,
			environment.DeviceID,
			environment.WorktreeDir,
			boolInt(environment.SetupComplete),
			environment.MergeBaseCommit,
			formatTime(environment.CreatedAt),
			formatTime(environment.LastUsedAt),
		); err != nil {
			return Task{}, false, fmt.Errorf("create task device environment %s: %w", environment.ID, err)
		}
	}

	if hasSetupEvent {
		event := *create.SetupEvent
		event.Seq = 1
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO task_events(
    id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			event.ID,
			event.TaskID,
			event.Seq,
			event.Type,
			event.Status,
			event.SourceType,
			event.SourceLabel,
			formatTime(event.CreatedAt),
			event.PayloadJSON,
			event.PayloadBlobID,
		); err != nil {
			return Task{}, false, fmt.Errorf("create task setup event %s: %w", event.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return Task{}, false, fmt.Errorf("commit task create %s: %w", task.ID, err)
	}
	tx = nil
	return task, true, nil
}

func (store *Store) GetTask(ctx context.Context, id string) (Task, bool, error) {
	var task Task
	var closed int
	var createdAt string
	var updatedAt string
	var lastViewed sql.NullString
	var lastEvent sql.NullString
	err := store.db.QueryRowContext(
		ctx,
		`SELECT id, repo_id, slug, title, description, isolation_json, metadata_json, closed,
    created_at, updated_at, last_viewed_at, last_event_at
FROM tasks WHERE id = ?`,
		id,
	).Scan(
		&task.ID,
		&task.RepoID,
		&task.Slug,
		&task.Title,
		&task.Description,
		&task.IsolationJSON,
		&task.MetadataJSON,
		&closed,
		&createdAt,
		&updatedAt,
		&lastViewed,
		&lastEvent,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Task{}, false, nil
	}
	if err != nil {
		return Task{}, false, fmt.Errorf("read task %s: %w", id, err)
	}
	task.Closed = closed != 0
	var parseErr error
	task.CreatedAt, parseErr = parseTime(createdAt)
	if parseErr != nil {
		return Task{}, false, parseErr
	}
	task.UpdatedAt, parseErr = parseTime(updatedAt)
	if parseErr != nil {
		return Task{}, false, parseErr
	}
	task.LastViewedAt, parseErr = parseNullTime(lastViewed)
	if parseErr != nil {
		return Task{}, false, parseErr
	}
	task.LastEventAt, parseErr = parseNullTime(lastEvent)
	if parseErr != nil {
		return Task{}, false, parseErr
	}
	return task, true, nil
}

func (store *Store) UpdateTaskMetadata(ctx context.Context, update TaskMetadataUpdate) (Task, bool, error) {
	if update.TaskID == "" {
		return Task{}, false, errors.New("task id is required")
	}
	task, ok, err := store.GetTask(ctx, update.TaskID)
	if err != nil || !ok {
		return task, ok, err
	}
	if update.UpdatedAt.IsZero() {
		update.UpdatedAt = time.Now().UTC()
	}
	if update.Title != nil {
		task.Title = *update.Title
	}
	if update.Closed != nil {
		task.Closed = *update.Closed
	}
	if update.LastViewedAtSet {
		task.LastViewedAt = update.LastViewedAt
	}
	if update.LastEventAtSet {
		task.LastEventAt = update.LastEventAt
	}
	if update.MetadataJSONSet {
		task.MetadataJSON = update.MetadataJSON
	}
	task.UpdatedAt = update.UpdatedAt

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, false, fmt.Errorf("begin task metadata update: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(
		ctx,
		`UPDATE tasks
SET title = ?, closed = ?, metadata_json = CASE WHEN ? != 0 THEN ? ELSE metadata_json END, updated_at = ?, last_viewed_at = ?, last_event_at = ?
WHERE id = ?`,
		task.Title,
		boolInt(task.Closed),
		boolInt(update.MetadataJSONSet),
		update.MetadataJSON,
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastViewedAt),
		nullTimeString(task.LastEventAt),
		task.ID,
	); err != nil {
		return Task{}, false, fmt.Errorf("update task metadata %s: %w", task.ID, err)
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO task_previews(
    task_id, repo_id, slug, title, closed, created_at, updated_at, last_viewed_at, last_event_at, usage_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(task_id) DO UPDATE SET
    repo_id = excluded.repo_id,
    slug = excluded.slug,
    title = excluded.title,
    closed = excluded.closed,
    updated_at = excluded.updated_at,
    last_viewed_at = excluded.last_viewed_at,
    last_event_at = excluded.last_event_at,
    usage_json = CASE WHEN ? != 0 THEN excluded.usage_json ELSE task_previews.usage_json END`,
		task.ID,
		task.RepoID,
		task.Slug,
		task.Title,
		boolInt(task.Closed),
		formatTime(task.CreatedAt),
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastViewedAt),
		nullTimeString(task.LastEventAt),
		update.UsageJSON,
		boolInt(update.UsageJSONSet),
	); err != nil {
		return Task{}, false, fmt.Errorf("update task preview metadata %s: %w", task.ID, err)
	}

	if err := tx.Commit(); err != nil {
		return Task{}, false, fmt.Errorf("commit task metadata update %s: %w", task.ID, err)
	}
	tx = nil
	return task, true, nil
}

func (store *Store) DeleteTask(ctx context.Context, repoID string, taskID string) (bool, error) {
	if repoID == "" {
		return false, errors.New("repo id is required")
	}
	if taskID == "" {
		return false, errors.New("task id is required")
	}
	result, err := store.db.ExecContext(ctx, "DELETE FROM tasks WHERE id = ? AND repo_id = ?", taskID, repoID)
	if err != nil {
		return false, fmt.Errorf("delete task %s: %w", taskID, err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read deleted task count %s: %w", taskID, err)
	}
	return deleted > 0, nil
}

func (store *Store) DeleteTaskAndBlobMetadata(ctx context.Context, repoID string, taskID string, blobIDs []string) (bool, error) {
	if repoID == "" {
		return false, errors.New("repo id is required")
	}
	if taskID == "" {
		return false, errors.New("task id is required")
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin task/blob delete %s: %w", taskID, err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()
	result, err := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id = ? AND repo_id = ?", taskID, repoID)
	if err != nil {
		return false, fmt.Errorf("delete task %s: %w", taskID, err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read deleted task count %s: %w", taskID, err)
	}
	if deleted == 0 {
		if err := tx.Commit(); err != nil {
			return false, fmt.Errorf("commit missing task/blob delete %s: %w", taskID, err)
		}
		tx = nil
		return false, nil
	}
	for _, blobID := range uniqueStrings(blobIDs) {
		if blobID == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM blobs WHERE id = ?", blobID); err != nil {
			return false, fmt.Errorf("delete task blob metadata %s: %w", blobID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit task/blob delete %s: %w", taskID, err)
	}
	tx = nil
	return true, nil
}

func (store *Store) ListTaskIDs(ctx context.Context) ([]string, error) {
	rows, err := store.db.QueryContext(ctx, "SELECT id FROM tasks ORDER BY id")
	if err != nil {
		return nil, fmt.Errorf("list task ids: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan task id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate task ids: %w", err)
	}
	return ids, nil
}

func (store *Store) UpsertTaskPreview(ctx context.Context, preview TaskPreview) error {
	if preview.TaskID == "" {
		return errors.New("task preview task id is required")
	}
	if preview.RepoID == "" {
		return errors.New("task preview repo id is required")
	}
	if preview.Title == "" {
		return errors.New("task preview title is required")
	}
	if preview.CreatedAt.IsZero() {
		preview.CreatedAt = time.Now().UTC()
	}
	if preview.UpdatedAt.IsZero() {
		preview.UpdatedAt = preview.CreatedAt
	}
	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO task_previews(
    task_id, repo_id, slug, title, closed, created_at, updated_at,
    last_viewed_at, last_event_at, last_event_json, usage_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(task_id) DO UPDATE SET
    repo_id = excluded.repo_id,
    slug = excluded.slug,
    title = excluded.title,
    closed = excluded.closed,
    updated_at = excluded.updated_at,
    last_viewed_at = excluded.last_viewed_at,
    last_event_at = excluded.last_event_at,
    last_event_json = excluded.last_event_json,
    usage_json = excluded.usage_json`,
		preview.TaskID,
		preview.RepoID,
		preview.Slug,
		preview.Title,
		boolInt(preview.Closed),
		formatTime(preview.CreatedAt),
		formatTime(preview.UpdatedAt),
		nullTimeString(preview.LastViewedAt),
		nullTimeString(preview.LastEventAt),
		preview.LastEventJSON,
		preview.UsageJSON,
	)
	if err != nil {
		return fmt.Errorf("upsert task preview %s: %w", preview.TaskID, err)
	}
	return nil
}

func (store *Store) ListTaskPreviews(ctx context.Context, repoID string) ([]TaskPreview, error) {
	rows, err := store.db.QueryContext(
		ctx,
		`SELECT task_id, repo_id, slug, title, closed, created_at, updated_at,
    last_viewed_at, last_event_at, last_event_json, usage_json
FROM task_previews
WHERE repo_id = ?
ORDER BY closed ASC, COALESCE(last_event_at, updated_at, created_at) DESC, title COLLATE NOCASE ASC`,
		repoID,
	)
	if err != nil {
		return nil, fmt.Errorf("list task previews for repo %s: %w", repoID, err)
	}
	defer rows.Close()

	previews := []TaskPreview{}
	for rows.Next() {
		preview, err := scanTaskPreview(rows)
		if err != nil {
			return nil, err
		}
		previews = append(previews, preview)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate task previews: %w", err)
	}
	return previews, nil
}

func (store *Store) UpsertTaskEvent(ctx context.Context, event TaskEvent) error {
	if event.ID == "" {
		return errors.New("task event id is required")
	}
	if event.TaskID == "" {
		return errors.New("task event task id is required")
	}
	if event.Type == "" {
		return errors.New("task event type is required")
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}
	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO task_events(
    id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    task_id = excluded.task_id,
    seq = excluded.seq,
    type = excluded.type,
    status = excluded.status,
    source_type = excluded.source_type,
    source_label = excluded.source_label,
    created_at = excluded.created_at,
    payload_json = excluded.payload_json,
    payload_blob_id = excluded.payload_blob_id`,
		event.ID,
		event.TaskID,
		event.Seq,
		event.Type,
		event.Status,
		event.SourceType,
		event.SourceLabel,
		formatTime(event.CreatedAt),
		event.PayloadJSON,
		event.PayloadBlobID,
	)
	if err != nil {
		return fmt.Errorf("upsert task event %s: %w", event.ID, err)
	}
	return nil
}

func (store *Store) GetTaskEvent(ctx context.Context, taskID string, eventID string) (TaskEvent, bool, error) {
	if taskID == "" || eventID == "" {
		return TaskEvent{}, false, nil
	}
	row := store.db.QueryRowContext(
		ctx,
		`SELECT id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
FROM task_events
WHERE task_id = ? AND id = ?`,
		taskID,
		eventID,
	)
	event, err := scanTaskEvent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return TaskEvent{}, false, nil
	}
	if err != nil {
		return TaskEvent{}, false, fmt.Errorf("get task event %s: %w", eventID, err)
	}
	return event, true, nil
}

func (store *Store) WriteTaskEvent(ctx context.Context, write TaskEventWrite) (Task, TaskEvent, bool, error) {
	event := write.Event
	if event.ID == "" {
		return Task{}, TaskEvent{}, false, errors.New("task event id is required")
	}
	if event.TaskID == "" {
		return Task{}, TaskEvent{}, false, errors.New("task event task id is required")
	}
	if event.Type == "" {
		return Task{}, TaskEvent{}, false, errors.New("task event type is required")
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}
	if write.UpdatedAt.IsZero() {
		write.UpdatedAt = event.CreatedAt
	}

	task, ok, err := store.GetTask(ctx, event.TaskID)
	if err != nil {
		return Task{}, TaskEvent{}, false, err
	}
	if !ok {
		return Task{}, TaskEvent{}, false, sql.ErrNoRows
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, TaskEvent{}, false, fmt.Errorf("begin task event write: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	existing, found, err := getTaskEventTx(ctx, tx, event.TaskID, event.ID)
	if err != nil {
		return Task{}, TaskEvent{}, false, err
	}
	if found && write.PreserveExisting {
		if err := tx.Commit(); err != nil {
			return Task{}, TaskEvent{}, false, fmt.Errorf("commit preserved task event %s: %w", event.ID, err)
		}
		tx = nil
		return task, existing, false, nil
	}
	if found && event.Seq == 0 {
		event.Seq = existing.Seq
	}
	if event.Seq == 0 {
		seq, err := taskEventSeqForUpsertTx(ctx, tx, event.TaskID, event.ID)
		if err != nil {
			return Task{}, TaskEvent{}, false, err
		}
		event.Seq = seq
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO task_events(
    id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    task_id = excluded.task_id,
    seq = excluded.seq,
    type = excluded.type,
    status = excluded.status,
    source_type = excluded.source_type,
    source_label = excluded.source_label,
    payload_json = excluded.payload_json,
    payload_blob_id = excluded.payload_blob_id`,
		event.ID,
		event.TaskID,
		event.Seq,
		event.Type,
		event.Status,
		event.SourceType,
		event.SourceLabel,
		formatTime(event.CreatedAt),
		event.PayloadJSON,
		event.PayloadBlobID,
	); err != nil {
		return Task{}, TaskEvent{}, false, fmt.Errorf("write task event %s: %w", event.ID, err)
	}

	task.UpdatedAt = write.UpdatedAt
	if write.UpdateLastEvent {
		if write.LastEventAt.Valid {
			task.LastEventAt = write.LastEventAt
		} else {
			task.LastEventAt = sql.NullTime{Time: event.CreatedAt, Valid: true}
		}
	}
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE tasks
SET updated_at = ?, last_event_at = ?
WHERE id = ?`,
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastEventAt),
		task.ID,
	); err != nil {
		return Task{}, TaskEvent{}, false, fmt.Errorf("update task event metadata %s: %w", task.ID, err)
	}
	if write.UpdatePreview {
		previewLastEventAt := task.LastEventAt
		if !previewLastEventAt.Valid {
			previewLastEventAt = sql.NullTime{Time: event.CreatedAt, Valid: true}
		}
		lastEventJSON := write.LastEventJSON
		if !lastEventJSON.Valid {
			lastEventJSON = event.PayloadJSON
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO task_previews(
    task_id, repo_id, slug, title, closed, created_at, updated_at, last_viewed_at, last_event_at, last_event_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(task_id) DO UPDATE SET
    repo_id = excluded.repo_id,
    slug = excluded.slug,
    title = excluded.title,
    closed = excluded.closed,
    updated_at = excluded.updated_at,
    last_viewed_at = excluded.last_viewed_at,
    last_event_at = excluded.last_event_at,
    last_event_json = excluded.last_event_json`,
			task.ID,
			task.RepoID,
			task.Slug,
			task.Title,
			boolInt(task.Closed),
			formatTime(task.CreatedAt),
			formatTime(task.UpdatedAt),
			nullTimeString(task.LastViewedAt),
			nullTimeString(previewLastEventAt),
			lastEventJSON,
		); err != nil {
			return Task{}, TaskEvent{}, false, fmt.Errorf("update task event preview %s: %w", task.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return Task{}, TaskEvent{}, false, fmt.Errorf("commit task event write %s: %w", event.ID, err)
	}
	tx = nil
	return task, event, true, nil
}

func (store *Store) SetupTaskEnvironment(ctx context.Context, setup TaskEnvironmentSetup) (Task, bool, error) {
	if setup.TaskID == "" {
		return Task{}, false, errors.New("task id is required")
	}
	if setup.DeviceEnvironment.ID == "" {
		return Task{}, false, errors.New("task device environment id is required")
	}
	if setup.DeviceEnvironment.DeviceID == "" {
		return Task{}, false, errors.New("task device environment device id is required")
	}
	task, ok, err := store.GetTask(ctx, setup.TaskID)
	if err != nil || !ok {
		return task, ok, err
	}
	now := time.Now().UTC()
	if setup.UpdatedAt.IsZero() {
		setup.UpdatedAt = now
	}
	if setup.DeviceEnvironment.TaskID == "" {
		setup.DeviceEnvironment.TaskID = setup.TaskID
	}
	if setup.DeviceEnvironment.TaskID != setup.TaskID {
		return Task{}, false, errors.New("task device environment task id mismatch")
	}
	if setup.DeviceEnvironment.CreatedAt.IsZero() {
		setup.DeviceEnvironment.CreatedAt = setup.UpdatedAt
	}
	if setup.DeviceEnvironment.LastUsedAt.IsZero() {
		setup.DeviceEnvironment.LastUsedAt = setup.UpdatedAt
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, false, fmt.Errorf("begin task environment setup: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO task_device_environments(
    id, task_id, device_id, worktree_dir, setup_complete, merge_base_commit, created_at, last_used_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(task_id, id) DO UPDATE SET
    device_id = excluded.device_id,
    worktree_dir = excluded.worktree_dir,
    setup_complete = excluded.setup_complete,
    merge_base_commit = excluded.merge_base_commit,
    last_used_at = excluded.last_used_at`,
		setup.DeviceEnvironment.ID,
		setup.DeviceEnvironment.TaskID,
		setup.DeviceEnvironment.DeviceID,
		setup.DeviceEnvironment.WorktreeDir,
		boolInt(setup.DeviceEnvironment.SetupComplete),
		setup.DeviceEnvironment.MergeBaseCommit,
		formatTime(setup.DeviceEnvironment.CreatedAt),
		formatTime(setup.DeviceEnvironment.LastUsedAt),
	); err != nil {
		return Task{}, false, fmt.Errorf("upsert task device environment %s: %w", setup.DeviceEnvironment.ID, err)
	}

	lastEventAt := task.LastEventAt
	lastEventJSON := sql.NullString{}
	hasSetupEvent := setup.SetupEvent != nil
	if hasSetupEvent {
		event := *setup.SetupEvent
		if event.ID == "" {
			return Task{}, false, errors.New("setup event id is required")
		}
		if event.TaskID == "" {
			event.TaskID = setup.TaskID
		}
		if event.TaskID != setup.TaskID {
			return Task{}, false, errors.New("setup event task id mismatch")
		}
		if event.Type == "" {
			event.Type = "setup_environment"
		}
		if event.CreatedAt.IsZero() {
			event.CreatedAt = setup.UpdatedAt
		}
		seq, err := taskEventSeqForUpsertTx(ctx, tx, setup.TaskID, event.ID)
		if err != nil {
			return Task{}, false, err
		}
		event.Seq = seq
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO task_events(
    id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    task_id = excluded.task_id,
    seq = excluded.seq,
    type = excluded.type,
    status = excluded.status,
    source_type = excluded.source_type,
    source_label = excluded.source_label,
    created_at = excluded.created_at,
    payload_json = excluded.payload_json,
    payload_blob_id = excluded.payload_blob_id`,
			event.ID,
			event.TaskID,
			event.Seq,
			event.Type,
			event.Status,
			event.SourceType,
			event.SourceLabel,
			formatTime(event.CreatedAt),
			event.PayloadJSON,
			event.PayloadBlobID,
		); err != nil {
			return Task{}, false, fmt.Errorf("upsert setup event %s: %w", event.ID, err)
		}
		lastEventAt = sql.NullTime{Time: event.CreatedAt, Valid: true}
		lastEventJSON = event.PayloadJSON
	}

	task.UpdatedAt = setup.UpdatedAt
	task.LastEventAt = lastEventAt
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE tasks
SET updated_at = ?, last_event_at = ?
WHERE id = ?`,
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastEventAt),
		task.ID,
	); err != nil {
		return Task{}, false, fmt.Errorf("update task environment metadata %s: %w", task.ID, err)
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO task_previews(
    task_id, repo_id, slug, title, closed, created_at, updated_at, last_viewed_at, last_event_at, last_event_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(task_id) DO UPDATE SET
    repo_id = excluded.repo_id,
    slug = excluded.slug,
    title = excluded.title,
    closed = excluded.closed,
    updated_at = excluded.updated_at,
    last_viewed_at = excluded.last_viewed_at,
    last_event_at = CASE WHEN ? != 0 THEN excluded.last_event_at ELSE task_previews.last_event_at END,
    last_event_json = CASE WHEN ? != 0 THEN excluded.last_event_json ELSE task_previews.last_event_json END`,
		task.ID,
		task.RepoID,
		task.Slug,
		task.Title,
		boolInt(task.Closed),
		formatTime(task.CreatedAt),
		formatTime(task.UpdatedAt),
		nullTimeString(task.LastViewedAt),
		nullTimeString(task.LastEventAt),
		lastEventJSON,
		boolInt(hasSetupEvent),
		boolInt(hasSetupEvent),
	); err != nil {
		return Task{}, false, fmt.Errorf("update task environment preview %s: %w", task.ID, err)
	}

	if err := tx.Commit(); err != nil {
		return Task{}, false, fmt.Errorf("commit task environment setup %s: %w", task.ID, err)
	}
	tx = nil
	return task, true, nil
}

func (store *Store) ListTaskDeviceEnvironments(ctx context.Context, taskID string) ([]TaskDeviceEnvironment, error) {
	rows, err := store.db.QueryContext(
		ctx,
		`SELECT id, task_id, device_id, worktree_dir, setup_complete, merge_base_commit, created_at, last_used_at
FROM task_device_environments
WHERE task_id = ?
ORDER BY last_used_at ASC, created_at ASC, id ASC`,
		taskID,
	)
	if err != nil {
		return nil, fmt.Errorf("list task device environments %s: %w", taskID, err)
	}
	defer rows.Close()

	environments := []TaskDeviceEnvironment{}
	for rows.Next() {
		environment, err := scanTaskDeviceEnvironment(rows)
		if err != nil {
			return nil, err
		}
		environments = append(environments, environment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate task device environments %s: %w", taskID, err)
	}
	return environments, nil
}

func (store *Store) ListTaskEvents(ctx context.Context, taskID string, hydrate bool) ([]TaskEvent, error) {
	limitClause := ""
	if !hydrate {
		limitClause = " LIMIT 80"
	}
	rows, err := store.db.QueryContext(
		ctx,
		`SELECT id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
FROM (
    SELECT id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
    FROM task_events
    WHERE task_id = ?
    ORDER BY seq DESC`+limitClause+`
)
ORDER BY seq ASC`,
		taskID,
	)
	if err != nil {
		return nil, fmt.Errorf("list task events for task %s: %w", taskID, err)
	}
	defer rows.Close()

	events := []TaskEvent{}
	for rows.Next() {
		event, err := scanTaskEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate task events: %w", err)
	}
	return events, nil
}

func (store *Store) UpsertComment(ctx context.Context, comment Comment) error {
	if comment.ID == "" {
		return errors.New("comment id is required")
	}
	if comment.TaskID == "" {
		return errors.New("comment task id is required")
	}
	if comment.CreatedAt.IsZero() {
		comment.CreatedAt = time.Now().UTC()
	}
	if comment.UpdatedAt.IsZero() {
		comment.UpdatedAt = comment.CreatedAt
	}
	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO comments(id, task_id, body, anchor_json, created_at, updated_at, deleted_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    task_id = excluded.task_id,
    body = excluded.body,
    anchor_json = excluded.anchor_json,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at`,
		comment.ID,
		comment.TaskID,
		comment.Body,
		comment.AnchorJSON,
		formatTime(comment.CreatedAt),
		formatTime(comment.UpdatedAt),
		nullTimeString(comment.DeletedAt),
	)
	if err != nil {
		return fmt.Errorf("upsert comment %s: %w", comment.ID, err)
	}
	return nil
}

func (store *Store) EditComment(ctx context.Context, taskID string, commentID string, body string, updatedAt time.Time) (bool, error) {
	if taskID == "" {
		return false, errors.New("comment task id is required")
	}
	if commentID == "" {
		return false, errors.New("comment id is required")
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE comments
SET body = ?, updated_at = ?
WHERE id = ? AND task_id = ? AND deleted_at IS NULL`,
		body,
		formatTime(updatedAt),
		commentID,
		taskID,
	)
	if err != nil {
		return false, fmt.Errorf("edit comment %s: %w", commentID, err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read edited comment count %s: %w", commentID, err)
	}
	return updated > 0, nil
}

func (store *Store) DeleteComment(ctx context.Context, taskID string, commentID string, deletedAt time.Time) (bool, error) {
	if taskID == "" {
		return false, errors.New("comment task id is required")
	}
	if commentID == "" {
		return false, errors.New("comment id is required")
	}
	if deletedAt.IsZero() {
		deletedAt = time.Now().UTC()
	}
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE comments
SET deleted_at = ?, updated_at = ?
WHERE id = ? AND task_id = ? AND deleted_at IS NULL`,
		formatTime(deletedAt),
		formatTime(deletedAt),
		commentID,
		taskID,
	)
	if err != nil {
		return false, fmt.Errorf("delete comment %s: %w", commentID, err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read deleted comment count %s: %w", commentID, err)
	}
	return updated > 0, nil
}

func (store *Store) ListComments(ctx context.Context, taskID string) ([]Comment, error) {
	rows, err := store.db.QueryContext(
		ctx,
		`SELECT id, task_id, body, anchor_json, created_at, updated_at, deleted_at
FROM comments
WHERE task_id = ? AND deleted_at IS NULL
ORDER BY created_at ASC`,
		taskID,
	)
	if err != nil {
		return nil, fmt.Errorf("list comments for task %s: %w", taskID, err)
	}
	defer rows.Close()

	comments := []Comment{}
	for rows.Next() {
		var comment Comment
		var createdAt string
		var updatedAt string
		var deletedAt sql.NullString
		if err := rows.Scan(&comment.ID, &comment.TaskID, &comment.Body, &comment.AnchorJSON, &createdAt, &updatedAt, &deletedAt); err != nil {
			return nil, fmt.Errorf("scan comment: %w", err)
		}
		var parseErr error
		comment.CreatedAt, parseErr = parseTime(createdAt)
		if parseErr != nil {
			return nil, parseErr
		}
		comment.UpdatedAt, parseErr = parseTime(updatedAt)
		if parseErr != nil {
			return nil, parseErr
		}
		comment.DeletedAt, parseErr = parseNullTime(deletedAt)
		if parseErr != nil {
			return nil, parseErr
		}
		comments = append(comments, comment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate comments: %w", err)
	}
	return comments, nil
}

func (store *Store) UpsertQueuedTurn(ctx context.Context, turn QueuedTurn) error {
	now := time.Now().UTC()
	if err := validateQueuedTurn(turn); err != nil {
		return err
	}
	if turn.CreatedAt.IsZero() {
		turn.CreatedAt = now
	}
	if turn.UpdatedAt.IsZero() {
		turn.UpdatedAt = turn.CreatedAt
	}
	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO queued_turns(id, task_id, type, input, status, position, payload_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    task_id = excluded.task_id,
    type = excluded.type,
    input = excluded.input,
    status = excluded.status,
    position = excluded.position,
    payload_json = excluded.payload_json,
    updated_at = excluded.updated_at`,
		turn.ID,
		turn.TaskID,
		turn.Type,
		turn.Input,
		turn.Status,
		turn.Position,
		turn.PayloadJSON,
		formatTime(turn.CreatedAt),
		formatTime(turn.UpdatedAt),
	)
	if err != nil {
		return fmt.Errorf("upsert queued turn %s: %w", turn.ID, err)
	}
	return nil
}

func (store *Store) CreateQueuedTurn(ctx context.Context, turn QueuedTurn) (QueuedTurn, bool, error) {
	now := time.Now().UTC()
	if err := validateQueuedTurn(turn); err != nil {
		return QueuedTurn{}, false, err
	}
	if turn.CreatedAt.IsZero() {
		turn.CreatedAt = now
	}
	if turn.UpdatedAt.IsZero() {
		turn.UpdatedAt = turn.CreatedAt
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return QueuedTurn{}, false, fmt.Errorf("begin queued turn create: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	existing, found, err := getQueuedTurnByIDTx(ctx, tx, turn.ID)
	if err != nil {
		return QueuedTurn{}, false, err
	}
	if found {
		if existing.TaskID != turn.TaskID {
			return QueuedTurn{}, false, errors.New("queued turn id belongs to another task")
		}
		if err := tx.Commit(); err != nil {
			return QueuedTurn{}, false, fmt.Errorf("commit existing queued turn create %s: %w", turn.ID, err)
		}
		tx = nil
		return existing, false, nil
	}
	if turn.Position <= 0 {
		position, err := nextQueuedTurnPositionTx(ctx, tx, turn.TaskID)
		if err != nil {
			return QueuedTurn{}, false, err
		}
		turn.Position = position
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO queued_turns(id, task_id, type, input, status, position, payload_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		turn.ID,
		turn.TaskID,
		turn.Type,
		turn.Input,
		turn.Status,
		turn.Position,
		turn.PayloadJSON,
		formatTime(turn.CreatedAt),
		formatTime(turn.UpdatedAt),
	); err != nil {
		return QueuedTurn{}, false, fmt.Errorf("create queued turn %s: %w", turn.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, false, fmt.Errorf("commit queued turn create %s: %w", turn.ID, err)
	}
	tx = nil
	return turn, true, nil
}

func (store *Store) ListQueuedTurns(ctx context.Context, taskID string) ([]QueuedTurn, error) {
	rows, err := store.db.QueryContext(
		ctx,
		`SELECT id, task_id, type, input, status, position, payload_json, created_at, updated_at
FROM queued_turns
WHERE task_id = ?
ORDER BY position ASC, created_at ASC, id ASC`,
		taskID,
	)
	if err != nil {
		return nil, fmt.Errorf("list queued turns for task %s: %w", taskID, err)
	}
	defer rows.Close()

	turns := []QueuedTurn{}
	for rows.Next() {
		turn, err := scanQueuedTurn(rows)
		if err != nil {
			return nil, err
		}
		turns = append(turns, turn)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate queued turns: %w", err)
	}
	return turns, nil
}

func (store *Store) ReorderQueuedTurns(ctx context.Context, taskID string, queuedTurnIDs []string, updatedAt time.Time) ([]QueuedTurn, bool, error) {
	if taskID == "" {
		return nil, false, errors.New("queued turn task id is required")
	}
	if len(queuedTurnIDs) == 0 {
		return nil, false, errors.New("queued turn ids are required")
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	seen := map[string]bool{}
	for _, id := range queuedTurnIDs {
		if id == "" {
			return nil, false, errors.New("queued turn id is required")
		}
		if seen[id] {
			return nil, false, errors.New("queued turn ids must be unique")
		}
		seen[id] = true
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("begin queued turn reorder: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	reordered := false
	for index, id := range queuedTurnIDs {
		turn, found, err := getQueuedTurnTx(ctx, tx, taskID, id)
		if err != nil {
			return nil, false, err
		}
		if !found {
			return nil, false, fmt.Errorf("queued turn %s not found", id)
		}
		if turn.Status != "queued" {
			return nil, false, fmt.Errorf("queued turn %s is not queued", id)
		}
		position := int64(index + 1)
		if turn.Position == position {
			continue
		}
		reordered = true
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE queued_turns
SET position = ?, updated_at = ?
WHERE id = ? AND task_id = ?`,
			position,
			formatTime(updatedAt),
			id,
			taskID,
		); err != nil {
			return nil, false, fmt.Errorf("reorder queued turn %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("commit queued turn reorder %s: %w", taskID, err)
	}
	tx = nil
	turns, err := store.ListQueuedTurns(ctx, taskID)
	if err != nil {
		return nil, false, err
	}
	return turns, reordered, nil
}

func (store *Store) ClaimNextQueuedTurn(ctx context.Context, taskID string, updatedAt time.Time) (QueuedTurn, bool, error) {
	if taskID == "" {
		return QueuedTurn{}, false, errors.New("queued turn task id is required")
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return QueuedTurn{}, false, fmt.Errorf("begin queued turn claim: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	row := tx.QueryRowContext(
		ctx,
		`SELECT id, task_id, type, input, status, position, payload_json, created_at, updated_at
FROM queued_turns
WHERE task_id = ? AND status = 'queued'
ORDER BY position ASC, created_at ASC, id ASC
LIMIT 1`,
		taskID,
	)
	turn, err := scanQueuedTurn(row)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.Commit(); err != nil {
			return QueuedTurn{}, false, fmt.Errorf("commit empty queued turn claim %s: %w", taskID, err)
		}
		tx = nil
		return QueuedTurn{}, false, nil
	}
	if err != nil {
		return QueuedTurn{}, false, err
	}
	turn.Status = "running"
	turn.UpdatedAt = updatedAt
	result, err := tx.ExecContext(
		ctx,
		`UPDATE queued_turns
SET status = ?, updated_at = ?
WHERE id = ? AND task_id = ? AND status = 'queued'`,
		turn.Status,
		formatTime(turn.UpdatedAt),
		turn.ID,
		turn.TaskID,
	)
	if err != nil {
		return QueuedTurn{}, false, fmt.Errorf("claim queued turn %s: %w", turn.ID, err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return QueuedTurn{}, false, fmt.Errorf("read queued turn claim result %s: %w", turn.ID, err)
	}
	if rowsAffected == 0 {
		if err := tx.Commit(); err != nil {
			return QueuedTurn{}, false, fmt.Errorf("commit lost queued turn claim %s: %w", turn.ID, err)
		}
		tx = nil
		return QueuedTurn{}, false, nil
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, false, fmt.Errorf("commit queued turn claim %s: %w", turn.ID, err)
	}
	tx = nil
	return turn, true, nil
}

func (store *Store) SetQueuedTurnRunningEvent(ctx context.Context, taskID string, queuedTurnID string, payloadJSON sql.NullString, updatedAt time.Time) (QueuedTurn, bool, error) {
	if taskID == "" {
		return QueuedTurn{}, false, errors.New("queued turn task id is required")
	}
	if queuedTurnID == "" {
		return QueuedTurn{}, false, errors.New("queued turn id is required")
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return QueuedTurn{}, false, fmt.Errorf("begin queued turn running event update: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()
	turn, found, err := getQueuedTurnTx(ctx, tx, taskID, queuedTurnID)
	if err != nil || !found {
		return turn, found, err
	}
	if turn.Status != "running" {
		if err := tx.Commit(); err != nil {
			return QueuedTurn{}, false, fmt.Errorf("commit unchanged queued turn running event %s: %w", queuedTurnID, err)
		}
		tx = nil
		return turn, true, nil
	}
	turn.PayloadJSON = payloadJSON
	turn.UpdatedAt = updatedAt
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE queued_turns
SET payload_json = ?, updated_at = ?
WHERE id = ? AND task_id = ? AND status = 'running'`,
		turn.PayloadJSON,
		formatTime(turn.UpdatedAt),
		turn.ID,
		turn.TaskID,
	); err != nil {
		return QueuedTurn{}, false, fmt.Errorf("update queued turn running event %s: %w", queuedTurnID, err)
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, false, fmt.Errorf("commit queued turn running event %s: %w", queuedTurnID, err)
	}
	tx = nil
	return turn, true, nil
}

func (store *Store) CompleteQueuedTurn(ctx context.Context, taskID string, queuedTurnID string, status string, updatedAt time.Time) (QueuedTurn, bool, bool, error) {
	if taskID == "" {
		return QueuedTurn{}, false, false, errors.New("queued turn task id is required")
	}
	if queuedTurnID == "" {
		return QueuedTurn{}, false, false, errors.New("queued turn id is required")
	}
	if !isQueuedTurnTerminalStatus(status) {
		return QueuedTurn{}, false, false, errors.New("queued turn terminal status is invalid")
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return QueuedTurn{}, false, false, fmt.Errorf("begin queued turn complete: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()
	turn, found, err := getQueuedTurnTx(ctx, tx, taskID, queuedTurnID)
	if err != nil || !found {
		return turn, found, false, err
	}
	if turn.Status != "running" {
		if err := tx.Commit(); err != nil {
			return QueuedTurn{}, false, false, fmt.Errorf("commit unchanged queued turn complete %s: %w", queuedTurnID, err)
		}
		tx = nil
		return turn, true, false, nil
	}
	turn.Status = status
	turn.UpdatedAt = updatedAt
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE queued_turns
SET status = ?, updated_at = ?
WHERE id = ? AND task_id = ? AND status = 'running'`,
		turn.Status,
		formatTime(turn.UpdatedAt),
		turn.ID,
		turn.TaskID,
	); err != nil {
		return QueuedTurn{}, false, false, fmt.Errorf("complete queued turn %s: %w", queuedTurnID, err)
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, false, false, fmt.Errorf("commit queued turn complete %s: %w", queuedTurnID, err)
	}
	tx = nil
	return turn, true, true, nil
}

func (store *Store) CancelQueuedTurn(ctx context.Context, taskID string, queuedTurnID string, updatedAt time.Time) (QueuedTurn, bool, bool, error) {
	if taskID == "" {
		return QueuedTurn{}, false, false, errors.New("queued turn task id is required")
	}
	if queuedTurnID == "" {
		return QueuedTurn{}, false, false, errors.New("queued turn id is required")
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return QueuedTurn{}, false, false, fmt.Errorf("begin queued turn cancel: %w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	turn, found, err := getQueuedTurnTx(ctx, tx, taskID, queuedTurnID)
	if err != nil || !found {
		return turn, found, false, err
	}
	if turn.Status != "queued" {
		if err := tx.Commit(); err != nil {
			return QueuedTurn{}, false, false, fmt.Errorf("commit unchanged queued turn cancel %s: %w", queuedTurnID, err)
		}
		tx = nil
		return turn, true, false, nil
	}

	turn.Status = "cancelled"
	turn.UpdatedAt = updatedAt
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE queued_turns
SET status = ?, updated_at = ?
WHERE id = ? AND task_id = ?`,
		turn.Status,
		formatTime(turn.UpdatedAt),
		turn.ID,
		turn.TaskID,
	); err != nil {
		return QueuedTurn{}, false, false, fmt.Errorf("cancel queued turn %s: %w", queuedTurnID, err)
	}
	if err := tx.Commit(); err != nil {
		return QueuedTurn{}, false, false, fmt.Errorf("commit queued turn cancel %s: %w", queuedTurnID, err)
	}
	tx = nil
	return turn, true, true, nil
}

func (store *Store) PutBlobMetadata(ctx context.Context, blob BlobMetadata) error {
	if blob.ID == "" {
		return errors.New("blob id is required")
	}
	if blob.Kind == "" {
		return errors.New("blob kind is required")
	}
	if blob.SHA256 == "" {
		return errors.New("blob sha256 is required")
	}
	if blob.Path == "" {
		return errors.New("blob path is required")
	}
	if blob.CreatedAt.IsZero() {
		blob.CreatedAt = time.Now().UTC()
	}
	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO blobs(id, kind, content_type, size_bytes, sha256, path, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    kind = excluded.kind,
    content_type = excluded.content_type,
    size_bytes = excluded.size_bytes,
    sha256 = excluded.sha256,
    path = excluded.path`,
		blob.ID,
		blob.Kind,
		blob.ContentType,
		blob.SizeBytes,
		blob.SHA256,
		blob.Path,
		formatTime(blob.CreatedAt),
	)
	if err != nil {
		return fmt.Errorf("put blob metadata %s: %w", blob.ID, err)
	}
	return nil
}

func (store *Store) GetBlobMetadata(ctx context.Context, id string) (BlobMetadata, bool, error) {
	if id == "" {
		return BlobMetadata{}, false, nil
	}
	var blob BlobMetadata
	var createdAt string
	err := store.db.QueryRowContext(
		ctx,
		`SELECT id, kind, content_type, size_bytes, sha256, path, created_at
FROM blobs
WHERE id = ?`,
		id,
	).Scan(&blob.ID, &blob.Kind, &blob.ContentType, &blob.SizeBytes, &blob.SHA256, &blob.Path, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return BlobMetadata{}, false, nil
	}
	if err != nil {
		return BlobMetadata{}, false, fmt.Errorf("get blob metadata %s: %w", id, err)
	}
	parsed, err := parseTime(createdAt)
	if err != nil {
		return BlobMetadata{}, false, err
	}
	blob.CreatedAt = parsed
	return blob, true, nil
}

func (store *Store) ListBlobMetadataByKind(ctx context.Context, kind string) ([]BlobMetadata, error) {
	if kind == "" {
		return nil, errors.New("blob kind is required")
	}
	rows, err := store.db.QueryContext(
		ctx,
		`SELECT id, kind, content_type, size_bytes, sha256, path, created_at
FROM blobs
WHERE kind = ?
ORDER BY created_at, id`,
		kind,
	)
	if err != nil {
		return nil, fmt.Errorf("list blob metadata for kind %s: %w", kind, err)
	}
	defer rows.Close()
	blobs := []BlobMetadata{}
	for rows.Next() {
		var blob BlobMetadata
		var createdAt string
		if err := rows.Scan(&blob.ID, &blob.Kind, &blob.ContentType, &blob.SizeBytes, &blob.SHA256, &blob.Path, &createdAt); err != nil {
			return nil, fmt.Errorf("scan blob metadata for kind %s: %w", kind, err)
		}
		parsed, err := parseTime(createdAt)
		if err != nil {
			return nil, err
		}
		blob.CreatedAt = parsed
		blobs = append(blobs, blob)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate blob metadata for kind %s: %w", kind, err)
	}
	return blobs, nil
}

func (store *Store) DeleteBlobMetadataIfUnchanged(ctx context.Context, blob BlobMetadata) (bool, error) {
	if blob.ID == "" {
		return false, errors.New("blob id is required")
	}
	if blob.Kind == "" {
		return false, errors.New("blob kind is required")
	}
	if blob.SHA256 == "" {
		return false, errors.New("blob sha256 is required")
	}
	if blob.Path == "" {
		return false, errors.New("blob path is required")
	}
	if blob.CreatedAt.IsZero() {
		return false, errors.New("blob created_at is required")
	}
	result, err := store.db.ExecContext(
		ctx,
		`DELETE FROM blobs
WHERE id = ? AND kind = ? AND sha256 = ? AND path = ? AND created_at = ?`,
		blob.ID,
		blob.Kind,
		blob.SHA256,
		blob.Path,
		formatTime(blob.CreatedAt),
	)
	if err != nil {
		return false, fmt.Errorf("delete unchanged blob metadata %s: %w", blob.ID, err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read deleted blob metadata count %s: %w", blob.ID, err)
	}
	return deleted > 0, nil
}

func (store *Store) PutSetting(ctx context.Context, key string, value json.RawMessage, updatedAt time.Time) error {
	if key == "" {
		return errors.New("setting key is required")
	}
	if len(value) == 0 || !json.Valid(value) {
		return errors.New("setting value must be valid JSON")
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO settings(key, value_json, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET
    value_json = excluded.value_json,
    updated_at = excluded.updated_at`,
		key,
		string(value),
		formatTime(updatedAt),
	)
	if err != nil {
		return fmt.Errorf("put setting %s: %w", key, err)
	}
	return nil
}

func (store *Store) GetSetting(ctx context.Context, key string) (json.RawMessage, bool, error) {
	if key == "" {
		return nil, false, nil
	}
	var value string
	err := store.db.QueryRowContext(ctx, `SELECT value_json FROM settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get setting %s: %w", key, err)
	}
	if !json.Valid([]byte(value)) {
		return nil, false, fmt.Errorf("setting %s contains invalid JSON", key)
	}
	return json.RawMessage(value), true, nil
}

func (store *Store) UpsertRuntime(ctx context.Context, runtime RuntimeRecord) error {
	if runtime.RuntimeID == "" {
		return errors.New("runtime id is required")
	}
	if runtime.Kind == "" {
		return errors.New("runtime kind is required")
	}
	if runtime.Status == "" {
		return errors.New("runtime status is required")
	}
	now := time.Now().UTC()
	if runtime.StartedAt.IsZero() {
		runtime.StartedAt = now
	}
	if runtime.UpdatedAt.IsZero() {
		runtime.UpdatedAt = now
	}
	if runtime.LastActivityAt.IsZero() {
		runtime.LastActivityAt = runtime.UpdatedAt
	}
	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO runtimes(runtime_id, kind, status, scope_json, started_at, updated_at, last_activity_at, payload_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(runtime_id) DO UPDATE SET
    kind = excluded.kind,
    status = excluded.status,
    scope_json = excluded.scope_json,
    updated_at = excluded.updated_at,
    last_activity_at = excluded.last_activity_at,
    payload_json = excluded.payload_json`,
		runtime.RuntimeID,
		runtime.Kind,
		runtime.Status,
		runtime.ScopeJSON,
		formatTime(runtime.StartedAt),
		formatTime(runtime.UpdatedAt),
		formatTime(runtime.LastActivityAt),
		runtime.PayloadJSON,
	)
	if err != nil {
		return fmt.Errorf("upsert runtime %s: %w", runtime.RuntimeID, err)
	}
	return nil
}

func (store *Store) GetRuntime(ctx context.Context, runtimeID string) (RuntimeRecord, bool, error) {
	if runtimeID == "" {
		return RuntimeRecord{}, false, nil
	}
	row := store.db.QueryRowContext(
		ctx,
		`SELECT runtime_id, kind, status, scope_json, started_at, updated_at, last_activity_at, payload_json
FROM runtimes
WHERE runtime_id = ?`,
		runtimeID,
	)
	runtime, err := scanRuntimeRecord(row)
	if errors.Is(err, sql.ErrNoRows) {
		return RuntimeRecord{}, false, nil
	}
	if err != nil {
		return RuntimeRecord{}, false, fmt.Errorf("get runtime %s: %w", runtimeID, err)
	}
	return runtime, true, nil
}

const runtimeRecordSelectSQL = `SELECT runtime_id, kind, status, scope_json, started_at, updated_at, last_activity_at, payload_json
FROM runtimes`

const runtimeRecordOrderSQL = ` ORDER BY last_activity_at DESC, runtime_id ASC`

const runtimeScopeValidSQL = `scope_json IS NOT NULL AND json_valid(scope_json)`

func (store *Store) ListRuntimes(ctx context.Context) ([]RuntimeRecord, error) {
	return store.ListRuntimesFiltered(ctx, RuntimeListFilter{})
}

func (store *Store) ListRuntimesFiltered(ctx context.Context, filter RuntimeListFilter) ([]RuntimeRecord, error) {
	var rows *sql.Rows
	var err error
	statusListSQL := runtimeStatusListSQL(filter.Statuses)
	switch {
	case filter.OwnerType != "" && filter.OwnerID != "" && filter.Status != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?
  AND json_extract(scope_json, '$.ownerId') = ?
  AND status = ?`+runtimeRecordOrderSQL,
			filter.OwnerType,
			filter.OwnerID,
			filter.Status,
		)
	case filter.OwnerType != "" && filter.OwnerID != "" && statusListSQL != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?
  AND json_extract(scope_json, '$.ownerId') = ?
  AND status IN (`+statusListSQL+`)`+runtimeRecordOrderSQL,
			filter.OwnerType,
			filter.OwnerID,
		)
	case filter.OwnerType != "" && filter.OwnerID != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?
  AND json_extract(scope_json, '$.ownerId') = ?`+runtimeRecordOrderSQL,
			filter.OwnerType,
			filter.OwnerID,
		)
	case filter.OwnerType != "" && filter.Status != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?
  AND status = ?`+runtimeRecordOrderSQL,
			filter.OwnerType,
			filter.Status,
		)
	case filter.OwnerType != "" && statusListSQL != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?
  AND status IN (`+statusListSQL+`)`+runtimeRecordOrderSQL,
			filter.OwnerType,
		)
	case filter.OwnerID != "" && filter.Status != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerId') = ?
  AND status = ?`+runtimeRecordOrderSQL,
			filter.OwnerID,
			filter.Status,
		)
	case filter.OwnerID != "" && statusListSQL != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerId') = ?
  AND status IN (`+statusListSQL+`)`+runtimeRecordOrderSQL,
			filter.OwnerID,
		)
	case filter.OwnerType != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerType') = ?`+runtimeRecordOrderSQL,
			filter.OwnerType,
		)
	case filter.OwnerID != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE `+runtimeScopeValidSQL+`
  AND json_extract(scope_json, '$.ownerId') = ?`+runtimeRecordOrderSQL,
			filter.OwnerID,
		)
	case filter.Status != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE status = ?`+runtimeRecordOrderSQL,
			filter.Status,
		)
	case statusListSQL != "":
		rows, err = store.db.QueryContext(
			ctx,
			runtimeRecordSelectSQL+`
WHERE status IN (`+statusListSQL+`)`+runtimeRecordOrderSQL,
		)
	default:
		rows, err = store.db.QueryContext(ctx, runtimeRecordSelectSQL+runtimeRecordOrderSQL)
	}
	if err != nil {
		return nil, fmt.Errorf("list runtimes: %w", err)
	}
	defer rows.Close()

	runtimes := []RuntimeRecord{}
	for rows.Next() {
		runtime, err := scanRuntimeRecord(rows)
		if err != nil {
			return nil, err
		}
		runtimes = append(runtimes, runtime)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list runtimes rows: %w", err)
	}
	return runtimes, nil
}

func runtimeStatusListSQL(statuses []string) string {
	if len(statuses) == 0 {
		return ""
	}
	seen := map[string]bool{}
	quoted := []string{}
	for _, status := range statuses {
		if seen[status] {
			continue
		}
		switch status {
		case "starting", "running", "completed", "failed", "stopped", "orphaned":
			seen[status] = true
			quoted = append(quoted, "'"+status+"'")
		}
	}
	if len(quoted) == 0 {
		return "''"
	}
	return strings.Join(quoted, ", ")
}

func (store *Store) MarkActiveRuntimesOrphaned(ctx context.Context, updatedAt time.Time) error {
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	_, err := store.db.ExecContext(
		ctx,
		`UPDATE runtimes
SET status = 'orphaned', updated_at = ?
WHERE status IN ('starting', 'running')`,
		formatTime(updatedAt),
	)
	if err != nil {
		return fmt.Errorf("mark active runtimes orphaned: %w", err)
	}
	return nil
}

func (store *Store) TouchActiveRuntime(ctx context.Context, runtimeID string, updatedAt time.Time) error {
	if runtimeID == "" {
		return nil
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	_, err := store.db.ExecContext(
		ctx,
		`UPDATE runtimes
SET updated_at = ?, last_activity_at = ?
WHERE runtime_id = ?
  AND status IN ('starting', 'running', 'orphaned')`,
		formatTime(updatedAt),
		formatTime(updatedAt),
		runtimeID,
	)
	if err != nil {
		return fmt.Errorf("touch active runtime %s: %w", runtimeID, err)
	}
	return nil
}

func (store *Store) AppendRuntimeOutputChunk(ctx context.Context, chunk RuntimeOutputChunk, maxChunks int) error {
	if chunk.RuntimeID == "" {
		return errors.New("runtime id is required")
	}
	if chunk.Stream == "" {
		return errors.New("runtime output stream is required")
	}
	if chunk.TimestampMs == 0 {
		chunk.TimestampMs = time.Now().UnixMilli()
	}
	if chunk.CreatedAt.IsZero() {
		chunk.CreatedAt = time.Now().UTC()
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin runtime output append %s: %w", chunk.RuntimeID, err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO runtime_output_chunks(runtime_id, stream, data, timestamp_ms, created_at)
VALUES (?, ?, ?, ?, ?)`,
		chunk.RuntimeID,
		chunk.Stream,
		chunk.Data,
		chunk.TimestampMs,
		formatTime(chunk.CreatedAt),
	); err != nil {
		return fmt.Errorf("append runtime output %s: %w", chunk.RuntimeID, err)
	}
	if maxChunks > 0 {
		if _, err := tx.ExecContext(
			ctx,
			`DELETE FROM runtime_output_chunks
WHERE runtime_id = ?
  AND id IN (
      SELECT id
      FROM runtime_output_chunks
      WHERE runtime_id = ?
      ORDER BY id DESC
      LIMIT -1 OFFSET ?
  )`,
			chunk.RuntimeID,
			chunk.RuntimeID,
			maxChunks,
		); err != nil {
			return fmt.Errorf("prune runtime output %s: %w", chunk.RuntimeID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit runtime output append %s: %w", chunk.RuntimeID, err)
	}
	tx = nil
	return nil
}

func (store *Store) ListRuntimeOutputChunks(ctx context.Context, runtimeID string, limit int) ([]RuntimeOutputChunk, error) {
	if runtimeID == "" {
		return []RuntimeOutputChunk{}, nil
	}
	var rows *sql.Rows
	var err error
	if limit > 0 {
		rows, err = store.db.QueryContext(
			ctx,
			`SELECT id, runtime_id, stream, data, timestamp_ms, created_at
FROM (
    SELECT id, runtime_id, stream, data, timestamp_ms, created_at
    FROM runtime_output_chunks
    WHERE runtime_id = ?
    ORDER BY id DESC
    LIMIT ?
)
ORDER BY id ASC`,
			runtimeID,
			limit,
		)
	} else {
		rows, err = store.db.QueryContext(
			ctx,
			`SELECT id, runtime_id, stream, data, timestamp_ms, created_at
FROM runtime_output_chunks
WHERE runtime_id = ?
ORDER BY id ASC`,
			runtimeID,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("list runtime output %s: %w", runtimeID, err)
	}
	defer rows.Close()

	chunks := []RuntimeOutputChunk{}
	for rows.Next() {
		chunk, err := scanRuntimeOutputChunk(rows)
		if err != nil {
			return nil, err
		}
		chunks = append(chunks, chunk)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list runtime output rows %s: %w", runtimeID, err)
	}
	return chunks, nil
}

func (store *Store) UpsertDevice(ctx context.Context, device Device) error {
	now := time.Now().UTC()
	if device.ID == "" {
		return errors.New("device id is required")
	}
	if device.Label == "" {
		return errors.New("device label is required")
	}
	if device.Platform == "" {
		device.Platform = "unknown"
	}
	if device.CreatedAt.IsZero() {
		device.CreatedAt = now
	}
	if device.UpdatedAt.IsZero() {
		device.UpdatedAt = device.CreatedAt
	}

	_, err := store.db.ExecContext(
		ctx,
		`INSERT INTO devices(
    id, session_id, label, platform, permissions_json, token_hash, created_at, updated_at, last_seen_at, revoked_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    session_id = excluded.session_id,
    label = excluded.label,
    platform = excluded.platform,
    permissions_json = excluded.permissions_json,
    token_hash = excluded.token_hash,
    updated_at = excluded.updated_at,
    last_seen_at = excluded.last_seen_at,
    revoked_at = excluded.revoked_at`,
		device.ID,
		device.SessionID,
		device.Label,
		device.Platform,
		device.PermissionsJSON,
		device.TokenHash,
		formatTime(device.CreatedAt),
		formatTime(device.UpdatedAt),
		nullTimeString(device.LastSeenAt),
		nullTimeString(device.RevokedAt),
	)
	if err != nil {
		return fmt.Errorf("upsert device %s: %w", device.ID, err)
	}
	return nil
}

func (store *Store) ListDevices(ctx context.Context) ([]Device, error) {
	rows, err := store.db.QueryContext(
		ctx,
		`SELECT id, session_id, label, platform, permissions_json, token_hash, created_at, updated_at, last_seen_at, revoked_at
FROM devices
ORDER BY revoked_at IS NOT NULL ASC, label COLLATE NOCASE ASC, created_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	defer rows.Close()

	devices := []Device{}
	for rows.Next() {
		device, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list devices rows: %w", err)
	}
	return devices, nil
}

func (store *Store) GetDeviceByTokenHash(ctx context.Context, tokenHash string) (Device, bool, error) {
	if tokenHash == "" {
		return Device{}, false, nil
	}
	row := store.db.QueryRowContext(
		ctx,
		`SELECT id, session_id, label, platform, permissions_json, token_hash, created_at, updated_at, last_seen_at, revoked_at
FROM devices
WHERE token_hash = ?`,
		tokenHash,
	)
	device, err := scanDevice(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Device{}, false, nil
	}
	if err != nil {
		return Device{}, false, fmt.Errorf("read device by token hash: %w", err)
	}
	return device, true, nil
}

func (store *Store) TouchDeviceLastSeen(ctx context.Context, deviceID string, seenAt time.Time) error {
	if deviceID == "" {
		return errors.New("device id is required")
	}
	if seenAt.IsZero() {
		seenAt = time.Now().UTC()
	}
	_, err := store.db.ExecContext(
		ctx,
		`UPDATE devices
SET last_seen_at = ?, updated_at = ?
WHERE id = ? AND revoked_at IS NULL`,
		formatTime(seenAt),
		formatTime(seenAt),
		deviceID,
	)
	if err != nil {
		return fmt.Errorf("touch device last seen %s: %w", deviceID, err)
	}
	return nil
}

func (store *Store) RevokeDevice(ctx context.Context, deviceID string, revokedAt time.Time) (bool, error) {
	if deviceID == "" {
		return false, errors.New("device id is required")
	}
	if revokedAt.IsZero() {
		revokedAt = time.Now().UTC()
	}
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE devices
SET revoked_at = ?, updated_at = ?
WHERE id = ? AND revoked_at IS NULL`,
		formatTime(revokedAt),
		formatTime(revokedAt),
		deviceID,
	)
	if err != nil {
		return false, fmt.Errorf("revoke device %s: %w", deviceID, err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read revoked device count %s: %w", deviceID, err)
	}
	return changed > 0, nil
}

func (store *Store) RevokeAllDevices(ctx context.Context, revokedAt time.Time) (int64, error) {
	if revokedAt.IsZero() {
		revokedAt = time.Now().UTC()
	}
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE devices
SET revoked_at = ?, updated_at = ?
WHERE revoked_at IS NULL`,
		formatTime(revokedAt),
		formatTime(revokedAt),
	)
	if err != nil {
		return 0, fmt.Errorf("revoke all devices: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("read revoked device count: %w", err)
	}
	return changed, nil
}

type rowScanner interface {
	// openade-allow-explicit-any: mirrors database/sql Row.Scan and Rows.Scan destination contract.
	Scan(dest ...interface{}) error
}

func scanRuntimeRecord(scanner rowScanner) (RuntimeRecord, error) {
	var runtime RuntimeRecord
	var startedAt string
	var updatedAt string
	var lastActivityAt string
	if err := scanner.Scan(
		&runtime.RuntimeID,
		&runtime.Kind,
		&runtime.Status,
		&runtime.ScopeJSON,
		&startedAt,
		&updatedAt,
		&lastActivityAt,
		&runtime.PayloadJSON,
	); err != nil {
		return RuntimeRecord{}, err
	}
	parsedStartedAt, err := parseTime(startedAt)
	if err != nil {
		return RuntimeRecord{}, err
	}
	parsedUpdatedAt, err := parseTime(updatedAt)
	if err != nil {
		return RuntimeRecord{}, err
	}
	parsedLastActivityAt, err := parseTime(lastActivityAt)
	if err != nil {
		return RuntimeRecord{}, err
	}
	runtime.StartedAt = parsedStartedAt
	runtime.UpdatedAt = parsedUpdatedAt
	runtime.LastActivityAt = parsedLastActivityAt
	return runtime, nil
}

func scanRuntimeOutputChunk(scanner rowScanner) (RuntimeOutputChunk, error) {
	var chunk RuntimeOutputChunk
	var createdAt string
	if err := scanner.Scan(
		&chunk.ID,
		&chunk.RuntimeID,
		&chunk.Stream,
		&chunk.Data,
		&chunk.TimestampMs,
		&createdAt,
	); err != nil {
		return RuntimeOutputChunk{}, err
	}
	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return RuntimeOutputChunk{}, err
	}
	chunk.CreatedAt = parsedCreatedAt
	return chunk, nil
}

func scanDevice(scanner rowScanner) (Device, error) {
	var device Device
	var createdAt string
	var updatedAt string
	var lastSeen sql.NullString
	var revokedAt sql.NullString
	if err := scanner.Scan(
		&device.ID,
		&device.SessionID,
		&device.Label,
		&device.Platform,
		&device.PermissionsJSON,
		&device.TokenHash,
		&createdAt,
		&updatedAt,
		&lastSeen,
		&revokedAt,
	); err != nil {
		return Device{}, err
	}
	var parseErr error
	device.CreatedAt, parseErr = parseTime(createdAt)
	if parseErr != nil {
		return Device{}, parseErr
	}
	device.UpdatedAt, parseErr = parseTime(updatedAt)
	if parseErr != nil {
		return Device{}, parseErr
	}
	device.LastSeenAt, parseErr = parseNullTime(lastSeen)
	if parseErr != nil {
		return Device{}, parseErr
	}
	device.RevokedAt, parseErr = parseNullTime(revokedAt)
	if parseErr != nil {
		return Device{}, parseErr
	}
	return device, nil
}

func taskEventSeqForUpsertTx(ctx context.Context, tx *sql.Tx, taskID string, eventID string) (int64, error) {
	var existingSeq int64
	if err := tx.QueryRowContext(ctx, "SELECT seq FROM task_events WHERE id = ? AND task_id = ?", eventID, taskID).Scan(&existingSeq); err == nil {
		return existingSeq, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("read setup event sequence %s: %w", eventID, err)
	}
	var maxSeq sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT MAX(seq) FROM task_events WHERE task_id = ?", taskID).Scan(&maxSeq); err != nil {
		return 0, fmt.Errorf("read next task event sequence %s: %w", taskID, err)
	}
	if !maxSeq.Valid {
		return 1, nil
	}
	return maxSeq.Int64 + 1, nil
}

func getTaskEventTx(ctx context.Context, tx *sql.Tx, taskID string, eventID string) (TaskEvent, bool, error) {
	row := tx.QueryRowContext(
		ctx,
		`SELECT id, task_id, seq, type, status, source_type, source_label, created_at, payload_json, payload_blob_id
FROM task_events
WHERE task_id = ? AND id = ?`,
		taskID,
		eventID,
	)
	event, err := scanTaskEvent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return TaskEvent{}, false, nil
	}
	if err != nil {
		return TaskEvent{}, false, fmt.Errorf("read task event %s: %w", eventID, err)
	}
	return event, true, nil
}

func scanTaskEvent(scanner rowScanner) (TaskEvent, error) {
	var event TaskEvent
	var createdAt string
	if err := scanner.Scan(&event.ID, &event.TaskID, &event.Seq, &event.Type, &event.Status, &event.SourceType, &event.SourceLabel, &createdAt, &event.PayloadJSON, &event.PayloadBlobID); err != nil {
		return TaskEvent{}, err
	}
	parsed, err := parseTime(createdAt)
	if err != nil {
		return TaskEvent{}, err
	}
	event.CreatedAt = parsed
	return event, nil
}

func scanTaskDeviceEnvironment(scanner rowScanner) (TaskDeviceEnvironment, error) {
	var environment TaskDeviceEnvironment
	var setupComplete int
	var createdAt string
	var lastUsedAt string
	if err := scanner.Scan(
		&environment.ID,
		&environment.TaskID,
		&environment.DeviceID,
		&environment.WorktreeDir,
		&setupComplete,
		&environment.MergeBaseCommit,
		&createdAt,
		&lastUsedAt,
	); err != nil {
		return TaskDeviceEnvironment{}, fmt.Errorf("scan task device environment: %w", err)
	}
	environment.SetupComplete = setupComplete != 0
	var parseErr error
	environment.CreatedAt, parseErr = parseTime(createdAt)
	if parseErr != nil {
		return TaskDeviceEnvironment{}, parseErr
	}
	environment.LastUsedAt, parseErr = parseTime(lastUsedAt)
	if parseErr != nil {
		return TaskDeviceEnvironment{}, parseErr
	}
	return environment, nil
}

func scanTaskPreview(scanner rowScanner) (TaskPreview, error) {
	var preview TaskPreview
	var closed int
	var createdAt string
	var updatedAt string
	var lastViewed sql.NullString
	var lastEvent sql.NullString
	if err := scanner.Scan(
		&preview.TaskID,
		&preview.RepoID,
		&preview.Slug,
		&preview.Title,
		&closed,
		&createdAt,
		&updatedAt,
		&lastViewed,
		&lastEvent,
		&preview.LastEventJSON,
		&preview.UsageJSON,
	); err != nil {
		return TaskPreview{}, fmt.Errorf("scan task preview: %w", err)
	}
	preview.Closed = closed != 0
	var parseErr error
	preview.CreatedAt, parseErr = parseTime(createdAt)
	if parseErr != nil {
		return TaskPreview{}, parseErr
	}
	preview.UpdatedAt, parseErr = parseTime(updatedAt)
	if parseErr != nil {
		return TaskPreview{}, parseErr
	}
	preview.LastViewedAt, parseErr = parseNullTime(lastViewed)
	if parseErr != nil {
		return TaskPreview{}, parseErr
	}
	preview.LastEventAt, parseErr = parseNullTime(lastEvent)
	if parseErr != nil {
		return TaskPreview{}, parseErr
	}
	return preview, nil
}

func getQueuedTurnTx(ctx context.Context, tx *sql.Tx, taskID string, queuedTurnID string) (QueuedTurn, bool, error) {
	row := tx.QueryRowContext(
		ctx,
		`SELECT id, task_id, type, input, status, position, payload_json, created_at, updated_at
FROM queued_turns
WHERE task_id = ? AND id = ?`,
		taskID,
		queuedTurnID,
	)
	turn, err := scanQueuedTurn(row)
	if errors.Is(err, sql.ErrNoRows) {
		return QueuedTurn{}, false, nil
	}
	if err != nil {
		return QueuedTurn{}, false, err
	}
	return turn, true, nil
}

func getQueuedTurnByIDTx(ctx context.Context, tx *sql.Tx, queuedTurnID string) (QueuedTurn, bool, error) {
	row := tx.QueryRowContext(
		ctx,
		`SELECT id, task_id, type, input, status, position, payload_json, created_at, updated_at
FROM queued_turns
WHERE id = ?`,
		queuedTurnID,
	)
	turn, err := scanQueuedTurn(row)
	if errors.Is(err, sql.ErrNoRows) {
		return QueuedTurn{}, false, nil
	}
	if err != nil {
		return QueuedTurn{}, false, err
	}
	return turn, true, nil
}

func nextQueuedTurnPositionTx(ctx context.Context, tx *sql.Tx, taskID string) (int64, error) {
	var maxPosition sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT MAX(position) FROM queued_turns WHERE task_id = ?", taskID).Scan(&maxPosition); err != nil {
		return 0, fmt.Errorf("read next queued turn position %s: %w", taskID, err)
	}
	if !maxPosition.Valid {
		return 1, nil
	}
	return maxPosition.Int64 + 1, nil
}

func scanQueuedTurn(scanner rowScanner) (QueuedTurn, error) {
	var turn QueuedTurn
	var createdAt string
	var updatedAt string
	if err := scanner.Scan(
		&turn.ID,
		&turn.TaskID,
		&turn.Type,
		&turn.Input,
		&turn.Status,
		&turn.Position,
		&turn.PayloadJSON,
		&createdAt,
		&updatedAt,
	); err != nil {
		return QueuedTurn{}, fmt.Errorf("scan queued turn: %w", err)
	}
	var parseErr error
	turn.CreatedAt, parseErr = parseTime(createdAt)
	if parseErr != nil {
		return QueuedTurn{}, parseErr
	}
	turn.UpdatedAt, parseErr = parseTime(updatedAt)
	if parseErr != nil {
		return QueuedTurn{}, parseErr
	}
	return turn, nil
}

func validateQueuedTurn(turn QueuedTurn) error {
	if turn.ID == "" {
		return errors.New("queued turn id is required")
	}
	if turn.TaskID == "" {
		return errors.New("queued turn task id is required")
	}
	if turn.Type != "do" && turn.Type != "ask" {
		return errors.New("queued turn type must be do or ask")
	}
	if turn.Input == "" {
		return errors.New("queued turn input is required")
	}
	if !isQueuedTurnStatus(turn.Status) {
		return errors.New("queued turn status is invalid")
	}
	return nil
}

func isQueuedTurnStatus(status string) bool {
	switch status {
	case "queued", "running", "completed", "error", "stopped", "cancelled":
		return true
	default:
		return false
	}
}

func isQueuedTurnTerminalStatus(status string) bool {
	switch status {
	case "completed", "error", "stopped":
		return true
	default:
		return false
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse time %q: %w", value, err)
	}
	return parsed, nil
}

func nullTimeString(value sql.NullTime) sql.NullString {
	if !value.Valid {
		return sql.NullString{}
	}
	return sql.NullString{String: formatTime(value.Time), Valid: true}
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func parseNullTime(value sql.NullString) (sql.NullTime, error) {
	if !value.Valid {
		return sql.NullTime{}, nil
	}
	parsed, err := parseTime(value.String)
	if err != nil {
		return sql.NullTime{}, err
	}
	return sql.NullTime{Time: parsed, Valid: true}, nil
}
