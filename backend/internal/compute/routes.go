package compute

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

// RegisterRoutes owns the URL that grants one exact computation context.
func RegisterRoutes(router RouteRegistrar, create http.HandlerFunc) {
	router.Handle(http.MethodPost, "/api/v1/compute-grants", create)
}
