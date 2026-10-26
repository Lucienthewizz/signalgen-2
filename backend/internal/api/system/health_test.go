package systemapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/platform/healthcheck"
)

type readinessFunc func(context.Context) error

func (check readinessFunc) Ready(ctx context.Context) error { return check(ctx) }

func TestReadinessAllowsColdDependencyBeyondFormerTwoSecondLimit(t *testing.T) {
	checker := readinessFunc(func(ctx context.Context) error {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) <= 2*time.Second || time.Until(deadline) > healthcheck.ReadinessTimeout {
			t.Fatal("readiness must have the bounded cold-connection budget")
		}
		timer := time.NewTimer(2100 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-timer.C:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	response := httptest.NewRecorder()
	(&Handler{}).Ready([]shared.ReadinessChecker{checker})(response, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"ready"`) {
		t.Fatalf("cold readiness returned %d: %s", response.Code, response.Body.String())
	}
}

func TestReadinessPreservesEarlierDeadlineAndStillFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		fail   bool
		status int
	}{
		// The shared HTTP boundary maps an expired parent request to 504.
		{"parent_cancellation", false, http.StatusGatewayTimeout},
		{"dependency_failure", true, http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			parentBudget := time.Second
			if !tc.fail {
				parentBudget = 10 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), parentBudget)
			defer cancel()
			parentDeadline, _ := ctx.Deadline()
			secondCalled := false
			checker := readinessFunc(func(ctx context.Context) error {
				deadline, _ := ctx.Deadline()
				if !deadline.Equal(parentDeadline) {
					t.Fatal("readiness extended the parent request deadline")
				}
				if tc.fail {
					return errors.New("private connection details must stay private")
				}
				<-ctx.Done()
				return ctx.Err()
			})
			second := readinessFunc(func(context.Context) error { secondCalled = true; return nil })
			response := httptest.NewRecorder()
			(&Handler{}).Ready([]shared.ReadinessChecker{checker, second})(response, httptest.NewRequest(http.MethodGet, "/ready", nil).WithContext(ctx))
			if response.Code != tc.status || secondCalled || strings.Contains(response.Body.String(), "private connection") {
				t.Fatalf("unsafe readiness failure: status=%d second=%t", response.Code, secondCalled)
			}
		})
	}
}
