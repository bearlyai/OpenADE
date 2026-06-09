package host

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	openADEProcsConfigFilename = "openade.toml"
	maxProcessConfigWalkDepth  = 10
)

var processConfigSkipDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"dist":         true,
	"build":        true,
	".next":        true,
	"vendor":       true,
	".venv":        true,
	"venv":         true,
	".cache":       true,
	"coverage":     true,
}

type ProcsConfig struct {
	RelativePath string
	Processes    []ProcsProcessDef
	Crons        []ProcsCronDef
}

type ProcsProcessDef struct {
	ID      string
	Name    string
	Command string
	WorkDir string
	URL     string
	Type    string
}

type ProcsCronDef struct {
	ID                 string
	Name               string
	Schedule           string
	Type               string
	Prompt             string
	AppendSystemPrompt string
	Images             []string
	Isolation          string
	Harness            string
	InTaskID           string
	ReuseTask          bool
}

type ProcessConfigError struct {
	RelativePath string
	Error        string
	Line         int
}

type ProcessDefinition struct {
	ProcsProcessDef
	ConfigPath string
	Cwd        string
}

type ProcessListResult struct {
	SearchRoot   string
	RepoRoot     string
	IsWorktree   bool
	WorktreeRoot string
	Configs      []ProcsConfig
	Processes    []ProcessDefinition
	Errors       []ProcessConfigError
}

type tomlValueKind uint8

const (
	tomlString tomlValueKind = iota
	tomlBool
	tomlStringArray
)

type tomlValue struct {
	kind        tomlValueKind
	stringValue string
	boolValue   bool
	arrayValue  []string
}

type procsTable struct {
	name   string
	line   int
	values map[string]tomlValue
}

func ListProjectProcesses(ctx context.Context, searchRoot string) (ProcessListResult, error) {
	resolvedSearchRoot, err := normalizeRoot(searchRoot)
	if err != nil {
		return ProcessListResult{}, err
	}
	repoRoot := resolvedSearchRoot
	isWorktree := false
	worktreeRoot := ""
	if gitInfo, ok, _, err := resolveGitRepository(ctx, resolvedSearchRoot); err != nil {
		return ProcessListResult{}, err
	} else if ok {
		repoRoot = gitInfo.RepoRoot
		gitDir, err := runGit(ctx, resolvedSearchRoot, "rev-parse", "--git-dir")
		if err != nil {
			return ProcessListResult{}, err
		}
		isWorktree = gitDir.success && strings.Contains(gitDir.stdout, ".git/worktrees")
		if isWorktree {
			worktreeRoot = repoRoot
		}
	}
	configFiles, err := findProcessConfigFiles(repoRoot)
	if err != nil {
		return ProcessListResult{}, err
	}
	configs := []ProcsConfig{}
	parseErrors := []ProcessConfigError{}
	for _, configFile := range configFiles {
		relativePath, err := scopedRelativePath(repoRoot, configFile)
		if err != nil {
			continue
		}
		data, err := os.ReadFile(configFile)
		if err != nil {
			parseErrors = append(parseErrors, ProcessConfigError{RelativePath: relativePath, Error: err.Error()})
			continue
		}
		config, configErr := parseProcsConfig(string(data), relativePath)
		if configErr != nil {
			parseErrors = append(parseErrors, *configErr)
			continue
		}
		configs = append(configs, config)
	}
	processes, definitionErrors := processDefinitions(repoRoot, configs)
	return ProcessListResult{
		SearchRoot:   resolvedSearchRoot,
		RepoRoot:     repoRoot,
		IsWorktree:   isWorktree,
		WorktreeRoot: worktreeRoot,
		Configs:      configs,
		Processes:    processes,
		Errors:       append(parseErrors, definitionErrors...),
	}, nil
}

func findProcessConfigFiles(root string) ([]string, error) {
	files := []string{}
	err := walkProcessConfigFiles(root, root, 0, &files)
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

func walkProcessConfigFiles(root string, current string, depth int, files *[]string) error {
	if depth > maxProcessConfigWalkDepth {
		return nil
	}
	entries, err := os.ReadDir(current)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		fullPath := filepath.Join(current, entry.Name())
		if entry.Type().IsRegular() && entry.Name() == openADEProcsConfigFilename {
			*files = append(*files, fullPath)
			continue
		}
		if !entry.IsDir() || processConfigSkipDirs[entry.Name()] || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if err := walkProcessConfigFiles(root, fullPath, depth+1, files); err != nil {
			return err
		}
	}
	return nil
}

func parseProcsConfig(content string, relativePath string) (ProcsConfig, *ProcessConfigError) {
	processes := []ProcsProcessDef{}
	crons := []ProcsCronDef{}
	var current *procsTable
	finishCurrent := func() *ProcessConfigError {
		if current == nil {
			return nil
		}
		if current.name == "process" {
			process, err := processDefFromValues(current.values, relativePath)
			if err != nil {
				return &ProcessConfigError{RelativePath: relativePath, Error: err.Error(), Line: current.line}
			}
			processes = append(processes, process)
			current = nil
			return nil
		}
		cron, err := cronDefFromValues(current.values, relativePath)
		if err != nil {
			return &ProcessConfigError{RelativePath: relativePath, Error: err.Error(), Line: current.line}
		}
		crons = append(crons, cron)
		current = nil
		return nil
	}

	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	for index, line := range lines {
		lineNumber := index + 1
		trimmed := strings.TrimSpace(stripTomlComment(line))
		if trimmed == "" {
			continue
		}
		if trimmed == "[[process]]" || trimmed == "[[cron]]" {
			if err := finishCurrent(); err != nil {
				return ProcsConfig{}, err
			}
			tableName := "process"
			if trimmed == "[[cron]]" {
				tableName = "cron"
			}
			current = &procsTable{name: tableName, line: lineNumber, values: map[string]tomlValue{}}
			continue
		}
		if strings.HasPrefix(trimmed, "[[") && !validTomlArrayHeader(trimmed) {
			return ProcsConfig{}, &ProcessConfigError{RelativePath: relativePath, Error: fmt.Sprintf("Invalid TOML table header at line %d", lineNumber), Line: lineNumber}
		}
		if strings.HasPrefix(trimmed, "[") && !validTomlHeader(trimmed) && !validTomlArrayHeader(trimmed) {
			return ProcsConfig{}, &ProcessConfigError{RelativePath: relativePath, Error: fmt.Sprintf("Invalid TOML table header at line %d", lineNumber), Line: lineNumber}
		}
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			if err := finishCurrent(); err != nil {
				return ProcsConfig{}, err
			}
			current = nil
			continue
		}
		if current == nil {
			continue
		}
		key, value, ok := parseTomlKeyValue(trimmed)
		if !ok {
			return ProcsConfig{}, &ProcessConfigError{RelativePath: relativePath, Error: fmt.Sprintf("Invalid %s key/value at line %d", current.name, lineNumber), Line: lineNumber}
		}
		current.values[key] = value
	}
	if err := finishCurrent(); err != nil {
		return ProcsConfig{}, err
	}
	return ProcsConfig{RelativePath: relativePath, Processes: processes, Crons: crons}, nil
}

func processDefFromValues(values map[string]tomlValue, relativePath string) (ProcsProcessDef, error) {
	name := stringTomlField(values, "name")
	command := stringTomlField(values, "command")
	processType := stringTomlField(values, "type")
	if processType == "" {
		processType = "daemon"
	}
	if name == "" {
		return ProcsProcessDef{}, errors.New("process.name is required")
	}
	if command == "" {
		return ProcsProcessDef{}, errors.New("process.command is required")
	}
	if processType != "setup" && processType != "daemon" && processType != "task" && processType != "check" {
		return ProcsProcessDef{}, fmt.Errorf("process.type '%s' is invalid", processType)
	}
	return ProcsProcessDef{
		ID:      relativePath + "::" + name,
		Name:    name,
		Command: command,
		WorkDir: stringTomlField(values, "work_dir"),
		URL:     stringTomlField(values, "url"),
		Type:    processType,
	}, nil
}

func cronDefFromValues(values map[string]tomlValue, relativePath string) (ProcsCronDef, error) {
	name := stringTomlField(values, "name")
	schedule := stringTomlField(values, "schedule")
	cronType := stringTomlField(values, "type")
	prompt := stringTomlField(values, "prompt")
	rawIsolation := stringTomlField(values, "isolation")
	if name == "" {
		return ProcsCronDef{}, errors.New("cron.name is required")
	}
	if schedule == "" {
		return ProcsCronDef{}, errors.New("cron.schedule is required")
	}
	if cronType == "" {
		return ProcsCronDef{}, errors.New("cron.type is required")
	}
	if prompt == "" {
		return ProcsCronDef{}, errors.New("cron.prompt is required")
	}
	if cronType != "plan" && cronType != "do" && cronType != "ask" && cronType != "hyperplan" {
		return ProcsCronDef{}, fmt.Errorf("cron.type '%s' is invalid", cronType)
	}
	if _, ok := values["images"]; ok && !stringArrayTomlFieldOK(values, "images") {
		return ProcsCronDef{}, errors.New("cron.images must be an array of strings")
	}
	if rawIsolation != "" && rawIsolation != "head" && rawIsolation != "worktree" {
		return ProcsCronDef{}, fmt.Errorf("cron.isolation '%s' is invalid", rawIsolation)
	}
	if _, ok := values["reuse_task"]; ok && !boolTomlFieldOK(values, "reuse_task") {
		return ProcsCronDef{}, errors.New("cron.reuse_task must be a boolean")
	}
	return ProcsCronDef{
		ID:                 relativePath + "::" + name,
		Name:               name,
		Schedule:           schedule,
		Type:               cronType,
		Prompt:             prompt,
		AppendSystemPrompt: stringTomlField(values, "append_system_prompt"),
		Images:             stringArrayTomlField(values, "images"),
		Isolation:          rawIsolation,
		Harness:            stringTomlField(values, "harness"),
		InTaskID:           stringTomlField(values, "in_task_id"),
		ReuseTask:          boolTomlFieldDefault(values, "reuse_task", true),
	}, nil
}

func processDefinitions(root string, configs []ProcsConfig) ([]ProcessDefinition, []ProcessConfigError) {
	processes := []ProcessDefinition{}
	errors := []ProcessConfigError{}
	for _, config := range configs {
		for _, process := range config.Processes {
			cwd, err := resolveProcessCwd(root, config.RelativePath, process.WorkDir)
			if err != nil {
				errors = append(errors, ProcessConfigError{RelativePath: config.RelativePath, Error: err.Error()})
				continue
			}
			processes = append(processes, ProcessDefinition{ProcsProcessDef: process, ConfigPath: config.RelativePath, Cwd: cwd})
		}
	}
	return processes, errors
}

func resolveProcessCwd(root string, configRelativePath string, workDir string) (string, error) {
	configPath, err := resolveRootRelativePath(root, configRelativePath)
	if err != nil {
		return "", errors.New("process config path is outside the repository")
	}
	cwd := filepath.Clean(filepath.Join(filepath.Dir(configPath), filepath.FromSlash(workDir)))
	relative, err := filepath.Rel(root, cwd)
	if err != nil {
		return "", err
	}
	if relative == "." || (!strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != ".." && !filepath.IsAbs(relative)) {
		return cwd, nil
	}
	return "", errors.New("process cwd is outside the repository")
}

func stripTomlComment(line string) string {
	quote := rune(0)
	escaped := false
	for index, char := range line {
		if quote == '"' {
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				quote = 0
			}
			continue
		}
		if quote == '\'' {
			if char == '\'' {
				quote = 0
			}
			continue
		}
		if char == '"' || char == '\'' {
			quote = char
			continue
		}
		if char == '#' {
			return line[:index]
		}
	}
	return line
}

func parseTomlKeyValue(line string) (string, tomlValue, bool) {
	index := strings.Index(line, "=")
	if index < 1 {
		return "", tomlValue{}, false
	}
	key := strings.TrimSpace(line[:index])
	value, ok := parseTomlValue(line[index+1:])
	if key == "" || !ok {
		return "", tomlValue{}, false
	}
	return key, value, true
}

func parseTomlValue(rawValue string) (tomlValue, bool) {
	value := strings.TrimSpace(rawValue)
	if value == "true" {
		return tomlValue{kind: tomlBool, boolValue: true}, true
	}
	if value == "false" {
		return tomlValue{kind: tomlBool, boolValue: false}, true
	}
	if strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]") {
		items, ok := splitTomlArray(value)
		if !ok {
			return tomlValue{}, false
		}
		return tomlValue{kind: tomlStringArray, arrayValue: items}, true
	}
	text, ok := parseTomlString(value)
	if !ok {
		return tomlValue{}, false
	}
	return tomlValue{kind: tomlString, stringValue: text}, true
}

func parseTomlString(value string) (string, bool) {
	if len(value) < 2 {
		return "", false
	}
	if strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'") {
		return value[1 : len(value)-1], true
	}
	if strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"") {
		text := value[1 : len(value)-1]
		text = strings.ReplaceAll(text, `\"`, `"`)
		text = strings.ReplaceAll(text, `\\`, `\`)
		text = strings.ReplaceAll(text, `\n`, "\n")
		text = strings.ReplaceAll(text, `\t`, "\t")
		return text, true
	}
	return "", false
}

func splitTomlArray(value string) ([]string, bool) {
	body := strings.TrimSpace(value[1 : len(value)-1])
	if body == "" {
		return []string{}, true
	}
	items := []string{}
	current := strings.Builder{}
	quote := rune(0)
	escaped := false
	for _, char := range body {
		if quote == '"' {
			current.WriteRune(char)
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				quote = 0
			}
			continue
		}
		if quote == '\'' {
			current.WriteRune(char)
			if char == '\'' {
				quote = 0
			}
			continue
		}
		if char == '"' || char == '\'' {
			quote = char
			current.WriteRune(char)
			continue
		}
		if char == ',' {
			parsed, ok := parseTomlString(strings.TrimSpace(current.String()))
			if !ok {
				return nil, false
			}
			items = append(items, parsed)
			current.Reset()
			continue
		}
		current.WriteRune(char)
	}
	if quote != 0 {
		return nil, false
	}
	parsed, ok := parseTomlString(strings.TrimSpace(current.String()))
	if !ok {
		return nil, false
	}
	items = append(items, parsed)
	return items, true
}

func validTomlHeader(value string) bool {
	if !strings.HasPrefix(value, "[") || !strings.HasSuffix(value, "]") || strings.HasPrefix(value, "[[") {
		return false
	}
	return validTomlName(value[1 : len(value)-1])
}

func validTomlArrayHeader(value string) bool {
	if !strings.HasPrefix(value, "[[") || !strings.HasSuffix(value, "]]") {
		return false
	}
	return validTomlName(value[2 : len(value)-2])
}

func validTomlName(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-' || char == '.' {
			continue
		}
		return false
	}
	return true
}

func stringTomlField(values map[string]tomlValue, key string) string {
	value, ok := values[key]
	if !ok || value.kind != tomlString {
		return ""
	}
	return value.stringValue
}

func stringArrayTomlField(values map[string]tomlValue, key string) []string {
	value, ok := values[key]
	if !ok || value.kind != tomlStringArray {
		return nil
	}
	return append([]string(nil), value.arrayValue...)
}

func stringArrayTomlFieldOK(values map[string]tomlValue, key string) bool {
	value, ok := values[key]
	return ok && value.kind == tomlStringArray
}

func boolTomlFieldOK(values map[string]tomlValue, key string) bool {
	value, ok := values[key]
	return ok && value.kind == tomlBool
}

func boolTomlFieldDefault(values map[string]tomlValue, key string, fallback bool) bool {
	value, ok := values[key]
	if !ok || value.kind != tomlBool {
		return fallback
	}
	return value.boolValue
}
