package host

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestListProjectProcessesInvalidatesCacheAfterWrite(t *testing.T) {
	resetProcessConfigCacheForTest(t)
	root := t.TempDir()
	writeHostTestFile(t, filepath.Join(root, "openade.toml"), `[[process]]
name = "Before"
command = "printf before"
type = "daemon"
`)

	before, err := ListProjectProcesses(context.Background(), root)
	if err != nil {
		t.Fatalf("initial process list: %v", err)
	}
	if len(before.Processes) != 1 || before.Processes[0].ID != "openade.toml::Before" {
		t.Fatalf("initial processes = %#v", before.Processes)
	}

	if _, err := WriteProjectFile(root, FileWriteOptions{
		Path: "openade.toml",
		Content: `[[process]]
name = "After"
command = "printf after"
type = "daemon"
`,
	}); err != nil {
		t.Fatalf("write openade.toml: %v", err)
	}

	after, err := ListProjectProcesses(context.Background(), root)
	if err != nil {
		t.Fatalf("process list after write: %v", err)
	}
	if len(after.Processes) != 1 || after.Processes[0].ID != "openade.toml::After" {
		t.Fatalf("processes after write = %#v", after.Processes)
	}
}

func TestListProjectProcessesCachesGitRootResolution(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is required")
	}
	resetProcessConfigCacheForTest(t)
	root := t.TempDir()
	nested := filepath.Join(root, "packages", "app")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatalf("create nested directory: %v", err)
	}
	writeHostTestFile(t, filepath.Join(root, "openade.toml"), `[[process]]
name = "Root Proc"
command = "printf root"
type = "daemon"
`)
	initResult, err := runGit(context.Background(), root, "init")
	if err != nil {
		t.Fatalf("git init: %v", err)
	}
	if !initResult.success {
		t.Fatalf("git init failed: %s", initResult.stderr)
	}

	before, err := ListProjectProcesses(context.Background(), nested)
	if err != nil {
		t.Fatalf("initial nested process list: %v", err)
	}
	if len(before.Processes) != 1 || before.Processes[0].ID != "openade.toml::Root Proc" {
		t.Fatalf("initial nested processes = %#v", before.Processes)
	}

	if err := os.Rename(filepath.Join(root, ".git"), filepath.Join(root, ".git-hidden")); err != nil {
		t.Fatalf("hide git directory: %v", err)
	}
	after, err := ListProjectProcesses(context.Background(), nested)
	if err != nil {
		t.Fatalf("cached nested process list: %v", err)
	}
	if after.RepoRoot != before.RepoRoot {
		t.Fatalf("cached repo root = %q, want %q", after.RepoRoot, before.RepoRoot)
	}
	if len(after.Processes) != 1 || after.Processes[0].ID != "openade.toml::Root Proc" {
		t.Fatalf("cached nested processes = %#v", after.Processes)
	}
}

func resetProcessConfigCacheForTest(t *testing.T) {
	t.Helper()
	reset := func() {
		processConfigCache.Lock()
		defer processConfigCache.Unlock()
		processConfigCache.entries = map[processConfigCacheKey]processConfigCacheEntry{}
		processConfigCache.loading = map[processConfigCacheKey]chan struct{}{}
		processConfigCache.generations = map[processConfigCacheKey]int64{}
		processRootCache.Lock()
		defer processRootCache.Unlock()
		processRootCache.entries = map[string]processRootCacheEntry{}
	}
	reset()
	t.Cleanup(reset)
}

func writeHostTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
