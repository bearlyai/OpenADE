//go:build darwin || linux || freebsd || netbsd || openbsd

package product

import (
	"os/exec"
	"syscall"
)

func configureCommandAgentProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func commandAgentProcessGroupID(cmd *exec.Cmd) *int {
	if cmd.Process == nil {
		return nil
	}
	pgid, err := syscall.Getpgid(cmd.Process.Pid)
	if err != nil {
		pid := cmd.Process.Pid
		return &pid
	}
	return &pgid
}
