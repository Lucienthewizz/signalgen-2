package session

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type sessionSlotTx interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// reserveSessionSlot runs after the caller's per-user advisory lock and active
// account check, inside the same transaction as inserting the new token hash.
// Parallel replicas therefore cannot each consume the same last session slot.
func (store *PostgresRepository) reserveSessionSlot(ctx context.Context, tx sessionSlotTx, userID, installationID string, now time.Time) error {
	if store.max == 1 {
		return store.reserveExclusiveSlot(ctx, tx, userID, installationID, now)
	}
	// A same-browser login rotates its old token without consuming another slot.
	// Count other unexpired installations BEFORE revoking anything, so a rejected
	// sixth browser or a later insert failure cannot invalidate existing sessions.
	var others int
	err := tx.QueryRow(ctx, `select count(*) from signalgen.app_sessions
where user_id=$1::uuid and installation_id<>$2 and revoked_at is null and expires_at>$3`, userID, installationID, now).Scan(&others)
	if err != nil {
		return err
	}
	if others >= store.max {
		return ErrSessionLimit
	}
	_, err = tx.Exec(ctx, `update signalgen.app_sessions set revoked_at=$3
where user_id=$1::uuid and installation_id=$2 and revoked_at is null and expires_at>$3`, userID, installationID, now)
	return err
}

// Default max=1 retains the original exclusive-device switch/cooldown behavior.
// Multi-session mode does not reuse this single-current-device state machine.
func (store *PostgresRepository) reserveExclusiveSlot(ctx context.Context, tx sessionSlotTx, userID, installationID string, now time.Time) error {
	_, err := tx.Exec(ctx, `insert into signalgen.account_device_state
(user_id,current_installation_id,updated_at) values ($1::uuid,$2,$3)
on conflict (user_id) do nothing`, userID, installationID, now)
	if err != nil {
		return err
	}
	var current string
	var lastSwitch pgtype.Timestamptz
	err = tx.QueryRow(ctx, `select current_installation_id,last_switched_at
from signalgen.account_device_state where user_id=$1::uuid for update`, userID).Scan(&current, &lastSwitch)
	if err != nil {
		return err
	}
	if current != installationID && lastSwitch.Valid && now.Before(lastSwitch.Time.Add(store.cooldown)) {
		return ErrDeviceCooldown
	}
	if _, err := tx.Exec(ctx, `update signalgen.app_sessions set revoked_at=$2
where user_id=$1::uuid and revoked_at is null and expires_at>$2`, userID, now); err != nil {
		return err
	}
	if current != installationID {
		_, err = tx.Exec(ctx, `update signalgen.account_device_state
set current_installation_id=$2,last_switched_at=$3,updated_at=$3 where user_id=$1::uuid`, userID, installationID, now)
	}
	return err
}
