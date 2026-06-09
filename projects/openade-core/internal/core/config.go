package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultHost            = "127.0.0.1"
	DefaultRuntimePath     = "/v1/runtime"
	DefaultServerName      = "openade-core"
	DefaultProtocolVersion = 1
)

type Config struct {
	Host                         string
	Port                         int
	RuntimePath                  string
	DataDir                      string
	DatabasePath                 string
	Token                        string
	AllowUnauthenticatedLoopback bool
	ServerName                   string
	ServerVersion                string
	ProtocolVersion              int
	PermissionProfile            string
	Permissions                  []string
	SlowRequestThreshold         time.Duration
	AgentWorkerCommand           []string
}

func DefaultConfig() Config {
	dataDir := defaultDataDir()
	return Config{
		Host:                         DefaultHost,
		Port:                         0,
		RuntimePath:                  DefaultRuntimePath,
		DataDir:                      dataDir,
		DatabasePath:                 filepath.Join(dataDir, "openade-core.db"),
		AllowUnauthenticatedLoopback: true,
		ServerName:                   DefaultServerName,
		ProtocolVersion:              DefaultProtocolVersion,
		SlowRequestThreshold:         500 * time.Millisecond,
	}
}

func ConfigFromEnv() Config {
	return ConfigFromEnvMap(os.Environ())
}

func ConfigFromEnvMap(environ []string) Config {
	cfg := DefaultConfig()
	values := map[string]string{}
	for _, entry := range environ {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			values[key] = value
		}
	}

	if value := strings.TrimSpace(values["OPENADE_CORE_HOST"]); value != "" {
		cfg.Host = value
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_RUNTIME_PATH"]); value != "" {
		cfg.RuntimePath = value
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_DATA_DIR"]); value != "" {
		cfg.DataDir = value
		cfg.DatabasePath = filepath.Join(value, "openade-core.db")
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_DATABASE_PATH"]); value != "" {
		cfg.DatabasePath = value
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_TOKEN"]); value != "" {
		cfg.Token = value
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_SERVER_NAME"]); value != "" {
		cfg.ServerName = value
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_SERVER_VERSION"]); value != "" {
		cfg.ServerVersion = value
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_PORT"]); value != "" {
		if port, err := strconv.Atoi(value); err == nil && port >= 0 {
			cfg.Port = port
		}
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_PROTOCOL_VERSION"]); value != "" {
		if version, err := strconv.Atoi(value); err == nil && version > 0 {
			cfg.ProtocolVersion = version
		}
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_PERMISSION_PROFILE"]); value != "" {
		cfg.PermissionProfile = value
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_ALLOW_UNAUTHENTICATED_LOOPBACK"]); value != "" {
		if parsed, err := strconv.ParseBool(value); err == nil {
			cfg.AllowUnauthenticatedLoopback = parsed
		}
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_SLOW_REQUEST_MS"]); value != "" {
		if ms, err := strconv.Atoi(value); err == nil && ms >= 0 {
			cfg.SlowRequestThreshold = time.Duration(ms) * time.Millisecond
		}
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_PERMISSIONS"]); value != "" {
		for _, permission := range strings.Split(value, ",") {
			if trimmed := strings.TrimSpace(permission); trimmed != "" {
				cfg.Permissions = append(cfg.Permissions, trimmed)
			}
		}
	}
	if value := strings.TrimSpace(values["OPENADE_CORE_AGENT_WORKER_COMMAND"]); value != "" {
		cfg.AgentWorkerCommand = parseAgentWorkerCommand(value)
	}

	return cfg
}

func parseAgentWorkerCommand(value string) []string {
	if strings.HasPrefix(value, "[") {
		var command []string
		if err := json.Unmarshal([]byte(value), &command); err == nil {
			normalized := make([]string, 0, len(command))
			for _, part := range command {
				trimmed := strings.TrimSpace(part)
				if trimmed != "" {
					normalized = append(normalized, trimmed)
				}
			}
			return normalized
		}
	}
	return []string{value}
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ".openade-core"
	}
	return filepath.Join(home, ".openade", "core")
}
