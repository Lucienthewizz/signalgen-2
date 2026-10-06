package api

import (
	"context"
	"errors"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

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

var errUniverseUnavailable = errors.New("stock universe store is unavailable")

type noUniverseStore struct{}

func (noUniverseStore) Catalog(context.Context) ([]universe.Instrument, error) {
	return nil, errUniverseUnavailable
}

func (noUniverseStore) List(context.Context, string) ([]universe.Universe, error) {
	return nil, errUniverseUnavailable
}

func (noUniverseStore) Get(context.Context, string, string) (universe.Universe, error) {
	return universe.Universe{}, universe.ErrNotFound
}

func (noUniverseStore) Instruments(context.Context, string, string) ([]universe.Instrument, error) {
	return nil, universe.ErrNotFound
}

func (noUniverseStore) Create(context.Context, string, string, []string) (universe.Universe, error) {
	return universe.Universe{}, errUniverseUnavailable
}

func (noUniverseStore) Update(context.Context, string, string, string, []string, int) (universe.Universe, error) {
	return universe.Universe{}, errUniverseUnavailable
}

func (noUniverseStore) Delete(context.Context, string, string, int) error {
	return errUniverseUnavailable
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

type unlimitedRateLimiter struct{}

func (unlimitedRateLimiter) Allow(string) (bool, time.Duration) { return true, 0 }
