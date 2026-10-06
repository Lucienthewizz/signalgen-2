package apitests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

type rotatingSessions struct {
	*fakeSessions
	rotated          session.Created
	err              error
	owner, id, token string
}

func (store *rotatingSessions) Rotate(_ context.Context, owner, id, token string) (session.Created, error) {
	store.owner, store.id, store.token = owner, id, token
	return store.rotated, store.err
}

func TestRotateCurrentSessionContract(t *testing.T) {
	for _, tc := range []struct {
		path, body string
		err        error
		status     int
	}{
		{"/api/v1/sessions/ses-current/refresh", "", nil, 200},
		{"/api/v1/sessions/ses-current/refresh", "{}", nil, 200},
		{"/api/v1/sessions/ses-other/refresh", "", nil, 404},
		{"/api/v1/sessions/ses-current/refresh", `{"expires_at":"2099-01-01"}`, nil, 400},
		{"/api/v1/sessions/ses-current/refresh", "", session.ErrInvalid, 403},
	} {
		expiry := time.Now().Add(time.Hour).UTC()
		store := &rotatingSessions{fakeSessions: &fakeSessions{verified: session.Session{ID: "ses-current", UserID: "user-a", ExpiresAt: expiry}},
			rotated: session.Created{Session: session.Session{ID: "ses-current", ExpiresAt: expiry}, Token: "new-app-token"}, err: tc.err}
		server := newAuthTestServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeAuthService{})
		server.Sessions = store
		request := httptest.NewRequest("POST", tc.path, strings.NewReader(tc.body))
		request.Header.Set("Authorization", "Bearer identity")
		request.Header.Set("X-App-Session", "old-app-token")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		if response.Code != tc.status {
			t.Fatalf("rotation status=%d wanted=%d", response.Code, tc.status)
		}
		if tc.status == 200 && (store.owner != "user-a" || store.id != "ses-current" || store.token != "old-app-token" ||
			!strings.Contains(response.Body.String(), "new-app-token") || response.Header().Get("Cache-Control") != "private, no-store") {
			t.Fatal("rotation lost ownership or response secret")
		}
		if tc.status == 400 || tc.status == 404 {
			if store.owner != "" {
				t.Fatal("invalid request reached rotation")
			}
		}
	}
}

func TestRotateRequiresIdentityAndCurrentAppSession(t *testing.T) {
	server := newAuthTestServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeAuthService{})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/ses-current/refresh", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatal("rotation accepted no identity")
	}
	request.Header.Set("Authorization", "Bearer identity")
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatal("rotation accepted no app session")
	}
}
