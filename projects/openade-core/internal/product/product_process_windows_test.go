//go:build windows

package product_test

import (
	"os/exec"
	"testing"
)

func startLongRunningProcessGroup(t *testing.T) (*exec.Cmd, int, *int) {
	t.Helper()
	t.Fatal("long-running process group helper is unsupported on Windows")
	return nil, 0, nil
}
