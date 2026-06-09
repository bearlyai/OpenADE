//go:build windows

package product

func agentWorkerProcessIsRunning(pid int) bool {
	return runtimeProcessIsRunning(pid)
}

func runtimeProcessIsRunning(pid int) bool {
	return pid > 0
}

func terminateAgentWorkerProcess(_ *int, _ *int) bool {
	return false
}
