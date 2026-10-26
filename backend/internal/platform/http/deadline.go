package http

import (
	"context"
	stdhttp "net/http"
	"time"
)

// ReadDeadline bounds reads and transient dataset preparation before the
// browser/socket 15-second timeouts. Preparation creates no durable business data.
// WriteTimeout alone only limits socket writes; it does not cancel SQL queries.
// Other mutations are not covered. WebSocket has its own lifecycle.
func ReadDeadline(next stdhttp.Handler) stdhttp.Handler {
	return readDeadline(next, 10*time.Second)
}

func readDeadline(next stdhttp.Handler, budget time.Duration) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		isRead := request.Method == stdhttp.MethodGet || request.Method == stdhttp.MethodHead
		isPrepare := request.Method == stdhttp.MethodPost && (request.URL.Path == "/api/v1/datasets/prepare" || request.URL.Path == "/api/v1/backtests/signals")
		if (!isRead && !isPrepare) || request.URL.Path == "/api/v1/screener/ws" {
			next.ServeHTTP(writer, request)
			return
		}
		ctx, cancel := context.WithTimeout(request.Context(), budget)
		defer cancel()
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}
