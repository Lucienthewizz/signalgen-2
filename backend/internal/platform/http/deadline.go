package http

import (
	"context"
	stdhttp "net/http"
	"time"
)

// ReadDeadline cancels dependency work before the browser's 15-second timeout.
// WriteTimeout alone only limits socket writes; it does not cancel SQL queries.
// Mutations are not retried by the client. WebSocket has its own lifecycle.
func ReadDeadline(next stdhttp.Handler) stdhttp.Handler {
	return readDeadline(next, 10*time.Second)
}

func readDeadline(next stdhttp.Handler, budget time.Duration) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		if (request.Method != stdhttp.MethodGet && request.Method != stdhttp.MethodHead) || request.URL.Path == "/api/v1/screener/ws" {
			next.ServeHTTP(writer, request)
			return
		}
		ctx, cancel := context.WithTimeout(request.Context(), budget)
		defer cancel()
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}
