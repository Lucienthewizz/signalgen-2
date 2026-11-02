package apitests

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/go-jose/go-jose/v4"
	"github.com/golang-jwt/jwt/v5"
)

func TestWarmLocalJWTDoesNotCacheSessionOrAccountAuthorization(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var keyReads, remoteReads atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/.well-known/jwks.json" {
			remoteReads.Add(1)
			w.WriteHeader(500)
			return
		}
		keyReads.Add(1)
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, Algorithm: "ES256", KeyID: "test", Use: "sig"}}})
	}))
	defer upstream.Close()
	identity, err := auth.NewSupabaseVerifier(upstream.URL, "fixture-publishable", upstream.Client())
	if err != nil {
		t.Fatal(err)
	}
	identity.EnableLocalVerification()
	const owner = "00000000-0000-4000-8000-000000000001"
	claims := jwt.MapClaims{"iss": upstream.URL + "/auth/v1", "aud": "authenticated", "sub": owner,
		"session_id": "00000000-0000-4000-8000-000000000002", "role": "authenticated",
		"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Add(-time.Minute).Unix(),
		"user_metadata": map[string]string{"role": "admin"}}
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	token.Header["kid"] = "test"
	raw, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	sessions := &fakeSessions{verified: session.Session{ID: "fixture-session"}}
	accounts := &countedAccountAccess{fakeAccess: &fakeAccess{account: access.Account{UserID: owner, Role: access.RoleUser, Status: access.StatusActive}}}
	server, err := api.NewServer(identity, sessions, accounts, &fakeDatasets{}, &fakeCompute{})
	if err != nil {
		t.Fatal(err)
	}
	read := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/account/me", nil)
		r.Header.Set("Authorization", "Bearer "+raw)
		r.Header.Set("X-App-Session", "fixture-app-session")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		return w
	}
	for i := 0; i < 2; i++ {
		w := read()
		if w.Code != 200 {
			t.Fatalf("account read status = %d", w.Code)
		}
		var body struct {
			User struct {
				Role string `json:"role"`
			} `json:"user"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.User.Role != "user" {
			t.Fatal("editable metadata affected authorization")
		}
	}
	if accounts.reads != 2 || sessions.verifiedUserID != owner {
		t.Fatal("warm JWT skipped current app authorization")
	}
	sessions.verifyError = session.ErrRevoked
	assertErrorCode(t, read(), 403, "SESSION_REVOKED")
	sessions.verifyError = session.ErrExpired
	assertErrorCode(t, read(), 403, "SESSION_EXPIRED")
	sessions.verifyError = nil
	accounts.err = access.ErrAccountSuspended
	assertErrorCode(t, read(), 403, "ACCOUNT_SUSPENDED")
	if keyReads.Load() != 1 || remoteReads.Load() != 0 {
		t.Fatal("local verification called Auth again")
	}
}
