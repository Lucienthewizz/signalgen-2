package operator

import "net/http"

type RouteRegistrar interface {
	Handle(method, path string, handler http.HandlerFunc)
}

type RouteHandlers struct {
	ListGrants   http.HandlerFunc
	CreateGrant  http.HandlerFunc
	RevokeGrant  http.HandlerFunc
	ChangeRole   http.HandlerFunc
	ListAccounts http.HandlerFunc
	ChangeStatus http.HandlerFunc
	ListAudit    http.HandlerFunc
}

func RegisterRoutes(router RouteRegistrar, handlers RouteHandlers) {
	router.Handle(http.MethodGet, "/api/v1/operator/accounts", handlers.ListAccounts)
	router.Handle(http.MethodPatch, "/api/v1/operator/accounts/:user_id/status", handlers.ChangeStatus)
	router.Handle(http.MethodGet, "/api/v1/operator/audit-events", handlers.ListAudit)
	router.Handle(http.MethodGet, "/api/v1/operator/grants", handlers.ListGrants)
	router.Handle(http.MethodPost, "/api/v1/operator/grants", handlers.CreateGrant)
	router.Handle(http.MethodDelete, "/api/v1/operator/grants/:user_id/:feature", handlers.RevokeGrant)
	router.Handle(http.MethodPatch, "/api/v1/operator/accounts/:user_id/role", handlers.ChangeRole)
}
