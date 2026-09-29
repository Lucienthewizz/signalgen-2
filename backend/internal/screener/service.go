package screener

import "context"

// TicketRepository creates one-use credentials for WebSocket upgrades. This
// keeps long-lived Supabase bearer tokens out of WebSocket URLs.
type TicketRepository interface {
	Create(ctx context.Context, binding Binding) (CreatedTicket, error)
	Consume(ctx context.Context, token string) (Binding, error)
}
