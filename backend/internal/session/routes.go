package session

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

type RouteHandlers struct {
	Create        http.HandlerFunc
	RevokeCurrent http.HandlerFunc
	RevokeByID    http.HandlerFunc
}

func RegisterRoutes(router RouteRegistrar, handlers RouteHandlers) {
	router.Handle(http.MethodPost, "/api/v1/sessions", handlers.Create)
	router.Handle(http.MethodDelete, "/api/v1/sessions/current", handlers.RevokeCurrent)
	router.Handle(http.MethodDelete, "/api/v1/account/sessions/:id", handlers.RevokeByID)
}
