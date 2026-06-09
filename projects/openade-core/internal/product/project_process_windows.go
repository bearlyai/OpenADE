//go:build windows

package product

import (
	"os"
	"os/exec"
)

func configureProjectProcess(_ *exec.Cmd) {}

func projectProcessGroupID(_ *exec.Cmd) *int {
	return nil
}

func terminateProjectProcess(process *os.Process, _ *int) error {
	if process == nil {
		return os.ErrProcessDone
	}
	return process.Kill()
}

func terminateProjectProcessID(pid *int, _ *int) error {
	if pid == nil || *pid <= 0 {
		return os.ErrProcessDone
	}
	process, err := os.FindProcess(*pid)
	if err != nil {
		return err
	}
	return process.Kill()
}
