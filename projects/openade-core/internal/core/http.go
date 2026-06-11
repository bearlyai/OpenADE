package core

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const pairMaxBodyBytes = 64 * 1024
const pairRateLimitWindow = time.Minute
const pairRateLimitMaxAttempts = 20

type HTTPServer struct {
	Config             Config
	Runtime            *Runtime
	Logger             *slog.Logger
	AuthenticateBearer func(context.Context, string) (ConnectionAuth, bool)
	PairDevice         func(context.Context, PairDeviceRequest) (JSONPayload, *RuntimeError)
	pairMu             sync.Mutex
	pairAttempts       map[string]pairAttempt
}

type ConnectionAuth struct {
	Permissions []string
	DeviceID    string
}

type PairDeviceRequest struct {
	Token      string `json:"token"`
	DeviceName string `json:"deviceName"`
	Platform   string `json:"platform"`
}

type pairAttempt struct {
	Count   int
	ResetAt time.Time
}

type healthResponse struct {
	OK bool `json:"ok"`
}

type versionResponse struct {
	ServerName      string `json:"serverName"`
	ServerVersion   string `json:"serverVersion"`
	ProtocolVersion int    `json:"protocolVersion"`
}

type outboundRuntimeMessage interface {
	outboundRuntimeMessage()
}

type runtimeCloseMessage struct {
	Reason string
}

func (message runtimeCloseMessage) outboundRuntimeMessage() {}

type inboundRuntimeRequest struct {
	Data     []byte
	QueuedAt time.Time
}

func NewHTTPServer(cfg Config, logger *slog.Logger) *HTTPServer {
	if logger == nil {
		logger = slog.Default()
	}
	runtime := NewRuntime(cfg, logger)
	return &HTTPServer{
		Config:       cfg,
		Runtime:      runtime,
		Logger:       logger,
		pairAttempts: map[string]pairAttempt{},
	}
}

func (server *HTTPServer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodOptions {
		server.writeNoContent(response)
		return
	}
	switch request.URL.Path {
	case "/healthz":
		server.writeJSON(response, http.StatusOK, healthResponse{OK: true})
	case "/v1/health":
		server.writeJSON(response, http.StatusOK, healthResponse{OK: true})
	case "/version":
		server.writeJSON(response, http.StatusOK, versionResponse{
			ServerName:      server.Config.ServerName,
			ServerVersion:   server.Config.ServerVersion,
			ProtocolVersion: server.Config.ProtocolVersion,
		})
	case "/pair":
		server.writeHTML(response, http.StatusOK, pairingPage(request))
	case "/v1/pair":
		server.servePair(response, request)
	case server.Config.RuntimePath:
		server.serveRuntime(response, request)
	default:
		http.NotFound(response, request)
	}
}

func (server *HTTPServer) writeNoContent(response http.ResponseWriter) {
	server.writeCORSHeaders(response)
	response.WriteHeader(http.StatusNoContent)
}

// openade-allow-explicit-any: net/http JSON responses encode several concrete DTO types through one helper.
func (server *HTTPServer) writeJSON(response http.ResponseWriter, status int, value interface{}) {
	server.writeCORSHeaders(response)
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func (server *HTTPServer) writeHTML(response http.ResponseWriter, status int, body string) {
	response.Header().Set("content-type", "text/html; charset=utf-8")
	response.WriteHeader(status)
	_, _ = response.Write([]byte(body))
}

func (server *HTTPServer) writePairError(response http.ResponseWriter, status int, message string) {
	server.writeJSON(response, status, map[string]string{"error": message})
}

func (server *HTTPServer) writeCORSHeaders(response http.ResponseWriter) {
	response.Header().Set("access-control-allow-origin", "*")
	response.Header().Set("access-control-allow-headers", "authorization, content-type")
	response.Header().Set("access-control-allow-methods", "GET, POST, OPTIONS")
}

func (server *HTTPServer) serveRuntime(response http.ResponseWriter, request *http.Request) {
	auth, ok := server.authorize(request)
	if !ok {
		http.Error(response, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(response, request, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
		Subprotocols:   runtimeSubprotocols(request),
	})
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	runtimeConn := server.Runtime.NewConnection(auth.Permissions)
	runtimeConn.SetDeviceID(auth.DeviceID)
	defer server.Runtime.RemoveConnection(runtimeConn)

	writeMessages := make(chan outboundRuntimeMessage, 64)
	runtimeConn.SetSender(func(notification RuntimeNotification) {
		select {
		case writeMessages <- notification:
		default:
			server.Logger.Warn("runtime client is too far behind", "connectionId", runtimeConn.ID)
			_ = conn.Close(websocket.StatusPolicyViolation, "client is too far behind")
		}
	})
	runtimeConn.SetCloser(func(reason string) {
		select {
		case writeMessages <- runtimeCloseMessage{Reason: reason}:
		default:
			_ = conn.Close(websocket.StatusPolicyViolation, reason)
		}
	})

	ctx := request.Context()
	errs := make(chan error, 3)
	requests := make(chan inboundRuntimeRequest, 64)
	go server.writeLoop(ctx, conn, writeMessages, errs)
	go server.readLoop(ctx, conn, requests, errs)
	go server.handleRuntimeRequests(ctx, runtimeConn, requests, writeMessages, errs)

	<-errs
}

func (server *HTTPServer) servePair(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		server.writePairError(response, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if server.PairDevice == nil {
		server.writePairError(response, http.StatusNotFound, "Pairing is not available")
		return
	}
	if !server.allowPairAttempt(request) {
		server.writePairError(response, http.StatusTooManyRequests, "Too many pairing attempts")
		return
	}
	var pairRequest PairDeviceRequest
	request.Body = http.MaxBytesReader(response, request.Body, pairMaxBodyBytes)
	if err := json.NewDecoder(request.Body).Decode(&pairRequest); err != nil {
		if errors.Is(err, io.EOF) {
			server.writePairError(response, http.StatusBadRequest, "Request body is required")
			return
		}
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			server.writePairError(response, http.StatusRequestEntityTooLarge, "Request body is too large")
			return
		}
		server.writePairError(response, http.StatusBadRequest, "Request body must be JSON")
		return
	}
	result, runtimeErr := server.PairDevice(request.Context(), pairRequest)
	if runtimeErr != nil {
		server.writePairError(response, pairErrorStatus(runtimeErr), "Pairing failed")
		return
	}
	server.clearPairAttempts(request)
	server.writeJSON(response, http.StatusOK, result)
}

func (server *HTTPServer) readLoop(ctx context.Context, socket *websocket.Conn, requests chan<- inboundRuntimeRequest, errs chan<- error) {
	defer close(requests)
	for {
		messageType, data, err := socket.Read(ctx)
		if err != nil {
			errs <- err
			return
		}
		if messageType != websocket.MessageText {
			continue
		}

		message := inboundRuntimeRequest{
			Data:     append([]byte(nil), data...),
			QueuedAt: time.Now(),
		}
		select {
		case <-ctx.Done():
			errs <- ctx.Err()
			return
		case requests <- message:
		}
	}
}

func (server *HTTPServer) handleRuntimeRequests(
	ctx context.Context,
	runtimeConn *Connection,
	requests <-chan inboundRuntimeRequest,
	writeMessages chan<- outboundRuntimeMessage,
	errs chan<- error,
) {
	for {
		var message inboundRuntimeRequest
		var ok bool
		select {
		case <-ctx.Done():
			errs <- ctx.Err()
			return
		case message, ok = <-requests:
			if !ok {
				return
			}
		}

		started := time.Now()
		request, runtimeErr := DecodeRuntimeRequest(message.Data)
		var response runtimeResponse
		if runtimeErr != nil {
			response = server.Runtime.HandleProtocolError(runtimeConn, request, message.QueuedAt, started, runtimeErr)
		} else {
			response = server.Runtime.HandleRequest(ctx, runtimeConn, request, message.QueuedAt)
		}
		if err := enqueueRuntimeMessage(ctx, writeMessages, response); err != nil {
			errs <- err
			return
		}
		if reason := runtimeConn.consumeCloseAfterResponse(); reason != "" {
			if err := enqueueRuntimeMessage(ctx, writeMessages, runtimeCloseMessage{Reason: reason}); err != nil {
				errs <- err
			}
			return
		}
	}
}

func (server *HTTPServer) writeLoop(ctx context.Context, socket *websocket.Conn, messages <-chan outboundRuntimeMessage, errs chan<- error) {
	for {
		select {
		case <-ctx.Done():
			errs <- ctx.Err()
			return
		case message := <-messages:
			if closeMessage, ok := message.(runtimeCloseMessage); ok {
				_ = socket.Close(websocket.StatusPolicyViolation, closeMessage.Reason)
				errs <- errors.New("runtime connection closed")
				return
			}
			if err := writeRuntimeMessage(ctx, socket, message); err != nil {
				errs <- err
				return
			}
		}
	}
}

func enqueueRuntimeMessage(ctx context.Context, messages chan<- outboundRuntimeMessage, value outboundRuntimeMessage) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case messages <- value:
		return nil
	}
}

func writeRuntimeMessage(ctx context.Context, socket *websocket.Conn, value outboundRuntimeMessage) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return socket.Write(ctx, websocket.MessageText, data)
}

func (server *HTTPServer) authorize(request *http.Request) (ConnectionAuth, bool) {
	token := tokenFromRequest(request)
	if server.Config.Token != "" {
		if token == server.Config.Token {
			return ConnectionAuth{Permissions: server.Config.Permissions}, true
		}
		if token != "" && server.AuthenticateBearer != nil {
			return server.AuthenticateBearer(request.Context(), token)
		}
		return ConnectionAuth{}, false
	}
	if token != "" && server.AuthenticateBearer != nil {
		if auth, ok := server.AuthenticateBearer(request.Context(), token); ok {
			return auth, true
		}
	}
	if server.Config.AllowUnauthenticatedLoopback && isLoopbackRemote(request.RemoteAddr) {
		return ConnectionAuth{Permissions: server.Config.Permissions}, true
	}
	return ConnectionAuth{}, false
}

func (server *HTTPServer) allowPairAttempt(request *http.Request) bool {
	now := time.Now().UTC()
	key := pairAttemptKey(request)
	server.pairMu.Lock()
	defer server.pairMu.Unlock()
	current := server.pairAttempts[key]
	if current.ResetAt.IsZero() || !current.ResetAt.After(now) {
		server.pairAttempts[key] = pairAttempt{Count: 1, ResetAt: now.Add(pairRateLimitWindow)}
		return true
	}
	if current.Count >= pairRateLimitMaxAttempts {
		return false
	}
	current.Count++
	server.pairAttempts[key] = current
	return true
}

func (server *HTTPServer) clearPairAttempts(request *http.Request) {
	server.pairMu.Lock()
	defer server.pairMu.Unlock()
	delete(server.pairAttempts, pairAttemptKey(request))
}

func pairAttemptKey(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if request.RemoteAddr != "" {
		return request.RemoteAddr
	}
	return "unknown"
}

func pairErrorStatus(runtimeErr *RuntimeError) int {
	switch runtimeErr.Code {
	case "invalid_params":
		return http.StatusBadRequest
	case "permission_denied":
		return http.StatusForbidden
	case "not_found":
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

func tokenFromRequest(request *http.Request) string {
	header := request.Header.Get("sec-websocket-protocol")
	for _, protocol := range strings.Split(header, ",") {
		trimmed := strings.TrimSpace(protocol)
		if strings.HasPrefix(trimmed, "bearer.") {
			return strings.TrimPrefix(trimmed, "bearer.")
		}
	}
	return ""
}

func runtimeSubprotocols(request *http.Request) []string {
	header := request.Header.Get("sec-websocket-protocol")
	for _, protocol := range strings.Split(header, ",") {
		trimmed := strings.TrimSpace(protocol)
		if strings.HasPrefix(trimmed, "bearer.") {
			return []string{trimmed}
		}
	}
	return nil
}

func pairingPage(request *http.Request) string {
	token := request.URL.Query().Get("token")
	return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenADE Companion Pairing</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111; background: #fff; }
        code { display: block; padding: 10px; border: 1px solid #ddd; overflow-wrap: anywhere; }
    </style>
</head>
<body>
    <h1>OpenADE Companion Pairing</h1>
    <p>Open the OpenADE Companion app, tap Scan QR, or enter these values manually.</p>
    <h2>Host</h2>
    <code>` + html.EscapeString(request.Host) + `</code>
    <h2>Pairing token</h2>
    <code>` + html.EscapeString(token) + `</code>
</body>
</html>`
}

func isLoopbackRemote(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func ListenAndServe(ctx context.Context, cfg Config, logger *slog.Logger) (*http.Server, string, error) {
	handler := NewHTTPServer(cfg, logger)
	return ListenAndServeHandler(ctx, cfg, logger, handler)
}

func ListenAndServeHandler(ctx context.Context, cfg Config, logger *slog.Logger, handler http.Handler) (*http.Server, string, error) {
	httpServer := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	listener, err := net.Listen("tcp", httpServer.Addr)
	if err != nil {
		return nil, "", err
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()
	go func() {
		if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) && logger != nil {
			logger.Error("openade core http server failed", "error", err)
		}
	}()
	address := listener.Addr().(*net.TCPAddr)
	return httpServer, "ws://" + net.JoinHostPort(cfg.Host, strconv.Itoa(address.Port)) + cfg.RuntimePath, nil
}
