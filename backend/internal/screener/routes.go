package screener

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

// RegisterRoutes registers the ordinary HTTP half of the screener transport.
// The WebSocket upgrade itself remains on the raw net/http boundary because it
// must hijack the connection.
func RegisterRoutes(router RouteRegistrar, createSocketTicket http.HandlerFunc) {
	router.Handle(http.MethodPost, "/api/v1/screener/socket-tickets", createSocketTicket)
}
