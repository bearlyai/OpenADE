package host

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestReadGitRepositoryInfoCachesSuccessfulReads(t *testing.T) {
	requireGitForHostTest(t)
	resetGitRepositoryInfoCacheForTest(t)
	ctx := context.Background()
	root := t.TempDir()
	mustRunGitForHostTest(t, ctx, root, "init")

	info, ok, reason, err := ReadGitRepositoryInfo(ctx, root)
	if err != nil {
		t.Fatalf("read git info: %v", err)
	}
	if !ok {
		t.Fatalf("read git info ok = false: %s", reason)
	}

	if err := os.Rename(filepath.Join(root, ".git"), filepath.Join(root, ".git-hidden")); err != nil {
		t.Fatalf("hide git directory: %v", err)
	}

	cached, ok, reason, err := ReadGitRepositoryInfo(ctx, root)
	if err != nil {
		t.Fatalf("read cached git info: %v", err)
	}
	if !ok {
		t.Fatalf("read cached git info ok = false: %s", reason)
	}
	if cached.RepoRoot != info.RepoRoot || cached.RelativePath != info.RelativePath || cached.DefaultBranch != info.DefaultBranch {
		t.Fatalf("cached git info = %#v, want root/path/branch from %#v", cached, info)
	}
}

func TestReadGitSummaryUsesLiveWorkingTree(t *testing.T) {
	requireGitForHostTest(t)
	resetGitRepositoryInfoCacheForTest(t)
	ctx := context.Background()
	root := t.TempDir()
	mustRunGitForHostTest(t, ctx, root, "init")
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("initial\n"), 0o644); err != nil {
		t.Fatalf("write initial file: %v", err)
	}
	mustRunGitForHostTest(t, ctx, root, "add", "README.md")
	mustRunGitForHostTest(t, ctx, root, "-c", "user.name=OpenADE", "-c", "user.email=openade@example.invalid", "commit", "-m", "initial")

	clean, ok, reason, err := ReadGitSummary(ctx, root)
	if err != nil {
		t.Fatalf("read clean summary: %v", err)
	}
	if !ok {
		t.Fatalf("read clean summary ok = false: %s", reason)
	}
	if clean.HasChanges {
		t.Fatalf("clean summary has changes: %#v", clean)
	}

	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("changed\n"), 0o644); err != nil {
		t.Fatalf("write changed file: %v", err)
	}
	changed, ok, reason, err := ReadGitSummary(ctx, root)
	if err != nil {
		t.Fatalf("read changed summary: %v", err)
	}
	if !ok {
		t.Fatalf("read changed summary ok = false: %s", reason)
	}
	if !changed.HasChanges {
		t.Fatalf("changed summary has no changes: %#v", changed)
	}
	if len(changed.Unstaged.Files) != 1 || changed.Unstaged.Files[0].Path != "README.md" || changed.Unstaged.Files[0].Status != "modified" {
		t.Fatalf("changed unstaged files = %#v", changed.Unstaged.Files)
	}
}

func requireGitForHostTest(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is required")
	}
}

func mustRunGitForHostTest(t *testing.T, ctx context.Context, cwd string, args ...string) {
	t.Helper()
	result, err := runGit(ctx, cwd, args...)
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	if !result.success {
		t.Fatalf("git %v failed: %s", args, result.stderr)
	}
}

func resetGitRepositoryInfoCacheForTest(t *testing.T) {
	t.Helper()
	reset := func() {
		gitRepositoryInfoCache.Lock()
		defer gitRepositoryInfoCache.Unlock()
		gitRepositoryInfoCache.entries = map[string]gitRepositoryInfoCacheEntry{}
		gitRepositoryInfoCache.loading = map[string]chan struct{}{}
	}
	reset()
	t.Cleanup(reset)
}
