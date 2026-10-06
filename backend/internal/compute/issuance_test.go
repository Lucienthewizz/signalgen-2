package compute

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/entitlement"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
)

// One recorder implements the four narrow workflow contracts. It makes call
// ordering, verified owner propagation and "no write on rejection" observable.
type issuanceRecorder struct {
	manifest                                          dataset.Manifest
	rule                                              rules.Rule
	featureError, datasetError, ruleError, grantError error
	calls                                             []string
	owners                                            []string
	created                                           CreateRequest
}

func (store *issuanceRecorder) RequireFeature(_ context.Context, owner, feature string) error {
	store.calls = append(store.calls, "feature")
	store.owners = append(store.owners, owner)
	if feature != entitlement.FeatureScreener && feature != entitlement.FeatureBacktest {
		return errors.New("unexpected feature")
	}
	return store.featureError
}
func (store *issuanceRecorder) Manifest(_ context.Context, owner, _ string) (dataset.Manifest, error) {
	store.calls = append(store.calls, "dataset")
	store.owners = append(store.owners, owner)
	return store.manifest, store.datasetError
}
func (store *issuanceRecorder) Get(_ context.Context, owner, _ string) (rules.Rule, error) {
	store.calls = append(store.calls, "rule")
	store.owners = append(store.owners, owner)
	return store.rule, store.ruleError
}
func (store *issuanceRecorder) Create(_ context.Context, request CreateRequest) (Grant, error) {
	store.calls = append(store.calls, "grant")
	store.owners = append(store.owners, request.UserID)
	store.created = request
	return Grant{ID: "issued"}, store.grantError
}

func issuanceFixture() (IssueInput, *issuanceRecorder) {
	input := IssueInput{Purpose: "screen", DatasetID: "snapshot", DatasetVersion: "v1", DatasetChecksum: "checksum", RuleID: core.BaselineRuleID, DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion}
	store := &issuanceRecorder{manifest: dataset.Manifest{DatasetID: input.DatasetID, Version: input.DatasetVersion, Checksum: input.DatasetChecksum, Purpose: input.Purpose}}
	return input, store
}
func (store *issuanceRecorder) service() IssuanceService {
	return IssuanceService{Features: store, Datasets: store, Rules: store, Grants: store}
}

func TestIssuanceServiceUsesVerifiedOwnerAndSession(t *testing.T) {
	for _, custom := range []bool{false, true} {
		input, store := issuanceFixture()
		if custom {
			input.RuleID, input.DefinitionHash = "private-rule", "custom-hash"
			store.rule = rules.Rule{DefinitionHash: input.DefinitionHash}
		}
		grant, err := store.service().Issue(context.Background(), "verified-owner", "verified-session", input)
		if err != nil || grant.ID != "issued" {
			t.Fatalf("issuance failed: %v", err)
		}
		if store.created.UserID != "verified-owner" || store.created.SessionID != "verified-session" || store.created.RuleID != input.RuleID || store.created.DatasetChecksum != input.DatasetChecksum {
			t.Fatal("verified binding lost")
		}
		for _, owner := range store.owners {
			if owner != "verified-owner" {
				t.Fatalf("wrong owner: %s", owner)
			}
		}
		want := []string{"feature", "dataset", "grant"}
		if custom {
			want = []string{"feature", "dataset", "rule", "grant"}
		}
		if !reflect.DeepEqual(store.calls, want) {
			t.Fatalf("calls=%v want=%v", store.calls, want)
		}
	}
}

func TestIssuanceServiceRejectsBeforePersistence(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*IssueInput, *issuanceRecorder)
		cause  error
		stage  IssuanceStage
	}{
		{"unsupported purpose", func(i *IssueInput, _ *issuanceRecorder) { i.Purpose = "trade" }, ErrUnsupportedPurpose, ""},
		{"missing feature", func(_ *IssueInput, s *issuanceRecorder) { s.featureError = access.ErrEntitlementMissing }, access.ErrEntitlementMissing, StageEntitlement},
		{"missing dataset", func(_ *IssueInput, s *issuanceRecorder) { s.datasetError = dataset.ErrNotFound }, dataset.ErrNotFound, StageDataset},
		{"missing rule", func(i *IssueInput, s *issuanceRecorder) { i.RuleID = "foreign-rule"; s.ruleError = rules.ErrNotFound }, rules.ErrNotFound, StageRule},
		{"purpose mismatch", func(_ *IssueInput, s *issuanceRecorder) { s.manifest.Purpose = "backtest" }, ErrBindingMismatch, ""},
		{"dataset version", func(i *IssueInput, _ *issuanceRecorder) { i.DatasetVersion = "changed" }, ErrBindingMismatch, ""},
		{"checksum", func(i *IssueInput, _ *issuanceRecorder) { i.DatasetChecksum = "changed" }, ErrBindingMismatch, ""},
		{"rule hash", func(i *IssueInput, _ *issuanceRecorder) { i.DefinitionHash = "changed" }, ErrBindingMismatch, ""},
		{"engine version", func(i *IssueInput, _ *issuanceRecorder) { i.EngineVersion = "changed" }, ErrBindingMismatch, ""},
		{"schema version", func(i *IssueInput, _ *issuanceRecorder) { i.SchemaVersion = "changed" }, ErrBindingMismatch, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input, store := issuanceFixture()
			tc.change(&input, store)
			_, err := store.service().Issue(context.Background(), "owner", "session", input)
			if !errors.Is(err, tc.cause) {
				t.Fatalf("error=%v want=%v", err, tc.cause)
			}
			if tc.stage != "" {
				var failure *IssuanceError
				if !errors.As(err, &failure) || failure.Stage != tc.stage {
					t.Fatalf("wrong failure stage: %v", err)
				}
			}
			if store.created.UserID != "" {
				t.Fatal("rejected input reached persistence")
			}
		})
	}
}

func TestIssuanceServicePreservesDependencyErrors(t *testing.T) {
	private := errors.New("private store detail")
	for _, stage := range []IssuanceStage{StageEntitlement, StageDataset, StageRule, StageGrant} {
		input, store := issuanceFixture()
		switch stage {
		case StageEntitlement:
			store.featureError = private
		case StageDataset:
			store.datasetError = private
		case StageRule:
			input.RuleID = "custom"
			store.ruleError = private
		case StageGrant:
			store.grantError = private
		}
		_, err := store.service().Issue(context.Background(), "owner", "session", input)
		var failure *IssuanceError
		if !errors.Is(err, private) || !errors.As(err, &failure) || failure.Stage != stage {
			t.Fatalf("lost dependency error for %s: %v", stage, err)
		}
	}
}
