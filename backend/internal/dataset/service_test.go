package dataset

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Records the service boundary without needing a network, provider or database.
type accessRecorder struct {
	manifest                            Manifest
	input                               PrepareRequest
	calls, owners                       []string
	featureError, ruleError, storeError error
}

func (store *accessRecorder) service() AccessService {
	return AccessService{Repository: store, Features: store, Rules: store}
}
func (store *accessRecorder) record(call, owner string) {
	store.calls = append(store.calls, call)
	store.owners = append(store.owners, owner)
}
func (store *accessRecorder) RequireFeature(_ context.Context, owner, feature string) error {
	store.record("feature", owner)
	if feature != access.FeatureScreener && feature != access.FeatureBacktest {
		return errors.New("unexpected feature")
	}
	return store.featureError
}
func (store *accessRecorder) Get(_ context.Context, owner, _ string) (rules.Rule, error) {
	store.record("rule", owner)
	return rules.Rule{}, store.ruleError
}
func (store *accessRecorder) Prepare(_ context.Context, owner string, input PrepareRequest) (Manifest, error) {
	store.record("prepare", owner)
	store.input = input
	return store.manifest, store.storeError
}
func (store *accessRecorder) Manifest(_ context.Context, owner, _ string) (Manifest, error) {
	store.record("manifest", owner)
	return store.manifest, store.storeError
}
func (store *accessRecorder) Content(_ context.Context, owner, _ string) ([]byte, Manifest, error) {
	store.record("content", owner)
	return []byte("private-candles"), store.manifest, store.storeError
}

func TestAccessServicePreparesOnlyAuthorizedOwnerRule(t *testing.T) {
	for _, rule := range []string{core.BaselineRuleID, "private-rule"} {
		store := &accessRecorder{manifest: Manifest{DatasetID: "snapshot", Purpose: "screen"}}
		input := PrepareRequest{Purpose: "screen", RuleID: rule, UniverseID: "private-universe"}
		manifest, err := store.service().Prepare(context.Background(), "verified-owner", input)
		if err != nil || manifest.DatasetID != "snapshot" || !reflect.DeepEqual(store.input, input) {
			t.Fatalf("prepare failed: %v", err)
		}
		want := []string{"feature", "prepare"}
		if rule != core.BaselineRuleID {
			want = []string{"feature", "rule", "prepare"}
		}
		if !reflect.DeepEqual(store.calls, want) {
			t.Fatalf("calls=%v want=%v", store.calls, want)
		}
		for _, owner := range store.owners {
			if owner != "verified-owner" {
				t.Fatal("lost verified owner")
			}
		}
	}
}

func TestAccessServiceRejectsBeforeDatasetPreparation(t *testing.T) {
	for _, tc := range []struct {
		name, purpose                 string
		featureError, ruleError, want error
	}{
		{"unsupported", "trade", nil, nil, ErrUnsupportedPurpose},
		{"feature denied", "screen", access.ErrEntitlementMissing, nil, access.ErrEntitlementMissing},
		{"foreign rule", "screen", nil, rules.ErrNotFound, rules.ErrNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &accessRecorder{featureError: tc.featureError, ruleError: tc.ruleError}
			_, err := store.service().Prepare(context.Background(), "owner", PrepareRequest{Purpose: tc.purpose, RuleID: "private-rule"})
			if !errors.Is(err, tc.want) {
				t.Fatalf("error=%v want=%v", err, tc.want)
			}
			if store.input.Purpose != "" {
				t.Fatal("rejected request reached provider preparation")
			}
		})
	}
}

func TestAccessServiceWithholdsRevokedOrUnsupportedDataset(t *testing.T) {
	for _, operation := range []string{"manifest", "content"} {
		for _, purpose := range []string{"screen", "unknown-purpose"} {
			store := &accessRecorder{manifest: Manifest{DatasetID: "private-snapshot", Purpose: purpose}, featureError: access.ErrEntitlementMissing}
			var manifest Manifest
			var content []byte
			var err error
			if operation == "manifest" {
				manifest, err = store.service().Manifest(context.Background(), "owner", "snapshot")
			} else {
				content, manifest, err = store.service().Content(context.Background(), "owner", "snapshot")
			}
			var denied *AccessError
			if !errors.As(err, &denied) || !errors.Is(err, access.ErrEntitlementMissing) {
				t.Fatalf("wrong access error: %v", err)
			}
			if len(content) != 0 || manifest.DatasetID != "" {
				t.Fatal("private bytes/metadata returned after denial")
			}
			for _, owner := range store.owners {
				if owner != "owner" {
					t.Fatal("read uses wrong owner")
				}
			}
		}
	}
}

func TestAccessServiceReadsProtectedSnapshot(t *testing.T) {
	store := &accessRecorder{manifest: Manifest{DatasetID: "snapshot", Purpose: "screen", Checksum: "checksum"}}
	manifest, err := store.service().Manifest(context.Background(), "owner", "snapshot")
	if err != nil || manifest.Checksum != "checksum" {
		t.Fatalf("manifest failed: %v", err)
	}
	content, manifest, err := store.service().Content(context.Background(), "owner", "snapshot")
	if err != nil || string(content) != "private-candles" || manifest.Checksum != "checksum" {
		t.Fatalf("content failed: %v", err)
	}
	if !reflect.DeepEqual(store.calls, []string{"manifest", "feature", "content", "feature"}) {
		t.Fatalf("calls=%v", store.calls)
	}
}

func TestAccessServicePreservesStoreFailures(t *testing.T) {
	for _, cause := range []error{ErrNotFound, ErrCapacity, ErrInvalidRequest, errors.New("private provider error")} {
		store := &accessRecorder{storeError: cause}
		_, err := store.service().Prepare(context.Background(), "owner", PrepareRequest{Purpose: "screen", RuleID: core.BaselineRuleID})
		if !errors.Is(err, cause) {
			t.Fatalf("prepare lost cause: %v", err)
		}
		_, err = store.service().Manifest(context.Background(), "owner", "snapshot")
		if !errors.Is(err, cause) {
			t.Fatalf("manifest lost cause: %v", err)
		}
		content, manifest, err := store.service().Content(context.Background(), "owner", "snapshot")
		if !errors.Is(err, cause) || len(content) != 0 || manifest.DatasetID != "" {
			t.Fatalf("content did not withhold failed result: %v", err)
		}
	}
}

type tierFeatureReader struct{ policy subscription.EffectiveAccess }

func (f *tierFeatureReader) EffectiveAccess(context.Context, string) (subscription.EffectiveAccess, error) {
	return f.policy, nil
}
func (f *tierFeatureReader) RequireFeature(_ context.Context, _ string, feature string) error {
	return f.policy.RequireFeature(feature)
}

type tierUniverseReader struct{ symbols []string }

func (u tierUniverseReader) Get(context.Context, string, string) (universe.Universe, error) {
	return universe.Universe{Symbols: u.symbols}, nil
}

func TestFreeDatasetRejectsPremiumBeforeFetchAndOldSnapshotReads(t *testing.T) {
	for _, tc := range []struct {
		name, rule, tf string
		count          int
		want           error
	}{
		{"allowed", core.BaselineRuleID, "1d", 3, nil}, {"fourth stock", core.BaselineRuleID, "1d", 4, subscription.ErrPlanLimit},
		{"intraday", core.BaselineRuleID, "5m", 3, subscription.ErrPlanLimit}, {"private rule", "private-rule", "1d", 3, subscription.ErrFeatureNotIncluded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &accessRecorder{manifest: Manifest{DatasetID: "old", Purpose: "screen", Timeframe: tc.tf, Symbols: make([]string, tc.count)}}
			features := &tierFeatureReader{policy: subscription.ResolveAccess("free", nil)}
			svc := AccessService{Repository: store, Rules: store, Features: features, Universes: tierUniverseReader{make([]string, tc.count)}}
			_, err := svc.Prepare(context.Background(), "owner", PrepareRequest{Purpose: "screen", RuleID: tc.rule, Timeframe: tc.tf, UniverseID: "saved"})
			if !errors.Is(err, tc.want) {
				t.Fatalf("prepare: %v want %v", err, tc.want)
			}
			for _, call := range store.calls {
				if tc.want != nil && call == "prepare" {
					t.Fatal("provider called after denial")
				}
			}
			// A previous paid snapshot must be checked again after downgrade, including content bytes.
			if tc.rule == core.BaselineRuleID {
				body, _, err := svc.Content(context.Background(), "owner", "old")
				if !errors.Is(err, tc.want) {
					t.Fatalf("read: %v", err)
				}
				if tc.want != nil && len(body) > 0 {
					t.Fatal("premium candle bytes leaked")
				}
			}
		})
	}
}
