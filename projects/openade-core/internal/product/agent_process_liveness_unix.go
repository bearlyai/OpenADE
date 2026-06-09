//go:build darwin || linux || freebsd || netbsd || openbsd

package product

import (
	"errors"
	"syscall"
)

func agentWorkerProcessIsRunning(pid int) bool {
	return runtimeProcessIsRunning(pid)
}

func runtimeProcessIsRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	return errors.Is(err, syscall.EPERM)
}

func terminateAgentWorkerProcess(pid *int, pgid *int) bool {
	if pgid != nil && *pgid > 0 {
		if err := syscall.Kill(-*pgid, syscall.SIGTERM); err == nil {
			return true
		}
	}
	if pid == nil || *pid <= 0 {
		return false
	}
	err := syscall.Kill(*pid, syscall.SIGTERM)
	return err == nil || errors.Is(err, syscall.ESRCH)
}
