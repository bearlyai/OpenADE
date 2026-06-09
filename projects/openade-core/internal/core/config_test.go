package core

import (
	"reflect"
	"testing"
	"time"
)

func TestConfigFromEnvMap(t *testing.T) {
	cfg := ConfigFromEnvMap([]string{
		"OPENADE_CORE_HOST=0.0.0.0",
		"OPENADE_CORE_PORT=8080",
		"OPENADE_CORE_RUNTIME_PATH=/runtime",
		"OPENADE_CORE_DATA_DIR=/tmp/openade-core",
		"OPENADE_CORE_DATABASE_PATH=/tmp/custom.db",
		"OPENADE_CORE_TOKEN=secret",
		"OPENADE_CORE_SERVER_NAME=test-core",
		"OPENADE_CORE_SERVER_VERSION=dev",
		"OPENADE_CORE_PROTOCOL_VERSION=2",
		"OPENADE_CORE_PERMISSION_PROFILE=paired",
		"OPENADE_CORE_ALLOW_UNAUTHENTICATED_LOOPBACK=false",
		"OPENADE_CORE_SLOW_REQUEST_MS=75",
		"OPENADE_CORE_NOTIFICATION_BURST_WINDOW_MS=1500",
		"OPENADE_CORE_NOTIFICATION_BURST_COUNT=7",
		"OPENADE_CORE_PERMISSIONS=initialize,server/*,notify:connection/*",
		`OPENADE_CORE_AGENT_WORKER_COMMAND=["node","worker.mjs"]`,
	})

	if cfg.Host != "0.0.0.0" {
		t.Fatalf("host = %q", cfg.Host)
	}
	if cfg.Port != 8080 {
		t.Fatalf("port = %d", cfg.Port)
	}
	if cfg.RuntimePath != "/runtime" {
		t.Fatalf("runtime path = %q", cfg.RuntimePath)
	}
	if cfg.DataDir != "/tmp/openade-core" {
		t.Fatalf("data dir = %q", cfg.DataDir)
	}
	if cfg.DatabasePath != "/tmp/custom.db" {
		t.Fatalf("database path = %q", cfg.DatabasePath)
	}
	if cfg.Token != "secret" {
		t.Fatalf("token = %q", cfg.Token)
	}
	if cfg.ServerName != "test-core" || cfg.ServerVersion != "dev" {
		t.Fatalf("server identity = %q %q", cfg.ServerName, cfg.ServerVersion)
	}
	if cfg.ProtocolVersion != 2 {
		t.Fatalf("protocol version = %d", cfg.ProtocolVersion)
	}
	if cfg.PermissionProfile != "paired" {
		t.Fatalf("permission profile = %q", cfg.PermissionProfile)
	}
	if cfg.AllowUnauthenticatedLoopback {
		t.Fatal("loopback auth should be disabled")
	}
	if cfg.SlowRequestThreshold != 75*time.Millisecond {
		t.Fatalf("slow threshold = %s", cfg.SlowRequestThreshold)
	}
	if cfg.NotificationBurstWindow != 1500*time.Millisecond || cfg.NotificationBurstCount != 7 {
		t.Fatalf("notification burst config = %s %d", cfg.NotificationBurstWindow, cfg.NotificationBurstCount)
	}
	if !reflect.DeepEqual(cfg.Permissions, []string{"initialize", "server/*", "notify:connection/*"}) {
		t.Fatalf("permissions = %#v", cfg.Permissions)
	}
	if !reflect.DeepEqual(cfg.AgentWorkerCommand, []string{"node", "worker.mjs"}) {
		t.Fatalf("agent worker command = %#v", cfg.AgentWorkerCommand)
	}
}
