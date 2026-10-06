// These aliases preserve the constructor's dependency vocabulary. Feature
// packages own the contracts; shared composes them without importing this package.
package api

import (
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

type IdentityVerifier = shared.IdentityVerifier

type AuthService = shared.AuthService

type SessionStore = shared.SessionStore

type DatasetStore = shared.DatasetStore

type ComputeStore = shared.ComputeStore

type ScreenerTicketStore = shared.ScreenerTicketStore

type RuleStore = shared.RuleStore

type SubscriptionService = shared.SubscriptionService

type UniverseStore = shared.UniverseStore

type AccessStore = shared.AccessStore

type ReadinessChecker = shared.ReadinessChecker

type RateLimiter = shared.RateLimiter
