package apitests

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

type fakeIdentity struct {
	principal auth.Principal
	err       error
}

func (fake fakeIdentity) Verify(_ context.Context, _ string) (auth.Principal, error) {
	return fake.principal, fake.err
}

type fakeSessions struct {
	created        session.Created
	verified       session.Session
	verifyError    error
	createdUserID  string
	verifiedUserID string
	verifiedToken  string
	revokedUserID  string
	revokedToken   string
	listed         []session.Session
	devices        []session.Device
	revokedID      string
	deviceID       string
	deviceLabel    string
	deviceRevoked  bool
	createError    error
}

type fakeAccess struct {
	account       access.Account
	features      []string
	grants        []access.FeatureGrant
	err           error
	ensuredUserID string
	ensuredEmail  string
	grantActor    string
	grantRequest  string
	grantUserID   string
	grantFeature  string
	grantReason   string
	grantUntil    time.Time
	revokeActor   string
	revokeRequest string
	revokeUserID  string
	revokeFeature string
	revokeReason  string
	roleActor     string
	roleRequest   string
	roleUserID    string
	roleValue     string
	roleReason    string
	roleError     error
}

func (fake *fakeAccess) RequireFeature(_ context.Context, _ string, feature string) error {
	if fake.err != nil {
		return fake.err
	}
	for _, granted := range fake.features {
		if granted == feature {
			return nil
		}
	}
	return access.ErrEntitlementMissing
}

type fakeDatasets struct {
	manifest     dataset.Manifest
	content      []byte
	err          error
	preparedBy   string
	prepareInput dataset.PrepareRequest
}

type fakeCompute struct {
	created           compute.CreateRequest
	grant             compute.Grant
	err               error
	verifiedUserID    string
	verifiedSessionID string
	verifiedGrantID   string
}

type fakeReadiness struct{ err error }

func (fake fakeReadiness) Ready(_ context.Context) error { return fake.err }

func (fake *fakeCompute) Create(_ context.Context, request compute.CreateRequest) (compute.Grant, error) {
	fake.created = request
	return fake.grant, fake.err
}

func (fake *fakeCompute) Verify(_ context.Context, userID, sessionID, grantID string) (compute.Grant, error) {
	fake.verifiedUserID = userID
	fake.verifiedSessionID = sessionID
	fake.verifiedGrantID = grantID
	return fake.grant, fake.err
}

func (fake *fakeDatasets) Prepare(_ context.Context, owner string, request dataset.PrepareRequest) (dataset.Manifest, error) {
	fake.preparedBy = owner
	fake.prepareInput = request
	return fake.manifest, fake.err
}

func (fake *fakeDatasets) Manifest(_ context.Context, _, _ string) (dataset.Manifest, error) {
	return fake.manifest, fake.err
}

func (fake *fakeDatasets) Content(_ context.Context, _, _ string) ([]byte, dataset.Manifest, error) {
	return fake.content, fake.manifest, fake.err
}

func (fake *fakeAccess) EnsureProfile(_ context.Context, userID, email string) (access.Account, error) {
	fake.ensuredUserID = userID
	fake.ensuredEmail = email
	if fake.err != nil {
		return access.Account{}, fake.err
	}
	return fake.accountFor(userID, email), nil
}

func (fake *fakeAccess) RequireActive(_ context.Context, userID string) (access.Account, error) {
	if fake.err != nil {
		return access.Account{}, fake.err
	}
	return fake.accountFor(userID, ""), nil
}

func (fake *fakeAccess) RequireOperator(_ context.Context, userID string) (access.Account, error) {
	if fake.err != nil {
		return access.Account{}, fake.err
	}
	account := fake.accountFor(userID, "")
	if account.Role != access.RoleOperator {
		return access.Account{}, access.ErrRoleRequired
	}
	return account, nil
}

func (fake *fakeAccess) Features(_ context.Context, _ string) ([]string, error) {
	if fake.err != nil {
		return nil, fake.err
	}
	return fake.features, nil
}

func (fake *fakeAccess) FeatureGrants(_ context.Context, userID string) ([]access.FeatureGrant, error) {
	if fake.err != nil {
		return nil, fake.err
	}
	items := make([]access.FeatureGrant, 0, len(fake.grants))
	for _, grant := range fake.grants {
		if grant.UserID == userID {
			items = append(items, grant)
		}
	}
	return items, nil
}

func (fake *fakeAccess) GrantFeatureAudited(_ context.Context, actor, requestID, userID, feature string, validUntil time.Time, reason string) (access.FeatureGrant, error) {
	if fake.err != nil {
		return access.FeatureGrant{}, fake.err
	}
	fake.grantActor, fake.grantRequest = actor, requestID
	fake.grantUserID, fake.grantFeature = userID, feature
	fake.grantUntil, fake.grantReason = validUntil, reason
	fake.grants = []access.FeatureGrant{{
		UserID: userID, Feature: feature, ValidUntil: validUntil, Reason: reason, Active: true,
	}}
	return fake.grants[0], nil
}

func (fake *fakeAccess) RevokeFeatureAudited(_ context.Context, actor, requestID, userID, feature, reason string) error {
	if fake.err != nil {
		return fake.err
	}
	fake.revokeActor, fake.revokeRequest = actor, requestID
	fake.revokeUserID, fake.revokeFeature, fake.revokeReason = userID, feature, reason
	return nil
}

func (fake *fakeAccess) SetRoleAudited(_ context.Context, actor, requestID, userID, role, reason string) (access.AccountRole, error) {
	if fake.err != nil {
		return access.AccountRole{}, fake.err
	}
	if fake.roleError != nil {
		return access.AccountRole{}, fake.roleError
	}
	fake.roleActor, fake.roleRequest = actor, requestID
	fake.roleUserID, fake.roleValue, fake.roleReason = userID, role, reason
	return access.AccountRole{
		UserID: userID, Role: role, Status: access.StatusActive, UpdatedAt: time.Now().UTC(),
	}, nil
}

func (fake *fakeAccess) accountFor(userID, email string) access.Account {
	if fake.account.UserID != "" {
		return fake.account
	}
	return access.Account{UserID: userID, Email: email, Role: access.RoleUser, Status: access.StatusActive}
}

func (fake *fakeSessions) Create(_ context.Context, userID, installationID, label string) (session.Created, error) {
	fake.createdUserID = userID
	if fake.createError != nil {
		return session.Created{}, fake.createError
	}
	if installationID == "" || label == "" {
		return session.Created{}, session.ErrInvalidRequest
	}
	return fake.created, nil
}

func (fake *fakeSessions) ActiveLimit() int { return 1 }

func (fake *fakeSessions) DeviceSwitchCooldown() time.Duration { return 24 * time.Hour }

func (fake *fakeSessions) Verify(_ context.Context, userID, token string) (session.Session, error) {
	fake.verifiedUserID = userID
	fake.verifiedToken = token
	return fake.verified, fake.verifyError
}

func (fake *fakeSessions) VerifyByID(_ context.Context, userID, sessionID string) (session.Session, error) {
	fake.verifiedUserID = userID
	if fake.verifyError != nil {
		return session.Session{}, fake.verifyError
	}
	if fake.verified.ID != "" && fake.verified.ID != sessionID {
		return session.Session{}, session.ErrInvalid
	}
	return fake.verified, nil
}

func (fake *fakeSessions) Revoke(_ context.Context, userID, token string) error {
	fake.revokedUserID = userID
	fake.revokedToken = token
	return nil
}

func (fake *fakeSessions) List(_ context.Context, userID string) ([]session.Session, error) {
	fake.verifiedUserID = userID
	return fake.listed, nil
}

func (fake *fakeSessions) RevokeByID(_ context.Context, userID, sessionID string) error {
	fake.revokedUserID = userID
	fake.revokedID = sessionID
	return nil
}

func (fake *fakeSessions) ListDevices(_ context.Context, userID string) ([]session.Device, error) {
	fake.verifiedUserID = userID
	return fake.devices, nil
}

func (fake *fakeSessions) RenameDevice(_ context.Context, userID, installationID, label string) error {
	fake.revokedUserID = userID
	fake.deviceID = installationID
	fake.deviceLabel = label
	return nil
}

func (fake *fakeSessions) RevokeDevice(_ context.Context, userID, installationID string) error {
	fake.revokedUserID = userID
	fake.deviceID = installationID
	fake.deviceRevoked = true
	return nil
}

func testServer(t *testing.T, identity fakeIdentity, sessions *fakeSessions) *api.Server {
	t.Helper()
	server, err := api.NewServer(identity, sessions, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{})
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func screenerTestManifest() dataset.Manifest {
	return dataset.Manifest{DatasetID: "ds-test", Version: "v1", Checksum: "sha256:test", Purpose: "screen",
		Symbols: []string{"BBCA.JK"}, AvailableRange: dataset.Range{From: "2026-01-01", To: "2026-12-31"}}
}

func assertErrorCode(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("cache control = %q", response.Header().Get("Cache-Control"))
	}
	var payload struct {
		Error struct {
			Code      string `json:"code"`
			RequestID string `json:"request_id"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != code || payload.Error.RequestID == "" {
		t.Fatalf("error = %+v", payload.Error)
	}
}
