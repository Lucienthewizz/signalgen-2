package auth

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"

	"github.com/go-jose/go-jose/v4"
	"github.com/golang-jwt/jwt/v5"
)

const fixtureUser = "00000000-0000-4000-8000-000000000001"
const fixtureSession = "00000000-0000-4000-8000-000000000002"

type jwtFixture struct {
	verifier *SupabaseVerifier
	server   *httptest.Server
	private  *ecdsa.PrivateKey
	mu       sync.Mutex
	keys     []jose.JSONWebKey
	status   int
	keyHits  atomic.Int64
	userHits atomic.Int64
}

func newJWTFixture(t testing.TB) *jwtFixture {
	t.Helper()
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	f := &jwtFixture{private: private, status: 200, keys: []jose.JSONWebKey{{Key: &private.PublicKey, KeyID: "fixture-key", Algorithm: "ES256", Use: "sig"}}}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/auth/v1/user" {
			f.userHits.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]string{"id": fixtureUser, "email": "fixture@example.test"})
			return
		}
		if r.URL.Path != "/auth/v1/.well-known/jwks.json" {
			w.WriteHeader(404)
			return
		}
		f.keyHits.Add(1)
		f.mu.Lock()
		defer f.mu.Unlock()
		w.WriteHeader(f.status)
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: f.keys})
	}))
	t.Cleanup(f.server.Close)
	f.verifier, err = NewSupabaseVerifier(f.server.URL, "fixture-publishable", f.server.Client())
	if err != nil {
		t.Fatal(err)
	}
	f.verifier.EnableLocalVerification()
	return f
}

func (f *jwtFixture) claims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{"iss": f.server.URL + "/auth/v1", "aud": "authenticated", "sub": fixtureUser,
		"session_id": fixtureSession, "role": "authenticated", "iat": now.Add(-time.Minute).Unix(),
		"exp": now.Add(time.Hour).Unix(), "email": "fixture@example.test",
		"user_metadata": map[string]string{"full_name": "Fixture", "role": "admin"}}
}

func signFixture(t testing.TB, claims jwt.MapClaims, method jwt.SigningMethod, key any, kid string) string {
	t.Helper()
	token := jwt.NewWithClaims(method, claims)
	if kid != "" {
		token.Header["kid"] = kid
	}
	raw, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func (f *jwtFixture) token(t testing.TB) string {
	return signFixture(t, f.claims(), jwt.SigningMethodES256, f.private, "fixture-key")
}

func TestLocalJWTCoalescesKeysAndValidatesEveryToken(t *testing.T) {
	f := newJWTFixture(t)
	raw := f.token(t)
	var readers sync.WaitGroup
	for i := 0; i < 24; i++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			principal, err := f.verifier.Verify(context.Background(), raw)
			if err != nil || principal.ID != fixtureUser || principal.FullName != "Fixture" {
				t.Errorf("signed identity not verified: %v", err)
			}
		}()
	}
	readers.Wait()
	if f.keyHits.Load() != 1 || f.userHits.Load() != 0 {
		t.Fatal("warm local validation used remote user lookup or duplicate JWKS fetches")
	}
	bad := f.claims()
	bad["exp"] = time.Now().Add(-time.Minute).Unix()
	if _, err := f.verifier.Verify(context.Background(), signFixture(t, bad, jwt.SigningMethodES256, f.private, "fixture-key")); !errors.Is(err, ErrTokenInvalid) {
		t.Fatal("key cache must not cache successful token decisions")
	}
}

func TestLocalJWTRejectsInvalidClaimsAndSignatureWithoutRemoteFallback(t *testing.T) {
	f := newJWTFixture(t)
	for _, test := range []struct {
		name, field string
		value       any
	}{
		{"issuer", "iss", "https://other-project.invalid/auth/v1"},
		{"audience", "aud", "anon"}, {"expired", "exp", time.Now().Add(-time.Second).Unix()},
		{"missing-exp", "exp", nil}, {"future-iat", "iat", time.Now().Add(time.Hour).Unix()},
		{"missing-iat", "iat", nil}, {"future-nbf", "nbf", time.Now().Add(time.Hour).Unix()},
		{"service-role", "role", "service_role"}, {"missing-subject", "sub", nil},
		{"invalid-subject", "sub", "not-a-uuid"}, {"missing-session", "session_id", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			claims := f.claims()
			if test.value == nil {
				delete(claims, test.field)
			} else {
				claims[test.field] = test.value
			}
			raw := signFixture(t, claims, jwt.SigningMethodES256, f.private, "fixture-key")
			if _, err := f.verifier.Verify(context.Background(), raw); !errors.Is(err, ErrTokenInvalid) {
				t.Fatalf("expected invalid token: %v", err)
			}
		})
	}
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	for _, raw := range []string{
		signFixture(t, f.claims(), jwt.SigningMethodES256, other, "fixture-key"),
		signFixture(t, f.claims(), jwt.SigningMethodES256, f.private, ""),
		signFixture(t, f.claims(), jwt.SigningMethodES256, f.private, "unknown-key"),
		signFixture(t, f.claims(), jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, "fixture-key"),
		"not-a-jwt",
	} {
		if _, err := f.verifier.Verify(context.Background(), raw); !errors.Is(err, ErrTokenInvalid) {
			t.Fatalf("unsafe token accepted: %v", err)
		}
	}
	if f.userHits.Load() != 0 || f.keyHits.Load() != 1 {
		t.Fatal("invalid local JWT triggered remote fallback or unbounded key refresh")
	}
}

func TestLocalJWTKeepsLegacyHS256OnRemoteValidation(t *testing.T) {
	f := newJWTFixture(t)
	raw := signFixture(t, f.claims(), jwt.SigningMethodHS256, []byte("synthetic-test-secret"), "")
	principal, err := f.verifier.Verify(context.Background(), raw)
	if err != nil || principal.ID != fixtureUser || f.userHits.Load() != 1 || f.keyHits.Load() != 0 {
		t.Fatal("legacy token must use authoritative Auth endpoint")
	}
}

func TestLocalJWTRS256AndAlgorithmBinding(t *testing.T) {
	f := newJWTFixture(t)
	private, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.keys = []jose.JSONWebKey{{Key: &private.PublicKey, KeyID: "rsa-fixture", Algorithm: "RS256", Use: "sig"}}
	f.mu.Unlock()
	raw := signFixture(t, f.claims(), jwt.SigningMethodRS256, private, "rsa-fixture")
	if _, err := f.verifier.Verify(context.Background(), raw); err != nil {
		t.Fatal(err)
	}
	raw = signFixture(t, f.claims(), jwt.SigningMethodES256, f.private, "rsa-fixture")
	if _, err := f.verifier.Verify(context.Background(), raw); !errors.Is(err, ErrTokenInvalid) {
		t.Fatal("mismatched key algorithm accepted")
	}
}

func TestJWKSRotationExpiryAndProviderFailure(t *testing.T) {
	f := newJWTFixture(t)
	old := f.token(t)
	if _, err := f.verifier.Verify(context.Background(), old); err != nil {
		t.Fatal(err)
	}
	newKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	f.mu.Lock()
	f.keys = []jose.JSONWebKey{{Key: &newKey.PublicKey, KeyID: "rotated", Algorithm: "ES256", Use: "sig"}}
	f.mu.Unlock()
	cache := f.verifier.local.keys
	cache.mu.Lock()
	cache.expires, cache.nextRefresh = time.Now().Add(-time.Second), time.Time{}
	cache.mu.Unlock()
	raw := signFixture(t, f.claims(), jwt.SigningMethodES256, newKey, "rotated")
	if _, err := f.verifier.Verify(context.Background(), raw); err != nil {
		t.Fatal(err)
	}
	if _, err := f.verifier.Verify(context.Background(), old); !errors.Is(err, ErrTokenInvalid) {
		t.Fatal("removed key still trusted after refresh")
	}
	f.mu.Lock()
	f.status = 503
	f.mu.Unlock()
	// A fresh known key works during a JWKS outage, without extending its TTL.
	if _, err := f.verifier.Verify(context.Background(), raw); err != nil {
		t.Fatal(err)
	}
	cache.mu.Lock()
	cache.expires, cache.nextRefresh = time.Now().Add(-time.Second), time.Time{}
	cache.mu.Unlock()
	for i := 0; i < 3; i++ {
		if _, err := f.verifier.Verify(context.Background(), raw); !errors.Is(err, ErrProviderUnavailable) {
			t.Fatalf("stale key must fail closed: %v", err)
		}
	}
	if f.keyHits.Load() != 3 || f.userHits.Load() != 0 {
		t.Fatal("JWKS outage was not bounded or triggered remote fallback")
	}
}

func TestUnknownKeyRefreshFailureStaysUnavailableDuringBackoff(t *testing.T) {
	f := newJWTFixture(t)
	if _, err := f.verifier.Verify(context.Background(), f.token(t)); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.status = 503
	f.mu.Unlock()
	cache := f.verifier.local.keys
	cache.mu.Lock()
	cache.nextRefresh = time.Time{}
	cache.mu.Unlock()
	raw := signFixture(t, f.claims(), jwt.SigningMethodES256, f.private, "new-key")
	for i := 0; i < 3; i++ {
		if _, err := f.verifier.Verify(context.Background(), raw); !errors.Is(err, ErrProviderUnavailable) {
			t.Fatal("provider failure became invalid credentials during retry")
		}
	}
	if f.keyHits.Load() != 2 {
		t.Fatal("retry ignored key-fetch backoff")
	}
	if _, err := f.verifier.Verify(context.Background(), f.token(t)); err != nil {
		t.Fatal("fresh existing key stopped working")
	}
}

func TestJWTRequestTimingsSeparateColdWarmAndRemoteVerification(t *testing.T) {
	f := newJWTFixture(t)
	var output bytes.Buffer
	observer := platformhttp.NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	raw := f.token(t)
	handler := observer.Observe(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := f.verifier.Verify(r.Context(), raw); err != nil {
			t.Error(err)
		}
		w.WriteHeader(200)
	}))
	for _, mode := range []string{"cold", "warm", "legacy"} {
		if mode == "legacy" {
			raw = signFixture(t, f.claims(), jwt.SigningMethodHS256, []byte("synthetic-secret"), "")
		}
		output.Reset()
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/fixture", nil))
		var event struct {
			Timings map[string]int64 `json:"timings_us"`
		}
		if err := json.Unmarshal(output.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		_, local := event.Timings["auth_local"]
		_, keys := event.Timings["auth_keys"]
		_, remote := event.Timings["auth_remote"]
		if (mode == "cold" && (!local || !keys || remote)) ||
			(mode == "warm" && (!local || keys || remote)) ||
			(mode == "legacy" && (local || keys || !remote)) {
			t.Fatalf("%s timings = %v", mode, event.Timings)
		}
	}
}

func TestJWKSRejectsPrivateEncryptionAndDuplicateKeys(t *testing.T) {
	for _, kind := range []string{"private", "encryption", "duplicate"} {
		t.Run(kind, func(t *testing.T) {
			f := newJWTFixture(t)
			f.mu.Lock()
			switch kind {
			case "private":
				f.keys[0].Key = f.private
			case "encryption":
				f.keys[0].Use = "enc"
			case "duplicate":
				f.keys = append(f.keys, f.keys[0])
			}
			f.mu.Unlock()
			if _, err := f.verifier.Verify(context.Background(), f.token(t)); err == nil {
				t.Fatal("unsafe JWKS accepted")
			}
		})
	}
}

func TestUnknownSigningKeyRefreshesAfterCooldown(t *testing.T) {
	f := newJWTFixture(t)
	if _, err := f.verifier.Verify(context.Background(), f.token(t)); err != nil {
		t.Fatal(err)
	}
	rotated, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	f.mu.Lock()
	f.keys = append(f.keys, jose.JSONWebKey{Key: &rotated.PublicKey, KeyID: "new", Algorithm: "ES256", Use: "sig"})
	f.mu.Unlock()
	raw := signFixture(t, f.claims(), jwt.SigningMethodES256, rotated, "new")
	if _, err := f.verifier.Verify(context.Background(), raw); !errors.Is(err, ErrTokenInvalid) {
		t.Fatal("unknown key ignored refresh cooldown")
	}
	cache := f.verifier.local.keys
	cache.mu.Lock()
	cache.nextRefresh = time.Time{}
	cache.mu.Unlock()
	if _, err := f.verifier.Verify(context.Background(), raw); err != nil {
		t.Fatal(err)
	}
	if f.keyHits.Load() != 2 {
		t.Fatal("new key did not trigger one bounded refresh")
	}
}

func TestJWKSRejectsMalformedOrOversizedResponses(t *testing.T) {
	for _, payload := range []string{`not json`, strings.Repeat(" ", 64*1024+1)} {
		f := newJWTFixture(t)
		f.verifier.local.keys.client = httpClientFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(payload))}, nil
		})
		if _, err := f.verifier.Verify(context.Background(), f.token(t)); !errors.Is(err, ErrProviderUnavailable) {
			t.Fatal("malformed key response was not rejected")
		}
	}
}

func TestJWKSCancellationDoesNotCancelSharedFetch(t *testing.T) {
	f := newJWTFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	base := f.server.Client()
	f.verifier.local.keys.client = httpClientFunc(func(r *http.Request) (*http.Response, error) {
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return base.Do(r)
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	raw := f.token(t)
	first := make(chan error, 1)
	go func() { _, err := f.verifier.Verify(ctx, raw); first <- err }()
	<-started
	cancel()
	if err := <-first; !errors.Is(err, ErrProviderUnavailable) {
		t.Fatal("canceled reader did not leave")
	}
	second := make(chan error, 1)
	go func() { _, err := f.verifier.Verify(context.Background(), raw); second <- err }()
	close(release)
	if err := <-second; err != nil {
		t.Fatal(err)
	}
	if f.keyHits.Load() != 1 {
		t.Fatal("shared fetch was canceled or duplicated")
	}
}

type httpClientFunc func(*http.Request) (*http.Response, error)

func (f httpClientFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

func BenchmarkLocalJWTWarm(b *testing.B) {
	f := newJWTFixture(b)
	raw := f.token(b)
	if _, err := f.verifier.Verify(context.Background(), raw); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := f.verifier.Verify(context.Background(), raw); err != nil {
			b.Fatal(err)
		}
	}
}
