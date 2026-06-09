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
