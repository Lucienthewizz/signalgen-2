package rules

import (
	"context"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

type Repository interface {
	List(ctx context.Context, ownerUserID string) ([]Rule, error)
	Get(ctx context.Context, ownerUserID, id string) (Rule, error)
	Create(ctx context.Context, ownerUserID string, definition core.RuleSnapshot) (Rule, error)
	Update(ctx context.Context, ownerUserID, id string, expectedVersion int, definition core.RuleSnapshot) (Rule, error)
	Delete(ctx context.Context, ownerUserID, id string, expectedVersion int) error
}
