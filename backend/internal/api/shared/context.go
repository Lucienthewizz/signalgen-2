package shared

import (
	"context"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

// Context holds backend-owned dependencies shared by HTTP feature adapters.
// Construct it once at startup; do not mutate dependencies during live requests.
type Context struct {
	Profiles       account.ProfileRepository
	Identity       IdentityVerifier
	Auth           AuthService
	Sessions       SessionStore
	Access         AccessStore
	Datasets       DatasetStore
	Compute        ComputeStore
	Rules          RuleStore
	Subscriptions  SubscriptionService
	Universes      UniverseStore
	Limiter        RateLimiter
	Tickets        ScreenerTicketStore
	OriginPatterns []string
	SocketContext  context.Context
	SocketLimiter  *screener.ConnectionLimiter
}
