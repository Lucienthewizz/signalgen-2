package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/entitlement"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/operator"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
)

// These aliases keep the public API constructor readable while each feature
// package remains the single owner of its dependency contract.
type IdentityVerifier = auth.IdentityVerifier
type AuthService = auth.Service
type SessionStore = session.Repository
type DatasetStore = dataset.Repository
type ComputeStore = compute.Repository
type ScreenerTicketStore = screener.TicketRepository
type RuleStore = rules.Repository
type SubscriptionService = subscription.Service

// AccessStore is the server-owned authorization source for account status,
// roles, feature entitlements, and audited operator mutations. It composes the
// three focused feature contracts instead of redefining all their methods.
type AccessStore interface {
	account.Service
	entitlement.Service
	operator.Service
}

var errRuleStoreUnavailable = errors.New("user rule store is unavailable")

type noUserRuleStore struct{}

func (noUserRuleStore) List(context.Context, string) ([]rules.Rule, error) {
	return []rules.Rule{}, nil
}
func (noUserRuleStore) Get(context.Context, string, string) (rules.Rule, error) {
	return rules.Rule{}, rules.ErrNotFound
}
func (noUserRuleStore) Create(context.Context, string, core.RuleSnapshot) (rules.Rule, error) {
	return rules.Rule{}, errRuleStoreUnavailable
}
func (noUserRuleStore) Update(context.Context, string, string, int, core.RuleSnapshot) (rules.Rule, error) {
	return rules.Rule{}, errRuleStoreUnavailable
}
func (noUserRuleStore) Delete(context.Context, string, string, int) error {
	return errRuleStoreUnavailable
}

var errSubscriptionUnavailable = errors.New("subscription service is unavailable")

type noSubscriptionService struct{}

func (noSubscriptionService) Plans(context.Context) ([]subscription.Plan, error) {
	return nil, errSubscriptionUnavailable
}
func (noSubscriptionService) Current(context.Context, string) (subscription.Subscription, error) {
	return subscription.Subscription{}, errSubscriptionUnavailable
}
func (noSubscriptionService) ActivateManual(context.Context, subscription.ActivateRequest) (subscription.Subscription, error) {
	return subscription.Subscription{}, errSubscriptionUnavailable
}
func (noSubscriptionService) Cancel(context.Context, subscription.CancelRequest) (subscription.Subscription, error) {
	return subscription.Subscription{}, errSubscriptionUnavailable
}

// ReadinessChecker lets each infrastructure dependency report whether the API
// is ready for traffic, independently from the lightweight liveness endpoint.
type ReadinessChecker interface {
	Ready(ctx context.Context) error
}

// RateLimiter protects mutation and public-auth routes from request bursts.
type RateLimiter interface {
	Allow(key string) (bool, time.Duration)
}

type unlimitedRateLimiter struct{}

func (unlimitedRateLimiter) Allow(string) (bool, time.Duration) { return true, 0 }

// Server is the HTTP composition root. It contains interfaces rather than
// concrete stores, which keeps handlers testable and storage replaceable.
type Server struct {
	identity       IdentityVerifier
	auth           AuthService
	sessions       SessionStore
	access         AccessStore
	datasets       DatasetStore
	compute        ComputeStore
	rules          RuleStore
	subscriptions  SubscriptionService
	limiter        RateLimiter
	tickets        ScreenerTicketStore
	originPatterns []string
	handler        http.Handler
}

type systemRuleResource struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	OwnerType      string `json:"owner_type"`
	ReadOnly       bool   `json:"read_only"`
	DefinitionHash string `json:"definition_hash"`
	SchemaVersion  string `json:"schema_version"`
	EngineVersion  string `json:"engine_version"`
	Version        int    `json:"version"`
}

type serverConfig struct {
	allowedOrigins  map[string]struct{}
	readinessChecks []ReadinessChecker
	ruleStore       RuleStore
	rateLimiter     RateLimiter
	ticketStore     ScreenerTicketStore
	originPatterns  []string
	authService     AuthService
	subscriptions   SubscriptionService
	resetRedirect   string
}

// WithAuthService enables registration, login, and password recovery routes.
func WithAuthService(service AuthService) ServerOption {
	return func(config *serverConfig) error {
		if service == nil {
			return fmt.Errorf("auth service is required")
		}
		config.authService = service
		return nil
	}
}

// WithPasswordResetRedirectURL configures the frontend page opened from a
// Supabase recovery email. Supabase must also allow-list this exact URL.
func WithPasswordResetRedirectURL(rawURL string) ServerOption {
	return func(config *serverConfig) error {
		rawURL = strings.TrimSpace(rawURL)
		if rawURL == "" {
			config.resetRedirect = ""
			return nil
		}
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return fmt.Errorf("invalid password reset redirect URL")
		}
		config.resetRedirect = rawURL
		return nil
	}
}

// WithReadinessChecks adds dependencies checked by GET /ready.
func WithReadinessChecks(checkers ...ReadinessChecker) ServerOption {
	return func(config *serverConfig) error {
		for _, checker := range checkers {
			if checker == nil {
				return fmt.Errorf("readiness checker is required")
			}
			config.readinessChecks = append(config.readinessChecks, checker)
		}
		return nil
	}
}

// WithRuleStore enables owner-scoped custom rule persistence.
func WithRuleStore(store RuleStore) ServerOption {
	return func(config *serverConfig) error {
		if store == nil {
			return fmt.Errorf("rule store is required")
		}
		config.ruleStore = store
		return nil
	}
}

// WithSubscriptionService enables provider-neutral subscription lifecycle
// endpoints. Paid activation remains operator/server controlled.
func WithSubscriptionService(service SubscriptionService) ServerOption {
	return func(config *serverConfig) error {
		if service == nil {
			return fmt.Errorf("subscription service is required")
		}
		config.subscriptions = service
		return nil
	}
}

// WithRateLimiter replaces the permissive test default with a real limiter.
func WithRateLimiter(limiter RateLimiter) ServerOption {
	return func(config *serverConfig) error {
		if limiter == nil {
			return fmt.Errorf("rate limiter is required")
		}
		config.rateLimiter = limiter
		return nil
	}
}

// WithScreenerTicketStore injects ticket persistence, mainly for tests or a
// future distributed implementation.
func WithScreenerTicketStore(store ScreenerTicketStore) ServerOption {
	return func(config *serverConfig) error {
		if store == nil {
			return fmt.Errorf("screener ticket store is required")
		}
		config.ticketStore = store
		return nil
	}
}

type ServerOption func(*serverConfig) error

// WithCORSOrigins enables browser access only for the exact HTTP(S) origins provided.
// An empty list keeps cross-origin browser access disabled.
func WithCORSOrigins(origins []string) ServerOption {
	return func(config *serverConfig) error {
		for _, rawOrigin := range origins {
			origin := strings.TrimSpace(rawOrigin)
			if origin == "" {
				continue
			}
			parsed, err := url.Parse(origin)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
				return fmt.Errorf("invalid CORS origin %q", rawOrigin)
			}
			config.allowedOrigins[origin] = struct{}{}
			config.originPatterns = append(config.originPatterns, origin)
		}
		return nil
	}
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
	if config.ticketStore == nil {
		var err error
		config.ticketStore, err = screener.NewTicketStore()
		if err != nil {
			return nil, err
		}
	}
	server := &Server{
		identity: identity, auth: config.authService, sessions: sessions, access: accessStore,
		datasets: datasets, compute: computeStore, rules: config.ruleStore, subscriptions: config.subscriptions, limiter: config.rateLimiter,
		tickets: config.ticketStore, originPatterns: append([]string(nil), config.originPatterns...),
	}
	// Route registration is isolated in routes.go so this constructor only wires dependencies.
	server.handler = server.routes(config)
	return server, nil
}

// ServeHTTP makes Server implement http.Handler so it can be mounted directly
// by http.Server and httptest.Server.
func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	server.handler.ServeHTTP(writer, request)
}

// health is a lightweight liveness endpoint. It does not touch dependencies.
func (server *Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

// ready verifies dependencies such as Postgres and the dataset source before
// accepting real traffic.
func (server *Server) ready(checkers []ReadinessChecker) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		for _, checker := range checkers {
			if err := checker.Ready(ctx); err != nil {
				writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service belum siap.")
				return
			}
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ready"})
	}
}
