//go:build darwin || linux || freebsd || netbsd || openbsd

package product

import (
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"testing"
	"time"
)

const processTerminationHelperEnv = "OPENADE_TEST_PROCESS_TERMINATION_HELPER"

func TestProcessTerminationSignalHelper(t *testing.T) {
	if os.Getenv(processTerminationHelperEnv) != "1" {
		return
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM)
	<-signals
	os.Exit(0)
}

func TestTerminateAgentWorkerProcessFallsBackToPIDWhenProcessGroupIsMissing(t *testing.T) {
	cmd := startProcessTerminationHelper(t)
	pid := cmd.Process.Pid
	stalePGID := unusedProcessGroupID(t, pid)

	if !terminateAgentWorkerProcess(&pid, &stalePGID) {
		t.Fatalf("terminate agent worker returned false for pid %d stale pgid %d", pid, stalePGID)
	}
	waitForProcessTerminationHelperExit(t, cmd)
}

func TestTerminateProjectProcessIDFallsBackToPIDWhenProcessGroupIsMissing(t *testing.T) {
	cmd := startProcessTerminationHelper(t)
	pid := cmd.Process.Pid
	stalePGID := unusedProcessGroupID(t, pid)

	if err := terminateProjectProcessID(&pid, &stalePGID); err != nil {
		t.Fatalf("terminate project process id: %v", err)
	}
	waitForProcessTerminationHelperExit(t, cmd)
}

func TestTerminateProjectProcessFallsBackToProcessWhenProcessGroupIsMissing(t *testing.T) {
	cmd := startProcessTerminationHelper(t)
	stalePGID := unusedProcessGroupID(t, cmd.Process.Pid)

	if err := terminateProjectProcess(cmd.Process, &stalePGID); err != nil {
		t.Fatalf("terminate project process: %v", err)
	}
	waitForProcessTerminationHelperExit(t, cmd)
}

func startProcessTerminationHelper(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestProcessTerminationSignalHelper$")
	cmd.Env = append(os.Environ(), processTerminationHelperEnv+"=1")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start process termination helper: %v", err)
	}
	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	})
	return cmd
}

func unusedProcessGroupID(t *testing.T, seed int) int {
	t.Helper()
	for offset := 1000; offset < 10000; offset++ {
		candidate := seed + offset
		if candidate <= 0 {
			continue
		}
		if err := syscall.Kill(-candidate, 0); errors.Is(err, syscall.ESRCH) {
			return candidate
		}
	}
	t.Fatalf("could not find unused process group id near pid %d", seed)
	return 0
}

func waitForProcessTerminationHelperExit(t *testing.T, cmd *exec.Cmd) {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()
	select {
	case <-done:
		return
	case <-time.After(2 * time.Second):
		t.Fatalf("process termination helper %d did not exit", cmd.Process.Pid)
	}
}
