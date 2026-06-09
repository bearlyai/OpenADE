//go:build darwin || linux || freebsd || netbsd || openbsd

package product_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/storage"
)

func startLongRunningProcessGroup(t *testing.T) (*exec.Cmd, int, *int) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestLongRunningProcessHelper$")
	cmd.Env = append(os.Environ(), "OPENADE_TEST_LONG_RUNNING_PROCESS=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start long running process helper: %v", err)
	}
	pid := cmd.Process.Pid
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		t.Fatalf("get long running process group: %v", err)
	}
	return cmd, pid, &pgid
}

func TestProductRuntimeStartupAdoptsLiveProjectProcessOutputOverRuntime(t *testing.T) {
	projectDir := t.TempDir()
	outputDir := filepath.Join(t.TempDir(), "process-output", "proc-live-adopted")
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		t.Fatalf("make process output dir: %v", err)
	}
	stdoutPath := filepath.Join(outputDir, "stdout.log")
	stderrPath := filepath.Join(outputDir, "stderr.log")
	releasePath := filepath.Join(projectDir, "release-process")
	stdoutWriter, err := os.OpenFile(stdoutPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("open stdout capture: %v", err)
	}
	stderrWriter, err := os.OpenFile(stderrPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		_ = stdoutWriter.Close()
		t.Fatalf("open stderr capture: %v", err)
	}
	cmd := exec.Command("/bin/sh", "-c", "printf 'before-restart\n'; while [ ! -f "+shellQuoteForUnixTest(releasePath)+" ]; do sleep 0.05; done; printf 'after-restart\n'")
	cmd.Stdout = stdoutWriter
	cmd.Stderr = stderrWriter
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		_ = stdoutWriter.Close()
		_ = stderrWriter.Close()
		t.Fatalf("start adoptable process: %v", err)
	}
	_ = stdoutWriter.Close()
	_ = stderrWriter.Close()
	pid := cmd.Process.Pid
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		_ = cmd.Process.Kill()
		t.Fatalf("get adoptable process group: %v", err)
	}
	waitDone := make(chan error, 1)
	go func() {
		waitDone <- cmd.Wait()
	}()
	t.Cleanup(func() {
		if unixProcessGroupIsRunning(pgid) {
			_ = syscall.Kill(-pgid, syscall.SIGTERM)
		}
		select {
		case <-waitDone:
		case <-time.After(2 * time.Second):
			_ = cmd.Process.Kill()
		}
	})
	waitForUnixFileContains(t, stdoutPath, "before-restart")

	startedAt := time.Date(2026, 6, 9, 11, 0, 0, 0, time.UTC)
	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        "repo-live-process-adopted",
			Name:      "Live process adopted repo",
			Path:      projectDir,
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("upsert live process repo: %v", err)
		}
		scopeJSON, err := json.Marshal(map[string]any{
			"ownerType": "process",
			"ownerId":   "proc-live-adopted",
			"rootPath":  projectDir,
			"labels":    map[string]string{"repoId": "repo-live-process-adopted", "taskId": ""},
		})
		if err != nil {
			t.Fatalf("marshal live process scope: %v", err)
		}
		payloadJSON, err := json.Marshal(map[string]any{
			"nativeId":            "proc-live-adopted",
			"pid":                 pid,
			"pgid":                pgid,
			"processLabel":        "adoptable process",
			"processDefinitionId": "openade.toml::Adoptable",
			"processStartedAt":    startedAt.Format(time.RFC3339Nano),
			"processStdoutFile":   stdoutPath,
			"processStderrFile":   stderrPath,
		})
		if err != nil {
			t.Fatalf("marshal live process payload: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "process:proc-live-adopted",
			Kind:           "process",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: string(scopeJSON), Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt,
			LastActivityAt: startedAt,
			PayloadJSON:    sql.NullString{String: string(payloadJSON), Valid: true},
		}); err != nil {
			t.Fatalf("upsert live process runtime: %v", err)
		}
	})

	running := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:proc-live-adopted",
	}))
	if running["status"] != "running" || running["nativeId"] != "proc-live-adopted" || running["pgid"] != float64(pgid) {
		t.Fatalf("adopted live process runtime = %#v", running)
	}
	if _, ok := running["processStdoutFile"]; ok {
		t.Fatalf("runtime DTO exposed private stdout path = %#v", running)
	}
	reconnected := waitForProjectProcessOutput(t, harness, "repo-live-process-adopted", "", "proc-live-adopted", "before-restart", false)
	if reconnected["completed"] == true {
		t.Fatalf("adopted live process completed too early = %#v", reconnected)
	}

	writeFile(t, releasePath, []byte("release"))
	select {
	case err := <-waitDone:
		if err != nil {
			t.Fatalf("adopted process exited with error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("adopted process did not exit after release")
	}
	completed := waitForRuntimeStatus(t, harness, "process:proc-live-adopted", "completed")
	if _, ok := completed["processStdoutFile"]; ok {
		t.Fatalf("completed runtime DTO exposed private stdout path = %#v", completed)
	}
	finalReconnect := waitForProjectProcessOutput(t, harness, "repo-live-process-adopted", "", "proc-live-adopted", "after-restart", true)
	if finalReconnect["exitCode"] != nil {
		t.Fatalf("adopted process should complete without recovered exit code = %#v", finalReconnect)
	}
}

func TestProductProjectProcessStopTerminatesProcessGroupOverRuntime(t *testing.T) {
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	projectDir := t.TempDir()
	childPIDPath := filepath.Join(projectDir, "child.pid")
	writeFile(t, filepath.Join(projectDir, "openade.toml"), []byte(`[[process]]
name = "ChildGroup"
command = "sleep 30 & echo $! > child.pid; wait"
type = "daemon"
`))
	now := time.Date(2026, 6, 9, 10, 0, 0, 0, time.UTC)
	if err := harness.store.UpsertRepo(ctx, storage.Repo{
		ID:        "repo-process-group",
		Name:      "Process Group Repo",
		Path:      projectDir,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("upsert process group repo: %v", err)
	}

	started := resultObject(t, harness.request(t, "openade/project/process/start", map[string]any{
		"repoId":       "repo-process-group",
		"definitionId": "openade.toml::ChildGroup",
		"timeoutMs":    30000,
	}))
	processID, ok := started["processId"].(string)
	if !ok || processID == "" {
		t.Fatalf("started process group = %#v", started)
	}
	t.Cleanup(func() {
		_ = harness.request(t, "openade/project/process/stop", map[string]any{
			"repoId":    "repo-process-group",
			"processId": processID,
		})
	})

	childPID := waitForUnixChildPIDFile(t, childPIDPath)
	if !unixPIDIsRunning(childPID) {
		t.Fatalf("child process %d was not running before stop", childPID)
	}
	runtimeRead := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:" + processID,
	}))
	pgidValue, ok := runtimeRead["pgid"].(float64)
	if !ok || pgidValue <= 0 {
		t.Fatalf("process runtime did not expose pgid = %#v", runtimeRead)
	}

	stopped := resultObject(t, harness.request(t, "openade/project/process/stop", map[string]any{
		"repoId":    "repo-process-group",
		"processId": processID,
	}))
	if stopped["ok"] != true {
		t.Fatalf("stop process group = %#v", stopped)
	}
	waitForUnixProcessGroupExit(t, int(pgidValue), 3*time.Second)
	if unixPIDIsRunning(childPID) {
		t.Fatalf("child process %d survived process group stop", childPID)
	}

	record, ok, err := harness.store.GetRuntime(ctx, "process:"+processID)
	if err != nil || !ok {
		t.Fatalf("get stopped process runtime: ok=%v err=%v", ok, err)
	}
	if !record.PayloadJSON.Valid || !strings.Contains(record.PayloadJSON.String, `"pgid":`) {
		t.Fatalf("stopped process runtime payload missing pgid: %#v", record.PayloadJSON)
	}
	if record.Status != "stopped" {
		t.Fatalf("stopped process runtime record = %#v", record)
	}
}

func TestProductRuntimeStartupTerminatesLiveUnadoptableProjectProcess(t *testing.T) {
	worker, pid, pgid := startLongRunningProcessGroup(t)
	t.Cleanup(func() {
		if worker.Process != nil {
			_ = worker.Process.Kill()
		}
		_ = worker.Wait()
	})
	startedAt := time.Date(2026, 6, 9, 17, 0, 0, 0, time.UTC)
	repoPath := t.TempDir()
	processID := "proc-live-unadoptable"

	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        "repo-live-unadoptable-process",
			Name:      "Live Unadoptable Process Repo",
			Path:      repoPath,
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("upsert live unadoptable process repo: %v", err)
		}
		scopeJSON, err := json.Marshal(map[string]any{
			"ownerType": "process",
			"ownerId":   processID,
			"rootPath":  repoPath,
			"labels":    map[string]string{"repoId": "repo-live-unadoptable-process", "taskId": ""},
		})
		if err != nil {
			t.Fatalf("marshal live unadoptable process scope: %v", err)
		}
		payloadJSON, err := json.Marshal(map[string]any{
			"nativeId":            processID,
			"pid":                 pid,
			"pgid":                *pgid,
			"processLabel":        "unadoptable process",
			"processDefinitionId": "openade.toml::Unadoptable",
			"processStartedAt":    startedAt.Format(time.RFC3339Nano),
		})
		if err != nil {
			t.Fatalf("marshal live unadoptable process payload: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "process:" + processID,
			Kind:           "process",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: string(scopeJSON), Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt,
			LastActivityAt: startedAt,
			PayloadJSON:    sql.NullString{String: string(payloadJSON), Valid: true},
		}); err != nil {
			t.Fatalf("upsert live unadoptable process runtime: %v", err)
		}
		if err := store.AppendRuntimeOutputChunk(ctx, storage.RuntimeOutputChunk{
			RuntimeID:   "process:" + processID,
			Stream:      "stdout",
			Data:        "live unadoptable process output\n",
			TimestampMs: startedAt.UnixMilli(),
		}, runtimeOutputReadLimit); err != nil {
			t.Fatalf("append live unadoptable process output: %v", err)
		}
	})

	runtimeDTO := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "process:" + processID,
	}))
	if runtimeDTO["status"] != "stopped" || runtimeDTO["pid"] != float64(pid) || runtimeDTO["pgid"] != float64(*pgid) || runtimeDTO["error"] != "process was orphaned during core startup" {
		t.Fatalf("startup stopped live unadoptable process runtime = %#v", runtimeDTO)
	}
	reconnect := resultObject(t, harness.request(t, "openade/project/process/reconnect", map[string]any{
		"repoId":    "repo-live-unadoptable-process",
		"processId": processID,
	}))
	if reconnect["found"] != true || reconnect["completed"] != true || reconnect["outputCount"] != float64(1) {
		t.Fatalf("startup unadoptable process reconnect = %#v", reconnect)
	}
	if !strings.Contains(projectProcessOutputText(arrayField(t, reconnect, "output")), "live unadoptable process output") {
		t.Fatalf("startup unadoptable process output = %#v", reconnect)
	}
	waitForProcessExit(t, worker, 2*time.Second)
	if unixProcessGroupIsRunning(*pgid) {
		t.Fatalf("unadoptable process group %d survived startup cleanup", *pgid)
	}
}

func TestProductRuntimeStopTerminatesStoredOrphanedProjectProcess(t *testing.T) {
	worker, pid, pgid := startLongRunningProcessGroup(t)
	t.Cleanup(func() {
		if worker.Process != nil {
			_ = worker.Process.Kill()
		}
		_ = worker.Wait()
	})
	startedAt := time.Date(2026, 6, 9, 17, 15, 0, 0, time.UTC)
	processID := "proc-runtime-stop-stored"
	repoPath := t.TempDir()
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	scopeJSON, err := json.Marshal(map[string]any{
		"ownerType": "process",
		"ownerId":   processID,
		"rootPath":  repoPath,
	})
	if err != nil {
		t.Fatalf("marshal runtime stop stored process scope: %v", err)
	}
	payloadJSON, err := json.Marshal(map[string]any{
		"nativeId":         processID,
		"pid":              pid,
		"pgid":             *pgid,
		"processLabel":     "stored orphan process",
		"processStartedAt": startedAt.Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("marshal runtime stop stored process payload: %v", err)
	}
	if err := harness.store.UpsertRuntime(ctx, storage.RuntimeRecord{
		RuntimeID:      "process:" + processID,
		Kind:           "process",
		Status:         "orphaned",
		ScopeJSON:      sql.NullString{String: string(scopeJSON), Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      startedAt,
		LastActivityAt: startedAt,
		PayloadJSON:    sql.NullString{String: string(payloadJSON), Valid: true},
	}); err != nil {
		t.Fatalf("upsert runtime stop stored process: %v", err)
	}

	stopped := resultObject(t, harness.request(t, "runtime/stop", map[string]any{
		"runtimeId": "process:" + processID,
		"reason":    "runtime stop stored process",
	}))
	if stopped["status"] != "stopped" || stopped["pid"] != float64(pid) || stopped["pgid"] != float64(*pgid) || stopped["error"] != "runtime stop stored process" {
		t.Fatalf("runtime stop stored process = %#v", stopped)
	}
	waitForProcessExit(t, worker, 2*time.Second)
	if unixProcessGroupIsRunning(*pgid) {
		t.Fatalf("stored process group %d survived runtime stop", *pgid)
	}
}

func TestProductRuntimeStopTerminatesStoredOrphanedTaskTerminal(t *testing.T) {
	worker, pid, pgid := startLongRunningProcessGroup(t)
	t.Cleanup(func() {
		if worker.Process != nil {
			_ = worker.Process.Kill()
		}
		_ = worker.Wait()
	})
	startedAt := time.Date(2026, 6, 9, 17, 20, 0, 0, time.UTC)
	repoPath := t.TempDir()
	terminalID := taskTerminalIDForTest("repo-runtime-stop-terminal", "task-runtime-stop-terminal")
	harness := newRuntimeHarness(t)
	ctx := context.Background()
	scopeJSON, err := json.Marshal(map[string]any{
		"ownerType": "pty",
		"ownerId":   terminalID,
		"rootPath":  repoPath,
		"labels":    map[string]string{"repoId": "repo-runtime-stop-terminal", "taskId": "task-runtime-stop-terminal"},
	})
	if err != nil {
		t.Fatalf("marshal runtime stop stored terminal scope: %v", err)
	}
	payloadJSON, err := json.Marshal(map[string]any{
		"nativeId":         terminalID,
		"pid":              pid,
		"pgid":             *pgid,
		"processLabel":     "/bin/bash",
		"processStartedAt": startedAt.Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("marshal runtime stop stored terminal payload: %v", err)
	}
	if err := harness.store.UpsertRuntime(ctx, storage.RuntimeRecord{
		RuntimeID:      "pty:" + terminalID,
		Kind:           "pty",
		Status:         "orphaned",
		ScopeJSON:      sql.NullString{String: string(scopeJSON), Valid: true},
		StartedAt:      startedAt,
		UpdatedAt:      startedAt,
		LastActivityAt: startedAt,
		PayloadJSON:    sql.NullString{String: string(payloadJSON), Valid: true},
	}); err != nil {
		t.Fatalf("upsert runtime stop stored terminal: %v", err)
	}

	stopped := resultObject(t, harness.request(t, "runtime/stop", map[string]any{
		"runtimeId": "pty:" + terminalID,
		"reason":    "runtime stop stored terminal",
	}))
	if stopped["status"] != "stopped" || stopped["pid"] != float64(pid) || stopped["pgid"] != float64(*pgid) || stopped["error"] != "runtime stop stored terminal" {
		t.Fatalf("runtime stop stored terminal = %#v", stopped)
	}
	waitForProcessExit(t, worker, 2*time.Second)
	if unixProcessGroupIsRunning(*pgid) {
		t.Fatalf("stored terminal process group %d survived runtime stop", *pgid)
	}
}

func TestProductRuntimeStartupTerminatesLiveOrphanedTaskTerminal(t *testing.T) {
	worker, pid, pgid := startLongRunningProcessGroup(t)
	t.Cleanup(func() {
		if worker.Process != nil {
			_ = worker.Process.Kill()
		}
		_ = worker.Wait()
	})
	startedAt := time.Date(2026, 6, 9, 17, 30, 0, 0, time.UTC)
	repoPath := t.TempDir()
	terminalID := taskTerminalIDForTest("repo-live-orphan-terminal", "task-live-orphan-terminal")

	harness := newRuntimeHarnessWithStoreSetup(t, func(ctx context.Context, store *storage.Store) {
		if err := store.UpsertRepo(ctx, storage.Repo{
			ID:        "repo-live-orphan-terminal",
			Name:      "Live Orphan Terminal Repo",
			Path:      repoPath,
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("upsert live orphan terminal repo: %v", err)
		}
		if err := store.UpsertTask(ctx, storage.Task{
			ID:            "task-live-orphan-terminal",
			RepoID:        "repo-live-orphan-terminal",
			Slug:          "task-live-orphan-terminal",
			Title:         "Live orphan terminal",
			IsolationJSON: sql.NullString{String: `{"type":"head"}`, Valid: true},
			CreatedAt:     startedAt,
			UpdatedAt:     startedAt,
		}); err != nil {
			t.Fatalf("upsert live orphan terminal task: %v", err)
		}
		scopeJSON, err := json.Marshal(map[string]any{
			"ownerType": "pty",
			"ownerId":   terminalID,
			"rootPath":  repoPath,
			"labels":    map[string]string{"repoId": "repo-live-orphan-terminal", "taskId": "task-live-orphan-terminal"},
		})
		if err != nil {
			t.Fatalf("marshal live orphan terminal scope: %v", err)
		}
		payloadJSON, err := json.Marshal(map[string]any{
			"nativeId":         terminalID,
			"pid":              pid,
			"pgid":             *pgid,
			"processLabel":     "/bin/bash",
			"processStartedAt": startedAt.Format(time.RFC3339Nano),
		})
		if err != nil {
			t.Fatalf("marshal live orphan terminal payload: %v", err)
		}
		if err := store.UpsertRuntime(ctx, storage.RuntimeRecord{
			RuntimeID:      "pty:" + terminalID,
			Kind:           "pty",
			Status:         "running",
			ScopeJSON:      sql.NullString{String: string(scopeJSON), Valid: true},
			StartedAt:      startedAt,
			UpdatedAt:      startedAt,
			LastActivityAt: startedAt,
			PayloadJSON:    sql.NullString{String: string(payloadJSON), Valid: true},
		}); err != nil {
			t.Fatalf("upsert live orphan terminal runtime: %v", err)
		}
		if err := store.AppendRuntimeOutputChunk(ctx, storage.RuntimeOutputChunk{
			RuntimeID:   "pty:" + terminalID,
			Stream:      "pty",
			Data:        "live orphan terminal output\n",
			TimestampMs: startedAt.UnixMilli(),
		}, runtimeOutputReadLimit); err != nil {
			t.Fatalf("append live orphan terminal output: %v", err)
		}
	})

	runtimeDTO := resultObject(t, harness.request(t, "runtime/read", map[string]any{
		"runtimeId": "pty:" + terminalID,
	}))
	if runtimeDTO["status"] != "stopped" || runtimeDTO["pid"] != float64(pid) || runtimeDTO["pgid"] != float64(*pgid) || runtimeDTO["error"] != "terminal process was orphaned during core startup" {
		t.Fatalf("startup stopped live orphaned terminal runtime = %#v", runtimeDTO)
	}
	reconnect := resultObject(t, harness.request(t, "openade/task/terminal/reconnect", map[string]any{
		"repoId":     "repo-live-orphan-terminal",
		"taskId":     "task-live-orphan-terminal",
		"terminalId": terminalID,
	}))
	if reconnect["found"] != true || reconnect["exited"] != true || reconnect["outputCount"] != float64(1) {
		t.Fatalf("startup orphan terminal reconnect = %#v", reconnect)
	}
	output := arrayField(t, reconnect, "output")
	if objectValue(t, output[0])["data"] != "live orphan terminal output\n" {
		t.Fatalf("startup orphan terminal output = %#v", output)
	}
	waitForProcessExit(t, worker, 2*time.Second)
	if unixProcessGroupIsRunning(*pgid) {
		t.Fatalf("terminal process group %d survived startup orphan cleanup", *pgid)
	}
}

func shellQuoteForUnixTest(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func waitForUnixFileContains(t *testing.T, path string, expected string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var last string
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil {
			last = string(data)
			if strings.Contains(last, expected) {
				return
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("file %s never contained %q; last content: %q", path, expected, last)
}

func waitForUnixChildPIDFile(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil {
			pid, parseErr := strconv.Atoi(strings.TrimSpace(string(data)))
			if parseErr == nil && pid > 0 {
				return pid
			}
			lastErr = parseErr
		} else {
			lastErr = err
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("child pid file %s was not readable: %v", path, lastErr)
	return 0
}

func waitForUnixProcessGroupExit(t *testing.T, pgid int, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !unixProcessGroupIsRunning(pgid) {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("process group %d did not exit within %s", pgid, timeout)
}

func unixPIDIsRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func unixProcessGroupIsRunning(pgid int) bool {
	if pgid <= 0 {
		return false
	}
	err := syscall.Kill(-pgid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
