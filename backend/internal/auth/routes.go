package auth

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

type RouteHandlers struct {
	Register             http.HandlerFunc
	Login                http.HandlerFunc
	Refresh              http.HandlerFunc
	Me                   http.HandlerFunc
	RequestPasswordReset http.HandlerFunc
	ResetPassword        http.HandlerFunc
}

func RegisterRoutes(router RouteRegistrar, handlers RouteHandlers) {
	router.Handle(http.MethodPost, "/api/auth/register", handlers.Register)
	router.Handle(http.MethodPost, "/api/auth/login", handlers.Login)
	router.Handle(http.MethodPost, "/api/auth/refresh", handlers.Refresh)
	router.Handle(http.MethodGet, "/api/auth/me", handlers.Me)
	router.Handle(http.MethodPost, "/api/auth/password/reset-request", handlers.RequestPasswordReset)
	router.Handle(http.MethodPost, "/api/auth/password/reset", handlers.ResetPassword)
}
