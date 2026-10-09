package main

import (
	"context"
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/workspace"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	apihttp "github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/ratelimit"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func main() {
	shutdownContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	// Read deployment configuration once at process startup. Secrets remain in
	// the backend environment and are never bundled into the frontend/WASM.
	projectURL := requiredEnvironment("SUPABASE_URL")
	publishableKey := requiredEnvironment("SUPABASE_PUBLISHABLE_KEY")
	databaseURL := requiredEnvironment("SUPABASE_DB_URL")
	yahooFinanceBaseURL := environment("YAHOO_FINANCE_BASE_URL", "https://query1.finance.yahoo.com")
	address := environment("SIGNALGEN_GO_API_ADDR", ":8080")
	allowedOrigins := commaSeparatedEnvironment("SIGNALGEN_CORS_ORIGINS")
	passwordResetRedirectURL := environment("SIGNALGEN_PASSWORD_RESET_REDIRECT_URL", "http://127.0.0.1:5174/?view=reset-password")
	maxActiveSessions := positiveIntegerEnvironment("SIGNALGEN_MAX_ACTIVE_SESSIONS", 1)
	deviceSwitchCooldownHours := positiveIntegerEnvironment("SIGNALGEN_DEVICE_SWITCH_COOLDOWN_HOURS", 24)
	mutationRatePerMinute := positiveIntegerEnvironment("SIGNALGEN_MUTATION_RATE_LIMIT_PER_MINUTE", 60)
	maxSocketConnections := positiveIntegerEnvironment("SIGNALGEN_MAX_SCREENER_CONNECTIONS", 32)
	maxUserSocketConnections := positiveIntegerEnvironment("SIGNALGEN_MAX_SCREENER_CONNECTIONS_PER_USER", 2)

	// Supabase is the identity provider: register, login, recovery, and bearer
	// verification. SignalGen authorization is wired separately below.
	identity, err := auth.NewSupabaseVerifier(projectURL, publishableKey, nil)
	if err != nil {
		log.Fatal(err)
	}
	// Supabase Postgres owns durable multi-user application state. SQL schema
	// changes are versioned under supabase/migrations, not run at API startup.
	database, err := platformdb.OpenPostgres(context.Background(), databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()
	// App sessions bind a Supabase user to an installation/device and enforce
	// the active-device limit plus device-switch cooldown.
	sessions, err := session.NewPostgresRepository(database, maxActiveSessions, time.Duration(deviceSwitchCooldownHours)*time.Hour)
	if err != nil {
		log.Fatal(err)
	}
	// Access state is server-owned: profile, role, status, entitlement, audit.
	accessStore := account.NewPostgresRepository(database)
	// Stock universes are durable owner-scoped bundles. Provider symbols remain
	// server-only metadata so clients cannot request an arbitrary instrument.
	universeStore := universe.NewPostgresRepository(database)
	yahooProvider, err := marketdata.NewYahooFinance(yahooFinanceBaseURL, nil)
	if err != nil {
		log.Fatal(err)
	}
	// Public OHLCV is shared briefly; private dataset handles remain owner-bound.
	// Identical instrument fetches reuse one bounded upstream request.
	provider, err := marketdata.NewCachedProvider(yahooProvider, marketdata.DefaultCacheOptions())
	if err != nil {
		log.Fatal(err)
	}
	// Dynamic datasets contain up to three universe members. Date boundaries are
	// calculated from provider candles and exposed only as response metadata.
	datasets, err := dataset.NewDynamicStore(provider, universeStore)
	if err != nil {
		log.Fatal(err)
	}
	// Compute grants persist the exact context approved for WASM/private scoring.
	computeStore := compute.NewPostgresRepository(database)
	// Custom rules are owner-scoped; the baseline rule remains in backend/core.
	ruleStore := rules.NewPostgresRepository(database)
	// Subscription state is provider-neutral. Manual operator activation is the
	// only trusted MVP source; payment webhooks will be added behind this service.
	subscriptionStore := subscription.NewPostgresRepository(database)
	// Rate limiting protects public auth and state-changing endpoints.
	mutationLimiter, err := ratelimit.New(mutationRatePerMinute, time.Minute)
	if err != nil {
		log.Fatal(err)
	}
	// NewServer is the composition boundary: concrete infrastructure is passed
	// into the HTTP package through small interfaces for testing and migration.
	handler, err := apihttp.NewServer(
		identity, sessions, accessStore, datasets, computeStore,
		apihttp.WithAuthService(identity),
		apihttp.WithSocketContext(shutdownContext),
		apihttp.WithScreenerConnectionLimits(maxSocketConnections, maxUserSocketConnections),
		apihttp.WithPasswordResetRedirectURL(passwordResetRedirectURL),
		apihttp.WithRuleStore(ruleStore),
		apihttp.WithProfileStore(accessStore),
		apihttp.WithSubscriptionService(subscriptionStore),
		apihttp.WithUniverseStore(universeStore),
		apihttp.WithWorkspaceStore(&workspace.PostgresStore{DB: database}),
		apihttp.WithRateLimiter(mutationLimiter),
		apihttp.WithCORSOrigins(allowedOrigins),
		apihttp.WithReadinessChecks(platformdb.PostgresReadiness{Pool: database}, datasets),
	)
	if err != nil {
		log.Fatal(err)
	}

	// Explicit timeouts prevent slow clients from holding server resources.
	server := &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Graceful shutdown lets in-flight HTTP requests finish during container
	// restarts or Ctrl+C instead of being terminated abruptly.
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Print("HTTP shutdown deadline exceeded; closing remaining connections")
			_ = server.Close()
		}
	}()

	log.Printf("SignalGen Go API listening on %s", address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	// ListenAndServe returns as soon as listeners close, before Shutdown has
	// necessarily drained handlers. Wait before deferred Postgres pool cleanup.
	<-shutdownDone
}

// requiredEnvironment fails fast when a security-critical setting is absent.
func requiredEnvironment(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is required", name)
	}
	return value
}

// environment reads an optional setting with a documented local default.
func environment(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// commaSeparatedEnvironment parses allow-lists such as CORS origins.
func commaSeparatedEnvironment(name string) []string {
	var values []string
	for _, value := range strings.Split(os.Getenv(name), ",") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

// positiveIntegerEnvironment rejects invalid limits during startup instead of
// silently running with an unsafe or surprising value.
func positiveIntegerEnvironment(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		log.Fatalf("%s must be a positive integer", name)
	}
	return value
}
