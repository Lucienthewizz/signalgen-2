package shared

import (
	"context"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
)

// EffectiveAccess uses the same authoritative policy as runtime permission
// checks. The fallback supports the preserved legacy adapter and older fixtures.
func (s *Context) EffectiveAccess(ctx context.Context, owner string) (subscription.EffectiveAccess, error) {
	if provider, ok := s.Access.(subscription.AccessProvider); ok {
		return provider.EffectiveAccess(ctx, owner)
	}
	current, _ := s.Subscriptions.Current(ctx, owner) // Optional in the preserved legacy adapter.
	code := "free"
	now := time.Now()
	if (current.Status == subscription.StatusActive || current.Status == subscription.StatusTrialing) && !now.Before(current.CurrentPeriodStart) && now.Before(current.CurrentPeriodEnd) {
		code = current.PlanCode
	}
	features, err := s.Access.Features(ctx, owner)
	if err != nil {
		return subscription.EffectiveAccess{}, err
	}
	result := subscription.ResolveAccess(code, features)
	// Legacy stores have no automatic Free grant; retain their exact feature set.
	result.Features = features
	return result, nil
}
