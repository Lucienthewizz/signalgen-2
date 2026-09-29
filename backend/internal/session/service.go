package session

import (
	"context"
	"time"
)

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
