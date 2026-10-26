package backtest

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
)

type fixtureStore struct {
	manifest                                 dataset.Manifest
	content                                  []byte
	grant                                    compute.Grant
	rule                                     rules.Rule
	accessErr, grantErr, datasetErr, ruleErr error
	contentReads                             int
}

func (s *fixtureStore) RequireFeature(_ context.Context, owner, feature string) error {
	if owner != "owner" || feature != "backtest" {
		return access.ErrEntitlementMissing
	}
	return s.accessErr
}
func (s *fixtureStore) Prepare(context.Context, string, dataset.PrepareRequest) (dataset.Manifest, error) {
	return s.manifest, nil
}
func (s *fixtureStore) Manifest(_ context.Context, owner, id string) (dataset.Manifest, error) {
	if owner != "owner" || id != s.manifest.DatasetID {
		return dataset.Manifest{}, dataset.ErrNotFound
	}
	return s.manifest, s.datasetErr
}
func (s *fixtureStore) Content(ctx context.Context, owner, id string) ([]byte, dataset.Manifest, error) {
	s.contentReads++
	m, e := s.Manifest(ctx, owner, id)
	return s.content, m, e
}
func (s *fixtureStore) Create(context.Context, compute.CreateRequest) (compute.Grant, error) {
	return s.grant, nil
}
func (s *fixtureStore) Verify(_ context.Context, owner, session, id string) (compute.Grant, error) {
	if owner != "owner" || session != "session" || id != "grant" {
		return compute.Grant{}, compute.ErrInvalid
	}
	return s.grant, s.grantErr
}
func (s *fixtureStore) Get(_ context.Context, owner, id string) (rules.Rule, error) {
	if owner != "owner" || id != "private-rule" {
		return rules.Rule{}, rules.ErrNotFound
	}
	return s.rule, s.ruleErr
}
func (s *fixtureStore) service() Service {
	return Service{Features: s, Datasets: s, Compute: s, Rules: s}
}
func signalFixture(t *testing.T) (SignalInput, *fixtureStore) {
	t.Helper()
	candles := []core.Candle{}
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 25; i++ {
		price := 100 + float64(i)
		candles = append(candles, core.Candle{Timestamp: from.AddDate(0, 0, i).Format(time.RFC3339), Open: price, High: price + 2, Low: price - 1, Close: price + 1, Volume: 1})
	}
	features, e := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: "TEST", Candles: candles})
	if e != nil {
		t.Fatal(e)
	}
	content, _ := json.Marshal(map[string]any{"series": []core.BacktestSeries{{Symbol: "TEST", Timezone: "UTC", Candles: candles}}})
	store := &fixtureStore{content: content, manifest: dataset.Manifest{DatasetID: "snapshot", Version: "v1", Checksum: "sha256:test", Purpose: "backtest", Timeframe: "1d", Backtest: &dataset.BacktestScope{Mode: "rule", From: "2026-01-21", To: "2026-01-23", NSteps: 2, RuleID: "private-rule"}}, grant: compute.Grant{ID: "grant", Purpose: "backtest", DatasetID: "snapshot", DatasetVersion: "v1", DatasetChecksum: "sha256:test", RuleID: "private-rule", DefinitionHash: "sha256:rule", EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion}, rule: rules.Rule{DefinitionHash: "sha256:rule", EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion, Definition: core.RuleSnapshot{Name: "Always", Logic: "AND", SignalType: "BUY", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 1}}}}}
	return SignalInput{ComputeGrantID: "grant", FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.BacktestPolicyVersion, Candidates: features.Candidates}, store
}
func TestSignalsChecksFullSymbolAndOnlyReturnsEntryWindow(t *testing.T) {
	input, store := signalFixture(t)
	result, err := store.service().Signals(context.Background(), "owner", "session", input)
	if err != nil || len(result.Entries) != 3 || result.Entries[0].Timestamp != "2026-01-21T00:00:00Z" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	input.Candidates = input.Candidates[1:]
	if _, err := store.service().Signals(context.Background(), "owner", "session", input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("accepted split %v", err)
	}
}
func TestSignalsDenialsAndBindingChanges(t *testing.T) {
	cases := map[string]struct {
		change func(*SignalInput, *fixtureStore)
		want   error
	}{
		"feature":         {func(_ *SignalInput, s *fixtureStore) { s.accessErr = access.ErrEntitlementMissing }, access.ErrEntitlementMissing},
		"expired grant":   {func(_ *SignalInput, s *fixtureStore) { s.grantErr = compute.ErrExpired }, compute.ErrExpired},
		"missing dataset": {func(_ *SignalInput, s *fixtureStore) { s.datasetErr = dataset.ErrNotFound }, dataset.ErrNotFound},
		"changed rule":    {func(_ *SignalInput, s *fixtureStore) { s.rule.DefinitionHash = "changed" }, rules.ErrNotFound},
		"foreign rule":    {func(_ *SignalInput, s *fixtureStore) { s.ruleErr = rules.ErrNotFound }, rules.ErrNotFound},
		"checksum":        {func(_ *SignalInput, s *fixtureStore) { s.manifest.Checksum = "changed" }, ErrVersion},
		"purpose":         {func(_ *SignalInput, s *fixtureStore) { s.grant.Purpose = "screen" }, ErrVersion},
		"engine":          {func(_ *SignalInput, s *fixtureStore) { s.grant.EngineVersion = "other" }, ErrVersion},
		"manual":          {func(_ *SignalInput, s *fixtureStore) { s.manifest.Backtest.Mode = "manual" }, ErrVersion},
		"sell":            {func(_ *SignalInput, s *fixtureStore) { s.rule.Definition.SignalType = "SELL" }, ErrUnsupported},
		"policy":          {func(i *SignalInput, _ *fixtureStore) { i.PolicyVersion = "other" }, ErrUnsupported},
		"wrong symbol":    {func(i *SignalInput, _ *fixtureStore) { i.Candidates[0].Symbol = "OTHER" }, ErrInvalid},
		"timestamp":       {func(i *SignalInput, _ *fixtureStore) { i.Candidates[0].Timestamp = "2020-01-01T00:00:00Z" }, ErrInvalid},
		"missing field":   {func(i *SignalInput, _ *fixtureStore) { i.Candidates[0].Features.Price = 0 }, ErrInvalid},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			i, s := signalFixture(t)
			tc.change(&i, s)
			if _, err := s.service().Signals(context.Background(), "owner", "session", i); !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
			if name == "feature" && s.contentReads != 0 {
				t.Fatal("denied user read snapshot")
			}
		})
	}
	input, store := signalFixture(t)
	if _, err := store.service().Signals(context.Background(), "owner", "foreign-session", input); !errors.Is(err, compute.ErrInvalid) {
		t.Fatal("cross-session grant accepted")
	}
	if _, err := store.service().Signals(context.Background(), "foreign-owner", "session", input); !errors.Is(err, access.ErrEntitlementMissing) {
		t.Fatal("cross-owner accepted")
	}
}
