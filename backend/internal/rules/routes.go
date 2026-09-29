package rules

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

type RouteHandlers struct {
	List   http.HandlerFunc
	Create http.HandlerFunc
	Get    http.HandlerFunc
	Update http.HandlerFunc
	Delete http.HandlerFunc
}

func RegisterRoutes(router RouteRegistrar, handlers RouteHandlers) {
	router.Handle(http.MethodGet, "/api/v1/rules", handlers.List)
	router.Handle(http.MethodPost, "/api/v1/rules", handlers.Create)
	router.Handle(http.MethodGet, "/api/v1/rules/:id", handlers.Get)
	router.Handle(http.MethodPatch, "/api/v1/rules/:id", handlers.Update)
	router.Handle(http.MethodDelete, "/api/v1/rules/:id", handlers.Delete)
}
