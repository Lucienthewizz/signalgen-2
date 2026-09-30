package universe

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

type RouteHandlers struct {
	Catalog http.HandlerFunc
	List    http.HandlerFunc
	Create  http.HandlerFunc
	Get     http.HandlerFunc
	Update  http.HandlerFunc
	Delete  http.HandlerFunc
}

func RegisterRoutes(router RouteRegistrar, handlers RouteHandlers) {
	router.Handle(http.MethodGet, "/api/v1/stocks", handlers.Catalog)
	router.Handle(http.MethodGet, "/api/v1/stock-universes", handlers.List)
	router.Handle(http.MethodPost, "/api/v1/stock-universes", handlers.Create)
	router.Handle(http.MethodGet, "/api/v1/stock-universes/:id", handlers.Get)
	router.Handle(http.MethodPatch, "/api/v1/stock-universes/:id", handlers.Update)
	router.Handle(http.MethodDelete, "/api/v1/stock-universes/:id", handlers.Delete)
}
