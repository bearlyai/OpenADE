//go:build windows

package product

import "os/exec"

func configureCommandAgentProcess(_ *exec.Cmd) {
}

func commandAgentProcessGroupID(_ *exec.Cmd) *int {
	return nil
}
