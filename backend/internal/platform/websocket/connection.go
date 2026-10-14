// Package websocket isolates the third-party WebSocket transport from the
// screener business flow. Protocol validation remains in the feature module.
package websocket

import (
	"context"
	"errors"
	"net/http"

	ws "github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type Connection struct{ raw *ws.Conn }

var (
	ErrNonTextMessage  = errors.New("WebSocket message must be text")
	ErrMessageTooLarge = errors.New("WebSocket message exceeds read limit")
)

func Accept(writer http.ResponseWriter, request *http.Request, originPatterns []string) (*Connection, error) {
	connection, err := ws.Accept(writer, request, &ws.AcceptOptions{
		OriginPatterns: originPatterns, CompressionMode: ws.CompressionDisabled,
	})
	if err != nil {
		return nil, err
	}
	return &Connection{raw: connection}, nil
}

func (connection *Connection) SetReadLimit(limit int64) { connection.raw.SetReadLimit(limit) }

func (connection *Connection) ReadText(ctx context.Context) ([]byte, bool) {
	raw, err := connection.ReadTextMessage(ctx)
	return raw, err == nil
}

// ReadTextMessage preserves errors for timeout/cancellation measurements, but
// callers must never serialize/log the raw error or received feature payload.
func (connection *Connection) ReadTextMessage(ctx context.Context) ([]byte, error) {
	messageType, raw, err := connection.raw.Read(ctx)
	if err != nil {
		if errors.Is(err, ws.ErrMessageTooBig) || ws.CloseStatus(err) == ws.StatusMessageTooBig {
			return nil, ErrMessageTooLarge
		}
		return nil, err
	}
	if messageType != ws.MessageText {
		return nil, ErrNonTextMessage
	}
	return raw, nil
}

func (connection *Connection) WriteJSON(ctx context.Context, value any) error {
	return wsjson.Write(ctx, connection.raw, value)
}

func (connection *Connection) CloseCompleted() error {
	return connection.raw.Close(ws.StatusNormalClosure, "completed")
}

func (connection *Connection) ClosePolicy(reason string) error {
	return connection.raw.Close(ws.StatusPolicyViolation, reason)
}
