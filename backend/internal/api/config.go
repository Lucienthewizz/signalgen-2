package api

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

type serverConfig struct {
	profileStore    account.ProfileRepository
	allowedOrigins  map[string]struct{}
	readinessChecks []ReadinessChecker
	ruleStore       RuleStore
	rateLimiter     RateLimiter
	ticketStore     ScreenerTicketStore
	originPatterns  []string
	authService     AuthService
	subscriptions   SubscriptionService
	universeStore   UniverseStore
	resetRedirect   string
	socketContext   context.Context
	socketLimiter   *screener.ConnectionLimiter
}

// WithProfileStore enables editable profile data independently of role storage.
func WithProfileStore(store account.ProfileRepository) ServerOption {
	return func(config *serverConfig) error {
		if store == nil {
			return fmt.Errorf("profile store is required")
		}
		config.profileStore = store
		return nil
	}
}

// WithScreenerConnectionLimits controls process-local concurrent sockets.
// Defaults are conservative MVP bounds, not a measured capacity claim.
func WithScreenerConnectionLimits(total, perUser int) ServerOption {
	return func(config *serverConfig) error {
		limiter, err := screener.NewConnectionLimiter(total, perUser)
		if err != nil {
			return err
		}
		config.socketLimiter = limiter
		return nil
	}
}

// WithSocketContext ties hijacked WebSockets to process shutdown. Ordinary HTTP
// requests still drain through http.Server.Shutdown instead of being cancelled.
func WithSocketContext(ctx context.Context) ServerOption {
	return func(config *serverConfig) error {
		if ctx == nil {
			return fmt.Errorf("socket context is required")
		}
		config.socketContext = ctx
		return nil
	}
}

// WithAuthService enables registration, login, refresh, and password recovery.
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

// WithUniverseStore enables owner-scoped stock catalog and universe routes.
func WithUniverseStore(store UniverseStore) ServerOption {
	return func(config *serverConfig) error {
		if store == nil {
			return fmt.Errorf("universe store is required")
		}
		config.universeStore = store
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
