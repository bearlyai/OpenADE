package core

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecodeRuntimeRequestRejectsInvalidIDs(t *testing.T) {
	for _, raw := range []string{
		`{"id":null,"method":"initialize"}`,
		`{"id":true,"method":"initialize"}`,
		`{"id":"","method":"initialize"}`,
	} {
		if _, runtimeErr := DecodeRuntimeRequest([]byte(raw)); runtimeErr == nil {
			t.Fatalf("expected invalid id to fail: %s", raw)
		}
	}
}

func TestRuntimeResponseAlwaysIncludesResultOrError(t *testing.T) {
	data, err := json.Marshal(runtimeResponse{ID: stringRequestID("ok")})
	if err != nil {
		t.Fatalf("marshal success response: %v", err)
	}
	if !strings.Contains(string(data), `"result":null`) {
		t.Fatalf("success response should include result:null, got %s", data)
	}

	data, err = json.Marshal(runtimeResponse{ID: stringRequestID("err"), Error: protocolError("failed", "failed")})
	if err != nil {
		t.Fatalf("marshal error response: %v", err)
	}
	if !strings.Contains(string(data), `"error"`) || strings.Contains(string(data), `"result"`) {
		t.Fatalf("error response should include only error, got %s", data)
	}
}
