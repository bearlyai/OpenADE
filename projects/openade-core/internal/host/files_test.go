package host

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFuzzySearchProjectFilesInvalidatesIndexAfterWrite(t *testing.T) {
	resetFuzzyPathIndexCacheForTest(t)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "existing.ts"), []byte("existing\n"), 0o644); err != nil {
		t.Fatalf("write existing file: %v", err)
	}

	before, err := FuzzySearchProjectFiles(root, FuzzySearchOptions{Query: "created-file", Limit: 10})
	if err != nil {
		t.Fatalf("initial fuzzy search: %v", err)
	}
	if len(before.Results) != 0 {
		t.Fatalf("initial fuzzy results = %#v", before.Results)
	}

	if _, err := WriteProjectFile(root, FileWriteOptions{
		Path:       "src/created-file.ts",
		Content:    "created\n",
		CreateDirs: true,
	}); err != nil {
		t.Fatalf("write project file: %v", err)
	}

	after, err := FuzzySearchProjectFiles(root, FuzzySearchOptions{Query: "created-file", Limit: 10})
	if err != nil {
		t.Fatalf("fuzzy search after write: %v", err)
	}
	if len(after.Results) == 0 || after.Results[0] != "src/created-file.ts" {
		t.Fatalf("fuzzy results after write = %#v", after.Results)
	}
}

func TestFuzzySearchProjectFilesKeepsIndexWarmAcrossEditorBursts(t *testing.T) {
	resetFuzzyPathIndexCacheForTest(t)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "warm-cache.ts"), []byte("warm\n"), 0o644); err != nil {
		t.Fatalf("write warm cache file: %v", err)
	}

	if _, err := FuzzySearchProjectFiles(root, FuzzySearchOptions{Query: "warm", Limit: 10}); err != nil {
		t.Fatalf("warm fuzzy search: %v", err)
	}

	resolvedRoot, err := normalizeRoot(root)
	if err != nil {
		t.Fatalf("normalize root: %v", err)
	}
	key := fuzzyPathIndexKey{root: resolvedRoot}
	fuzzyPathIndexCache.Lock()
	cached, ok := fuzzyPathIndexCache.entries[key]
	fuzzyPathIndexCache.Unlock()
	if !ok {
		t.Fatalf("expected fuzzy index cache entry for %s", resolvedRoot)
	}
	if remaining := time.Until(cached.expiresAt); remaining < 25*time.Second {
		t.Fatalf("fuzzy index cache remaining ttl = %s, want at least 25s", remaining)
	}
}

func resetFuzzyPathIndexCacheForTest(t *testing.T) {
	t.Helper()
	reset := func() {
		fuzzyPathIndexCache.Lock()
		defer fuzzyPathIndexCache.Unlock()
		fuzzyPathIndexCache.entries = map[fuzzyPathIndexKey]fuzzyPathIndex{}
		fuzzyPathIndexCache.loading = map[fuzzyPathIndexKey]chan struct{}{}
		fuzzyPathIndexCache.generations = map[fuzzyPathIndexKey]int64{}
	}
	reset()
	t.Cleanup(reset)
}
