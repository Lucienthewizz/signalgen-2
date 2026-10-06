package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

// Server connects independent HTTP feature adapters and implements http.Handler.
// Context is shared injection state, not client-supplied request data.
type Server struct {
	*shared.Context
	handler http.Handler
}

// NewServer validates and wires every dependency needed by the HTTP boundary.
// Optional behavior is injected with ServerOption so tests can replace stores.
func NewServer(identity IdentityVerifier, sessions SessionStore, accessStore AccessStore, datasets DatasetStore, computeStore ComputeStore, options ...ServerOption) (*Server, error) {
	if identity == nil || sessions == nil || accessStore == nil || datasets == nil || computeStore == nil {
		return nil, fmt.Errorf("identity verifier, session store, access store, dataset store, and compute store are required")
	}
	config := serverConfig{allowedOrigins: make(map[string]struct{})}
	for _, option := range options {
		if option == nil {
			continue
		}
		if err := option(&config); err != nil {
			return nil, err
		}
	}
	if config.ruleStore == nil {
		config.ruleStore = noUserRuleStore{}
	}
	if config.rateLimiter == nil {
		config.rateLimiter = unlimitedRateLimiter{}
	}
	if config.subscriptions == nil {
		config.subscriptions = noSubscriptionService{}
	}
	if config.universeStore == nil {
		config.universeStore = noUniverseStore{}
	}
	if config.ticketStore == nil {
		var err error
		config.ticketStore, err = screener.NewTicketStore()
		if err != nil {
			return nil, err
		}
	}
	if config.socketContext == nil {
		config.socketContext = context.Background()
	}
	if config.socketLimiter == nil {
		config.socketLimiter, _ = screener.NewConnectionLimiter(32, 2)
	}
	server := &Server{Context: &shared.Context{
		Profiles: config.profileStore,
		Identity: identity, Auth: config.authService, Sessions: sessions, Access: accessStore,
		Datasets: datasets, Compute: computeStore, Rules: config.ruleStore, Subscriptions: config.subscriptions, Universes: config.universeStore, Limiter: config.rateLimiter,
		Tickets: config.ticketStore, OriginPatterns: append([]string(nil), config.originPatterns...),
		SocketContext: config.socketContext,
		SocketLimiter: config.socketLimiter,
	}}
	// Route registration is isolated in routes.go so this constructor only wires dependencies.
	server.handler = server.routes(config)
	return server, nil
}

// ServeHTTP makes Server implement http.Handler so it can be mounted directly
// by http.Server and httptest.Server.
func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	server.handler.ServeHTTP(writer, request)
}
