package product

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/host"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

const (
	projectProcessDefaultTimeout     = 10 * time.Minute
	projectProcessDaemonTimeout      = 24 * time.Hour
	projectProcessMaxTimeout         = 24 * time.Hour
	projectProcessMaxOutput          = 2000
	projectProcessCleanupDelay       = 30 * time.Minute
	projectProcessOutputPollInterval = 100 * time.Millisecond
)

type projectProcessOutputChunkDTO struct {
	Type      string `json:"type"`
	Data      string `json:"data"`
	Timestamp int64  `json:"timestamp"`
}

type projectProcessStartDTO struct {
	RepoID       string `json:"repoId"`
	TaskID       string `json:"taskId,omitempty"`
	DefinitionID string `json:"definitionId"`
	ProcessID    string `json:"processId"`
	RuntimeID    string `json:"runtimeId,omitempty"`
}

type projectProcessReconnectDTO struct {
	RepoID      string                         `json:"repoId"`
	TaskID      string                         `json:"taskId,omitempty"`
	ProcessID   string                         `json:"processId"`
	Found       bool                           `json:"found"`
	Completed   bool                           `json:"completed,omitempty"`
	ExitCode    *int                           `json:"exitCode,omitempty"`
	Signal      *string                        `json:"signal,omitempty"`
	Error       string                         `json:"error,omitempty"`
	OutputCount int                            `json:"outputCount,omitempty"`
	Output      []projectProcessOutputChunkDTO `json:"output"`
}

type projectProcessStopDTO struct {
	RepoID    string `json:"repoId"`
	TaskID    string `json:"taskId,omitempty"`
	ProcessID string `json:"processId"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
}

type projectProcessStartedNotificationDTO struct {
	Type             string `json:"type"`
	ProcessID        string `json:"processId"`
	RuntimeID        string `json:"runtimeId"`
	PID              *int   `json:"pid,omitempty"`
	PGID             *int   `json:"pgid,omitempty"`
	Cwd              string `json:"cwd"`
	Label            string `json:"label"`
	ProcessStartedAt string `json:"processStartedAt,omitempty"`
}

type projectProcessOutputNotificationDTO struct {
	Type      string                       `json:"type"`
	ProcessID string                       `json:"processId"`
	Chunk     projectProcessOutputChunkDTO `json:"chunk"`
}

type projectProcessExitNotificationDTO struct {
	Type      string  `json:"type"`
	ProcessID string  `json:"processId"`
	ExitCode  *int    `json:"exitCode"`
	Signal    *string `json:"signal"`
}

type projectProcessErrorNotificationDTO struct {
	Type      string `json:"type"`
	ProcessID string `json:"processId"`
	Error     string `json:"error"`
}

type projectProcessState struct {
	processID    string
	repoID       string
	taskID       string
	definitionID string
	cwd          string
	command      string
	cmd          *exec.Cmd
	cancel       context.CancelFunc
	output       []projectProcessOutputChunkDTO
	completed    bool
	exitCode     *int
	signal       *string
	errorMessage string
	pid          *int
	pgid         *int
	stdoutFile   string
	stderrFile   string
	stdoutOffset int64
	stderrOffset int64
	stdoutWriter *os.File
	stderrWriter *os.File
	startedAt    time.Time
	cleanupTimer *time.Timer
}

type projectProcessOutputFiles struct {
	stdoutPath   string
	stderrPath   string
	stdoutWriter *os.File
	stderrWriter *os.File
}

func (service *Service) handleProjectProcessStart(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodProjectProcessStart, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID       string `json:"repoId"`
			TaskID       string `json:"taskId"`
			DefinitionID string `json:"definitionId"`
			TimeoutMs    int64  `json:"timeoutMs"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		definitionID := strings.TrimSpace(params.DefinitionID)
		if definitionID == "" {
			return nil, invalidParams("definitionId is required")
		}
		repo, root, runtimeErr := service.projectHostRoot(ctx, params.RepoID, params.TaskID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		result, err := host.ListProjectProcesses(ctx, root)
		if err != nil {
			return nil, handlerError(err)
		}
		definition, ok := findProjectProcessDefinition(result.Processes, definitionID)
		if !ok {
			return nil, invalidParams("process definition not found")
		}
		if err := ensureProcessCwd(definition.Cwd); err != nil {
			return nil, invalidParams(err.Error())
		}
		started, err := service.startProjectProcess(repo.ID, params.TaskID, definition, processTimeout(definition, params.TimeoutMs), service.personalSettingsEnvVarsOrEmpty(ctx))
		if err != nil {
			return nil, handlerError(err)
		}
		return started, nil
	})
}

func (service *Service) handleProjectProcessReconnect(_ context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID    string `json:"repoId"`
		TaskID    string `json:"taskId"`
		ProcessID string `json:"processId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if strings.TrimSpace(params.ProcessID) == "" {
		return nil, invalidParams("processId is required")
	}
	return service.reconnectProjectProcess(params.RepoID, params.TaskID, params.ProcessID), nil
}

func (service *Service) handleProjectProcessStop(_ context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation(openADEMethodProjectProcessStop, raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID    string `json:"repoId"`
			TaskID    string `json:"taskId"`
			ProcessID string `json:"processId"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		if strings.TrimSpace(params.ProcessID) == "" {
			return nil, invalidParams("processId is required")
		}
		return service.stopProjectProcess(params.RepoID, params.TaskID, params.ProcessID), nil
	})
}

func findProjectProcessDefinition(definitions []host.ProcessDefinition, definitionID string) (host.ProcessDefinition, bool) {
	for _, definition := range definitions {
		if definition.ID == definitionID {
			return definition, true
		}
	}
	return host.ProcessDefinition{}, false
}

func ensureProcessCwd(cwd string) error {
	stat, err := os.Stat(cwd)
	if err != nil {
		return err
	}
	if !stat.IsDir() {
		return errors.New("process cwd is not a directory")
	}
	return nil
}

func processTimeout(definition host.ProcessDefinition, requestedMs int64) time.Duration {
	fallback := projectProcessDefaultTimeout
	if definition.Type == "daemon" {
		fallback = projectProcessDaemonTimeout
	}
	if requestedMs <= 0 {
		return fallback
	}
	requested := time.Duration(requestedMs) * time.Millisecond
	if requested > projectProcessMaxTimeout {
		return projectProcessMaxTimeout
	}
	return requested
}

func (service *Service) startProjectProcess(
	repoID string,
	taskID string,
	definition host.ProcessDefinition,
	timeout time.Duration,
	envVars map[string]string,
) (projectProcessStartDTO, error) {
	processID := "proc-" + randomHexID()
	processContext, cancel := context.WithTimeout(context.Background(), timeout)
	command, args := processShellCommand(definition.Command)
	cmd := exec.CommandContext(processContext, command, args...)
	configureProjectProcess(cmd)
	cmd.Dir = definition.Cwd
	cmd.Env = environmentWithOverrides(os.Environ(), envVars)

	outputFiles, err := service.openProjectProcessOutputFiles(processID)
	if err != nil {
		cancel()
		return projectProcessStartDTO{}, err
	}
	var stdout io.Reader
	var stderr io.Reader
	if outputFiles.stdoutWriter != nil && outputFiles.stderrWriter != nil {
		cmd.Stdout = outputFiles.stdoutWriter
		cmd.Stderr = outputFiles.stderrWriter
	} else {
		stdout, err = cmd.StdoutPipe()
		if err != nil {
			cancel()
			return projectProcessStartDTO{}, err
		}
		stderr, err = cmd.StderrPipe()
		if err != nil {
			cancel()
			return projectProcessStartDTO{}, err
		}
	}
	if err := cmd.Start(); err != nil {
		closeProjectProcessOutputFiles(outputFiles)
		cancel()
		return projectProcessStartDTO{}, err
	}

	state := &projectProcessState{
		processID:    processID,
		repoID:       repoID,
		taskID:       taskID,
		definitionID: definition.ID,
		cwd:          definition.Cwd,
		command:      definition.Command,
		cmd:          cmd,
		cancel:       cancel,
		stdoutFile:   outputFiles.stdoutPath,
		stderrFile:   outputFiles.stderrPath,
		stdoutWriter: outputFiles.stdoutWriter,
		stderrWriter: outputFiles.stderrWriter,
		output:       []projectProcessOutputChunkDTO{},
		completed:    false,
		startedAt:    time.Now().UTC(),
	}
	if cmd.Process != nil {
		pid := cmd.Process.Pid
		state.pid = &pid
		state.pgid = projectProcessGroupID(cmd)
	}

	service.processMu.Lock()
	service.processes[processID] = state
	service.processMu.Unlock()
	runtimeRecord, err := service.persistProjectProcessRuntime(state, "running", "", nil, nil, "")
	if err != nil {
		service.removeProjectProcessState(processID)
		if cmd.Process != nil {
			_ = terminateProjectProcess(cmd.Process, state.pgid)
		}
		closeProjectProcessOutputFiles(outputFiles)
		cancel()
		return projectProcessStartDTO{}, err
	}
	service.runtime.Notify("runtime/created", runtimeRecord)
	service.notifyProjectProcessStarted(state)

	if outputFiles.stdoutPath != "" && outputFiles.stderrPath != "" {
		go service.tailProjectProcessOutputFile(processContext, processID, "stdout", outputFiles.stdoutPath, 0)
		go service.tailProjectProcessOutputFile(processContext, processID, "stderr", outputFiles.stderrPath, 0)
	} else {
		go service.readProjectProcessOutput(processID, "stdout", stdout)
		go service.readProjectProcessOutput(processID, "stderr", stderr)
	}
	go service.waitProjectProcess(processID, cmd)

	return projectProcessStartDTO{
		RepoID:       repoID,
		TaskID:       taskID,
		DefinitionID: definition.ID,
		ProcessID:    processID,
		RuntimeID:    "process:" + processID,
	}, nil
}

func processShellCommand(command string) (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd.exe", []string{"/C", command}
	}
	return "/bin/sh", []string{"-c", command}
}

func (service *Service) openProjectProcessOutputFiles(processID string) (projectProcessOutputFiles, error) {
	outputDir := strings.TrimSpace(service.options.ProcessOutputDir)
	if outputDir == "" {
		return projectProcessOutputFiles{}, nil
	}
	processDir := filepath.Join(outputDir, processID)
	if err := os.MkdirAll(processDir, 0o700); err != nil {
		return projectProcessOutputFiles{}, err
	}
	stdoutPath := filepath.Join(processDir, "stdout.log")
	stderrPath := filepath.Join(processDir, "stderr.log")
	stdoutWriter, err := os.OpenFile(stdoutPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return projectProcessOutputFiles{}, err
	}
	stderrWriter, err := os.OpenFile(stderrPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		_ = stdoutWriter.Close()
		return projectProcessOutputFiles{}, err
	}
	return projectProcessOutputFiles{
		stdoutPath:   stdoutPath,
		stderrPath:   stderrPath,
		stdoutWriter: stdoutWriter,
		stderrWriter: stderrWriter,
	}, nil
}

func closeProjectProcessOutputFiles(files projectProcessOutputFiles) {
	if files.stdoutWriter != nil {
		_ = files.stdoutWriter.Close()
	}
	if files.stderrWriter != nil {
		_ = files.stderrWriter.Close()
	}
}

func closeProjectProcessStateOutputFiles(state *projectProcessState) {
	if state == nil {
		return
	}
	closeProjectProcessOutputFiles(projectProcessOutputFiles{
		stdoutWriter: state.stdoutWriter,
		stderrWriter: state.stderrWriter,
	})
	state.stdoutWriter = nil
	state.stderrWriter = nil
}

func (service *Service) readProjectProcessOutput(processID string, outputType string, reader io.Reader) {
	buffered := bufio.NewReader(reader)
	for {
		chunk, err := buffered.ReadString('\n')
		if chunk != "" {
			service.appendProjectProcessOutput(processID, projectProcessOutputChunkDTO{
				Type:      outputType,
				Data:      chunk,
				Timestamp: time.Now().UnixMilli(),
			})
		}
		if err != nil {
			return
		}
	}
}

func (service *Service) tailProjectProcessOutputFile(ctx context.Context, processID string, outputType string, path string, startOffset int64) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	if startOffset > 0 {
		if _, err := file.Seek(startOffset, io.SeekStart); err != nil {
			return
		}
	}
	offset := startOffset
	buffer := make([]byte, 4096)
	for {
		count, err := file.Read(buffer)
		if count > 0 {
			select {
			case <-ctx.Done():
				return
			default:
			}
			offset += int64(count)
			service.appendProjectProcessOutput(processID, projectProcessOutputChunkDTO{
				Type:      outputType,
				Data:      string(buffer[:count]),
				Timestamp: time.Now().UnixMilli(),
			})
			service.updateProjectProcessRuntimeOutputOffset(processID, outputType, offset)
		}
		if err == nil {
			continue
		}
		if !errors.Is(err, io.EOF) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(projectProcessOutputPollInterval):
		}
	}
}

func (service *Service) drainProjectProcessOutputFile(processID string, outputType string, path string, startOffset int64) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	if startOffset > 0 {
		if _, err := file.Seek(startOffset, io.SeekStart); err != nil {
			return
		}
	}
	offset := startOffset
	buffer := make([]byte, 4096)
	for {
		count, err := file.Read(buffer)
		if count > 0 {
			offset += int64(count)
			service.appendProjectProcessOutput(processID, projectProcessOutputChunkDTO{
				Type:      outputType,
				Data:      string(buffer[:count]),
				Timestamp: time.Now().UnixMilli(),
			})
			service.updateProjectProcessRuntimeOutputOffset(processID, outputType, offset)
		}
		if err != nil {
			return
		}
	}
}

func (service *Service) appendProjectProcessOutput(processID string, chunk projectProcessOutputChunkDTO) {
	service.processMu.Lock()
	state := service.processes[processID]
	if state == nil {
		service.processMu.Unlock()
		return
	}
	state.output = append(state.output, chunk)
	for len(state.output) > projectProcessMaxOutput {
		state.output = state.output[1:]
	}
	service.processMu.Unlock()
	service.persistProjectProcessOutput(processID, chunk)
	service.touchProjectProcessRuntime(processID)
	service.runtime.Notify("process/output", projectProcessOutputNotificationDTO{
		Type:      "output",
		ProcessID: processID,
		Chunk:     chunk,
	})
}

func (service *Service) waitProjectProcess(processID string, cmd *exec.Cmd) {
	err := cmd.Wait()
	service.processMu.Lock()
	state := service.processes[processID]
	if state == nil {
		service.processMu.Unlock()
		return
	}
	state.completed = true
	state.exitCode, state.signal, state.errorMessage = processExitStatus(err)
	if state.cancel != nil {
		state.cancel()
	}
	closeProjectProcessStateOutputFiles(state)
	stdoutFile := state.stdoutFile
	stderrFile := state.stderrFile
	stdoutOffset := state.stdoutOffset
	stderrOffset := state.stderrOffset
	exitCode := cloneIntPointer(state.exitCode)
	signal := cloneStringPointer(state.signal)
	errorMessage := state.errorMessage
	service.scheduleProjectProcessCleanupLocked(processID, state)
	service.processMu.Unlock()
	if stdoutFile != "" {
		service.drainProjectProcessOutputFile(processID, "stdout", stdoutFile, stdoutOffset)
	}
	if stderrFile != "" {
		service.drainProjectProcessOutputFile(processID, "stderr", stderrFile, stderrOffset)
	}
	if errorMessage != "" {
		runtimeRecord := service.updateProjectProcessRuntimeTerminal(processID, "failed", errorMessage, exitCode, signal)
		if runtimeRecord != nil {
			service.runtime.Notify("runtime/failed", *runtimeRecord)
		}
		service.runtime.Notify("process/error", projectProcessErrorNotificationDTO{Type: "error", ProcessID: processID, Error: errorMessage})
		return
	}
	status := "completed"
	if signal != nil {
		status = "stopped"
	} else if exitCode != nil && *exitCode != 0 {
		status = "failed"
	}
	runtimeRecord := service.updateProjectProcessRuntimeTerminal(processID, status, "", exitCode, signal)
	if runtimeRecord != nil {
		if status == "completed" {
			service.runtime.Notify("runtime/completed", *runtimeRecord)
		} else if status == "stopped" {
			service.runtime.Notify("runtime/stopped", *runtimeRecord)
		} else {
			service.runtime.Notify("runtime/failed", *runtimeRecord)
		}
	}
	service.runtime.Notify("process/exit", projectProcessExitNotificationDTO{Type: "exit", ProcessID: processID, ExitCode: exitCode, Signal: signal})
}

func processExitStatus(err error) (*int, *string, string) {
	if err == nil {
		exitCode := 0
		return &exitCode, nil, ""
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		exitCode := exitErr.ExitCode()
		return &exitCode, nil, ""
	}
	return nil, nil, err.Error()
}

func (service *Service) scheduleProjectProcessCleanupLocked(processID string, state *projectProcessState) {
	if state.cleanupTimer != nil {
		state.cleanupTimer.Stop()
	}
	state.cleanupTimer = time.AfterFunc(projectProcessCleanupDelay, func() {
		service.processMu.Lock()
		defer service.processMu.Unlock()
		delete(service.processes, processID)
	})
}

func (service *Service) notifyProjectProcessStarted(state *projectProcessState) {
	service.runtime.Notify("process/started", projectProcessStartedNotificationDTO{
		Type:             "started",
		ProcessID:        state.processID,
		RuntimeID:        "process:" + state.processID,
		PID:              cloneIntPointer(state.pid),
		PGID:             cloneIntPointer(state.pgid),
		Cwd:              state.cwd,
		Label:            state.command,
		ProcessStartedAt: formatTime(state.startedAt),
	})
}

func (service *Service) projectProcessInstances(repoID string, taskID string) []projectProcessInstanceDTO {
	service.processMu.Lock()
	defer service.processMu.Unlock()
	instances := []projectProcessInstanceDTO{}
	for _, state := range service.processes {
		if !state.matchesScope(repoID, taskID) {
			continue
		}
		instances = append(instances, state.instanceDTO())
	}
	return instances
}

func (service *Service) removeProjectProcessState(processID string) {
	service.processMu.Lock()
	defer service.processMu.Unlock()
	delete(service.processes, processID)
}

func (service *Service) reconnectProjectProcess(repoID string, taskID string, processID string) projectProcessReconnectDTO {
	service.processMu.Lock()
	state := service.processes[processID]
	if state == nil || !state.matchesScope(repoID, taskID) {
		service.processMu.Unlock()
		return service.reconnectStoredProjectProcess(repoID, taskID, processID)
	}
	output := append([]projectProcessOutputChunkDTO{}, state.output...)
	service.processMu.Unlock()
	return projectProcessReconnectDTO{
		RepoID:      repoID,
		TaskID:      taskID,
		ProcessID:   processID,
		Found:       true,
		Completed:   state.completed,
		ExitCode:    cloneIntPointer(state.exitCode),
		Signal:      cloneStringPointer(state.signal),
		Error:       state.errorMessage,
		OutputCount: len(output),
		Output:      output,
	}
}

func (service *Service) reconnectStoredProjectProcess(repoID string, taskID string, processID string) projectProcessReconnectDTO {
	result := projectProcessReconnectDTO{RepoID: repoID, TaskID: taskID, ProcessID: processID, Found: false, Output: []projectProcessOutputChunkDTO{}}
	record, ok, err := service.store.GetRuntime(context.Background(), "process:"+processID)
	if err != nil || !ok {
		return result
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil || dto.Kind != "process" || dto.NativeID != processID || !storedProjectProcessStatusIsReconnectable(dto) || !storedProjectProcessMatchesScope(dto, repoID, taskID) {
		return result
	}
	chunks, err := service.store.ListRuntimeOutputChunks(context.Background(), "process:"+processID, projectProcessMaxOutput)
	if err != nil {
		return result
	}
	output := make([]projectProcessOutputChunkDTO, 0, len(chunks))
	for _, chunk := range chunks {
		output = append(output, projectProcessOutputChunkDTO{
			Type:      chunk.Stream,
			Data:      chunk.Data,
			Timestamp: chunk.TimestampMs,
		})
	}
	result.Found = true
	result.Completed = dto.Status == "orphaned" || isTerminalRuntimeStatus(dto.Status)
	result.ExitCode = cloneIntPointer(dto.ExitCode)
	result.Signal = cloneStringPointer(dto.Signal)
	result.Error = dto.Error
	result.OutputCount = len(output)
	result.Output = output
	return result
}

func storedProjectProcessStatusIsReconnectable(dto runtimeRecordDTO) bool {
	return dto.Status != "stopped" || dto.Error == orphanedProjectProcessStartupStopReason
}

func (service *Service) adoptStoredProjectProcesses(ctx context.Context) {
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return
	}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil || dto.Kind != "process" || dto.Status != "orphaned" {
			continue
		}
		_ = service.adoptStoredProjectProcess(ctx, dto)
	}
}

func (service *Service) adoptStoredProjectProcess(ctx context.Context, dto runtimeRecordDTO) bool {
	if dto.NativeID == "" || dto.PID == nil || !runtimeProcessIsRunning(*dto.PID) || dto.ProcessStdoutFile == "" || dto.ProcessStderrFile == "" {
		return false
	}
	repoID := ""
	taskID := ""
	if dto.Scope.Labels != nil {
		repoID = dto.Scope.Labels["repoId"]
		taskID = dto.Scope.Labels["taskId"]
	}
	if repoID == "" {
		return false
	}
	output := service.storedProjectProcessOutput(dto.NativeID)
	startedAt := parseProjectProcessStartedAt(dto)
	tailCtx, cancelTail := context.WithCancel(context.Background())
	state := &projectProcessState{
		processID:    dto.NativeID,
		repoID:       repoID,
		taskID:       taskID,
		definitionID: dto.ProcessDefinitionID,
		cwd:          dto.Scope.RootPath,
		command:      dto.ProcessLabel,
		cancel:       cancelTail,
		output:       output,
		completed:    false,
		pid:          cloneIntPointer(dto.PID),
		pgid:         cloneIntPointer(dto.PGID),
		stdoutFile:   dto.ProcessStdoutFile,
		stderrFile:   dto.ProcessStderrFile,
		stdoutOffset: dto.ProcessStdoutOffset,
		stderrOffset: dto.ProcessStderrOffset,
		startedAt:    startedAt,
	}
	service.processMu.Lock()
	if existing := service.processes[state.processID]; existing != nil {
		service.processMu.Unlock()
		cancelTail()
		return false
	}
	service.processes[state.processID] = state
	service.processMu.Unlock()

	dto.Status = "running"
	updatedAt := time.Now().UTC()
	dto.UpdatedAt = formatTime(updatedAt)
	dto.LastActivityAt = dto.UpdatedAt
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		service.removeProjectProcessState(state.processID)
		cancelTail()
		return false
	}
	if err := service.store.UpsertRuntime(ctx, record); err != nil {
		service.removeProjectProcessState(state.processID)
		cancelTail()
		return false
	}
	service.runtime.Notify("runtime/updated", dto)
	service.notifyProjectProcessStarted(state)
	go service.tailProjectProcessOutputFile(tailCtx, state.processID, "stdout", state.stdoutFile, state.stdoutOffset)
	go service.tailProjectProcessOutputFile(tailCtx, state.processID, "stderr", state.stderrFile, state.stderrOffset)
	go service.monitorAdoptedProjectProcess(tailCtx, state.processID, cloneIntPointer(state.pid))
	return true
}

func parseProjectProcessStartedAt(dto runtimeRecordDTO) time.Time {
	if dto.ProcessStartedAt != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, dto.ProcessStartedAt); err == nil {
			return parsed
		}
	}
	if dto.StartedAt != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, dto.StartedAt); err == nil {
			return parsed
		}
	}
	return time.Now().UTC()
}

func (service *Service) storedProjectProcessOutput(processID string) []projectProcessOutputChunkDTO {
	chunks, err := service.store.ListRuntimeOutputChunks(context.Background(), "process:"+processID, projectProcessMaxOutput)
	if err != nil {
		return []projectProcessOutputChunkDTO{}
	}
	output := make([]projectProcessOutputChunkDTO, 0, len(chunks))
	for _, chunk := range chunks {
		output = append(output, projectProcessOutputChunkDTO{
			Type:      chunk.Stream,
			Data:      chunk.Data,
			Timestamp: chunk.TimestampMs,
		})
	}
	return output
}

func (service *Service) monitorAdoptedProjectProcess(ctx context.Context, processID string, pid *int) {
	ticker := time.NewTicker(projectProcessOutputPollInterval)
	defer ticker.Stop()
	for {
		if pid == nil || !runtimeProcessIsRunning(*pid) {
			service.completeAdoptedProjectProcess(processID)
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (service *Service) completeAdoptedProjectProcess(processID string) {
	service.processMu.Lock()
	state := service.processes[processID]
	if state == nil || state.completed {
		service.processMu.Unlock()
		return
	}
	state.completed = true
	if state.cancel != nil {
		state.cancel()
	}
	stdoutFile := state.stdoutFile
	stderrFile := state.stderrFile
	stdoutOffset := state.stdoutOffset
	stderrOffset := state.stderrOffset
	service.scheduleProjectProcessCleanupLocked(processID, state)
	service.processMu.Unlock()
	if stdoutFile != "" {
		service.drainProjectProcessOutputFile(processID, "stdout", stdoutFile, stdoutOffset)
	}
	if stderrFile != "" {
		service.drainProjectProcessOutputFile(processID, "stderr", stderrFile, stderrOffset)
	}
	runtimeRecord := service.updateProjectProcessRuntimeTerminal(processID, "completed", "", nil, nil)
	if runtimeRecord != nil {
		service.runtime.Notify("runtime/completed", *runtimeRecord)
	}
	service.runtime.Notify("process/exit", projectProcessExitNotificationDTO{Type: "exit", ProcessID: processID, ExitCode: nil, Signal: nil})
}

func storedProjectProcessMatchesScope(dto runtimeRecordDTO, repoID string, taskID string) bool {
	if dto.Scope.Labels == nil {
		return false
	}
	if dto.Scope.Labels["repoId"] != repoID {
		return false
	}
	return dto.Scope.Labels["taskId"] == taskID
}

func (service *Service) stopProjectProcess(repoID string, taskID string, processID string) projectProcessStopDTO {
	return service.stopProjectProcessWithReason(repoID, taskID, processID, "", "SIGKILL")
}

func (service *Service) stopProjectProcessWithReason(repoID string, taskID string, processID string, reason string, signalValue string) projectProcessStopDTO {
	service.processMu.Lock()
	state := service.processes[processID]
	if state == nil || !state.matchesScope(repoID, taskID) {
		service.processMu.Unlock()
		return projectProcessStopDTO{RepoID: repoID, TaskID: taskID, ProcessID: processID, OK: false, Error: "Process not found"}
	}
	delete(service.processes, processID)
	if state.cleanupTimer != nil {
		state.cleanupTimer.Stop()
	}
	service.processMu.Unlock()

	if state.cancel != nil {
		state.cancel()
	}
	closeProjectProcessStateOutputFiles(state)
	if state.cmd != nil && state.cmd.Process != nil && !state.completed {
		if err := terminateProjectProcess(state.cmd.Process, state.pgid); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return projectProcessStopDTO{RepoID: repoID, TaskID: taskID, ProcessID: processID, OK: false, Error: err.Error()}
		}
		signal := signalValue
		runtimeRecord := service.updateProjectProcessRuntimeTerminal(processID, "stopped", reason, nil, &signal)
		if runtimeRecord != nil {
			service.runtime.Notify("runtime/stopped", *runtimeRecord)
		}
		service.runtime.Notify("process/exit", projectProcessExitNotificationDTO{Type: "exit", ProcessID: processID, ExitCode: nil, Signal: &signal})
	} else if state.cmd == nil && state.pid != nil && !state.completed {
		if err := terminateProjectProcessID(state.pid, state.pgid); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return projectProcessStopDTO{RepoID: repoID, TaskID: taskID, ProcessID: processID, OK: false, Error: err.Error()}
		}
		signal := signalValue
		runtimeRecord := service.updateProjectProcessRuntimeTerminal(processID, "stopped", reason, nil, &signal)
		if runtimeRecord != nil {
			service.runtime.Notify("runtime/stopped", *runtimeRecord)
		}
		service.runtime.Notify("process/exit", projectProcessExitNotificationDTO{Type: "exit", ProcessID: processID, ExitCode: nil, Signal: &signal})
	}
	return projectProcessStopDTO{RepoID: repoID, TaskID: taskID, ProcessID: processID, OK: true}
}

func (service *Service) stopProjectProcessByRuntime(processID string, reason string) projectProcessStopDTO {
	service.processMu.Lock()
	state := service.processes[processID]
	if state == nil {
		service.processMu.Unlock()
		return projectProcessStopDTO{ProcessID: processID, OK: false, Error: "Process not found"}
	}
	repoID := state.repoID
	taskID := state.taskID
	service.processMu.Unlock()
	return service.stopProjectProcessWithReason(repoID, taskID, processID, reason, "stopped")
}

func (service *Service) persistProjectProcessRuntime(state *projectProcessState, status string, errorMessage string, exitCode *int, signal *string, exitedAt string) (runtimeRecordDTO, error) {
	dto := runtimeRecordDTO{
		RuntimeID:           "process:" + state.processID,
		Kind:                "process",
		Status:              status,
		Scope:               runtimeScopeDTO{OwnerType: "process", OwnerID: state.processID, RootPath: state.cwd, Labels: map[string]string{"repoId": state.repoID, "taskId": state.taskID}},
		StartedAt:           formatTime(state.startedAt),
		UpdatedAt:           formatTime(time.Now().UTC()),
		LastActivityAt:      formatTime(time.Now().UTC()),
		NativeID:            state.processID,
		PID:                 cloneIntPointer(state.pid),
		PGID:                cloneIntPointer(state.pgid),
		ProcessLabel:        state.command,
		ProcessDefinitionID: state.definitionID,
		ProcessStdoutFile:   state.stdoutFile,
		ProcessStderrFile:   state.stderrFile,
		ProcessStdoutOffset: state.stdoutOffset,
		ProcessStderrOffset: state.stderrOffset,
		ProcessStartedAt:    formatTime(state.startedAt),
		ExitedAt:            exitedAt,
		ExitCode:            cloneIntPointer(exitCode),
		Signal:              cloneStringPointer(signal),
		Error:               errorMessage,
	}
	record, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return runtimeRecordDTO{}, errors.New(runtimeErr.Message)
	}
	if err := service.store.UpsertRuntime(context.Background(), record); err != nil {
		return runtimeRecordDTO{}, err
	}
	return dto, nil
}

func (service *Service) persistProjectProcessOutput(processID string, chunk projectProcessOutputChunkDTO) {
	_ = service.store.AppendRuntimeOutputChunk(context.Background(), storage.RuntimeOutputChunk{
		RuntimeID:   "process:" + processID,
		Stream:      chunk.Type,
		Data:        chunk.Data,
		TimestampMs: chunk.Timestamp,
	}, projectProcessMaxOutput)
}

func (service *Service) touchProjectProcessRuntime(processID string) {
	_ = service.store.TouchActiveRuntime(context.Background(), "process:"+processID, time.Now().UTC())
}

func (service *Service) updateProjectProcessRuntimeOutputOffset(processID string, outputType string, offset int64) {
	if offset <= 0 {
		return
	}
	service.processMu.Lock()
	state := service.processes[processID]
	if state != nil {
		if outputType == "stdout" {
			state.stdoutOffset = offset
		} else if outputType == "stderr" {
			state.stderrOffset = offset
		}
	}
	service.processMu.Unlock()

	record, ok, err := service.store.GetRuntime(context.Background(), "process:"+processID)
	if err != nil || !ok {
		return
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil || !isActiveRuntimeStatus(dto.Status) {
		return
	}
	if outputType == "stdout" {
		dto.ProcessStdoutOffset = offset
	} else if outputType == "stderr" {
		dto.ProcessStderrOffset = offset
	} else {
		return
	}
	now := time.Now().UTC()
	dto.UpdatedAt = formatTime(now)
	dto.LastActivityAt = dto.UpdatedAt
	updated, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return
	}
	_ = service.store.UpsertRuntime(context.Background(), updated)
}

func (service *Service) updateProjectProcessRuntimeTerminal(processID string, status string, errorMessage string, exitCode *int, signal *string) *runtimeRecordDTO {
	record, ok, err := service.store.GetRuntime(context.Background(), "process:"+processID)
	if err != nil || !ok {
		return nil
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil {
		return nil
	}
	now := time.Now().UTC()
	dto.Status = status
	dto.UpdatedAt = formatTime(now)
	dto.LastActivityAt = dto.UpdatedAt
	dto.ExitedAt = dto.UpdatedAt
	dto.ExitCode = cloneIntPointer(exitCode)
	dto.Signal = cloneStringPointer(signal)
	dto.Error = errorMessage
	updated, runtimeErr := runtimeDTOToStorage(dto)
	if runtimeErr != nil {
		return nil
	}
	if err := service.store.UpsertRuntime(context.Background(), updated); err != nil {
		return nil
	}
	return &dto
}

func (state *projectProcessState) matchesScope(repoID string, taskID string) bool {
	return state.repoID == repoID && state.taskID == taskID
}

func (state *projectProcessState) instanceDTO() projectProcessInstanceDTO {
	instance := projectProcessInstanceDTO{
		ProcessID:    state.processID,
		DefinitionID: state.definitionID,
		RepoID:       state.repoID,
		TaskID:       state.taskID,
		Cwd:          state.cwd,
		Completed:    state.completed,
		Error:        state.errorMessage,
		PID:          cloneIntPointer(state.pid),
	}
	if state.exitCode != nil {
		instance.ExitCode = cloneIntPointer(state.exitCode)
	}
	if state.signal != nil {
		instance.Signal = *state.signal
	}
	return instance
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
