package api

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/operator"
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
)

// routes is the application composition point. Each feature package owns its
// URL list, while this method connects those URLs to the HTTP handlers.
func (server *Server) routes(config serverConfig) http.Handler {
	router := platformhttp.NewRouter()

	router.Handle(http.MethodGet, "/api", server.apiStatus)
	router.Handle(http.MethodGet, "/health", server.health)
	router.Handle(http.MethodGet, "/ready", server.ready(config.readinessChecks))
	router.Handle(http.MethodGet, "/api/v1/capabilities", server.capabilities)

	auth.RegisterRoutes(router, auth.RouteHandlers{
		Register: server.register, Login: server.login, Me: server.me,
		RequestPasswordReset: server.requestPasswordReset(config.resetRedirect),
		ResetPassword:        server.resetPassword,
	})
	session.RegisterRoutes(router, session.RouteHandlers{
		Create: server.createSession, RevokeCurrent: server.revokeCurrentSession,
		RevokeByID: server.revokeAccountSession,
	})
	account.RegisterRoutes(router, account.RouteHandlers{
		Me: server.accountMe, Sessions: server.accountSessions,
		Devices: server.accountDevices, Device: server.updateAccountDevice,
	})
	subscription.RegisterRoutes(router, subscription.RouteHandlers{
		Plans: server.listSubscriptionPlans, Current: server.currentSubscription,
		Cancel: server.cancelCurrentSubscription, OperatorUpsert: server.activateOperatorSubscription,
	})
	rules.RegisterRoutes(router, rules.RouteHandlers{
		List: server.listRules, Create: server.createRule, Get: server.getRule,
		Update: server.updateRule, Delete: server.deleteRule,
	})
	dataset.RegisterRoutes(router, dataset.RouteHandlers{
		Prepare: server.prepareDataset, Manifest: server.datasetManifest,
		Content: server.datasetContent,
	})
	compute.RegisterRoutes(router, server.createComputeGrant)
	screener.RegisterRoutes(router, server.createScreenerSocketTicket)
	operator.RegisterRoutes(router, operator.RouteHandlers{
		ListGrants: server.listOperatorGrants, CreateGrant: server.createOperatorGrant,
		RevokeGrant: server.revokeOperatorGrant, ChangeRole: server.changeOperatorAccountRole,
	})

	// coder/websocket hijacks the original net/http writer. Gin buffers its
	// writer before hijacking, so this one upgrade route stays on the raw
	// boundary while the ordinary HTTP routes use Gin.
	boundary := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && request.URL.Path == "/api/v1/screener/ws" {
			server.screenerWebSocket(writer, request)
			return
		}
		router.Handler().ServeHTTP(writer, request)
	})
	return platformhttp.RequestContext(platformhttp.CORSAllowlist(boundary, config.allowedOrigins))
}
