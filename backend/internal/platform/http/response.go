// Package http centralizes transport-only behavior shared by every feature:
// strict JSON decoding, stable errors, request IDs, and browser CORS.
package http

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	stdhttp "net/http"
)

const MaxJSONBody = 64 << 10

var ErrJSONBodyTooLarge = errors.New("JSON body exceeds limit")

func DecodeJSON(request *stdhttp.Request, target any) error {
	raw, err := io.ReadAll(io.LimitReader(request.Body, MaxJSONBody+1))
	if err != nil {
		return err
	}
	if len(raw) > MaxJSONBody {
		return ErrJSONBodyTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("request must contain one JSON object")
	}
	return nil
}

func WriteJSON(writer stdhttp.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func WriteError(writer stdhttp.ResponseWriter, request *stdhttp.Request, status int, code, message string) {
	writer.Header().Set("Cache-Control", "private, no-store")
	WriteJSON(writer, status, map[string]any{
		"error": map[string]string{
			"code": code, "message": message, "request_id": RequestID(request.Context()),
		},
	})
}

type requestIDKey struct{}

func RequestContext(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		requestID := newRequestID()
		writer.Header().Set("X-Request-ID", requestID)
		ctx := context.WithValue(request.Context(), requestIDKey{}, requestID)
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}

func CORSAllowlist(next stdhttp.Handler, allowedOrigins map[string]struct{}) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		origin := request.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(writer, request)
			return
		}
		writer.Header().Add("Vary", "Origin")
		if _, allowed := allowedOrigins[origin]; !allowed {
			if request.Method == stdhttp.MethodOptions {
				WriteError(writer, request, stdhttp.StatusForbidden, "ORIGIN_NOT_ALLOWED", "Origin browser tidak diizinkan.")
				return
			}
			next.ServeHTTP(writer, request)
			return
		}
		writer.Header().Set("Access-Control-Allow-Origin", origin)
		if request.Method != stdhttp.MethodOptions {
			next.ServeHTTP(writer, request)
			return
		}
		writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-App-Session")
		writer.Header().Set("Access-Control-Max-Age", "600")
		writer.WriteHeader(stdhttp.StatusNoContent)
	})
}

func RequestID(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey{}).(string)
	return value
}

func newRequestID() string {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "req_unavailable"
	}
	return "req_" + hex.EncodeToString(raw)
}
