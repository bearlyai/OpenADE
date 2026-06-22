package host

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const gitCommandTimeout = 10 * time.Second
const maxGitFileAtTreeishBytes int64 = 1024 * 1024
const maxGitPatchSize = 1024 * 1024
const gitRepositoryInfoCacheTTL = 30 * time.Second
const maxGitRepositoryInfoCacheItems = 128

var ErrNotGitRepository = errors.New("not a git repository")

type GitRepositoryInfo struct {
	RepoRoot      string
	RelativePath  string
	DefaultBranch string
	HasGhCLI      bool
}

type RepoPathInspection struct {
	Path         string
	ResolvedPath string
	Exists       bool
	IsDirectory  bool
	IsGitRepo    bool
	RepoRoot     string
	RelativePath string
	MainBranch   string
	HasGhCLI     bool
	Error        string
}

type GitBranch struct {
	Name      string
	IsDefault bool
	IsRemote  bool
}

type GitBranches struct {
	Branches      []GitBranch
	DefaultBranch string
}

type GitWorktree struct {
	WorktreeID string
	Path       string
	Branch     string
	Head       string
	Label      string
}

type GitChangedFile struct {
	Path    string
	Status  string
	OldPath string
	Binary  bool
}

type GitChangeStats struct {
	FilesChanged int
	Insertions   int
	Deletions    int
}

type GitChangeGroup struct {
	Files []GitChangedFile
	Stats GitChangeStats
}

type GitLogEntry struct {
	SHA          string
	ShortSHA     string
	Message      string
	Author       string
	Date         string
	RelativeDate string
	ParentCount  int
}

type GitLogResult struct {
	Commits []GitLogEntry
	HasMore bool
}

type GitSummary struct {
	Branch     *string
	HeadCommit string
	Ahead      *int
	HasChanges bool
	Staged     GitChangeGroup
	Unstaged   GitChangeGroup
	Untracked  []GitChangedFile
}

type GitFileAtTreeishResult struct {
	Content  string
	Exists   bool
	TooLarge bool
}

type GitPatchStats struct {
	Insertions   int
	Deletions    int
	ChangedLines int
	HunkCount    int
}

type GitCommitFilePatchResult struct {
	Patch     string
	Truncated bool
	Heavy     bool
	Stats     GitPatchStats
}

type GitFilePairResult struct {
	Before   string
	After    string
	TooLarge bool
}

type GitCommitResult struct {
	Committed bool
	Status    string
	SHA       string
	Error     string
}

type TaskEnvironmentWorktree struct {
	WorktreeDir     string
	WorkingDir      string
	RootPath        string
	BranchName      string
	SourceBranch    string
	MergeBaseCommit string
}

type TaskEnvironmentWorktreeCleanupTarget struct {
	WorktreeDir          string
	BranchName           string
	RequireGitRegistered bool
}

type commandResult struct {
	stdout   string
	stderr   string
	success  bool
	exitCode int
}

var taskEnvironmentSlugPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

type gitRepositoryInfoCacheEntry struct {
	info      GitRepositoryInfo
	expiresAt time.Time
}

var gitRepositoryInfoCache = struct {
	sync.Mutex
	entries map[string]gitRepositoryInfoCacheEntry
	loading map[string]chan struct{}
}{
	entries: map[string]gitRepositoryInfoCacheEntry{},
	loading: map[string]chan struct{}{},
}

const defaultGitIgnore = `# Dependencies
node_modules/
vendor/
bower_components/
.pnp/
.pnp.js

# Build outputs
dist/
build/
out/
.next/
.nuxt/
.output/
*.egg-info/
__pycache__/
*.pyc

# Environment files
.env
.env.local
.env.*.local
*.local

# IDE/Editor
.idea/
.vscode/
*.swp
*.swo
*~
.project
.classpath
.settings/

# OS files
.DS_Store
.DS_Store?
._*
Thumbs.db
ehthumbs.db
Desktop.ini

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Testing
coverage/
.nyc_output/
.pytest_cache/

# Misc
*.bak
*.tmp
*.temp
.cache/
`

func InspectRepoPath(ctx context.Context, rawPath string) RepoPathInspection {
	resolvedPath := ResolveUserPath(rawPath)
	inspection := RepoPathInspection{
		Path:         rawPath,
		ResolvedPath: resolvedPath,
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return inspection
	}
	inspection.Exists = true
	inspection.IsDirectory = info.IsDir()
	if !info.IsDir() {
		return inspection
	}
	gitInfo, ok, reason, err := ReadGitRepositoryInfo(ctx, resolvedPath)
	if err != nil {
		inspection.Error = err.Error()
		return inspection
	}
	if !ok {
		inspection.Error = reason
		return inspection
	}
	inspection.IsGitRepo = true
	inspection.RepoRoot = gitInfo.RepoRoot
	inspection.RelativePath = gitInfo.RelativePath
	inspection.MainBranch = gitInfo.DefaultBranch
	inspection.HasGhCLI = gitInfo.HasGhCLI
	return inspection
}

func ResolveUserPath(rawPath string) string {
	resolvedPath := strings.TrimSpace(rawPath)
	if strings.HasPrefix(resolvedPath, "~") {
		if homeDir, err := os.UserHomeDir(); err == nil {
			resolvedPath = filepath.Join(homeDir, strings.TrimPrefix(resolvedPath, "~"))
		}
	}
	if homeDir, err := os.UserHomeDir(); err == nil {
		resolvedPath = strings.ReplaceAll(resolvedPath, "$HOME", homeDir)
		resolvedPath = strings.ReplaceAll(resolvedPath, "${HOME}", homeDir)
		resolvedPath = strings.ReplaceAll(resolvedPath, "%USERPROFILE%", homeDir)
		resolvedPath = strings.ReplaceAll(resolvedPath, "%HOME%", homeDir)
	}
	return filepath.Clean(resolvedPath)
}

func InitializeGitRepository(ctx context.Context, directory string) error {
	info, err := os.Stat(directory)
	if err != nil {
		return fmt.Errorf("stat git directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("path is not a directory")
	}
	if _, err := os.Stat(filepath.Join(directory, ".git")); err == nil {
		return fmt.Errorf("directory is already a git repository")
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat .git directory: %w", err)
	}
	if result, err := runGit(ctx, directory, "init"); err != nil {
		return err
	} else if !result.success {
		return fmt.Errorf("git init failed: %s", strings.TrimSpace(result.stderr))
	}
	gitignorePath := filepath.Join(directory, ".gitignore")
	if _, err := os.Stat(gitignorePath); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(gitignorePath, []byte(defaultGitIgnore), 0o644); err != nil {
			return fmt.Errorf("write .gitignore: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("stat .gitignore: %w", err)
	}
	if result, err := runGit(ctx, directory, "add", ".gitignore"); err != nil {
		return err
	} else if !result.success {
		return fmt.Errorf("git add .gitignore failed: %s", strings.TrimSpace(result.stderr))
	}
	if result, err := runGit(ctx, directory, "-c", "user.name=OpenADE", "-c", "user.email=openade@example.invalid", "commit", "-m", "Initial commit: Add .gitignore"); err != nil {
		return err
	} else if !result.success {
		return fmt.Errorf("git commit .gitignore failed: %s", strings.TrimSpace(result.stderr))
	}
	return nil
}

func ReadGitRepositoryInfo(ctx context.Context, directory string) (GitRepositoryInfo, bool, string, error) {
	cacheKey, canCache := gitRepositoryInfoCacheKey(directory)
	for {
		if !canCache {
			info, ok, reason, err := resolveGitRepository(ctx, directory)
			if err != nil || !ok {
				return info, ok, reason, err
			}
			info.HasGhCLI = checkGhCLI(ctx, info.RepoRoot)
			return info, true, "", nil
		}

		now := time.Now()
		gitRepositoryInfoCache.Lock()
		if cached, ok := gitRepositoryInfoCache.entries[cacheKey]; ok {
			if now.Before(cached.expiresAt) {
				gitRepositoryInfoCache.Unlock()
				return cached.info, true, "", nil
			}
			delete(gitRepositoryInfoCache.entries, cacheKey)
		}
		if loading := gitRepositoryInfoCache.loading[cacheKey]; loading != nil {
			gitRepositoryInfoCache.Unlock()
			<-loading
			continue
		}
		loading := make(chan struct{})
		gitRepositoryInfoCache.loading[cacheKey] = loading
		gitRepositoryInfoCache.Unlock()

		info, ok, reason, err := resolveGitRepository(ctx, directory)
		if err == nil && ok {
			info.HasGhCLI = checkGhCLI(ctx, info.RepoRoot)
		}

		gitRepositoryInfoCache.Lock()
		if err == nil && ok {
			gitRepositoryInfoCache.entries[cacheKey] = gitRepositoryInfoCacheEntry{
				info:      info,
				expiresAt: time.Now().Add(gitRepositoryInfoCacheTTL),
			}
			evictGitRepositoryInfoCacheLocked(time.Now())
		}
		delete(gitRepositoryInfoCache.loading, cacheKey)
		close(loading)
		gitRepositoryInfoCache.Unlock()

		return info, ok, reason, err
	}
}

func gitRepositoryInfoCacheKey(directory string) (string, bool) {
	if strings.TrimSpace(directory) == "" {
		return "", false
	}
	absDirectory, err := filepath.Abs(directory)
	if err != nil {
		return "", false
	}
	return absDirectory, true
}

func evictGitRepositoryInfoCacheLocked(now time.Time) {
	for key, entry := range gitRepositoryInfoCache.entries {
		if !now.Before(entry.expiresAt) {
			delete(gitRepositoryInfoCache.entries, key)
		}
	}
	for len(gitRepositoryInfoCache.entries) > maxGitRepositoryInfoCacheItems {
		var oldestKey string
		var oldest time.Time
		first := true
		for key, entry := range gitRepositoryInfoCache.entries {
			if first || entry.expiresAt.Before(oldest) {
				first = false
				oldestKey = key
				oldest = entry.expiresAt
			}
		}
		delete(gitRepositoryInfoCache.entries, oldestKey)
	}
}

func ListGitBranches(ctx context.Context, directory string, includeRemote bool) (GitBranches, bool, string, error) {
	info, ok, reason, err := resolveGitRepositoryBase(ctx, directory)
	if err != nil || !ok {
		return GitBranches{}, ok, reason, err
	}
	type gitCommandRead struct {
		result commandResult
		err    error
	}
	localCh := make(chan gitCommandRead, 1)
	remoteHeadCh := make(chan gitCommandRead, 1)
	remoteCh := make(chan gitCommandRead, 1)
	go func() {
		result, err := runGit(ctx, info.RepoRoot, "branch", "--format=%(refname:short)")
		localCh <- gitCommandRead{result: result, err: err}
	}()
	go func() {
		result, err := runGit(ctx, info.RepoRoot, "symbolic-ref", "refs/remotes/origin/HEAD")
		remoteHeadCh <- gitCommandRead{result: result, err: err}
	}()
	if includeRemote {
		go func() {
			result, err := runGit(ctx, info.RepoRoot, "branch", "-r", "--format=%(refname:short)")
			remoteCh <- gitCommandRead{result: result, err: err}
		}()
	} else {
		remoteCh <- gitCommandRead{}
	}
	localRead := <-localCh
	remoteHeadRead := <-remoteHeadCh
	remoteRead := <-remoteCh
	if localRead.err != nil {
		return GitBranches{}, true, "", localRead.err
	}
	if !localRead.result.success {
		return GitBranches{}, true, "", fmt.Errorf("list local branches: %s", firstNonEmpty(localRead.result.stderr, localRead.result.stdout))
	}

	defaultBranch := defaultBranchFromBranchOutput(remoteHeadRead.result, localRead.result.stdout)
	branches := gitBranchesFromOutput(localRead.result.stdout, defaultBranch, false)
	localNames := map[string]bool{}
	for _, branch := range branches {
		localNames[branch.Name] = true
	}

	if includeRemote {
		if remoteRead.err != nil {
			return GitBranches{}, true, "", remoteRead.err
		}
		if remoteRead.result.success {
			for _, branch := range gitBranchesFromOutput(remoteRead.result.stdout, defaultBranch, true) {
				localName := strings.TrimPrefix(branch.Name, "origin/")
				if localNames[localName] || localNames[branch.Name] {
					continue
				}
				branches = append(branches, branch)
			}
		}
	}

	sortGitBranches(branches)
	return GitBranches{Branches: branches, DefaultBranch: defaultBranch}, true, "", nil
}

func ListGitWorktrees(ctx context.Context, directory string) ([]GitWorktree, bool, string, error) {
	info, ok, reason, err := resolveGitRepositoryBase(ctx, directory)
	if err != nil || !ok {
		return nil, ok, reason, err
	}
	result, err := runGit(ctx, info.RepoRoot, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, true, "", err
	}
	if !result.success {
		return nil, true, "", fmt.Errorf("list git worktrees: %s", firstNonEmpty(result.stderr, result.stdout))
	}
	return gitWorktreesFromEntries(parseGitWorktreeEntries(result.stdout)), true, "", nil
}

func CheckGitAncestor(ctx context.Context, directory string, ancestor string, descendant string) (*bool, bool, string, error) {
	info, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return nil, ok, reason, err
	}
	if strings.TrimSpace(ancestor) == "" || strings.TrimSpace(descendant) == "" {
		return nil, true, "", nil
	}
	result, err := runGit(ctx, info.RepoRoot, "merge-base", "--is-ancestor", ancestor, descendant)
	if err != nil {
		return nil, true, "", err
	}
	if result.success {
		merged := true
		return &merged, true, "", nil
	}
	if result.exitCode == 1 {
		merged := false
		return &merged, true, "", nil
	}
	return nil, true, "", nil
}

func PrepareTaskEnvironmentWorktree(ctx context.Context, directory string, slug string, sourceBranch string, worktreeBaseDir string) (TaskEnvironmentWorktree, bool, string, error) {
	info, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return TaskEnvironmentWorktree{}, ok, reason, err
	}
	if !taskEnvironmentSlugPattern.MatchString(slug) {
		return TaskEnvironmentWorktree{}, true, "", errors.New("task slug is invalid for environment setup")
	}
	if strings.TrimSpace(sourceBranch) == "" {
		sourceBranch = info.DefaultBranch
	}
	if strings.TrimSpace(sourceBranch) == "" {
		sourceBranch = "main"
	}
	if strings.TrimSpace(worktreeBaseDir) == "" {
		worktreeBaseDir = defaultTaskEnvironmentWorktreeBaseDir()
	}
	worktreeBaseDir, err = filepath.Abs(worktreeBaseDir)
	if err != nil {
		return TaskEnvironmentWorktree{}, true, "", fmt.Errorf("resolve worktree base directory: %w", err)
	}
	if err := os.MkdirAll(worktreeBaseDir, 0o755); err != nil {
		return TaskEnvironmentWorktree{}, true, "", fmt.Errorf("create worktree base directory: %w", err)
	}

	worktreeDir := filepath.Join(worktreeBaseDir, slug)
	branchName := "openade/" + slug
	expectedBranch := "refs/heads/" + branchName
	worktreesResult, err := runGit(ctx, info.RepoRoot, "worktree", "list", "--porcelain")
	if err != nil {
		return TaskEnvironmentWorktree{}, true, "", err
	}
	if worktreesResult.success {
		for _, entry := range parseGitWorktreeEntries(worktreesResult.stdout) {
			if filepath.Clean(entry.path) != filepath.Clean(worktreeDir) {
				continue
			}
			if entry.branch == branchName || entry.branch == expectedBranch {
				return buildTaskEnvironmentWorktree(ctx, info, worktreeDir, branchName, sourceBranch), true, "", nil
			}
			removeResult, err := runGit(ctx, info.RepoRoot, "worktree", "remove", worktreeDir, "--force")
			if err != nil {
				return TaskEnvironmentWorktree{}, true, "", err
			}
			if !removeResult.success {
				return TaskEnvironmentWorktree{}, true, "", fmt.Errorf("remove mismatched task worktree: %s", firstNonEmpty(removeResult.stderr, removeResult.stdout))
			}
			break
		}
	}

	addResult, err := runGit(ctx, info.RepoRoot, "worktree", "add", "-b", branchName, worktreeDir, sourceBranch)
	if err != nil {
		return TaskEnvironmentWorktree{}, true, "", err
	}
	if !addResult.success && strings.Contains(addResult.stderr, "already exists") {
		addResult, err = runGit(ctx, info.RepoRoot, "worktree", "add", worktreeDir, branchName)
		if err != nil {
			return TaskEnvironmentWorktree{}, true, "", err
		}
	}
	if !addResult.success {
		return TaskEnvironmentWorktree{}, true, "", fmt.Errorf("create task worktree: %s", firstNonEmpty(addResult.stderr, addResult.stdout))
	}
	return buildTaskEnvironmentWorktree(ctx, info, worktreeDir, branchName, sourceBranch), true, "", nil
}

func NewTaskEnvironmentWorktreeCleanupTarget(slug string, worktreeDir string, worktreeBaseDir string) (TaskEnvironmentWorktreeCleanupTarget, error) {
	if !taskEnvironmentSlugPattern.MatchString(slug) {
		return TaskEnvironmentWorktreeCleanupTarget{}, errors.New("task slug is invalid for environment cleanup")
	}
	if strings.TrimSpace(worktreeDir) == "" {
		return TaskEnvironmentWorktreeCleanupTarget{}, errors.New("task worktree directory is required for cleanup")
	}
	if strings.TrimSpace(worktreeBaseDir) == "" {
		worktreeBaseDir = defaultTaskEnvironmentWorktreeBaseDir()
	}
	baseDir, err := filepath.Abs(worktreeBaseDir)
	if err != nil {
		return TaskEnvironmentWorktreeCleanupTarget{}, fmt.Errorf("resolve worktree base directory: %w", err)
	}
	targetDir, err := filepath.Abs(worktreeDir)
	if err != nil {
		return TaskEnvironmentWorktreeCleanupTarget{}, fmt.Errorf("resolve task worktree directory: %w", err)
	}
	expectedDir := filepath.Join(baseDir, slug)
	if filepath.Clean(targetDir) != filepath.Clean(expectedDir) {
		return TaskEnvironmentWorktreeCleanupTarget{}, errors.New("task worktree is outside the core-managed worktree path")
	}
	relative, err := filepath.Rel(baseDir, targetDir)
	if err != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || relative == ".." || filepath.IsAbs(relative) {
		return TaskEnvironmentWorktreeCleanupTarget{}, errors.New("task worktree is outside the core-managed worktree base")
	}
	return TaskEnvironmentWorktreeCleanupTarget{
		WorktreeDir: targetDir,
		BranchName:  "openade/" + slug,
	}, nil
}

func NewImportedTaskEnvironmentWorktreeCleanupTarget(ctx context.Context, directory string, slug string, worktreeDir string) (TaskEnvironmentWorktreeCleanupTarget, bool, string, error) {
	info, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return TaskEnvironmentWorktreeCleanupTarget{}, ok, reason, err
	}
	if !taskEnvironmentSlugPattern.MatchString(slug) {
		return TaskEnvironmentWorktreeCleanupTarget{}, true, "", errors.New("task slug is invalid for imported worktree cleanup")
	}
	if strings.TrimSpace(worktreeDir) == "" {
		return TaskEnvironmentWorktreeCleanupTarget{}, true, "", errors.New("task worktree directory is required for imported cleanup")
	}
	targetDir, err := filepath.Abs(worktreeDir)
	if err != nil {
		return TaskEnvironmentWorktreeCleanupTarget{}, true, "", fmt.Errorf("resolve imported task worktree directory: %w", err)
	}
	if filepath.Clean(targetDir) == filepath.Clean(info.RepoRoot) {
		return TaskEnvironmentWorktreeCleanupTarget{}, true, "", errors.New("task worktree points at the repository root")
	}
	branchName := "openade/" + slug
	worktreesResult, err := runGit(ctx, info.RepoRoot, "worktree", "list", "--porcelain")
	if err != nil {
		return TaskEnvironmentWorktreeCleanupTarget{}, true, "", err
	}
	if !worktreesResult.success {
		return TaskEnvironmentWorktreeCleanupTarget{}, true, "", fmt.Errorf("list imported task worktrees: %s", firstNonEmpty(worktreesResult.stderr, worktreesResult.stdout))
	}
	for _, entry := range parseGitWorktreeEntries(worktreesResult.stdout) {
		if filepath.Clean(entry.path) != filepath.Clean(targetDir) {
			continue
		}
		if entry.branch != branchName {
			return TaskEnvironmentWorktreeCleanupTarget{}, true, "", fmt.Errorf("imported task worktree branch mismatch: %s", firstNonEmpty(entry.branch, "(detached)"))
		}
		return TaskEnvironmentWorktreeCleanupTarget{
			WorktreeDir:          targetDir,
			BranchName:           branchName,
			RequireGitRegistered: true,
		}, true, "", nil
	}
	return TaskEnvironmentWorktreeCleanupTarget{}, true, "", errors.New("imported task worktree is not registered with the repository")
}

func RemoveTaskEnvironmentWorktree(ctx context.Context, directory string, target TaskEnvironmentWorktreeCleanupTarget) (bool, bool, string, error) {
	info, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return false, ok, reason, err
	}
	removed := false
	worktreesResult, err := runGit(ctx, info.RepoRoot, "worktree", "list", "--porcelain")
	if err != nil {
		return false, true, "", err
	}
	if !worktreesResult.success {
		return false, true, "", fmt.Errorf("list worktrees: %s", firstNonEmpty(worktreesResult.stderr, worktreesResult.stdout))
	}
	registered := false
	for _, entry := range parseGitWorktreeEntries(worktreesResult.stdout) {
		if filepath.Clean(entry.path) != filepath.Clean(target.WorktreeDir) {
			continue
		}
		registered = true
		if target.RequireGitRegistered && entry.branch != target.BranchName {
			return false, true, "", fmt.Errorf("task worktree branch mismatch: %s", firstNonEmpty(entry.branch, "(detached)"))
		}
		if !target.RequireGitRegistered && entry.branch != "" && entry.branch != target.BranchName {
			return false, true, "", fmt.Errorf("task worktree branch mismatch: %s", entry.branch)
		}
		removeResult, err := runGit(ctx, info.RepoRoot, "worktree", "remove", target.WorktreeDir, "--force")
		if err != nil {
			return false, true, "", err
		}
		if !removeResult.success {
			if target.RequireGitRegistered {
				return false, true, "", fmt.Errorf("remove imported task worktree: %s", firstNonEmpty(removeResult.stderr, removeResult.stdout))
			}
			if err := os.RemoveAll(target.WorktreeDir); err != nil {
				return false, true, "", fmt.Errorf("remove task worktree directory: %w", err)
			}
			pruneResult, err := runGit(ctx, info.RepoRoot, "worktree", "prune")
			if err != nil {
				return false, true, "", err
			}
			if !pruneResult.success {
				return false, true, "", fmt.Errorf("prune removed task worktree: %s", firstNonEmpty(pruneResult.stderr, pruneResult.stdout))
			}
		}
		removed = true
		break
	}
	if !registered {
		if target.RequireGitRegistered {
			return false, true, "", errors.New("task worktree is no longer registered with the repository")
		}
		if _, err := os.Stat(target.WorktreeDir); err == nil {
			if err := os.RemoveAll(target.WorktreeDir); err != nil {
				return false, true, "", fmt.Errorf("remove stale task worktree directory: %w", err)
			}
			pruneResult, err := runGit(ctx, info.RepoRoot, "worktree", "prune")
			if err != nil {
				return false, true, "", err
			}
			if !pruneResult.success {
				return false, true, "", fmt.Errorf("prune stale task worktree: %s", firstNonEmpty(pruneResult.stderr, pruneResult.stdout))
			}
			removed = true
		} else if !os.IsNotExist(err) {
			return false, true, "", fmt.Errorf("stat task worktree directory: %w", err)
		}
	}
	if removed {
		if err := deleteTaskEnvironmentBranch(ctx, info.RepoRoot, target.BranchName); err != nil {
			return true, true, "", err
		}
	}
	return removed, true, "", nil
}

func ReadGitSummary(ctx context.Context, directory string) (GitSummary, bool, string, error) {
	info, ok, reason, err := resolveGitRepositoryBase(ctx, directory)
	if err != nil || !ok {
		return GitSummary{}, ok, reason, err
	}

	branch := currentBranch(ctx, info.RepoRoot)
	headCommit := gitOutput(ctx, info.RepoRoot, "rev-parse", "--short", "HEAD")
	ahead := gitAheadCount(ctx, info.RepoRoot, branch)
	stagedNameStatus := successfulGitOutput(ctx, info.RepoRoot, "diff", "--cached", "--name-status", "-M")
	unstagedNameStatus := successfulGitOutput(ctx, info.RepoRoot, "diff", "--name-status", "-M")
	stagedNumstat := successfulGitOutput(ctx, info.RepoRoot, "diff", "--cached", "--numstat", "-M")
	unstagedNumstat := successfulGitOutput(ctx, info.RepoRoot, "diff", "--numstat", "-M")
	untrackedOutput := successfulGitOutput(ctx, info.RepoRoot, "ls-files", "--others", "--exclude-standard")

	stagedFiles := parseGitNameStatus(stagedNameStatus, parseBinaryByPath(stagedNumstat))
	unstagedFiles := parseGitNameStatus(unstagedNameStatus, parseBinaryByPath(unstagedNumstat))
	untracked := gitUntrackedFiles(untrackedOutput)
	return GitSummary{
		Branch:     branch,
		HeadCommit: headCommit,
		Ahead:      ahead,
		HasChanges: len(stagedFiles) > 0 || len(unstagedFiles) > 0 || len(untracked) > 0,
		Staged: GitChangeGroup{
			Files: stagedFiles,
			Stats: parseGitNumstatStats(stagedNumstat),
		},
		Unstaged: GitChangeGroup{
			Files: unstagedFiles,
			Stats: parseGitNumstatStats(unstagedNumstat),
		},
		Untracked: untracked,
	}, true, "", nil
}

func ReadGitLog(ctx context.Context, directory string, ref string, limit int, skip int) (GitLogResult, bool, string, error) {
	info, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return GitLogResult{}, ok, reason, err
	}
	if limit <= 0 {
		limit = 50
	}
	if skip < 0 {
		skip = 0
	}
	fieldSeparator := "\x1f"
	recordSeparator := "\x1e"
	format := strings.Join([]string{"%H", "%h", "%s", "%an", "%aI", "%ar", "%P"}, fieldSeparator) + recordSeparator
	args := []string{"log", "--format=" + format, "--max-count=" + strconv.Itoa(limit+1), "--skip=" + strconv.Itoa(skip)}
	if strings.TrimSpace(ref) != "" {
		args = append(args, ref)
	}
	result, err := runGit(ctx, info.RepoRoot, args...)
	if err != nil {
		return GitLogResult{}, true, "", err
	}
	if !result.success {
		return GitLogResult{}, true, "", fmt.Errorf("read git log: %s", firstNonEmpty(result.stderr, result.stdout))
	}
	commits := parseGitLogOutput(result.stdout, fieldSeparator, recordSeparator)
	hasMore := len(commits) > limit
	if hasMore {
		commits = commits[:limit]
	}
	return GitLogResult{Commits: commits, HasMore: hasMore}, true, "", nil
}

func ReadGitCommitFiles(ctx context.Context, directory string, commit string) ([]GitChangedFile, bool, string, error) {
	info, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return nil, ok, reason, err
	}
	parentResult, err := runGit(ctx, info.RepoRoot, "show", "--no-patch", "--format=%P", commit)
	if err != nil {
		return nil, true, "", err
	}
	if !parentResult.success {
		return nil, true, "", fmt.Errorf("resolve commit parents: %s", firstNonEmpty(parentResult.stderr, parentResult.stdout))
	}
	parents := strings.Fields(parentResult.stdout)
	args := []string{"diff-tree", "--root", "-r", "--no-commit-id", "--name-status", "-M", commit}
	if len(parents) > 0 {
		args = []string{"diff", "--name-status", "-M", parents[0], commit}
	}
	diffResult, err := runGit(ctx, info.RepoRoot, args...)
	if err != nil {
		return nil, true, "", err
	}
	if !diffResult.success {
		return nil, true, "", fmt.Errorf("read commit files: %s", firstNonEmpty(diffResult.stderr, diffResult.stdout))
	}
	return parseGitNameStatus(diffResult.stdout, map[string]bool{}), true, "", nil
}

func CommitGitChanges(ctx context.Context, directory string, message string) (GitCommitResult, bool, string, error) {
	_, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return GitCommitResult{}, ok, reason, err
	}
	workDir, err := normalizeRoot(directory)
	if err != nil {
		return GitCommitResult{}, true, "", err
	}
	addResult, err := runGit(ctx, workDir, "add", "-A")
	if err != nil {
		return GitCommitResult{}, true, "", err
	}
	if !addResult.success {
		return GitCommitResult{Committed: false, Status: "failed", Error: firstNonEmpty(addResult.stderr, addResult.stdout, "Failed to stage task changes")}, true, "", nil
	}

	statusResult, err := runGit(ctx, workDir, "status", "--porcelain")
	if err != nil {
		return GitCommitResult{}, true, "", err
	}
	if !statusResult.success {
		return GitCommitResult{Committed: false, Status: "failed", Error: firstNonEmpty(statusResult.stderr, statusResult.stdout, "Failed to inspect task changes")}, true, "", nil
	}
	if strings.TrimSpace(statusResult.stdout) == "" {
		return GitCommitResult{Committed: false, Status: "nothing_to_commit"}, true, "", nil
	}

	commitResult, err := runGit(ctx, workDir, "commit", "-m", message)
	if err != nil {
		return GitCommitResult{}, true, "", err
	}
	if !commitResult.success {
		errorMessage := firstNonEmpty(commitResult.stderr, commitResult.stdout, "Failed to commit task changes")
		if strings.Contains(errorMessage, "nothing to commit") {
			return GitCommitResult{Committed: false, Status: "nothing_to_commit"}, true, "", nil
		}
		return GitCommitResult{Committed: false, Status: "failed", Error: errorMessage}, true, "", nil
	}

	shaResult, err := runGit(ctx, workDir, "rev-parse", "HEAD")
	if err != nil {
		return GitCommitResult{}, true, "", err
	}
	if !shaResult.success {
		return GitCommitResult{Committed: true, Status: "committed"}, true, "", nil
	}
	return GitCommitResult{Committed: true, Status: "committed", SHA: strings.TrimSpace(shaResult.stdout)}, true, "", nil
}

func ReadGitChanges(ctx context.Context, directory string, fromTreeish string) ([]GitChangedFile, bool, string, error) {
	info, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return nil, ok, reason, err
	}
	workDir, err := normalizeRoot(directory)
	if err != nil {
		return nil, true, "", err
	}
	diffResult, err := runGit(ctx, workDir, "diff", "--name-status", "-M", fromTreeish)
	if err != nil {
		return nil, true, "", err
	}
	if !diffResult.success {
		return nil, true, "", fmt.Errorf("read task changes: %s", firstNonEmpty(diffResult.stderr, diffResult.stdout))
	}
	files := parseGitNameStatus(diffResult.stdout, map[string]bool{})
	seenPaths := map[string]bool{}
	for _, file := range files {
		seenPaths[file.Path] = true
	}
	untrackedResult, err := runGit(ctx, info.RepoRoot, "ls-files", "--others", "--exclude-standard")
	if err != nil {
		return nil, true, "", err
	}
	if untrackedResult.success {
		for _, file := range gitUntrackedFiles(untrackedResult.stdout) {
			if seenPaths[file.Path] {
				continue
			}
			files = append(files, file)
		}
	}
	return files, true, "", nil
}

func ReadGitFileAtTreeish(ctx context.Context, directory string, treeish string, filePath string) (GitFileAtTreeishResult, bool, string, error) {
	_, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return GitFileAtTreeishResult{}, ok, reason, err
	}
	workDir, err := normalizeRoot(directory)
	if err != nil {
		return GitFileAtTreeishResult{}, true, "", err
	}
	relativePath, err := scopedGitRelativePath(workDir, filePath)
	if err != nil {
		return GitFileAtTreeishResult{}, true, "", err
	}
	spec := treeish + ":./" + relativePath
	sizeResult, err := runGit(ctx, workDir, "cat-file", "-s", spec)
	if err != nil {
		return GitFileAtTreeishResult{}, true, "", err
	}
	if !sizeResult.success {
		return GitFileAtTreeishResult{Exists: false}, true, "", nil
	}
	size, err := strconv.ParseInt(strings.TrimSpace(sizeResult.stdout), 10, 64)
	if err != nil {
		return GitFileAtTreeishResult{}, true, "", fmt.Errorf("read file size at treeish: %w", err)
	}
	if size > maxGitFileAtTreeishBytes || isBinaryPath(filePath) {
		return GitFileAtTreeishResult{Exists: true, TooLarge: true}, true, "", nil
	}
	contentResult, err := runGit(ctx, workDir, "show", spec)
	if err != nil {
		return GitFileAtTreeishResult{}, true, "", err
	}
	if !contentResult.success {
		return GitFileAtTreeishResult{Exists: false}, true, "", nil
	}
	return GitFileAtTreeishResult{Content: contentResult.stdout, Exists: true}, true, "", nil
}

func ReadGitDiff(
	ctx context.Context,
	directory string,
	fromTreeish string,
	filePath string,
	oldPath string,
	contextLines int,
	allowTruncation bool,
) (GitCommitFilePatchResult, bool, string, error) {
	_, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return GitCommitFilePatchResult{}, ok, reason, err
	}
	workDir, err := normalizeRoot(directory)
	if err != nil {
		return GitCommitFilePatchResult{}, true, "", err
	}
	if isGeneratedGitPatchFile(filePath) {
		return GitCommitFilePatchResult{}, true, "", nil
	}
	pathspecs, err := gitPatchPathspecs(workDir, filePath, oldPath)
	if err != nil {
		return GitCommitFilePatchResult{}, true, "", err
	}
	args := []string{"diff", "-M", "-U" + strconv.Itoa(contextLines), fromTreeish, "--"}
	args = append(args, pathspecs...)
	diffResult, err := runGit(ctx, workDir, args...)
	if err != nil {
		return GitCommitFilePatchResult{}, true, "", err
	}
	if !diffResult.success {
		return GitCommitFilePatchResult{}, true, "", fmt.Errorf("read task diff: %s", firstNonEmpty(diffResult.stderr, diffResult.stdout))
	}
	patch := finalizeGitPatch(diffResult.stdout, allowTruncation)
	if patch.Patch != "" || oldPath != "" {
		return patch, true, "", nil
	}
	untrackedPatch, err := readGitUntrackedFilePatch(ctx, workDir, filePath, contextLines, allowTruncation)
	if err != nil {
		return GitCommitFilePatchResult{}, true, "", err
	}
	return untrackedPatch, true, "", nil
}

func ReadGitFilePair(ctx context.Context, directory string, fromTreeish string, filePath string, oldPath string) (GitFilePairResult, bool, string, error) {
	_, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return GitFilePairResult{}, ok, reason, err
	}
	workDir, err := normalizeRoot(directory)
	if err != nil {
		return GitFilePairResult{}, true, "", err
	}
	if isGeneratedGitPatchFile(filePath) {
		return GitFilePairResult{TooLarge: true}, true, "", nil
	}
	beforePath := filePath
	if oldPath != "" {
		beforePath = oldPath
	}
	before, _, _, err := ReadGitFileAtTreeish(ctx, workDir, fromTreeish, beforePath)
	if err != nil {
		return GitFilePairResult{}, true, "", err
	}
	after, err := readGitWorkingTreeFile(workDir, filePath)
	if err != nil {
		return GitFilePairResult{}, true, "", err
	}
	if before.TooLarge || after.TooLarge || exceedsGitFilePairLineLimit(before.Content) || exceedsGitFilePairLineLimit(after.Content) {
		return GitFilePairResult{TooLarge: true}, true, "", nil
	}
	return GitFilePairResult{Before: before.Content, After: after.Content}, true, "", nil
}

func ReadGitCommitFilePatch(
	ctx context.Context,
	directory string,
	commit string,
	filePath string,
	oldPath string,
	contextLines int,
	allowTruncation bool,
) (GitCommitFilePatchResult, bool, string, error) {
	_, ok, reason, err := resolveGitRepository(ctx, directory)
	if err != nil || !ok {
		return GitCommitFilePatchResult{}, ok, reason, err
	}
	workDir, err := normalizeRoot(directory)
	if err != nil {
		return GitCommitFilePatchResult{}, true, "", err
	}
	if isGeneratedGitPatchFile(filePath) {
		return GitCommitFilePatchResult{}, true, "", nil
	}
	parentResult, err := runGit(ctx, workDir, "show", "--no-patch", "--format=%P", commit)
	if err != nil {
		return GitCommitFilePatchResult{}, true, "", err
	}
	if !parentResult.success {
		return GitCommitFilePatchResult{}, true, "", fmt.Errorf("resolve commit parents: %s", firstNonEmpty(parentResult.stderr, parentResult.stdout))
	}
	parents := strings.Fields(parentResult.stdout)
	pathspecs, err := gitPatchPathspecs(workDir, filePath, oldPath)
	if err != nil {
		return GitCommitFilePatchResult{}, true, "", err
	}
	contextArg := "-U" + strconv.Itoa(contextLines)
	args := []string{"diff-tree", "--root", "-p", "-M", contextArg, commit, "--"}
	if len(parents) > 0 {
		args = []string{"diff", "-M", contextArg, parents[0], commit, "--"}
	}
	args = append(args, pathspecs...)
	diffResult, err := runGit(ctx, workDir, args...)
	if err != nil {
		return GitCommitFilePatchResult{}, true, "", err
	}
	if !diffResult.success {
		return GitCommitFilePatchResult{}, true, "", fmt.Errorf("read commit file patch: %s", firstNonEmpty(diffResult.stderr, diffResult.stdout))
	}
	return finalizeGitPatch(diffResult.stdout, allowTruncation), true, "", nil
}

func resolveGitRepository(ctx context.Context, directory string) (GitRepositoryInfo, bool, string, error) {
	info, ok, reason, err := resolveGitRepositoryBase(ctx, directory)
	if err != nil || !ok {
		return info, ok, reason, err
	}
	info.DefaultBranch = detectDefaultBranch(ctx, info.RepoRoot)
	return info, true, "", nil
}

func resolveGitRepositoryBase(ctx context.Context, directory string) (GitRepositoryInfo, bool, string, error) {
	if strings.TrimSpace(directory) == "" {
		return GitRepositoryInfo{}, false, "directory is required", nil
	}
	stat, err := os.Stat(directory)
	if err != nil {
		return GitRepositoryInfo{}, false, err.Error(), nil
	}
	if !stat.IsDir() {
		return GitRepositoryInfo{}, false, "path is not a directory", nil
	}
	absDirectory, err := filepath.Abs(directory)
	if err != nil {
		return GitRepositoryInfo{}, false, err.Error(), nil
	}

	rootResult, err := runGit(ctx, absDirectory, "rev-parse", "--show-toplevel")
	if err != nil {
		return GitRepositoryInfo{}, false, "", err
	}
	if !rootResult.success {
		return GitRepositoryInfo{}, false, firstNonEmpty(rootResult.stderr, rootResult.stdout, ErrNotGitRepository.Error()), nil
	}
	prefixResult, err := runGit(ctx, absDirectory, "rev-parse", "--show-prefix")
	if err != nil {
		return GitRepositoryInfo{}, false, "", err
	}
	relativePath := ""
	if prefixResult.success {
		relativePath = strings.TrimSuffix(strings.TrimSpace(prefixResult.stdout), "/")
	}

	repoRoot := strings.TrimSpace(rootResult.stdout)
	return GitRepositoryInfo{
		RepoRoot:     repoRoot,
		RelativePath: relativePath,
	}, true, "", nil
}

func defaultBranchFromBranchOutput(remoteHead commandResult, localBranchOutput string) string {
	if remoteHead.success {
		name := strings.TrimPrefix(strings.TrimSpace(remoteHead.stdout), "refs/remotes/origin/")
		if name != "" {
			return name
		}
	}
	for _, name := range strings.Split(strings.TrimSpace(localBranchOutput), "\n") {
		if strings.TrimSpace(name) == "main" {
			return "main"
		}
	}
	for _, name := range strings.Split(strings.TrimSpace(localBranchOutput), "\n") {
		if strings.TrimSpace(name) == "master" {
			return "master"
		}
	}
	return "main"
}

func detectDefaultBranch(ctx context.Context, repoRoot string) string {
	remoteHead := gitOutput(ctx, repoRoot, "symbolic-ref", "refs/remotes/origin/HEAD")
	if remoteHead != "" {
		return strings.TrimPrefix(remoteHead, "refs/remotes/origin/")
	}
	if gitSuccess(ctx, repoRoot, "show-ref", "--verify", "refs/heads/main") {
		return "main"
	}
	if gitSuccess(ctx, repoRoot, "show-ref", "--verify", "refs/heads/master") {
		return "master"
	}
	return "main"
}

func checkGhCLI(ctx context.Context, repoRoot string) bool {
	if _, err := exec.LookPath("gh"); err != nil {
		return false
	}
	commandCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, "gh", "--version")
	cmd.Dir = repoRoot
	return cmd.Run() == nil
}

func currentBranch(ctx context.Context, repoRoot string) *string {
	branch := gitOutput(ctx, repoRoot, "rev-parse", "--abbrev-ref", "HEAD")
	if branch == "" || branch == "HEAD" {
		return nil
	}
	return &branch
}

func gitAheadCount(ctx context.Context, repoRoot string, branch *string) *int {
	if branch == nil {
		return nil
	}
	if count, ok := parseGitCount(gitOutput(ctx, repoRoot, "rev-list", "--count", "@{upstream}..HEAD")); ok {
		return &count
	}
	if count, ok := parseGitCount(gitOutput(ctx, repoRoot, "rev-list", "--count", "origin/HEAD..HEAD")); ok {
		return &count
	}
	return nil
}

func parseGitCount(value string) (int, bool) {
	if strings.TrimSpace(value) == "" {
		return 0, false
	}
	count, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, false
	}
	return count, true
}

func gitOutput(ctx context.Context, cwd string, args ...string) string {
	result, err := runGit(ctx, cwd, args...)
	if err != nil || !result.success {
		return ""
	}
	return strings.TrimSpace(result.stdout)
}

func successfulGitOutput(ctx context.Context, cwd string, args ...string) string {
	result, err := runGit(ctx, cwd, args...)
	if err != nil || !result.success {
		return ""
	}
	return result.stdout
}

func gitSuccess(ctx context.Context, cwd string, args ...string) bool {
	result, err := runGit(ctx, cwd, args...)
	return err == nil && result.success
}

func runGit(ctx context.Context, cwd string, args ...string) (commandResult, error) {
	commandCtx, cancel := context.WithTimeout(ctx, gitCommandTimeout)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, "git", append([]string{"-C", cwd}, args...)...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if exitErr, ok := err.(*exec.ExitError); ok {
		exitCode = exitErr.ExitCode()
	}
	result := commandResult{stdout: stdout.String(), stderr: stderr.String(), success: err == nil, exitCode: exitCode}
	if commandCtx.Err() != nil {
		return result, commandCtx.Err()
	}
	return result, nil
}

func gitPatchPathspecs(root string, filePath string, oldPath string) ([]string, error) {
	normalizedPath, err := scopedGitRelativePath(root, filePath)
	if err != nil {
		return nil, err
	}
	if oldPath != "" && oldPath != filePath {
		normalizedOldPath, err := scopedGitRelativePath(root, oldPath)
		if err != nil {
			return nil, err
		}
		return []string{normalizedOldPath, normalizedPath}, nil
	}
	return []string{normalizedPath}, nil
}

func scopedGitRelativePath(root string, filePath string) (string, error) {
	target, err := resolveRootRelativePath(root, filePath)
	if err != nil {
		return "", err
	}
	return scopedRelativePath(root, target)
}

func readGitUntrackedFilePatch(ctx context.Context, workDir string, filePath string, contextLines int, allowTruncation bool) (GitCommitFilePatchResult, error) {
	target, err := resolveRootRelativePath(workDir, filePath)
	if err != nil {
		return GitCommitFilePatchResult{}, err
	}
	stat, err := os.Stat(target)
	if err != nil || !stat.Mode().IsRegular() {
		return GitCommitFilePatchResult{}, nil
	}
	relativePath, err := scopedRelativePath(workDir, target)
	if err != nil {
		return GitCommitFilePatchResult{}, err
	}
	result, err := runGit(ctx, workDir, "diff", "--no-index", "-U"+strconv.Itoa(contextLines), "--", os.DevNull, relativePath)
	if err != nil {
		return GitCommitFilePatchResult{}, err
	}
	if !result.success && result.exitCode != 1 {
		return GitCommitFilePatchResult{}, fmt.Errorf("read untracked file patch: %s", firstNonEmpty(result.stderr, result.stdout))
	}
	return finalizeGitPatch(result.stdout, allowTruncation), nil
}

func readGitWorkingTreeFile(workDir string, filePath string) (GitFileAtTreeishResult, error) {
	target, err := resolveRootRelativePath(workDir, filePath)
	if err != nil {
		return GitFileAtTreeishResult{}, err
	}
	stat, err := os.Stat(target)
	if err != nil || !stat.Mode().IsRegular() {
		return GitFileAtTreeishResult{Exists: false}, nil
	}
	if stat.Size() > maxGitFileAtTreeishBytes || isBinaryPath(filePath) {
		return GitFileAtTreeishResult{Exists: true, TooLarge: true}, nil
	}
	content, err := os.ReadFile(target)
	if err != nil {
		return GitFileAtTreeishResult{}, err
	}
	return GitFileAtTreeishResult{Content: string(content), Exists: true}, nil
}

func exceedsGitFilePairLineLimit(content string) bool {
	count := 0
	for _, char := range content {
		if char == '\n' {
			count++
			if count > 10_000 {
				return true
			}
		}
	}
	return false
}

func finalizeGitPatch(patch string, allowTruncation bool) GitCommitFilePatchResult {
	if patch == "" {
		return GitCommitFilePatchResult{}
	}
	stats := parseGitPatchStats(patch)
	truncated := allowTruncation && len(patch) > maxGitPatchSize
	outputPatch := patch
	if truncated {
		outputPatch = patch[:maxGitPatchSize]
	}
	return GitCommitFilePatchResult{
		Patch:     outputPatch,
		Truncated: truncated,
		Heavy:     truncated || len(patch) > 256*1024 || stats.ChangedLines > 4_000 || stats.HunkCount > 50,
		Stats:     stats,
	}
}

func parseGitPatchStats(patch string) GitPatchStats {
	stats := GitPatchStats{}
	for _, line := range strings.Split(patch, "\n") {
		if strings.HasPrefix(line, "@@") {
			stats.HunkCount++
			continue
		}
		if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			stats.Insertions++
			continue
		}
		if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
			stats.Deletions++
		}
	}
	stats.ChangedLines = stats.Insertions + stats.Deletions
	return stats
}

func isGeneratedGitPatchFile(filePath string) bool {
	switch filepath.Base(filePath) {
	case "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock", "Gemfile.lock", "Cargo.lock", "poetry.lock", "Pipfile.lock", "go.sum", "flake.lock", "bun.lock", "bun.lockb":
		return true
	default:
		return false
	}
}

func parseGitLogOutput(stdout string, fieldSeparator string, recordSeparator string) []GitLogEntry {
	commits := []GitLogEntry{}
	for _, record := range strings.Split(stdout, recordSeparator) {
		trimmed := strings.TrimSpace(record)
		if trimmed == "" {
			continue
		}
		parts := strings.Split(trimmed, fieldSeparator)
		for len(parts) < 7 {
			parts = append(parts, "")
		}
		parents := strings.Fields(strings.TrimSpace(parts[6]))
		commits = append(commits, GitLogEntry{
			SHA:          strings.TrimSpace(parts[0]),
			ShortSHA:     strings.TrimSpace(parts[1]),
			Message:      parts[2],
			Author:       parts[3],
			Date:         strings.TrimSpace(parts[4]),
			RelativeDate: strings.TrimSpace(parts[5]),
			ParentCount:  len(parents),
		})
	}
	return commits
}

func gitBranchesFromOutput(stdout string, defaultBranch string, isRemote bool) []GitBranch {
	branches := []GitBranch{}
	for _, line := range strings.Split(stdout, "\n") {
		name := strings.TrimSpace(strings.TrimPrefix(line, "refs/heads/"))
		if name == "" || strings.Contains(name, "HEAD") {
			continue
		}
		branches = append(branches, GitBranch{
			Name:      name,
			IsDefault: strings.TrimPrefix(name, "origin/") == defaultBranch,
			IsRemote:  isRemote,
		})
	}
	return branches
}

func sortGitBranches(branches []GitBranch) {
	for i := 1; i < len(branches); i++ {
		current := branches[i]
		j := i - 1
		for j >= 0 && gitBranchLess(current, branches[j]) {
			branches[j+1] = branches[j]
			j--
		}
		branches[j+1] = current
	}
}

func gitBranchLess(left GitBranch, right GitBranch) bool {
	if left.IsDefault != right.IsDefault {
		return left.IsDefault
	}
	return left.Name < right.Name
}

type gitWorktreeEntry struct {
	path   string
	head   string
	branch string
}

func gitWorktreesFromEntries(entries []gitWorktreeEntry) []GitWorktree {
	worktrees := []GitWorktree{}
	for _, entry := range entries {
		if strings.TrimSpace(entry.path) == "" || strings.TrimSpace(entry.head) == "" {
			continue
		}
		cleanPath := filepath.Clean(entry.path)
		label := filepath.Base(cleanPath)
		if label == "." || label == string(filepath.Separator) {
			continue
		}
		worktrees = append(worktrees, GitWorktree{
			WorktreeID: label,
			Path:       entry.path,
			Branch:     strings.TrimPrefix(entry.branch, "refs/heads/"),
			Head:       strings.TrimSpace(entry.head),
			Label:      label,
		})
	}
	return worktrees
}

func parseGitWorktreeEntries(output string) []gitWorktreeEntry {
	entries := []gitWorktreeEntry{}
	var current gitWorktreeEntry
	hasCurrent := false
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			if hasCurrent {
				entries = append(entries, current)
				current = gitWorktreeEntry{}
				hasCurrent = false
			}
			continue
		}
		key, value, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		hasCurrent = true
		switch key {
		case "worktree":
			current.path = value
		case "HEAD":
			current.head = value
		case "branch":
			current.branch = strings.TrimPrefix(value, "refs/heads/")
		}
	}
	if hasCurrent {
		entries = append(entries, current)
	}
	return entries
}

func buildTaskEnvironmentWorktree(ctx context.Context, info GitRepositoryInfo, worktreeDir string, branchName string, sourceBranch string) TaskEnvironmentWorktree {
	workingDir := worktreeDir
	if info.RelativePath != "" {
		workingDir = filepath.Join(worktreeDir, filepath.FromSlash(info.RelativePath))
		_ = os.MkdirAll(workingDir, 0o755)
	}
	return TaskEnvironmentWorktree{
		WorktreeDir:     worktreeDir,
		WorkingDir:      workingDir,
		RootPath:        worktreeDir,
		BranchName:      branchName,
		SourceBranch:    sourceBranch,
		MergeBaseCommit: gitMergeBase(ctx, info.RepoRoot, branchName, sourceBranch),
	}
}

func gitMergeBase(ctx context.Context, repoRoot string, left string, right string) string {
	result, err := runGit(ctx, repoRoot, "merge-base", left, right)
	if err != nil || !result.success {
		return ""
	}
	return strings.TrimSpace(result.stdout)
}

func deleteTaskEnvironmentBranch(ctx context.Context, repoRoot string, branchName string) error {
	if strings.TrimSpace(branchName) == "" {
		return nil
	}
	ref := "refs/heads/" + branchName
	exists, err := runGit(ctx, repoRoot, "show-ref", "--verify", "--quiet", ref)
	if err != nil {
		return err
	}
	if !exists.success {
		return nil
	}
	result, err := runGit(ctx, repoRoot, "branch", "-D", branchName)
	if err != nil {
		return err
	}
	if !result.success {
		return fmt.Errorf("delete task worktree branch: %s", firstNonEmpty(result.stderr, result.stdout))
	}
	return nil
}

func defaultTaskEnvironmentWorktreeBaseDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join(".openade", "workspaces", "worktrees")
	}
	return filepath.Join(home, ".openade", "workspaces", "worktrees")
}

func parseGitNameStatus(stdout string, binaryByPath map[string]bool) []GitChangedFile {
	files := []GitChangedFile{}
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		statusCode := ""
		if len(parts) > 0 {
			statusCode = parts[0]
		}
		if strings.HasPrefix(statusCode, "R") {
			if len(parts) < 3 {
				continue
			}
			path := parts[2]
			files = append(files, GitChangedFile{
				Path:    path,
				Status:  "renamed",
				OldPath: parts[1],
				Binary:  binaryByPath[path] || isBinaryPath(path),
			})
			continue
		}
		if len(parts) < 2 {
			continue
		}
		path := parts[1]
		files = append(files, GitChangedFile{
			Path:   path,
			Status: gitStatusName(statusCode),
			Binary: binaryByPath[path] || isBinaryPath(path),
		})
	}
	return files
}

func gitStatusName(code string) string {
	switch {
	case strings.HasPrefix(code, "A"):
		return "added"
	case strings.HasPrefix(code, "D"):
		return "deleted"
	case strings.HasPrefix(code, "R"):
		return "renamed"
	default:
		return "modified"
	}
}

func parseGitNumstatStats(stdout string) GitChangeStats {
	stats := GitChangeStats{}
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			continue
		}
		stats.FilesChanged++
		if parts[0] != "-" {
			stats.Insertions += parsePositiveInt(parts[0])
		}
		if parts[1] != "-" {
			stats.Deletions += parsePositiveInt(parts[1])
		}
	}
	return stats
}

func parseBinaryByPath(stdout string) map[string]bool {
	result := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			continue
		}
		path := strings.Join(parts[2:], "\t")
		result[path] = parts[0] == "-" || isBinaryPath(path)
	}
	return result
}

func gitUntrackedFiles(stdout string) []GitChangedFile {
	files := []GitChangedFile{}
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		path := strings.TrimSpace(line)
		if path == "" {
			continue
		}
		files = append(files, GitChangedFile{Path: path, Status: "added", Binary: isBinaryPath(path)})
	}
	return files
}

func parsePositiveInt(value string) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 0 {
		return 0
	}
	return parsed
}

func isBinaryPath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tgz", ".tar", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".mov", ".mp3", ".wav":
		return true
	default:
		return false
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
