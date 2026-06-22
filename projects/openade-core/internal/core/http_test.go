package core

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
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

func readResponseWithTimeout(t *testing.T, conn *websocket.Conn, timeout time.Duration) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	_, data, err := conn.Read(ctx)
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

func TestRuntimeWebSocketIdleTimeDoesNotCountAsQueueWait(t *testing.T) {
	cfg := DefaultConfig()
	cfg.SlowRequestThreshold = 150 * time.Millisecond
	server, httpServer := testServer(cfg)
	defer httpServer.Close()

	events := make(chan SlowRequestEvent, 4)
	server.Runtime.SetSlowRequestObserver(func(event SlowRequestEvent) {
		events <- event
	})
	server.Runtime.Register("test/fast", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		return map[string]bool{"ok": true}, nil
	})

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), nil)
	if err != nil {
		t.Fatalf("dial runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeRequest(t, conn, `{"id":1,"method":"initialize","params":{"protocolVersion":1}}`)
	if response := readResponse(t, conn); response["error"] != nil {
		t.Fatalf("initialize response = %#v", response)
	}
	time.Sleep(250 * time.Millisecond)

	writeRequest(t, conn, `{"id":2,"method":"test/fast"}`)
	response := readResponse(t, conn)
	if response["error"] != nil {
		t.Fatalf("fast response = %#v", response)
	}
	select {
	case event := <-events:
		t.Fatalf("idle websocket time was reported as a slow request: %#v", event)
	default:
	}
}

func TestRuntimeWebSocketRunsTrustedLocalRequestsConcurrently(t *testing.T) {
	cfg := DefaultConfig()
	cfg.SlowRequestThreshold = 20 * time.Millisecond
	server, httpServer := testServer(cfg)
	defer httpServer.Close()

	events := make(chan SlowRequestEvent, 4)
	server.Runtime.SetSlowRequestObserver(func(event SlowRequestEvent) {
		events <- event
	})
	server.Runtime.Register("test/slow", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		time.Sleep(120 * time.Millisecond)
		return map[string]bool{"ok": true}, nil
	})
	server.Runtime.Register("test/fast", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		return map[string]bool{"ok": true}, nil
	})

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), nil)
	if err != nil {
		t.Fatalf("dial runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeRequest(t, conn, `{"id":1,"method":"initialize","params":{"protocolVersion":1}}`)
	if response := readResponse(t, conn); response["error"] != nil {
		t.Fatalf("initialize response = %#v", response)
	}

	writeRequest(t, conn, `{"id":2,"method":"test/slow"}`)
	writeRequest(t, conn, `{"id":3,"method":"test/fast"}`)
	fastResponse := readResponse(t, conn)
	slowResponse := readResponse(t, conn)
	if fastResponse["id"] != float64(3) || fastResponse["error"] != nil {
		t.Fatalf("fast response = %#v", fastResponse)
	}
	if slowResponse["id"] != float64(2) || slowResponse["error"] != nil {
		t.Fatalf("slow response = %#v", slowResponse)
	}

	var slowEvent *SlowRequestEvent
	deadline := time.After(time.Second)
	for slowEvent == nil {
		select {
		case event := <-events:
			if event.Method == "test/fast" {
				t.Fatalf("fast request should not wait behind slow handler: %#v", event)
			}
			if event.Method == "test/slow" {
				copied := event
				slowEvent = &copied
			}
		case <-deadline:
			t.Fatal("timed out waiting for slow request event")
		}
	}
	if slowEvent.QueueWait > 50*time.Millisecond || slowEvent.Handler < 75*time.Millisecond {
		t.Fatalf("slow request timing should be handler-bound, not queue-bound: %#v", slowEvent)
	}
	if slowEvent.DominantPhase != "handler" {
		t.Fatalf("slow request dominant phase = %q, event = %#v", slowEvent.DominantPhase, slowEvent)
	}
}

func TestRuntimeWebSocketTrustedLocalSaturatedDispatcherReportsQueueWait(t *testing.T) {
	cfg := DefaultConfig()
	cfg.SlowRequestThreshold = 20 * time.Millisecond
	server, httpServer := testServer(cfg)
	defer httpServer.Close()

	events := make(chan SlowRequestEvent, maxConcurrentRuntimeRequests+4)
	server.Runtime.SetSlowRequestObserver(func(event SlowRequestEvent) {
		events <- event
	})
	startedBlocks := make(chan struct{}, maxConcurrentRuntimeRequests)
	releaseBlocks := make(chan struct{})
	server.Runtime.Register("test/block", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		startedBlocks <- struct{}{}
		<-releaseBlocks
		return map[string]bool{"ok": true}, nil
	})
	server.Runtime.Register("test/fast", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		return map[string]bool{"ok": true}, nil
	})

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), nil)
	if err != nil {
		t.Fatalf("dial runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeRequest(t, conn, `{"id":1,"method":"initialize","params":{"protocolVersion":1}}`)
	if response := readResponseWithTimeout(t, conn, time.Second); response["error"] != nil {
		t.Fatalf("initialize response = %#v", response)
	}

	for i := 0; i < maxConcurrentRuntimeRequests; i++ {
		writeRequest(t, conn, `{"id":`+strconv.Itoa(10+i)+`,"method":"test/block"}`)
	}
	for i := 0; i < maxConcurrentRuntimeRequests; i++ {
		select {
		case <-startedBlocks:
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for blocking handler %d", i)
		}
	}

	writeRequest(t, conn, `{"id":"queued-fast","method":"test/fast"}`)
	time.Sleep(120 * time.Millisecond)
	close(releaseBlocks)

	var fastResponse map[string]any
	deadline := time.After(time.Second)
	for fastResponse == nil {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for queued fast response")
		default:
			response := readResponseWithTimeout(t, conn, time.Second)
			if response["id"] == "queued-fast" {
				fastResponse = response
			}
		}
	}
	if fastResponse["error"] != nil {
		t.Fatalf("queued fast response = %#v", fastResponse)
	}

	var fastEvent *SlowRequestEvent
	for fastEvent == nil {
		select {
		case event := <-events:
			if event.RequestID == "queued-fast" {
				copied := event
				fastEvent = &copied
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for queued fast slow-event")
		}
	}
	if fastEvent.QueueWait < 75*time.Millisecond {
		t.Fatalf("queued fast request did not report dispatcher wait as queue time: %#v", fastEvent)
	}
	if fastEvent.Handler >= fastEvent.QueueWait {
		t.Fatalf("queued fast request timing did not separate queue and handler time: %#v", fastEvent)
	}
	if fastEvent.DominantPhase != "queue_wait" {
		t.Fatalf("queued fast request dominant phase = %q, event = %#v", fastEvent.DominantPhase, fastEvent)
	}
}

func TestRuntimeWebSocketPairedDeviceRequestsStaySequential(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Token = "trusted-token"
	cfg.SlowRequestThreshold = 20 * time.Millisecond
	server, httpServer := testServer(cfg)
	defer httpServer.Close()
	server.AuthenticateBearer = func(_ context.Context, token string) (ConnectionAuth, bool) {
		if token != "device-token" {
			return ConnectionAuth{}, false
		}
		return ConnectionAuth{DeviceID: "device-1"}, true
	}

	events := make(chan SlowRequestEvent, 4)
	server.Runtime.SetSlowRequestObserver(func(event SlowRequestEvent) {
		events <- event
	})
	server.Runtime.Register("test/slow", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		time.Sleep(120 * time.Millisecond)
		return map[string]bool{"ok": true}, nil
	})
	server.Runtime.Register("test/fast", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		return map[string]bool{"ok": true}, nil
	})

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer.device-token"},
	})
	if err != nil {
		t.Fatalf("dial paired runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeRequest(t, conn, `{"id":1,"method":"initialize","params":{"protocolVersion":1}}`)
	if response := readResponse(t, conn); response["error"] != nil {
		t.Fatalf("initialize response = %#v", response)
	}

	writeRequest(t, conn, `{"id":2,"method":"test/slow"}`)
	writeRequest(t, conn, `{"id":3,"method":"test/fast"}`)
	slowResponse := readResponse(t, conn)
	fastResponse := readResponse(t, conn)
	if slowResponse["id"] != float64(2) || slowResponse["error"] != nil {
		t.Fatalf("slow response = %#v", slowResponse)
	}
	if fastResponse["id"] != float64(3) || fastResponse["error"] != nil {
		t.Fatalf("fast response = %#v", fastResponse)
	}

	var fastEvent *SlowRequestEvent
	deadline := time.After(time.Second)
	for fastEvent == nil {
		select {
		case event := <-events:
			if event.Method == "test/fast" {
				copied := event
				fastEvent = &copied
			}
		case <-deadline:
			t.Fatal("timed out waiting for fast request slow-event")
		}
	}
	if fastEvent.QueueWait < 75*time.Millisecond {
		t.Fatalf("fast request queue wait did not include the slow handler ahead of it: %#v", fastEvent)
	}
	if fastEvent.Duration < fastEvent.QueueWait {
		t.Fatalf("fast request duration is less than queue wait: %#v", fastEvent)
	}
}

func TestRuntimeWebSocketProtocolErrorsEmitSlowRequestEvents(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Token = "trusted-token"
	cfg.SlowRequestThreshold = 20 * time.Millisecond
	server, httpServer := testServer(cfg)
	defer httpServer.Close()
	server.AuthenticateBearer = func(_ context.Context, token string) (ConnectionAuth, bool) {
		if token != "device-token" {
			return ConnectionAuth{}, false
		}
		return ConnectionAuth{DeviceID: "device-1"}, true
	}

	events := make(chan SlowRequestEvent, 4)
	server.Runtime.SetSlowRequestObserver(func(event SlowRequestEvent) {
		events <- event
	})
	server.Runtime.Register("test/slow", func(_ context.Context, _ *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
		time.Sleep(120 * time.Millisecond)
		return map[string]bool{"ok": true}, nil
	})

	conn, _, err := websocket.Dial(context.Background(), wsURL(httpServer.URL, cfg.RuntimePath), &websocket.DialOptions{
		Subprotocols: []string{"bearer.device-token"},
	})
	if err != nil {
		t.Fatalf("dial runtime websocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeRequest(t, conn, `{"id":1,"method":"initialize","params":{"protocolVersion":1}}`)
	if response := readResponse(t, conn); response["error"] != nil {
		t.Fatalf("initialize response = %#v", response)
	}

	writeRequest(t, conn, `{"id":2,"method":"test/slow"}`)
	writeRequest(t, conn, `{`)
	if response := readResponse(t, conn); response["id"] != float64(2) || response["error"] != nil {
		t.Fatalf("slow response = %#v", response)
	}
	protocolResponse := readResponse(t, conn)
	if protocolResponse["id"] != "invalid-message" {
		t.Fatalf("protocol response id = %#v", protocolResponse)
	}
	errorObject, ok := protocolResponse["error"].(map[string]any)
	if !ok || errorObject["code"] != "invalid_request" {
		t.Fatalf("protocol response error = %#v", protocolResponse)
	}

	var protocolEvent *SlowRequestEvent
	deadline := time.After(time.Second)
	for protocolEvent == nil {
		select {
		case event := <-events:
			if event.Method == protocolDecodeMethod {
				copied := event
				protocolEvent = &copied
			}
		case <-deadline:
			t.Fatal("timed out waiting for protocol error slow-event")
		}
	}
	if protocolEvent.Service != DefaultServerName || protocolEvent.RequestID != "invalid-message" || protocolEvent.Connection != "go:1" {
		t.Fatalf("protocol slow-event identity = %#v", protocolEvent)
	}
	if !protocolEvent.Failed || protocolEvent.ErrorCode != "invalid_request" {
		t.Fatalf("protocol slow-event failure state = %#v", protocolEvent)
	}
	if protocolEvent.QueueWait < 75*time.Millisecond {
		t.Fatalf("protocol slow-event did not include queue wait behind slow handler: %#v", protocolEvent)
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
	conn.SetInitialized(true)
	queuedAt := time.Now().Add(-10 * time.Millisecond)
	response := runtime.HandleRequest(context.Background(), conn, RuntimeRequest{
		ID:     stringRequestID("slow"),
		Method: "test/slow",
		Params: json.RawMessage(`{
			"repoId": "repo-1",
			"taskId": "task-1",
			"clientRequestId": "client-1\nretry",
			"path": "src/private/file.ts",
			"query": "secret query",
			"prompt": "do not log this prompt"
		}`),
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
	if events[0].DominantPhase != "queue_wait" {
		t.Fatalf("slow event dominant phase = %q, event = %#v", events[0].DominantPhase, events[0])
	}
	if events[0].Scope["repoId"] != "repo-1" ||
		events[0].Scope["taskId"] != "task-1" ||
		events[0].Scope["clientRequestId"] != "client-1?retry" ||
		events[0].Scope["pathDepth"] != 3 ||
		events[0].Scope["queryLength"] != 12 {
		t.Fatalf("slow event scope = %#v", events[0].Scope)
	}
	eventJSON, err := json.Marshal(events[0])
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	for _, leaked := range []string{"src/private/file.ts", "secret query", "do not log this prompt"} {
		if strings.Contains(string(eventJSON), leaked) {
			t.Fatalf("slow event leaked payload %q: %s", leaked, string(eventJSON))
		}
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
	conn.SetInitialized(true)
	rawRequestID := "slow\nrequest-" + strings.Repeat("x", 100)
	response := runtime.HandleRequest(context.Background(), conn, RuntimeRequest{
		ID:     stringRequestID(rawRequestID),
		Method: "test/slow",
		Params: json.RawMessage(`{
			"repoId": "repo-1",
			"path": "src/private/file.ts",
			"query": "secret query"
		}`),
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
		"dominantPhase=",
		"connectionId=go:1",
		"failed=false",
		"scope=",
		"repo-1",
		"pathDepth",
		"queryLength",
	} {
		if !strings.Contains(logged, expected) {
			t.Fatalf("slow log missing %q: %s", expected, logged)
		}
	}
	if strings.Contains(logged, rawRequestID) ||
		strings.Contains(logged, strings.Repeat("x", 100)) ||
		strings.Contains(logged, "src/private/file.ts") ||
		strings.Contains(logged, "secret query") {
		t.Fatalf("slow log leaked raw request id: %s", logged)
	}
}

func TestNotificationBurstObserverUsesNotificationMethodOnly(t *testing.T) {
	cfg := DefaultConfig()
	cfg.NotificationBurstWindow = time.Second
	cfg.NotificationBurstCount = 3
	runtime := NewRuntime(cfg, slog.New(slog.NewTextHandler(&strings.Builder{}, nil)))
	events := []NotificationBurstEvent{}
	runtime.SetNotificationBurstObserver(func(event NotificationBurstEvent) {
		events = append(events, event)
	})
	conn := runtime.NewConnection(nil)
	sent := []RuntimeNotification{}
	conn.SetSender(func(notification RuntimeNotification) {
		sent = append(sent, notification)
	})

	for i := 0; i < 3; i++ {
		runtime.Notify("openade/task/updated", map[string]string{
			"repoId": "repo-secret",
			"prompt": "do not log this prompt",
		})
	}

	if len(sent) != 3 {
		t.Fatalf("sent notifications = %#v", sent)
	}
	if len(events) != 1 {
		t.Fatalf("notification burst events = %#v", events)
	}
	if events[0].Service != DefaultServerName || events[0].Method != "openade/task/updated" || events[0].Count != 3 {
		t.Fatalf("notification burst event identity fields = %#v", events[0])
	}
	eventJSON, err := json.Marshal(events[0])
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	if strings.Contains(string(eventJSON), "repo-secret") || strings.Contains(string(eventJSON), "do not log this prompt") {
		t.Fatalf("notification burst event leaked payload: %s", string(eventJSON))
	}
}

func TestNotificationBurstDefaultLoggerIncludesSanitizedOperationalFields(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ServerName = "openade-core-test"
	cfg.NotificationBurstWindow = time.Second
	cfg.NotificationBurstCount = 2
	var logs strings.Builder
	runtime := NewRuntime(cfg, slog.New(slog.NewTextHandler(&logs, nil)))

	runtime.Notify("connection/lagged", map[string]string{"token": "secret-token"})
	runtime.Notify("connection/lagged", map[string]string{"token": "secret-token"})

	logged := logs.String()
	for _, expected := range []string{
		"runtime notification burst",
		"service=openade-core-test",
		"method=connection/lagged",
		"count=2",
		"windowMs=",
	} {
		if !strings.Contains(logged, expected) {
			t.Fatalf("notification burst log missing %q: %s", expected, logged)
		}
	}
	if strings.Contains(logged, "secret-token") {
		t.Fatalf("notification burst log leaked payload: %s", logged)
	}
}
