package screener

import (
	"context"
	"errors"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/entitlement"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

// These doubles only implement the operations used by authorization. Calling
// another embedded contract method panics, exposing an unexpected dependency.
type authorizationFixture struct {
	account.Service
	accountError  error
	sessionError  error
	grantError    error
	manifestError error
	grant         compute.Grant
	manifest      dataset.Manifest
	owners        []string
}

func (f *authorizationFixture) RequireActive(_ context.Context, owner string) (account.State, error) {
	f.owners = append(f.owners, owner)
	return account.State{}, f.accountError
}
func (f *authorizationFixture) VerifyByID(_ context.Context, owner, _ string) (session.Session, error) {
	f.owners = append(f.owners, owner)
	return session.Session{}, f.sessionError
}

type authorizationEntitlements struct {
	entitlement.Service
	fixture *authorizationFixture
	err     error
}

func (f authorizationEntitlements) RequireFeature(_ context.Context, owner, feature string) error {
	f.fixture.owners = append(f.fixture.owners, owner)
	if feature != access.FeatureScreener {
		return errors.New("unexpected feature")
	}
	return f.err
}

type authorizationGrants struct {
	compute.Repository
	fixture *authorizationFixture
}

func (f authorizationGrants) Verify(_ context.Context, owner, _, _ string) (compute.Grant, error) {
	f.fixture.owners = append(f.fixture.owners, owner)
	return f.fixture.grant, f.fixture.grantError
}

type authorizationDatasets struct {
	dataset.Repository
	fixture *authorizationFixture
}

func (f authorizationDatasets) Manifest(_ context.Context, owner, _ string) (dataset.Manifest, error) {
	f.fixture.owners = append(f.fixture.owners, owner)
	return f.fixture.manifest, f.fixture.manifestError
}

type authorizationRules struct {
	rule  rules.Rule
	err   error
	owner string
}

func (f *authorizationRules) Get(_ context.Context, owner, _ string) (rules.Rule, error) {
	f.owner = owner
	return f.rule, f.err
}

func TestAuthorizationServiceRechecksDomainState(t *testing.T) {
	for _, tc := range []struct {
		name             string
		change           func(*authorizationFixture)
		entitlementError error
		code             string
		retryable        bool
	}{
		{name: "allowed"},
		{name: "expired session", change: func(f *authorizationFixture) { f.sessionError = session.ErrExpired }, code: "SESSION_EXPIRED"},
		{name: "revoked session", change: func(f *authorizationFixture) { f.sessionError = session.ErrRevoked }, code: "SESSION_REVOKED"},
		{name: "suspended account", change: func(f *authorizationFixture) { f.accountError = access.ErrAccountSuspended }, code: "ACCOUNT_SUSPENDED"},
		{name: "missing feature", entitlementError: access.ErrEntitlementMissing, code: "ENTITLEMENT_REQUIRED"},
		{name: "expired grant", change: func(f *authorizationFixture) { f.grantError = compute.ErrExpired }, code: "GRANT_EXPIRED"},
		{name: "invalid grant", change: func(f *authorizationFixture) { f.grantError = compute.ErrInvalid }, code: "GRANT_INVALID"},
		{name: "changed grant", change: func(f *authorizationFixture) { f.grant.DatasetVersion = "new" }, code: "VERSION_MISMATCH"},
		{name: "missing dataset", change: func(f *authorizationFixture) { f.manifestError = dataset.ErrNotFound }, code: "RESOURCE_NOT_FOUND"},
		{name: "changed dataset", change: func(f *authorizationFixture) { f.manifest.Checksum = "new" }, code: "VERSION_MISMATCH"},
		{name: "unavailable store", change: func(f *authorizationFixture) { f.sessionError = errors.New("private database detail") }, code: "SERVICE_UNAVAILABLE", retryable: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			binding := Binding{UserID: "verified-owner", SessionID: "session", ComputeGrantID: "grant", RuleID: core.BaselineRuleID, DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion}
			expected := compute.Grant{ID: "grant", Purpose: "screen", RuleID: binding.RuleID, DefinitionHash: binding.DefinitionHash, EngineVersion: binding.EngineVersion, SchemaVersion: binding.SchemaVersion, DatasetID: "dataset", DatasetVersion: "v1", DatasetChecksum: "checksum"}
			fixture := &authorizationFixture{grant: expected, manifest: dataset.Manifest{DatasetID: "dataset", Version: "v1", Checksum: "checksum", Purpose: "screen"}}
			if tc.change != nil {
				tc.change(fixture)
			}
			service := AuthorizationService{Sessions: fixture, Accounts: fixture, Entitlements: authorizationEntitlements{fixture: fixture, err: tc.entitlementError}, Compute: authorizationGrants{fixture: fixture}, Datasets: authorizationDatasets{fixture: fixture}}
			rule, manifest, failure := service.RecheckBatch(context.Background(), binding, expected)
			if tc.code == "" {
				if failure != nil || rule.Name == "" || manifest.DatasetID != "dataset" {
					t.Fatalf("valid authorization failed: %+v", failure)
				}
			} else if failure == nil || failure.Code != tc.code || failure.Retryable != tc.retryable {
				t.Fatalf("failure = %+v, want %s retryable=%v", failure, tc.code, tc.retryable)
			}
			for _, owner := range fixture.owners {
				if owner != binding.UserID {
					t.Fatalf("dependency received unverified owner: %s", owner)
				}
			}
		})
	}
}

func TestAuthorizationServiceResolvesOwnerRuleAndRejectsChangedDefinition(t *testing.T) {
	binding := Binding{UserID: "owner", RuleID: "custom", DefinitionHash: "hash", EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion}
	reader := &authorizationRules{rule: rules.Rule{DefinitionHash: binding.DefinitionHash, EngineVersion: binding.EngineVersion, SchemaVersion: binding.SchemaVersion, Definition: core.RuleSnapshot{Name: "private"}}}
	service := AuthorizationService{Rules: reader}
	rule, err := service.ResolveRule(context.Background(), binding)
	if err != nil || rule.Name != "private" || reader.owner != "owner" {
		t.Fatalf("owner rule resolution failed: %v", err)
	}
	reader.rule.DefinitionHash = "changed"
	if _, err := service.ResolveRule(context.Background(), binding); !errors.Is(err, rules.ErrNotFound) {
		t.Fatalf("changed rule was accepted: %v", err)
	}
	binding.RuleID = core.BaselineRuleID
	if _, err := service.ResolveRule(context.Background(), binding); !errors.Is(err, rules.ErrNotFound) {
		t.Fatalf("wrong baseline hash was accepted: %v", err)
	}
}
