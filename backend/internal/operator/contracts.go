// Package operator owns privileged, audited account and entitlement changes.
package operator

import (
	"context"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/entitlement"
)

// Service defines privileged changes with a verified actor and audit context.
type Service interface {
	RequireOperator(ctx context.Context, userID string) (account.State, error)
	GrantFeatureAudited(ctx context.Context, actor, requestID, userID, feature string, validUntil time.Time, reason string) (entitlement.Grant, error)
	RevokeFeatureAudited(ctx context.Context, actor, requestID, userID, feature, reason string) error
	SetRoleAudited(ctx context.Context, actor, requestID, userID, role, reason string) (account.Role, error)
}
