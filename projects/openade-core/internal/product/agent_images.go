package product

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"

	"github.com/openade/openade/projects/openade-core/internal/core"
)

type agentPromptImageDTO struct {
	ID        string                 `json:"id,omitempty"`
	Ext       string                 `json:"ext,omitempty"`
	MediaType string                 `json:"mediaType,omitempty"`
	Source    agentPromptImageSource `json:"source"`
}

type agentPromptImageSource struct {
	Kind      string `json:"kind"`
	Data      string `json:"data"`
	MediaType string `json:"mediaType"`
}

func (service *Service) agentPromptImages(ctx context.Context, repoID string, taskID string, rawImages *json.RawMessage) (*json.RawMessage, *core.RuntimeError) {
	if rawImages == nil || len(*rawImages) == 0 {
		return nil, nil
	}
	task, ok, err := service.store.GetTask(ctx, taskID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || task.RepoID != repoID {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	var rawRefs []json.RawMessage
	if err := json.Unmarshal(*rawImages, &rawRefs); err != nil {
		return nil, invalidParams("images must be an array")
	}
	refs := taskImageReferences(rawRefs)
	if len(refs) == 0 {
		return nil, nil
	}
	events, err := service.store.ListTaskEvents(ctx, taskID, true)
	if err != nil {
		return nil, handlerError(err)
	}
	queuedTurns, err := service.store.ListQueuedTurns(ctx, taskID)
	if err != nil {
		return nil, handlerError(err)
	}
	images := make([]agentPromptImageDTO, 0, len(refs))
	for _, ref := range refs {
		owned := taskImageReference(events, queuedTurns, ref.ID, ref.Ext)
		if owned == nil {
			continue
		}
		blob, ok, err := service.store.GetBlobMetadata(ctx, ref.ID)
		if err != nil {
			return nil, handlerError(err)
		}
		if !ok || blob.Kind != "task_image" {
			continue
		}
		data, err := os.ReadFile(blob.Path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, handlerError(err)
		}
		mediaType := firstNonEmptyString(owned.MediaType, blob.ContentType.String, mediaTypeForImageExt(owned.Ext))
		if !strings.HasPrefix(mediaType, "image/") {
			continue
		}
		images = append(images, agentPromptImageDTO{
			ID:        owned.ID,
			Ext:       owned.Ext,
			MediaType: mediaType,
			Source: agentPromptImageSource{
				Kind:      "base64",
				Data:      base64.StdEncoding.EncodeToString(data),
				MediaType: mediaType,
			},
		})
	}
	if len(images) == 0 {
		return nil, nil
	}
	payload, err := json.Marshal(images)
	if err != nil {
		return nil, handlerError(err)
	}
	expanded := json.RawMessage(payload)
	return cloneRawMessagePointer(&expanded), nil
}

func mediaTypeForImageExt(ext string) string {
	switch strings.ToLower(ext) {
	case "gif":
		return "image/gif"
	case "jpeg", "jpg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	default:
		return ""
	}
}
