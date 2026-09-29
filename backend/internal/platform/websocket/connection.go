// Package websocket isolates the third-party WebSocket transport from the
// screener business flow. Protocol validation remains in the feature module.
package websocket

import (
	"context"
	"net/http"

	ws "github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type Connection struct{ raw *ws.Conn }

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
	messageType, raw, err := connection.raw.Read(ctx)
	return raw, err == nil && messageType == ws.MessageText
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
