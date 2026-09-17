package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	apihttp "github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/storage"
)

func main() {
	projectURL := requiredEnvironment("SUPABASE_URL")
	publishableKey := requiredEnvironment("SUPABASE_PUBLISHABLE_KEY")
	databasePath := environment("SIGNALGEN_GO_DB_PATH", "/data/signalgen-go.db")
	fixturePath := environment("SIGNALGEN_FIXTURE_PATH", "/usr/share/signalgen/fixtures/default_scalping_v1.json")
	address := environment("SIGNALGEN_GO_API_ADDR", ":8080")
	allowedOrigins := commaSeparatedEnvironment("SIGNALGEN_CORS_ORIGINS")
	maxActiveSessions := positiveIntegerEnvironment("SIGNALGEN_MAX_ACTIVE_SESSIONS", 3)

	identity, err := auth.NewSupabaseVerifier(projectURL, publishableKey, nil)
	if err != nil {
		log.Fatal(err)
	}
	database, err := storage.OpenSQLite(databasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()
	sessions, err := session.NewStore(database, session.WithMaxActiveSessions(maxActiveSessions))
	if err != nil {
		log.Fatal(err)
	}
	if err := sessions.Migrate(context.Background()); err != nil {
		log.Fatal(err)
	}
	accessStore, err := access.NewStore(database)
	if err != nil {
		log.Fatal(err)
	}
	if err := accessStore.Migrate(context.Background()); err != nil {
		log.Fatal(err)
	}
	datasets, err := dataset.NewFixtureStore(fixturePath)
	if err != nil {
		log.Fatal(err)
	}
	computeStore, err := compute.NewStore(database)
	if err != nil {
		log.Fatal(err)
	}
	if err := computeStore.Migrate(context.Background()); err != nil {
		log.Fatal(err)
	}
	handler, err := apihttp.NewServer(
		identity, sessions, accessStore, datasets, computeStore,
		apihttp.WithCORSOrigins(allowedOrigins),
		apihttp.WithReadinessChecks(sessions, accessStore, datasets, computeStore),
	)
	if err != nil {
		log.Fatal(err)
	}

	server := &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	log.Printf("SignalGen Go API listening on %s", address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func requiredEnvironment(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is required", name)
	}
	return value
}

func environment(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func commaSeparatedEnvironment(name string) []string {
	var values []string
	for _, value := range strings.Split(os.Getenv(name), ",") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

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
