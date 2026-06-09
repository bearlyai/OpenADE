package product

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

type turnInterruptResultDTO struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func (service *Service) handleTurnInterrupt(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/turn/interrupt", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.interruptTurn(ctx, raw)
	})
}

func (service *Service) interruptTurn(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		TaskID string `json:"taskId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	taskID := strings.TrimSpace(params.TaskID)
	if taskID == "" {
		return nil, invalidParams("taskId is required")
	}
	runtimeDTO, ok, runtimeErr := service.activeAgentRuntimeForTask(ctx, taskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if !ok {
		return turnInterruptResultDTO{OK: false, Error: "No server-owned turn is running for this task"}, nil
	}
	if _, runtimeErr := service.stopAgentRuntime(ctx, runtimeDTO, "user interrupt"); runtimeErr != nil {
		return nil, runtimeErr
	}
	return turnInterruptResultDTO{OK: true}, nil
}

func (service *Service) activeAgentRuntimeForTask(ctx context.Context, taskID string) (runtimeRecordDTO, bool, *core.RuntimeError) {
	records, err := service.store.ListRuntimes(ctx)
	if err != nil {
		return runtimeRecordDTO{}, false, handlerError(err)
	}
	for _, record := range records {
		dto, runtimeErr := runtimeRecordToDTO(record)
		if runtimeErr != nil {
			return runtimeRecordDTO{}, false, runtimeErr
		}
		if dto.Kind != "agent" || dto.Scope.OwnerType != "openade-task" || dto.Scope.OwnerID != taskID {
			continue
		}
		if isActiveRuntimeStatus(dto.Status) {
			return dto, true, nil
		}
	}
	return runtimeRecordDTO{}, false, nil
}
