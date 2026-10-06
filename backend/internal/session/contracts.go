package session

import (
	"context"
	"time"
)

// Repository is the persistence contract for owner-scoped sessions and devices.
// The active implementation is Postgres; HTTP handlers never issue SQL directly.
type Repository interface {
	Create(ctx context.Context, userID, installationID, label string) (Created, error)
	Verify(ctx context.Context, userID, token string) (Session, error)
	VerifyByID(ctx context.Context, userID, sessionID string) (Session, error)
	Revoke(ctx context.Context, userID, token string) error
	List(ctx context.Context, userID string) ([]Session, error)
	RevokeByID(ctx context.Context, userID, sessionID string) error
	ListDevices(ctx context.Context, userID string) ([]Device, error)
	RenameDevice(ctx context.Context, userID, installationID, label string) error
	RevokeDevice(ctx context.Context, userID, installationID string) error
	ActiveLimit() int
	DeviceSwitchCooldown() time.Duration
}

// TokenRotator is implemented by the active Postgres adapter. Legacy reference
// repositories do not silently pretend to rotate security credentials.
type TokenRotator interface {
	Rotate(ctx context.Context, userID, sessionID, currentToken string) (Created, error)
}
