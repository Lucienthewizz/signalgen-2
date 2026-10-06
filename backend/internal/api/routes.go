package api

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	accountapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/account"
	authapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/auth"
	computeapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/compute"
	datasetsapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/datasets"
	operatorapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/operator"
	rulesapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/rules"
	screenerapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/screener"
	sessionsapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/sessions"
	subscriptionsapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/subscriptions"
	systemapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/system"
	universesapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/universes"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/operator"
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// routes is the application composition point. Each feature package owns its
// URL list, while this method connects those URLs to the HTTP handlers.
func (server *Server) routes(config serverConfig) http.Handler {
	accountHandler := &accountapi.Handler{Context: server.Context}
	authHandler := &authapi.Handler{Context: server.Context}
	computeHandler := &computeapi.Handler{Context: server.Context}
	datasetsHandler := &datasetsapi.Handler{Context: server.Context}
	operatorHandler := &operatorapi.Handler{Context: server.Context}
	rulesHandler := &rulesapi.Handler{Context: server.Context}
	screenerHandler := &screenerapi.Handler{Context: server.Context}
	sessionsHandler := &sessionsapi.Handler{Context: server.Context}
	subscriptionsHandler := &subscriptionsapi.Handler{Context: server.Context}
	systemHandler := &systemapi.Handler{Context: server.Context}
	universesHandler := &universesapi.Handler{Context: server.Context}
	router := platformhttp.NewRouter()

	router.Handle(http.MethodGet, "/api", systemHandler.APIStatus)
	router.Handle(http.MethodGet, "/health", systemHandler.Health)
	router.Handle(http.MethodGet, "/ready", systemHandler.Ready(config.readinessChecks))
	router.Handle(http.MethodGet, "/api/v1/capabilities", systemHandler.Capabilities)

	auth.RegisterRoutes(router, auth.RouteHandlers{
		Register: authHandler.Register, Login: authHandler.Login, Refresh: authHandler.RefreshAuth, Me: authHandler.Me,
		RequestPasswordReset: authHandler.RequestPasswordReset(config.resetRedirect),
		ResetPassword:        authHandler.ResetPassword,
	})
	session.RegisterRoutes(router, session.RouteHandlers{
		Create: sessionsHandler.CreateSession, Rotate: sessionsHandler.RotateSession, RevokeCurrent: sessionsHandler.RevokeCurrentSession,
		RevokeByID: sessionsHandler.RevokeAccountSession,
	})
	account.RegisterRoutes(router, account.RouteHandlers{
		Profile: accountHandler.AccountProfile, UpdateProfile: accountHandler.UpdateAccountProfile,
		Me: accountHandler.AccountMe, Sessions: accountHandler.AccountSessions,
		Devices: accountHandler.AccountDevices, Device: accountHandler.UpdateAccountDevice,
	})
	subscription.RegisterRoutes(router, subscription.RouteHandlers{
		Plans: subscriptionsHandler.ListSubscriptionPlans, Current: subscriptionsHandler.CurrentSubscription,
		Cancel: subscriptionsHandler.CancelCurrentSubscription, OperatorUpsert: subscriptionsHandler.ActivateOperatorSubscription,
	})
	rules.RegisterRoutes(router, rules.RouteHandlers{
		List: rulesHandler.ListRules, Create: rulesHandler.CreateRule, Get: rulesHandler.GetRule,
		Update: rulesHandler.UpdateRule, Delete: rulesHandler.DeleteRule,
	})
	universe.RegisterRoutes(router, universe.RouteHandlers{
		Catalog: universesHandler.ListStockCatalog, List: universesHandler.ListStockUniverses,
		Create: universesHandler.CreateStockUniverse, Get: universesHandler.GetStockUniverse,
		Update: universesHandler.UpdateStockUniverse, Delete: universesHandler.DeleteStockUniverse,
	})
	dataset.RegisterRoutes(router, dataset.RouteHandlers{
		Prepare: datasetsHandler.PrepareDataset, Manifest: datasetsHandler.DatasetManifest,
		Content: datasetsHandler.DatasetContent,
	})
	compute.RegisterRoutes(router, computeHandler.CreateComputeGrant)
	screener.RegisterRoutes(router, screenerHandler.CreateScreenerSocketTicket)
	operator.RegisterRoutes(router, operator.RouteHandlers{
		ListGrants: operatorHandler.ListOperatorGrants, CreateGrant: operatorHandler.CreateOperatorGrant,
		RevokeGrant: operatorHandler.RevokeOperatorGrant, ChangeRole: operatorHandler.ChangeOperatorAccountRole,
	})

	// coder/websocket hijacks the original net/http writer. Gin buffers its
	// writer before hijacking, so this one upgrade route stays on the raw
	// boundary while the ordinary HTTP routes use Gin.
	boundary := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && request.URL.Path == "/api/v1/screener/ws" {
			screenerHandler.ScreenerWebSocket(writer, request)
			return
		}
		router.Handler().ServeHTTP(writer, request)
	})
	return platformhttp.RequestContext(platformhttp.CORSAllowlist(boundary, config.allowedOrigins))
}
