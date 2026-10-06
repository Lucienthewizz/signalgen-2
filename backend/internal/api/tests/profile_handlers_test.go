package apitests

import (
	"bytes"
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

type fakeProfiles struct {
	owner string
	input account.UpdateProfileInput
	calls int
	err   error
}

func (fake *fakeProfiles) Profile(_ context.Context, owner string) (account.Profile, error) {
	fake.owner = owner
	fake.calls++
	return account.Profile{UserID: owner, DisplayName: "Lucien", Version: 1}, fake.err
}
func (fake *fakeProfiles) UpdateProfile(_ context.Context, owner string, input account.UpdateProfileInput) (account.Profile, error) {
	fake.owner = owner
	fake.input = input
	fake.calls++
	profile := account.Profile{UserID: owner, Version: input.Version + 1}
	if input.DisplayName != nil {
		profile.DisplayName = *input.DisplayName
	}
	if input.Bio != nil {
		profile.Bio = *input.Bio
	}
	return profile, fake.err
}

func TestProfileRoutes(t *testing.T) {
	for _, tc := range []struct {
		name, method, body, bearer, session string
		code                                int
		err                                 error
		calls                               int
	}{
		{"read", "GET", "", "test", "session", 200, nil, 1},
		{"write", "PATCH", `{"display_name":"  Lucien  ","version":1}`, "test", "session", 200, nil, 1},
		{"bio_only", "PATCH", `{"bio":"Belajar saham","version":1}`, "test", "session", 200, nil, 1},
		{"null_only", "PATCH", `{"bio":null,"version":1}`, "test", "session", 422, nil, 0},
		{"missing_bearer", "GET", "", "", "session", 401, nil, 0},
		{"missing_session", "GET", "", "test", "", 401, nil, 0},
		{"owner_injection", "PATCH", `{"user_id":"user-b","display_name":"Lucien","version":1}`, "test", "session", 400, nil, 0},
		{"role_injection", "PATCH", `{"role":"operator","display_name":"Lucien","version":1}`, "test", "session", 400, nil, 0},
		{"email_injection", "PATCH", `{"email":"x@test.invalid","display_name":"Lucien","version":1}`, "test", "session", 400, nil, 0},
		{"invalid", "PATCH", `{"version":1}`, "test", "session", 422, nil, 0},
		{"stale", "PATCH", `{"display_name":"Lucien","version":1}`, "test", "session", 409, account.ErrProfileConflict, 1},
		{"storage_error", "GET", "", "test", "session", 503, errors.New("private connection secret"), 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			profiles := &fakeProfiles{err: tc.err}
			server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, api.WithProfileStore(profiles))
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(tc.method, "/api/v1/account/profile", bytes.NewBufferString(tc.body))
			if tc.bearer != "" {
				request.Header.Set("Authorization", "Bearer "+tc.bearer)
			}
			request.Header.Set("X-App-Session", tc.session)
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if response.Code != tc.code || profiles.calls != tc.calls {
				t.Fatalf("status=%d calls=%d body=%s", response.Code, profiles.calls, response.Body.String())
			}
			if profiles.calls > 0 && profiles.owner != "user-a" {
				t.Fatal("untrusted owner used")
			}
			if strings.Contains(response.Body.String(), "private connection secret") {
				t.Fatal("secret exposed")
			}
			if tc.code == 200 && response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("profile cacheable")
			}
			if tc.name == "write" && *profiles.input.DisplayName != "Lucien" {
				t.Fatal("input not normalized")
			}
		})
	}
}

func TestProfileUnavailableWithoutRepository(t *testing.T) {
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "/api/v1/account/profile", nil)
	request.Header.Set("Authorization", "Bearer test")
	request.Header.Set("X-App-Session", "session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != 503 {
		t.Fatalf("status=%d", response.Code)
	}
}
