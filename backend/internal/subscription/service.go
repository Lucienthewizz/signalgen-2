package subscription

import "context"

type Service interface {
	Plans(ctx context.Context) ([]Plan, error)
	Current(ctx context.Context, userID string) (Subscription, error)
	ActivateManual(ctx context.Context, request ActivateRequest) (Subscription, error)
	Cancel(ctx context.Context, request CancelRequest) (Subscription, error)
}
