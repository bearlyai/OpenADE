package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/product"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{}))
	cfg := core.ConfigFromEnv()
	var profileErr error
	cfg, profileErr = product.ApplyPermissionProfile(cfg)
	if profileErr != nil {
		logger.Error("failed to apply OpenADE Core permission profile", "error", profileErr)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := storage.Open(ctx, cfg.DatabasePath)
	if err != nil {
		logger.Error("failed to open OpenADE Core storage", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := store.Close(); err != nil {
			logger.Error("failed to close OpenADE Core storage", "error", err)
		}
	}()

	httpHandler := core.NewHTTPServer(cfg, logger)
	hostName, _ := os.Hostname()
	var agentExecutor product.AgentExecutor
	var sdkCapabilitiesExecutor product.SDKCapabilitiesExecutor
	if len(cfg.AgentWorkerCommand) > 0 {
		commandAgentExecutor := product.NewCommandAgentExecutorWithRecoveryDir(cfg.AgentWorkerCommand, filepath.Join(cfg.DataDir, "agent-recovery"))
		agentExecutor = commandAgentExecutor
		sdkCapabilitiesExecutor = commandAgentExecutor
	}
	product.ConfigureDeviceAuthentication(httpHandler, store)
	productService := product.Register(httpHandler.Runtime, store, product.Options{
		Version:                 cfg.ServerVersion,
		HostName:                hostName,
		BlobDir:                 filepath.Join(cfg.DataDir, "blobs"),
		WorktreeBaseDir:         filepath.Join(cfg.DataDir, "worktrees"),
		ProcessOutputDir:        filepath.Join(cfg.DataDir, "process-output"),
		AgentExecutor:           agentExecutor,
		SDKCapabilitiesExecutor: sdkCapabilitiesExecutor,
	})
	productService.ConfigurePairing(httpHandler)

	server, runtimeURL, err := core.ListenAndServeHandler(ctx, cfg, logger, httpHandler)
	if err != nil {
		logger.Error("failed to start OpenADE Core", "error", err)
		os.Exit(1)
	}
	productService.StartCronScheduler(ctx, 0)
	logger.Info("OpenADE Core listening", "runtimeUrl", runtimeURL, "httpAddr", server.Addr)
	<-ctx.Done()
}
