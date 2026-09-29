package dataset

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

type RouteHandlers struct {
	Prepare  http.HandlerFunc
	Manifest http.HandlerFunc
	Content  http.HandlerFunc
}

// RegisterRoutes keeps dataset URLs next to the dataset feature instead of in
// one growing application-wide router file.
func RegisterRoutes(router RouteRegistrar, handlers RouteHandlers) {
	router.Handle(http.MethodPost, "/api/v1/datasets/prepare", handlers.Prepare)
	router.Handle(http.MethodGet, "/api/v1/datasets/:id/manifest", handlers.Manifest)
	router.Handle(http.MethodGet, "/api/v1/datasets/:id/content", handlers.Content)
}
