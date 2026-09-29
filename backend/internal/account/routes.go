package account

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

type RouteHandlers struct {
	Me       http.HandlerFunc
	Sessions http.HandlerFunc
	Devices  http.HandlerFunc
	Device   http.HandlerFunc
}

func RegisterRoutes(router RouteRegistrar, handlers RouteHandlers) {
	router.Handle(http.MethodGet, "/api/v1/account/me", handlers.Me)
	router.Handle(http.MethodGet, "/api/v1/account/sessions", handlers.Sessions)
	router.Handle(http.MethodGet, "/api/v1/account/devices", handlers.Devices)
	router.Handle(http.MethodPatch, "/api/v1/account/devices/:id", handlers.Device)
}
