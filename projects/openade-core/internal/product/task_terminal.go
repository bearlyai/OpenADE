package product

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	goruntime "runtime"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

const (
	taskTerminalDefaultCols         = 100
	taskTerminalDefaultRows         = 30
	taskTerminalMaxOutput           = 2000
	taskTerminalCleanupDelay        = 30 * time.Minute
	taskTerminalProcessMissingError = "terminal process is no longer running"
	orphanedTaskTerminalStopReason  = "terminal process was orphaned during core startup"
)

type taskTerminalOutputChunkDTO struct {
	Data      string `json:"data"`
	Timestamp int64  `json:"timestamp,omitempty"`
}

type taskTerminalStartDTO struct {
	RepoID     string `json:"repoId"`
	TaskID     string `json:"taskId"`
	TerminalID string `json:"terminalId"`
	RuntimeID  string `json:"runtimeId,omitempty"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
}

type taskTerminalReconnectDTO struct {
	RepoID      string                       `json:"repoId"`
	TaskID      string                       `json:"taskId"`
	TerminalID  string                       `json:"terminalId"`
	Found       bool                         `json:"found"`
	Exited      bool                         `json:"exited,omitempty"`
	ExitCode    *int                         `json:"exitCode,omitempty"`
	OutputCount int                          `json:"outputCount,omitempty"`
	Output      []taskTerminalOutputChunkDTO `json:"output"`
}

type taskTerminalMutationDTO struct {
	RepoID     string `json:"repoId"`
	TaskID     string `json:"taskId"`
	TerminalID string `json:"terminalId"`
	OK         bool   `json:"ok"`
}

type taskTerminalStartedNotificationDTO struct {
	Type             string `json:"type"`
	PtyID            string `json:"ptyId"`
	RuntimeID        string `json:"runtimeId"`
	PID              *int   `json:"pid,omitempty"`
	PGID             *int   `json:"pgid,omitempty"`
	Cwd              string `json:"cwd"`
	Shell            string `json:"shell"`
	ProcessStartedAt string `json:"processStartedAt,omitempty"`
}

type taskTerminalOutputNotificationDTO struct {
	Type  string                     `json:"type"`
	PtyID string                     `json:"ptyId"`
	Chunk taskTerminalOutputChunkDTO `json:"chunk"`
}

type taskTerminalExitNotificationDTO struct {
	Type     string `json:"type"`
	PtyID    string `json:"ptyId"`
	ExitCode int    `json:"exitCode"`
}

type taskTerminalKilledNotificationDTO struct {
	Type  string `json:"type"`
	PtyID string `json:"ptyId"`
}

type taskTerminalState struct {
	terminalID   string
	repoID       string
	taskID       string
	cwd          string
	shell        string
	cmd          *exec.Cmd
	ptyFile      *os.File
	output       []taskTerminalOutputChunkDTO
	completed    bool
	exitCode     *int
	signal       *string
	errorMessage string
	pid          *int
	pgid         *int
	startedAt    time.Time
	cleanupTimer *time.Timer
}

func (service *Service) handleTaskTerminalStart(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/terminal/start", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID string `json:"repoId"`
			TaskID string `json:"taskId"`
			Cols   int    `json:"cols"`
			Rows   int    `json:"rows"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		repo, task, cwd, runtimeErr := service.taskWorkDir(ctx, params.RepoID, params.TaskID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		result, err := service.startTaskTerminal(repo.ID, task.ID, cwd, terminalSize(params.Cols, params.Rows), service.personalSettingsEnvVarsOrEmpty(ctx))
		if err != nil {
			return nil, handlerError(err)
		}
		return result, nil
	})
}

func (service *Service) handleTaskTerminalReconnect(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID     string `json:"repoId"`
		TaskID     string `json:"taskId"`
		TerminalID string `json:"terminalId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, task, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	terminalID := strings.TrimSpace(params.TerminalID)
	if terminalID == "" {
		terminalID = openADETaskTerminalID(repo.ID, task.ID)
	}
	if runtimeErr := assertTaskTerminalID(repo.ID, task.ID, terminalID); runtimeErr != nil {
		return nil, runtimeErr
	}
	return service.reconnectTaskTerminal(repo.ID, task.ID, terminalID), nil
}

func (service *Service) handleTaskTerminalWrite(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/terminal/write", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID     string `json:"repoId"`
			TaskID     string `json:"taskId"`
			TerminalID string `json:"terminalId"`
			Data       string `json:"data"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		repo, task, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if runtimeErr := assertTaskTerminalID(repo.ID, task.ID, params.TerminalID); runtimeErr != nil {
			return nil, runtimeErr
		}
		return service.writeTaskTerminal(repo.ID, task.ID, params.TerminalID, params.Data), nil
	})
}

func (service *Service) handleTaskTerminalResize(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/terminal/resize", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID     string `json:"repoId"`
			TaskID     string `json:"taskId"`
			TerminalID string `json:"terminalId"`
			Cols       int    `json:"cols"`
			Rows       int    `json:"rows"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		repo, task, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if runtimeErr := assertTaskTerminalID(repo.ID, task.ID, params.TerminalID); runtimeErr != nil {
			return nil, runtimeErr
		}
		return service.resizeTaskTerminal(repo.ID, task.ID, params.TerminalID, terminalSize(params.Cols, params.Rows)), nil
	})
}

func (service *Service) handleTaskTerminalStop(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/terminal/stop", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID     string `json:"repoId"`
			TaskID     string `json:"taskId"`
			TerminalID string `json:"terminalId"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		repo, task, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if runtimeErr := assertTaskTerminalID(repo.ID, task.ID, params.TerminalID); runtimeErr != nil {
			return nil, runtimeErr
		}
		return service.stopTaskTerminal(repo.ID, task.ID, params.TerminalID), nil
	})
}

func terminalSize(cols int, rows int) *pty.Winsize {
	if cols <= 0 {
		cols = taskTerminalDefaultCols
	}
	if rows <= 0 {
		rows = taskTerminalDefaultRows
	}
	return &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)}
}

func openADETaskTerminalID(repoID string, taskID string) string {
	sum := sha256.Sum256([]byte(repoID + "\x00" + taskID))
	return "openade-task-terminal-" + hex.EncodeToString(sum[:])[:24]
}

func assertTaskTerminalID(repoID string, taskID string, terminalID string) *core.RuntimeError {
	if strings.TrimSpace(terminalID) == "" {
		return invalidParams("terminalId is required")
	}
	if terminalID != openADETaskTerminalID(repoID, taskID) {
		return invalidParams("terminalId is invalid")
	}
	return nil
}

func taskTerminalShell(envVars map[string]string) string {
	if goruntime.GOOS == "windows" {
		return "powershell.exe"
	}
	if shell := strings.TrimSpace(envVars["SHELL"]); shell != "" {
		return shell
	}
	if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" {
		return shell
	}
	return "/bin/bash"
}

func (service *Service) startTaskTerminal(repoID string, taskID string, cwd string, size *pty.Winsize, envVars map[string]string) (taskTerminalStartDTO, error) {
	terminalID := openADETaskTerminalID(repoID, taskID)
	runtimeID := "pty:" + terminalID

	service.terminalMu.Lock()
	if state := service.terminals[terminalID]; state != nil {
		service.terminalMu.Unlock()
		return taskTerminalStartDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, RuntimeID: runtimeID, OK: true}, nil
	}
	service.terminalMu.Unlock()

	if stat, err := os.Stat(cwd); err != nil {
		return taskTerminalStartDTO{}, err
	} else if !stat.IsDir() {
		return taskTerminalStartDTO{}, errors.New("terminal cwd is not a directory")
	}

	shell := taskTerminalShell(envVars)
	cmd := exec.Command(shell)
	cmd.Dir = cwd
	cmd.Env = environmentWithOverrides(os.Environ(), envVars, "TERM=xterm-256color")
	ptyFile, err := pty.StartWithSize(cmd, size)
	if err != nil {
		return taskTerminalStartDTO{}, err
	}

	state := &taskTerminalState{
		terminalID: terminalID,
		repoID:     repoID,
		taskID:     taskID,
		cwd:        cwd,
		shell:      shell,
		cmd:        cmd,
		ptyFile:    ptyFile,
		output:     []taskTerminalOutputChunkDTO{},
		startedAt:  time.Now().UTC(),
	}
	if cmd.Process != nil {
		pid := cmd.Process.Pid
		state.pid = &pid
		state.pgid = &pid
	}

	service.terminalMu.Lock()
	if existing := service.terminals[terminalID]; existing != nil {
		service.terminalMu.Unlock()
		_ = ptyFile.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return taskTerminalStartDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, RuntimeID: runtimeID, OK: true}, nil
	}
	service.terminals[terminalID] = state
	service.terminalMu.Unlock()

	runtimeRecord, err := service.persistTaskTerminalRuntime(state, "running", "", nil, nil, "")
	if err != nil {
		service.removeTaskTerminalState(terminalID)
		_ = ptyFile.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return taskTerminalStartDTO{}, err
	}
	service.runtime.Notify("runtime/created", runtimeRecord)
	service.notifyTaskTerminalStarted(state)

	go service.readTaskTerminalOutput(terminalID, ptyFile)
	go service.waitTaskTerminal(terminalID, cmd)

	return taskTerminalStartDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, RuntimeID: runtimeID, OK: true}, nil
}

func (service *Service) readTaskTerminalOutput(terminalID string, reader io.Reader) {
	buffer := make([]byte, 4096)
	for {
		count, err := reader.Read(buffer)
		if count > 0 {
			service.appendTaskTerminalOutput(terminalID, taskTerminalOutputChunkDTO{
				Data:      string(buffer[:count]),
				Timestamp: time.Now().UnixMilli(),
			})
		}
		if err != nil {
			return
		}
	}
}

func (service *Service) appendTaskTerminalOutput(terminalID string, chunk taskTerminalOutputChunkDTO) {
	service.terminalMu.Lock()
	state := service.terminals[terminalID]
	if state == nil {
		service.terminalMu.Unlock()
		return
	}
	state.output = append(state.output, chunk)
	for len(state.output) > taskTerminalMaxOutput {
		state.output = state.output[1:]
	}
	service.terminalMu.Unlock()
	service.persistTaskTerminalOutput(terminalID, chunk)
	service.touchTaskTerminalRuntime(terminalID)
	service.runtime.Notify("pty/output", taskTerminalOutputNotificationDTO{
		Type:  "output",
		PtyID: terminalID,
		Chunk: chunk,
	})
}

func (service *Service) waitTaskTerminal(terminalID string, cmd *exec.Cmd) {
	err := cmd.Wait()
	service.terminalMu.Lock()
	state := service.terminals[terminalID]
	if state == nil {
		service.terminalMu.Unlock()
		return
	}
	state.completed = true
	state.exitCode, state.signal, state.errorMessage = processExitStatus(err)
	if state.ptyFile != nil {
		_ = state.ptyFile.Close()
	}
	exitCode := cloneIntPointer(state.exitCode)
	signal := cloneStringPointer(state.signal)
	errorMessage := state.errorMessage
	service.scheduleTaskTerminalCleanupLocked(terminalID, state)
	service.terminalMu.Unlock()

	status := "completed"
	if signal != nil {
		status = "stopped"
	} else if errorMessage != "" {
		status = "failed"
	} else if exitCode != nil && *exitCode != 0 {
		status = "failed"
	}
	runtimeRecord := service.updateTaskTerminalRuntimeTerminal(terminalID, status, errorMessage, exitCode, signal)
	if runtimeRecord != nil {
		if status == "completed" {
			service.runtime.Notify("runtime/completed", *runtimeRecord)
		} else if status == "stopped" {
			service.runtime.Notify("runtime/stopped", *runtimeRecord)
		} else {
			service.runtime.Notify("runtime/failed", *runtimeRecord)
		}
	}
	notificationExitCode := 0
	if exitCode != nil {
		notificationExitCode = *exitCode
	}
	service.runtime.Notify("pty/exit", taskTerminalExitNotificationDTO{Type: "exit", PtyID: terminalID, ExitCode: notificationExitCode})
}

func (service *Service) reconnectTaskTerminal(repoID string, taskID string, terminalID string) taskTerminalReconnectDTO {
	service.terminalMu.Lock()
	state := service.terminals[terminalID]
	if state == nil || state.repoID != repoID || state.taskID != taskID {
		service.terminalMu.Unlock()
		return service.reconnectStoredTaskTerminal(repoID, taskID, terminalID)
	}
	output := append([]taskTerminalOutputChunkDTO{}, state.output...)
	service.terminalMu.Unlock()
	return taskTerminalReconnectDTO{
		RepoID:      repoID,
		TaskID:      taskID,
		TerminalID:  terminalID,
		Found:       true,
		Exited:      state.completed,
		ExitCode:    cloneIntPointer(state.exitCode),
		OutputCount: len(output),
		Output:      output,
	}
}

func (service *Service) reconnectStoredTaskTerminal(repoID string, taskID string, terminalID string) taskTerminalReconnectDTO {
	result := taskTerminalReconnectDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, Found: false, Output: []taskTerminalOutputChunkDTO{}}
	record, ok, err := service.store.GetRuntime(context.Background(), "pty:"+terminalID)
	if err != nil || !ok {
		return result
	}
	dto, runtimeErr := runtimeRecordToDTO(record)
	if runtimeErr != nil || dto.Kind != "pty" || dto.NativeID != terminalID || !storedTaskTerminalStatusIsReconnectable(dto) || !storedTaskTerminalMatchesScope(dto, repoID, taskID) {
		return result
	}
	chunks, err := service.store.ListRuntimeOutputChunks(context.Background(), "pty:"+terminalID, taskTerminalMaxOutput)
	if err != nil {
		return result
	}
	output := make([]taskTerminalOutputChunkDTO, 0, len(chunks))
	for _, chunk := range chunks {
		output = append(output, taskTerminalOutputChunkDTO{
			Data:      chunk.Data,
			Timestamp: chunk.TimestampMs,
		})
	}
	result.Found = true
	result.Exited = dto.Status == "orphaned" || isTerminalRuntimeStatus(dto.Status)
	result.ExitCode = cloneIntPointer(dto.ExitCode)
	result.OutputCount = len(output)
	result.Output = output
	return result
}

func storedTaskTerminalStatusIsReconnectable(dto runtimeRecordDTO) bool {
	return dto.Status != "stopped" || dto.Error == taskTerminalProcessMissingError || dto.Error == orphanedTaskTerminalStopReason
}

func storedTaskTerminalMatchesScope(dto runtimeRecordDTO, repoID string, taskID string) bool {
	if dto.Scope.Labels == nil {
		return false
	}
	return dto.Scope.Labels["repoId"] == repoID && dto.Scope.Labels["taskId"] == taskID
}

func (service *Service) writeTaskTerminal(repoID string, taskID string, terminalID string, data string) taskTerminalMutationDTO {
	service.terminalMu.Lock()
	state := service.terminals[terminalID]
	if state == nil || state.repoID != repoID || state.taskID != taskID || state.completed || state.ptyFile == nil {
		service.terminalMu.Unlock()
		return taskTerminalMutationDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, OK: false}
	}
	ptyFile := state.ptyFile
	service.terminalMu.Unlock()
	_, err := ptyFile.Write([]byte(data))
	return taskTerminalMutationDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, OK: err == nil}
}

func (service *Service) resizeTaskTerminal(repoID string, taskID string, terminalID string, size *pty.Winsize) taskTerminalMutationDTO {
	service.terminalMu.Lock()
	state := service.terminals[terminalID]
	if state == nil || state.repoID != repoID || state.taskID != taskID || state.completed || state.ptyFile == nil {
		service.terminalMu.Unlock()
		return taskTerminalMutationDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, OK: false}
	}
	ptyFile := state.ptyFile
	service.terminalMu.Unlock()
	err := pty.Setsize(ptyFile, size)
	return taskTerminalMutationDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, OK: err == nil}
}

func (service *Service) stopTaskTerminal(repoID string, taskID string, terminalID string) taskTerminalMutationDTO {
	return service.stopTaskTerminalWithReason(repoID, taskID, terminalID, "")
}

func (service *Service) stopTaskTerminalByRuntime(terminalID string, reason string) taskTerminalMutationDTO {
	service.terminalMu.Lock()
	state := service.terminals[terminalID]
	if state == nil {
		service.terminalMu.Unlock()
		return taskTerminalMutationDTO{TerminalID: terminalID, OK: false}
	}
	repoID := state.repoID
	taskID := state.taskID
	service.terminalMu.Unlock()
	return service.stopTaskTerminalWithReason(repoID, taskID, terminalID, reason)
}

func (service *Service) stopTaskTerminalWithReason(repoID string, taskID string, terminalID string, reason string) taskTerminalMutationDTO {
	service.terminalMu.Lock()
	state := service.terminals[terminalID]
	if state == nil || state.repoID != repoID || state.taskID != taskID {
		service.terminalMu.Unlock()
		return taskTerminalMutationDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, OK: false}
	}
	delete(service.terminals, terminalID)
	if state.cleanupTimer != nil {
		state.cleanupTimer.Stop()
	}
	service.terminalMu.Unlock()

	if state.ptyFile != nil {
		_ = state.ptyFile.Close()
	}
	if state.cmd != nil && state.cmd.Process != nil && !state.completed {
		killTaskTerminalProcess(state.cmd.Process)
	}
	signal := "killed"
	if reason != "" {
		signal = "stopped"
	}
	runtimeRecord := service.updateTaskTerminalRuntimeTerminal(terminalID, "stopped", reason, nil, &signal)
	if runtimeRecord != nil {
		service.runtime.Notify("runtime/stopped", *runtimeRecord)
	}
	service.runtime.Notify("pty/killed", taskTerminalKilledNotificationDTO{Type: "killed", PtyID: terminalID})
	return taskTerminalMutationDTO{RepoID: repoID, TaskID: taskID, TerminalID: terminalID, OK: true}
}

func killTaskTerminalProcess(process *os.Process) {
	if goruntime.GOOS != "windows" && process.Pid > 0 {
		if err := syscall.Kill(-process.Pid, syscall.SIGTERM); err == nil || errors.Is(err, os.ErrProcessDone) {
			return
		}
	}
	if err := process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return
	}
}

func (service *Service) scheduleTaskTerminalCleanupLocked(terminalID string, state *taskTerminalState) {
	if state.cleanupTimer != nil {
		state.cleanupTimer.Stop()
	}
	state.cleanupTimer = time.AfterFunc(taskTerminalCleanupDelay, func() {
		service.terminalMu.Lock()
		defer service.terminalMu.Unlock()
		delete(service.terminals, terminalID)
	})
}

func (service *Service) removeTaskTerminalState(terminalID string) {
	service.terminalMu.Lock()
	defer service.terminalMu.Unlock()
	delete(service.terminals, terminalID)
}

func (service *Service) notifyTaskTerminalStarted(state *taskTerminalState) {
	service.runtime.Notify("pty/started", taskTerminalStartedNotificationDTO{
		Type:             "started",
		PtyID:            state.terminalID,
		RuntimeID:        "pty:" + state.terminalID,
		PID:              cloneIntPointer(state.pid),
		PGID:             cloneIntPointer(state.pgid),
		Cwd:              state.cwd,
		Shell:            state.shell,
		ProcessStartedAt: formatTime(state.startedAt),
	})
}

func (service *Service) persistTaskTerminalRuntime(state *taskTerminalState, status string, errorMessage string, exitCode *int, signal *string, exitedAt string) (runtimeRecordDTO, error) {
	dto := runtimeRecordDTO{
		RuntimeID:        "pty:" + state.terminalID,
		Kind:             "pty",
		Status:           status,
		Scope:            runtimeScopeDTO{OwnerType: "pty", OwnerID: state.terminalID, RootPath: state.cwd, Labels: map[string]string{"repoId": state.repoID, "taskId": state.taskID}},
		StartedAt:        formatTime(state.startedAt),
		UpdatedAt:        formatTime(time.Now().UTC()),
		LastActivityAt:   formatTime(time.Now().UTC()),
		NativeID:         state.terminalID,
		PID:              cloneIntPointer(state.pid),
		PGID:             cloneIntPointer(state.pgid),
		ProcessLabel:     state.shell,
		ProcessStartedAt: formatTime(state.startedAt),
		ExitedAt:         exitedAt,
		ExitCode:         cloneIntPointer(exitCode),
		Signal:           cloneStringPointer(signal),
		Error:            errorMessage,
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

func (service *Service) persistTaskTerminalOutput(terminalID string, chunk taskTerminalOutputChunkDTO) {
	_ = service.store.AppendRuntimeOutputChunk(context.Background(), storage.RuntimeOutputChunk{
		RuntimeID:   "pty:" + terminalID,
		Stream:      "pty",
		Data:        chunk.Data,
		TimestampMs: chunk.Timestamp,
	}, taskTerminalMaxOutput)
}

func (service *Service) touchTaskTerminalRuntime(terminalID string) {
	_ = service.store.TouchActiveRuntime(context.Background(), "pty:"+terminalID, time.Now().UTC())
}

func (service *Service) updateTaskTerminalRuntimeTerminal(terminalID string, status string, errorMessage string, exitCode *int, signal *string) *runtimeRecordDTO {
	record, ok, err := service.store.GetRuntime(context.Background(), "pty:"+terminalID)
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
