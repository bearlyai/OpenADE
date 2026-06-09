//go:build darwin || linux || freebsd || netbsd || openbsd

package product

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

func configureProjectProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func projectProcessGroupID(cmd *exec.Cmd) *int {
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

func terminateProjectProcess(process *os.Process, pgid *int) error {
	if pgid != nil && *pgid > 0 {
		if err := syscall.Kill(-*pgid, syscall.SIGTERM); err == nil || errors.Is(err, syscall.ESRCH) {
			return nil
		}
	}
	if process == nil {
		return os.ErrProcessDone
	}
	return process.Kill()
}

func terminateProjectProcessID(pid *int, pgid *int) error {
	if pgid != nil && *pgid > 0 {
		if err := syscall.Kill(-*pgid, syscall.SIGTERM); err == nil || errors.Is(err, syscall.ESRCH) {
			return nil
		}
	}
	if pid == nil || *pid <= 0 {
		return os.ErrProcessDone
	}
	err := syscall.Kill(*pid, syscall.SIGTERM)
	if err == nil || errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
