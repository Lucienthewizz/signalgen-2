package subscription

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

type RouteHandlers struct {
	Plans          http.HandlerFunc
	Current        http.HandlerFunc
	Cancel         http.HandlerFunc
	OperatorUpsert http.HandlerFunc
}

func RegisterRoutes(router RouteRegistrar, handlers RouteHandlers) {
	router.Handle(http.MethodGet, "/api/v1/subscription/plans", handlers.Plans)
	router.Handle(http.MethodGet, "/api/v1/subscription", handlers.Current)
	router.Handle(http.MethodPost, "/api/v1/subscription/cancel", handlers.Cancel)
	router.Handle(http.MethodPost, "/api/v1/operator/subscriptions", handlers.OperatorUpsert)
}
