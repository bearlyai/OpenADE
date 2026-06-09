package core

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func testServer(cfg Config) (*HTTPServer, *httptest.Server) {
	server := NewHTTPServer(cfg, slog.New(slog.NewTextHandler(&strings.Builder{}, nil)))
	return server, httptest.NewServer(server)
}

func wsURL(httpURL string, path string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http") + path
}

func readResponse(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	_, data, err := conn.Read(context.Background())
	if err != nil {
		t.Fatalf("read websocket response: %v", err)
	}
	var response map[string]any
	if err := json.Unmarshal(data, &response); err != nil {
		t.Fatalf("decode response %s: %v", data, err)
	}
	return response
}

func writeRequest(t *testing.T, conn *websocket.Conn, request string) {
	t.Helper()
	if err := conn.Write(context.Background(), websocket.MessageText, []byte(request)); err != nil {
		t.Fatalf("write websocket request: %v", err)
	}
}

func TestHealthAndVersionEndpoints(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ServerVersion = "test-version"
	_, httpServer := testServer(cfg)
	defer httpServer.Close()

	for _, path := range []string{"/healthz", "/version"} {
		response, err := http.Get(httpServer.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET %s status = %d", path, response.StatusCode)
		}
		_ = response.Body.Close()
	}
}

func TestRuntimeInitializeOverWebSocket(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Token = "token"
	cfg.ServerVersion = "test-version"
	_, httpServer := testServer(cfg)
	defer httpServer.Close()

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer.token"},
	})
	if err != nil {
		t.Fatalf("dial runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	if conn.Subprotocol() != "bearer.token" {
		t.Fatalf("subprotocol = %q", conn.Subprotocol())
	}

	writeRequest(t, conn, `{"id":1,"method":"initialize","params":{"clientName":"test","clientPlatform":"desktop","protocolVersion":1}}`)
	response := readResponse(t, conn)
	if response["id"] != float64(1) {
		t.Fatalf("response id = %#v", response["id"])
	}
	result, ok := response["result"].(map[string]any)
	if !ok {
		t.Fatalf("missing result: %#v", response)
	}
	if result["serverName"] != DefaultServerName {
		t.Fatalf("serverName = %#v", result["serverName"])
	}
	if result["serverVersion"] != "test-version" {
		t.Fatalf("serverVersion = %#v", result["serverVersion"])
	}
	capabilities, ok := result["capabilities"].(map[string]any)
	if !ok {
		t.Fatalf("missing capabilities: %#v", result)
	}
	methods := capabilities["methods"].([]any)
	if len(methods) == 0 {
		t.Fatal("initialize returned no methods")
	}
}

func TestRuntimeRejectsMissingToken(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Token = "token"
	_, httpServer := testServer(cfg)
	defer httpServer.Close()

	_, response, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), nil)
	if err == nil {
		t.Fatal("expected websocket dial without token to fail")
	}
	if response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %#v, error = %v", response, err)
	}
}

func TestRuntimeRequiresInitialize(t *testing.T) {
	cfg := DefaultConfig()
	_, httpServer := testServer(cfg)
	defer httpServer.Close()

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), nil)
	if err != nil {
		t.Fatalf("dial runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeRequest(t, conn, `{"id":"a","method":"server/status/read"}`)
	response := readResponse(t, conn)
	runtimeErr := response["error"].(map[string]any)
	if runtimeErr["code"] != "not_initialized" {
		t.Fatalf("error = %#v", runtimeErr)
	}
}

func TestRuntimeWritesResponsesAndNotificationsThroughWebSocket(t *testing.T) {
	cfg := DefaultConfig()
	server, httpServer := testServer(cfg)
	defer httpServer.Close()

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), nil)
	if err != nil {
		t.Fatalf("dial runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeRequest(t, conn, `{"id":1,"method":"initialize","params":{"protocolVersion":1}}`)
	response := readResponse(t, conn)
	if _, ok := response["result"].(map[string]any); !ok {
		t.Fatalf("initialize response = %#v", response)
	}

	server.Runtime.Notify("connection/lagged", map[string]any{"reason": "test"})
	notification := readResponse(t, conn)
	if notification["method"] != "connection/lagged" || notification["id"] != nil {
		t.Fatalf("notification = %#v", notification)
	}

	writeRequest(t, conn, `{"id":2,"method":"server/status/read"}`)
	status := readResponse(t, conn)
	if status["id"] != float64(2) {
		t.Fatalf("status response = %#v", status)
	}
	if _, ok := status["result"].(map[string]any); !ok {
		t.Fatalf("status result = %#v", status)
	}
}

func TestRuntimeFiltersCapabilitiesByPermission(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Permissions = []string{"initialize", "server/status/read"}
	_, httpServer := testServer(cfg)
	defer httpServer.Close()

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), nil)
	if err != nil {
		t.Fatalf("dial runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeRequest(t, conn, `{"id":1,"method":"initialize","params":{"protocolVersion":1}}`)
	response := readResponse(t, conn)
	result := response["result"].(map[string]any)
	capabilities := result["capabilities"].(map[string]any)
	methods := capabilities["methods"].([]any)
	got := map[string]bool{}
	for _, method := range methods {
		got[method.(string)] = true
	}
	if !got["initialize"] || !got["server/status/read"] {
		t.Fatalf("missing allowed methods: %#v", got)
	}
	if got["subscription/update"] {
		t.Fatalf("unexpected denied method in capabilities: %#v", got)
	}
}

func TestSlowRequestSeparatesQueueAndHandlerTime(t *testing.T) {
	cfg := DefaultConfig()
	cfg.SlowRequestThreshold = 0
	runtime := NewRuntime(cfg, slog.New(slog.NewTextHandler(&strings.Builder{}, nil)))
	events := []SlowRequestEvent{}
	runtime.SetSlowRequestObserver(func(event SlowRequestEvent) {
		events = append(events, event)
	})
	runtime.Register("test/slow", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		time.Sleep(5 * time.Millisecond)
		return map[string]bool{"ok": true}, nil
	})
	conn := runtime.NewConnection(nil)
	conn.initialized = true
	queuedAt := time.Now().Add(-10 * time.Millisecond)
	response := runtime.HandleRequest(context.Background(), conn, RuntimeRequest{
		ID:     stringRequestID("slow"),
		Method: "test/slow",
	}, queuedAt)

	if response.Error != nil {
		t.Fatalf("unexpected error: %#v", response.Error)
	}
	if len(events) != 1 {
		t.Fatalf("slow events = %#v", events)
	}
	if events[0].QueueWait <= 0 || events[0].Handler <= 0 {
		t.Fatalf("slow event did not separate timings: %#v", events[0])
	}
	if events[0].Service != DefaultServerName || events[0].Method != "test/slow" || events[0].RequestID != "slow" {
		t.Fatalf("slow event identity fields = %#v", events[0])
	}
}

func TestSlowRequestDefaultLoggerIncludesSanitizedOperationalFields(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ServerName = "openade-core-test"
	cfg.SlowRequestThreshold = 0
	var logs strings.Builder
	runtime := NewRuntime(cfg, slog.New(slog.NewTextHandler(&logs, nil)))
	runtime.Register("test/slow", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		return map[string]bool{"ok": true}, nil
	})
	conn := runtime.NewConnection(nil)
	conn.initialized = true
	rawRequestID := "slow\nrequest-" + strings.Repeat("x", 100)
	response := runtime.HandleRequest(context.Background(), conn, RuntimeRequest{
		ID:     stringRequestID(rawRequestID),
		Method: "test/slow",
	}, time.Now().Add(-time.Millisecond))

	if response.Error != nil {
		t.Fatalf("unexpected error: %#v", response.Error)
	}
	logged := logs.String()
	for _, expected := range []string{
		"runtime request slow",
		"service=openade-core-test",
		"method=test/slow",
		"requestId=slow?request-",
		"durationMs=",
		"queueWaitMs=",
		"handlerMs=",
		"connectionId=go:1",
		"failed=false",
	} {
		if !strings.Contains(logged, expected) {
			t.Fatalf("slow log missing %q: %s", expected, logged)
		}
	}
	if strings.Contains(logged, rawRequestID) || strings.Contains(logged, strings.Repeat("x", 100)) {
		t.Fatalf("slow log leaked raw request id: %s", logged)
	}
}
