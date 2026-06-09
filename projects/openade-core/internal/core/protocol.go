package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// JSONPayload is the dynamic part of the runtime wire envelope. Product and
// storage code should prefer concrete DTO structs or json.RawMessage.
// openade-allow-explicit-any: runtime JSON envelopes carry method-specific DTOs through one shared transport field.
type JSONPayload interface{}

type requestIDKind uint8

const (
	requestIDInvalid requestIDKind = iota
	requestIDString
	requestIDInteger
	requestIDFloat
)

type RequestID struct {
	kind         requestIDKind
	stringValue  string
	integerValue int64
	floatValue   float64
}

func stringRequestID(value string) RequestID {
	return RequestID{kind: requestIDString, stringValue: value}
}

func (id RequestID) MarshalJSON() ([]byte, error) {
	switch id.kind {
	case requestIDString:
		return json.Marshal(id.stringValue)
	case requestIDInteger:
		return json.Marshal(id.integerValue)
	case requestIDFloat:
		return json.Marshal(id.floatValue)
	default:
		return []byte(`"invalid-message"`), nil
	}
}

func (id RequestID) LogValue() string {
	switch id.kind {
	case requestIDString:
		return sanitizedLogValue(id.stringValue, 80)
	case requestIDInteger:
		return strconv.FormatInt(id.integerValue, 10)
	case requestIDFloat:
		return strconv.FormatFloat(id.floatValue, 'f', -1, 64)
	default:
		return "invalid-message"
	}
}

func sanitizedLogValue(value string, maxRunes int) string {
	var builder strings.Builder
	count := 0
	for _, char := range value {
		if count >= maxRunes {
			builder.WriteString("...")
			return builder.String()
		}
		if unicode.IsControl(char) {
			builder.WriteRune('?')
		} else {
			builder.WriteRune(char)
		}
		count++
	}
	return builder.String()
}

func (id *RequestID) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return errors.New("request id is required")
	}
	if trimmed[0] == '"' {
		var value string
		if err := json.Unmarshal(trimmed, &value); err != nil {
			return err
		}
		if value == "" {
			return errors.New("request id string must not be empty")
		}
		id.kind = requestIDString
		id.stringValue = value
		return nil
	}

	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	var value json.Number
	if err := decoder.Decode(&value); err != nil {
		return errors.New("request id must be a string or finite number")
	}
	num, err := strconv.ParseFloat(string(value), 64)
	if err != nil || math.IsNaN(num) || math.IsInf(num, 0) {
		return errors.New("request id number must be finite")
	}
	if math.Trunc(num) == num {
		integer, err := strconv.ParseInt(string(value), 10, 64)
		if err == nil {
			id.kind = requestIDInteger
			id.integerValue = integer
			return nil
		}
	}
	id.kind = requestIDFloat
	id.floatValue = num
	return nil
}

type RuntimeRequest struct {
	ID     RequestID       `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

type RuntimeError struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type runtimeResponse struct {
	ID     RequestID     `json:"id"`
	Result JSONPayload   `json:"-"`
	Error  *RuntimeError `json:"-"`
}

func (response runtimeResponse) outboundRuntimeMessage() {}

func (response runtimeResponse) MarshalJSON() ([]byte, error) {
	if response.Error != nil {
		return json.Marshal(struct {
			ID    RequestID     `json:"id"`
			Error *RuntimeError `json:"error"`
		}{
			ID:    response.ID,
			Error: response.Error,
		})
	}
	return json.Marshal(struct {
		ID     RequestID   `json:"id"`
		Result JSONPayload `json:"result"`
	}{
		ID:     response.ID,
		Result: response.Result,
	})
}

type RuntimeNotification struct {
	Method string      `json:"method"`
	Params JSONPayload `json:"params,omitempty"`
	Cursor string      `json:"cursor,omitempty"`
}

func (notification RuntimeNotification) outboundRuntimeMessage() {}

func DecodeRuntimeRequest(data []byte) (RuntimeRequest, *RuntimeError) {
	var request RuntimeRequest
	if err := json.Unmarshal(data, &request); err != nil {
		return RuntimeRequest{ID: stringRequestID("invalid-message")}, protocolError("invalid_request", "Runtime request must be valid JSON")
	}
	if request.ID.kind == requestIDInvalid {
		return RuntimeRequest{ID: stringRequestID("invalid-message")}, protocolError("invalid_request", "Runtime request id must be a string or finite number")
	}
	if request.Method == "" {
		return request, protocolError("invalid_request", "Runtime request method must be a non-empty string")
	}
	return request, nil
}

func protocolError(code string, message string) *RuntimeError {
	return &RuntimeError{Code: code, Message: message}
}

func formattedHandlerError(code string, message string, method string) *RuntimeError {
	return &RuntimeError{Code: code, Message: fmt.Sprintf(message, method)}
}
