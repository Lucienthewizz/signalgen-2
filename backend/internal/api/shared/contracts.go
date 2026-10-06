package shared

import (
	"context"
	"time"

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
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
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

type UniverseStore = universe.Repository

// AccessStore is the server-owned authorization source for account status,
// roles, feature entitlements, and audited operator mutations. It composes the
// three focused feature contracts instead of redefining all their methods.
type AccessStore interface {
	account.Service
	entitlement.Service
	operator.Service
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
