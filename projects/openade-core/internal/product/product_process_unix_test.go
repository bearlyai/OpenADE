//go:build darwin || linux || freebsd || netbsd || openbsd

package product_test

import (
	"os"
	"os/exec"
	"syscall"
	"testing"
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
