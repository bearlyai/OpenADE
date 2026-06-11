package core

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Handler func(context.Context, *Connection, json.RawMessage) (JSONPayload, *RuntimeError)

type SlowRequestEvent struct {
	Service    string
	Method     string
	RequestID  string
	Duration   time.Duration
	QueueWait  time.Duration
	Handler    time.Duration
	Connection string
	Failed     bool
	ErrorCode  string
}

type NotificationBurstEvent struct {
	Service string
	Method  string
	Count   int
	Window  time.Duration
}

const protocolDecodeMethod = "protocol/decode"

type notificationBurstEntry struct {
	startedAt       time.Time
	count           int
	lastWarnedCount int
}

type Capabilities struct {
	Methods        []string        `json:"methods"`
	Notifications  []string        `json:"notifications"`
	AgentProviders []AgentProvider `json:"agentProviders"`
}

type AgentProvider struct{}

type InitializeResult struct {
	ProtocolVersion int          `json:"protocolVersion"`
	ServerName      string       `json:"serverName"`
	ServerVersion   string       `json:"serverVersion,omitempty"`
	Capabilities    Capabilities `json:"capabilities"`
}

type ServerStatusResult struct {
	InitializeResult
	ConnectionCount int `json:"connectionCount"`
}

type Runtime struct {
	cfg                 Config
	logger              *slog.Logger
	handlers            map[string]Handler
	notifications       map[string]struct{}
	mu                  sync.RWMutex
	connections         map[*Connection]struct{}
	nextConnID          int64
	nextCursor          int64
	notificationLog     []RuntimeNotification
	onSlowRequest       func(SlowRequestEvent)
	onNotificationBurst func(NotificationBurstEvent)
	notificationBursts  map[string]notificationBurstEntry
}

func NewRuntime(cfg Config, logger *slog.Logger) *Runtime {
	if logger == nil {
		logger = slog.Default()
	}
	rt := &Runtime{
		cfg:                cfg,
		logger:             logger,
		handlers:           map[string]Handler{},
		notifications:      map[string]struct{}{},
		connections:        map[*Connection]struct{}{},
		notificationLog:    []RuntimeNotification{},
		notificationBursts: map[string]notificationBurstEntry{},
	}
	rt.onSlowRequest = rt.logSlowRequest
	rt.onNotificationBurst = rt.logNotificationBurst

	rt.Register("initialize", rt.handleInitialize)
	rt.Register("server/status/read", rt.handleServerStatus)
	rt.Register("subscription/update", rt.handleSubscriptionUpdate)
	rt.RegisterNotification("connection/lagged")
	return rt
}

func (rt *Runtime) SetSlowRequestObserver(observer func(SlowRequestEvent)) {
	if observer == nil {
		rt.onSlowRequest = rt.logSlowRequest
		return
	}
	rt.onSlowRequest = observer
}

func (rt *Runtime) SetNotificationBurstObserver(observer func(NotificationBurstEvent)) {
	if observer == nil {
		rt.onNotificationBurst = rt.logNotificationBurst
		return
	}
	rt.onNotificationBurst = observer
}

func (rt *Runtime) Register(method string, handler Handler) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.handlers[method] = handler
}

func (rt *Runtime) RegisterNotification(method string) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.notifications[method] = struct{}{}
}

func (rt *Runtime) NewConnection(permissions []string) *Connection {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.nextConnID++
	conn := &Connection{
		ID:            "go:" + strconv.FormatInt(rt.nextConnID, 10),
		runtime:       rt,
		permissions:   append([]string(nil), permissions...),
		subscriptions: map[string]struct{}{"*": {}},
	}
	rt.connections[conn] = struct{}{}
	return conn
}

func (rt *Runtime) RemoveConnection(conn *Connection) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	delete(rt.connections, conn)
}

func (rt *Runtime) CloseDeviceConnections(deviceID string, reason string) int {
	return rt.CloseDeviceConnectionsExcept(deviceID, nil, reason)
}

func (rt *Runtime) CloseDeviceConnectionsExcept(deviceID string, except *Connection, reason string) int {
	rt.mu.RLock()
	connections := []*Connection{}
	for conn := range rt.connections {
		if conn == except {
			continue
		}
		connDeviceID := conn.DeviceID()
		if connDeviceID == "" {
			continue
		}
		if deviceID == "" || connDeviceID == deviceID {
			connections = append(connections, conn)
		}
	}
	rt.mu.RUnlock()

	for _, conn := range connections {
		conn.Close(reason)
	}
	return len(connections)
}

func (rt *Runtime) ConnectionCount() int {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return len(rt.connections)
}

func (rt *Runtime) HandleRequest(ctx context.Context, conn *Connection, request RuntimeRequest, queueStarted time.Time) runtimeResponse {
	started := time.Now()
	response := rt.handleRequest(ctx, conn, request)
	rt.recordSlowRequest(request, conn, queueStarted, started, response)
	return response
}

func (rt *Runtime) HandleProtocolError(conn *Connection, request RuntimeRequest, queueStarted time.Time, started time.Time, runtimeErr *RuntimeError) runtimeResponse {
	if request.Method == "" {
		request.Method = protocolDecodeMethod
	}
	response := runtimeResponse{ID: request.ID, Error: runtimeErr}
	rt.recordSlowRequest(request, conn, queueStarted, started, response)
	return response
}

func (rt *Runtime) handleRequest(ctx context.Context, conn *Connection, request RuntimeRequest) runtimeResponse {
	if request.Method != "initialize" && !conn.initialized {
		return runtimeResponse{ID: request.ID, Error: protocolError("not_initialized", "Call initialize before invoking runtime methods")}
	}

	rt.mu.RLock()
	handler := rt.handlers[request.Method]
	rt.mu.RUnlock()
	if handler == nil {
		return runtimeResponse{ID: request.ID, Error: formattedHandlerError("method_not_found", "Unknown runtime method %s", request.Method)}
	}
	if !rt.canInvoke(request.Method, conn) {
		return runtimeResponse{ID: request.ID, Error: formattedHandlerError("permission_denied", "Not allowed to call runtime method %s", request.Method)}
	}

	result, err := handler(ctx, conn, request.Params)
	if err != nil {
		return runtimeResponse{ID: request.ID, Error: err}
	}
	if request.Method == "initialize" {
		conn.initialized = true
	}
	return runtimeResponse{ID: request.ID, Result: result}
}

func (rt *Runtime) Notify(method string, params JSONPayload) {
	rt.mu.Lock()
	rt.nextCursor++
	burstEvent := rt.recordNotificationBurstLocked(method, time.Now())
	notification := RuntimeNotification{
		Method: method,
		Params: params,
		Cursor: strconv.FormatInt(rt.nextCursor, 10),
	}
	rt.notificationLog = append(rt.notificationLog, notification)
	if len(rt.notificationLog) > 256 {
		rt.notificationLog = rt.notificationLog[len(rt.notificationLog)-256:]
	}
	connections := make([]*Connection, 0, len(rt.connections))
	for conn := range rt.connections {
		if rt.canReceiveNotificationLocked(method, conn) && conn.matchesSubscription(method) {
			connections = append(connections, conn)
		}
	}
	rt.mu.Unlock()

	if burstEvent != nil && rt.onNotificationBurst != nil {
		rt.onNotificationBurst(*burstEvent)
	}
	for _, conn := range connections {
		conn.Send(notification)
	}
}

func (rt *Runtime) recordNotificationBurstLocked(method string, now time.Time) *NotificationBurstEvent {
	if rt.cfg.NotificationBurstCount <= 0 || rt.cfg.NotificationBurstWindow <= 0 {
		return nil
	}
	burst, ok := rt.notificationBursts[method]
	if !ok || now.Sub(burst.startedAt) > rt.cfg.NotificationBurstWindow {
		burst = notificationBurstEntry{startedAt: now}
	}
	burst.count++

	var event *NotificationBurstEvent
	if burst.count >= rt.cfg.NotificationBurstCount && burst.count-burst.lastWarnedCount >= rt.cfg.NotificationBurstCount {
		burst.lastWarnedCount = burst.count
		event = &NotificationBurstEvent{
			Service: rt.serviceName(),
			Method:  method,
			Count:   burst.count,
			Window:  now.Sub(burst.startedAt),
		}
	}

	rt.notificationBursts[method] = burst
	return event
}

func (rt *Runtime) capabilitiesFor(conn *Connection) Capabilities {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	methods := make([]string, 0, len(rt.handlers))
	for method := range rt.handlers {
		if rt.canInvokeLocked(method, conn) {
			methods = append(methods, method)
		}
	}
	sort.Strings(methods)

	notifications := make([]string, 0, len(rt.notifications))
	for method := range rt.notifications {
		if rt.canReceiveNotificationLocked(method, conn) {
			notifications = append(notifications, method)
		}
	}
	sort.Strings(notifications)

	return Capabilities{
		Methods:        methods,
		Notifications:  notifications,
		AgentProviders: []AgentProvider{},
	}
}

func (rt *Runtime) baseInitializeResult(conn *Connection) InitializeResult {
	return InitializeResult{
		ProtocolVersion: rt.cfg.ProtocolVersion,
		ServerName:      rt.cfg.ServerName,
		ServerVersion:   rt.cfg.ServerVersion,
		Capabilities:    rt.capabilitiesFor(conn),
	}
}

func (rt *Runtime) handleInitialize(_ context.Context, conn *Connection, raw json.RawMessage) (JSONPayload, *RuntimeError) {
	var params struct {
		ProtocolVersion int `json:"protocolVersion"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, protocolError("invalid_params", "initialize params must be an object")
		}
	}
	if params.ProtocolVersion != 0 && params.ProtocolVersion != rt.cfg.ProtocolVersion {
		data, _ := json.Marshal(struct {
			ClientProtocolVersion int `json:"clientProtocolVersion"`
			ServerProtocolVersion int `json:"serverProtocolVersion"`
		}{
			ClientProtocolVersion: params.ProtocolVersion,
			ServerProtocolVersion: rt.cfg.ProtocolVersion,
		})
		return nil, &RuntimeError{
			Code:    "unsupported_protocol_version",
			Message: "Desktop update required: client protocol is not compatible with runtime protocol.",
			Data:    data,
		}
	}
	return rt.baseInitializeResult(conn), nil
}

func (rt *Runtime) handleServerStatus(_ context.Context, conn *Connection, _ json.RawMessage) (JSONPayload, *RuntimeError) {
	return ServerStatusResult{
		InitializeResult: rt.baseInitializeResult(conn),
		ConnectionCount:  rt.ConnectionCount(),
	}, nil
}

func (rt *Runtime) handleSubscriptionUpdate(_ context.Context, conn *Connection, raw json.RawMessage) (JSONPayload, *RuntimeError) {
	var params struct {
		Methods []string `json:"methods"`
		Cursor  string   `json:"cursor"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, protocolError("invalid_params", "subscription/update params must be an object")
		}
	}
	conn.setSubscriptions(params.Methods)
	if params.Cursor != "" {
		rt.replayNotifications(conn, params.Cursor)
	}
	return map[string]bool{"ok": true}, nil
}

func (rt *Runtime) replayNotifications(conn *Connection, cursor string) {
	requested, err := strconv.ParseInt(cursor, 10, 64)
	if err != nil {
		return
	}

	rt.mu.RLock()
	pending := []RuntimeNotification{}
	for _, notification := range rt.notificationLog {
		value, parseErr := strconv.ParseInt(notification.Cursor, 10, 64)
		if parseErr == nil && value > requested && rt.canReceiveNotificationLocked(notification.Method, conn) && conn.matchesSubscription(notification.Method) {
			pending = append(pending, notification)
		}
	}
	rt.mu.RUnlock()

	for _, notification := range pending {
		conn.Send(notification)
	}
}

func (rt *Runtime) canInvoke(method string, conn *Connection) bool {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.canInvokeLocked(method, conn)
}

func (rt *Runtime) canInvokeLocked(method string, conn *Connection) bool {
	if len(conn.permissions) == 0 {
		return true
	}
	for _, permission := range conn.permissions {
		if matchesPattern(method, permission) {
			return true
		}
	}
	return false
}

func (rt *Runtime) canReceiveNotificationLocked(method string, conn *Connection) bool {
	if len(conn.permissions) == 0 {
		return true
	}
	notificationPermission := "notify:" + method
	for _, permission := range conn.permissions {
		if matchesPattern(notificationPermission, permission) || matchesPattern(method, permission) {
			return true
		}
	}
	return false
}

func matchesPattern(value string, pattern string) bool {
	if pattern == "*" {
		return true
	}
	if pattern == value {
		return true
	}
	if strings.HasSuffix(pattern, "/*") {
		prefix := strings.TrimSuffix(pattern, "*")
		return strings.HasPrefix(value, prefix)
	}
	if strings.HasSuffix(pattern, "*") {
		prefix := strings.TrimSuffix(pattern, "*")
		return strings.HasPrefix(value, prefix)
	}
	return false
}

func (rt *Runtime) recordSlowRequest(request RuntimeRequest, conn *Connection, queuedAt time.Time, startedAt time.Time, response runtimeResponse) {
	if rt.onSlowRequest == nil || rt.cfg.SlowRequestThreshold < 0 {
		return
	}
	duration := time.Since(queuedAt)
	if duration < rt.cfg.SlowRequestThreshold {
		return
	}
	errorCode := ""
	if response.Error != nil {
		errorCode = response.Error.Code
	}
	event := SlowRequestEvent{
		Service:    rt.serviceName(),
		Method:     request.Method,
		RequestID:  request.ID.LogValue(),
		Duration:   duration,
		QueueWait:  startedAt.Sub(queuedAt),
		Handler:    time.Since(startedAt),
		Connection: conn.ID,
		Failed:     response.Error != nil,
		ErrorCode:  errorCode,
	}
	rt.onSlowRequest(event)
}

func (rt *Runtime) serviceName() string {
	if rt.cfg.ServerName != "" {
		return rt.cfg.ServerName
	}
	return DefaultServerName
}

func (rt *Runtime) logSlowRequest(event SlowRequestEvent) {
	if rt.logger == nil {
		return
	}
	rt.logger.Warn(
		"runtime request slow",
		"service", event.Service,
		"method", event.Method,
		"requestId", event.RequestID,
		"durationMs", event.Duration.Milliseconds(),
		"queueWaitMs", event.QueueWait.Milliseconds(),
		"handlerMs", event.Handler.Milliseconds(),
		"connectionId", event.Connection,
		"failed", event.Failed,
		"errorCode", event.ErrorCode,
	)
}

func (rt *Runtime) logNotificationBurst(event NotificationBurstEvent) {
	if rt.logger == nil {
		return
	}
	rt.logger.Warn(
		"runtime notification burst",
		"service", event.Service,
		"method", event.Method,
		"count", event.Count,
		"windowMs", event.Window.Milliseconds(),
	)
}

type Connection struct {
	ID            string
	runtime       *Runtime
	permissions   []string
	deviceID      string
	initialized   bool
	send          func(RuntimeNotification)
	close         func(string)
	closeReason   string
	subscriptions map[string]struct{}
	mu            sync.RWMutex
}

func (conn *Connection) Send(notification RuntimeNotification) {
	conn.mu.RLock()
	send := conn.send
	conn.mu.RUnlock()
	if send != nil {
		send(notification)
	}
}

func (conn *Connection) SetSender(send func(RuntimeNotification)) {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	conn.send = send
}

func (conn *Connection) SetCloser(close func(string)) {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	conn.close = close
}

func (conn *Connection) Close(reason string) {
	conn.mu.RLock()
	close := conn.close
	conn.mu.RUnlock()
	if close != nil {
		close(reason)
	}
}

func (conn *Connection) CloseAfterResponse(reason string) {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	conn.closeReason = reason
}

func (conn *Connection) consumeCloseAfterResponse() string {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	reason := conn.closeReason
	conn.closeReason = ""
	return reason
}

func (conn *Connection) SetDeviceID(deviceID string) {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	conn.deviceID = deviceID
}

func (conn *Connection) DeviceID() string {
	conn.mu.RLock()
	defer conn.mu.RUnlock()
	return conn.deviceID
}

func (conn *Connection) CanInvoke(method string) bool {
	if conn == nil || conn.runtime == nil {
		return true
	}
	return conn.runtime.canInvoke(method, conn)
}

func (conn *Connection) setSubscriptions(methods []string) {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	conn.subscriptions = map[string]struct{}{}
	if len(methods) == 0 {
		conn.subscriptions["*"] = struct{}{}
		return
	}
	for _, method := range methods {
		if method != "" {
			conn.subscriptions[method] = struct{}{}
		}
	}
}

func (conn *Connection) matchesSubscription(method string) bool {
	conn.mu.RLock()
	defer conn.mu.RUnlock()
	if _, ok := conn.subscriptions["*"]; ok {
		return true
	}
	if _, ok := conn.subscriptions[method]; ok {
		return true
	}
	for pattern := range conn.subscriptions {
		if matchesPattern(method, pattern) {
			return true
		}
	}
	return false
}
