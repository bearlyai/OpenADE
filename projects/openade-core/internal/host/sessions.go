package host

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type HarnessSessionRoots struct {
	ClaudeConfigDir string
	CodexHome       string
}

func DeleteHarnessSession(harnessID string, sessionID string, cwd string) (bool, error) {
	sessionID = strings.TrimSpace(sessionID)
	if err := validateHarnessSessionID(sessionID); err != nil {
		return false, err
	}
	switch strings.TrimSpace(harnessID) {
	case "claude-code":
		return deleteClaudeSession(sessionID, cwd, HarnessSessionRoots{})
	case "codex":
		return deleteCodexSession(sessionID, HarnessSessionRoots{})
	default:
		return false, nil
	}
}

func FindHarnessSessionFile(harnessID string, sessionID string, cwd string, roots HarnessSessionRoots) (string, bool, error) {
	sessionID = strings.TrimSpace(sessionID)
	if err := validateHarnessSessionID(sessionID); err != nil {
		return "", false, err
	}
	switch strings.TrimSpace(harnessID) {
	case "claude-code":
		path, err := findClaudeSessionFile(claudeHomePath(roots), sessionID, cwd)
		return path, path != "", err
	case "codex":
		path, err := findCodexSessionFile(codexHomePath(roots), sessionID)
		return path, path != "", err
	default:
		return "", false, nil
	}
}

func validateHarnessSessionID(sessionID string) error {
	if sessionID == "" {
		return errors.New("session id is required")
	}
	if len(sessionID) > 256 || sessionID == "." || sessionID == ".." || strings.Contains(sessionID, "..") {
		return errors.New("session id is invalid")
	}
	for _, char := range sessionID {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' || char == '.' {
			continue
		}
		return errors.New("session id is invalid")
	}
	return nil
}

func deleteClaudeSession(sessionID string, cwd string, roots HarnessSessionRoots) (bool, error) {
	claudeHome := claudeHomePath(roots)
	sessionPath, err := findClaudeSessionFile(claudeHome, sessionID, cwd)
	if err != nil || sessionPath == "" {
		return false, err
	}
	if err := os.Remove(sessionPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return true, err
	}
	sessionDir := strings.TrimSuffix(sessionPath, ".jsonl")
	if err := os.RemoveAll(sessionDir); err != nil {
		return true, err
	}
	debugLog := filepath.Join(claudeHome, "debug", sessionID+".txt")
	if err := os.Remove(debugLog); err != nil && !errors.Is(err, os.ErrNotExist) {
		return true, err
	}
	return true, nil
}

func findClaudeSessionFile(claudeHome string, sessionID string, cwd string) (string, error) {
	projectsDir := filepath.Join(claudeHome, "projects")
	if cwd != "" {
		filePath := filepath.Join(projectsDir, encodeClaudeProjectPath(cwd), sessionID+".jsonl")
		if isRegularFile(filePath) {
			return filePath, nil
		}
		return "", nil
	}
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		filePath := filepath.Join(projectsDir, entry.Name(), sessionID+".jsonl")
		if isRegularFile(filePath) {
			return filePath, nil
		}
	}
	return "", nil
}

func encodeClaudeProjectPath(cwd string) string {
	replacer := strings.NewReplacer("/", "-", "\\", "-")
	return replacer.Replace(cwd)
}

func deleteCodexSession(sessionID string, roots HarnessSessionRoots) (bool, error) {
	codexHome := codexHomePath(roots)
	sessionPath, err := findCodexSessionFile(codexHome, sessionID)
	if err != nil {
		return false, err
	}
	deleted := false
	if sessionPath != "" {
		if err := os.Remove(sessionPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return true, err
		}
		deleted = true
	}
	archivedPath := filepath.Join(codexHome, "archived_sessions", sessionID+".jsonl")
	if isRegularFile(archivedPath) {
		if err := os.Remove(archivedPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return true, err
		}
		deleted = true
	}
	return deleted, nil
}

func findCodexSessionFile(codexHome string, sessionID string) (string, error) {
	sessionsDir := filepath.Join(codexHome, "sessions")
	if _, err := os.Stat(sessionsDir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	suffix := "-" + sessionID + ".jsonl"
	var match string
	err := filepath.WalkDir(sessionsDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || match != "" {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if strings.HasSuffix(entry.Name(), suffix) {
			match = path
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return match, nil
}

func claudeHomePath(roots HarnessSessionRoots) string {
	if configured := strings.TrimSpace(roots.ClaudeConfigDir); configured != "" {
		return configured
	}
	return envHomePath("CLAUDE_CONFIG_DIR", ".claude")
}

func codexHomePath(roots HarnessSessionRoots) string {
	if configured := strings.TrimSpace(roots.CodexHome); configured != "" {
		return configured
	}
	return envHomePath("CODEX_HOME", ".codex")
}

func envHomePath(envName string, defaultDir string) string {
	if configured := strings.TrimSpace(os.Getenv(envName)); configured != "" {
		return configured
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return defaultDir
	}
	return filepath.Join(home, defaultDir)
}

func isRegularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
