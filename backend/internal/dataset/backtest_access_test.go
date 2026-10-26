package dataset

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type missingEntryHistory struct{ backtestProvider }

func (p *missingEntryHistory) DailyHistory(ctx context.Context, instrument universe.Instrument, from, to time.Time) (marketdata.History, error) {
	return p.backtestProvider.DailyHistory(ctx, instrument, from, time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC))
}

func TestBacktestRejectsHistoryWithOnlyWarmup(t *testing.T) {
	store, _ := NewDynamicStore(&missingEntryHistory{}, fakeUniverseRepository{owner: "user-a"})
	if _, err := store.Prepare(context.Background(), "user-a", backtestPrepare()); !errors.Is(err, marketdata.ErrInsufficientCandles) || len(store.entries) != 0 {
		t.Fatalf("missing entry data became success: %v", err)
	}
}

func TestBacktestManualNeedsNoRuleAndDenialPrecedesFetch(t *testing.T) {
	input := PrepareRequest{Purpose: "backtest", Mode: "manual", From: "2026-01-01", To: "2026-01-31", NSteps: 3, UniverseID: "owner-universe"}
	store := &accessRecorder{manifest: Manifest{Purpose: "backtest"}}
	if _, err := store.service().Prepare(context.Background(), "owner", input); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(store.calls, []string{"feature", "prepare"}) {
		t.Fatalf("manual calls=%v", store.calls)
	}
	store = &accessRecorder{featureError: access.ErrEntitlementMissing}
	if _, err := store.service().Prepare(context.Background(), "owner", input); !errors.Is(err, access.ErrEntitlementMissing) || len(store.calls) != 1 {
		t.Fatal("denial reached prepare")
	}
	input.Mode, input.RuleID = "rule", "foreign-rule"
	store = &accessRecorder{ruleError: rules.ErrNotFound}
	if _, err := store.service().Prepare(context.Background(), "owner", input); !errors.Is(err, rules.ErrNotFound) || store.input.Purpose != "" {
		t.Fatal("foreign rule reached prepare")
	}
	store = &accessRecorder{}
	if _, err := store.service().Prepare(context.Background(), "owner", input); !errors.Is(err, ErrInvalidRequest) || store.input.Purpose != "" {
		t.Fatal("non-BUY rule reached prepare")
	}
}
