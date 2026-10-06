package session

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Rotate atomically replaces a session secret, preserving ID, device and expiry.
// The conditional update is a compare-and-swap: only one concurrent request can
// consume the old hash. No grace period, stored plaintext, or expiry extension.
// Queries always include the verified owner because pgx has no auth.uid context.
func (store *PostgresRepository) Rotate(ctx context.Context, userID, sessionID, currentToken string) (Created, error) {
	userID, sessionID, currentToken = strings.TrimSpace(userID), strings.TrimSpace(sessionID), strings.TrimSpace(currentToken)
	if userID == "" || sessionID == "" || currentToken == "" {
		return Created{}, ErrInvalid
	}
	token, err := randomCredential("sgs_", 32)
	if err != nil {
		return Created{}, err
	}
	oldHash := sha256.Sum256([]byte(currentToken))
	newHash := sha256.Sum256([]byte(token))
	item, err := scanPostgresSession(store.db.QueryRow(ctx, `update signalgen.app_sessions
set token_hash=$4, last_seen_at=clock_timestamp()
where user_id=$1::uuid and id=$2 and token_hash=$3
and revoked_at is null and expires_at>clock_timestamp()
returning `+sessionColumns, userID, sessionID, oldHash[:], newHash[:]))
	if errors.Is(err, pgx.ErrNoRows) {
		return Created{}, ErrInvalid
	}
	if err != nil {
		return Created{}, err
	}
	return Created{Session: item, Token: token}, nil
}
