package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sessions stores only a SHA-256 token hash. Tokens are returned once at
// creation and are never logged or included in list responses.
type PostgresRepository struct {
	db       *pgxpool.Pool
	max      int
	cooldown time.Duration
	ttl      time.Duration
}

func NewPostgresRepository(db *pgxpool.Pool, max int, cooldown time.Duration) (*PostgresRepository, error) {
	if db == nil || max != 1 || cooldown <= 0 {
		return nil, fmt.Errorf("invalid Postgres session configuration")
	}
	return &PostgresRepository{db: db, max: max, cooldown: cooldown, ttl: 24 * time.Hour}, nil
}

func (store *PostgresRepository) Ready(ctx context.Context) error { return store.db.Ping(ctx) }
func (store *PostgresRepository) ActiveLimit() int                { return store.max }
func (store *PostgresRepository) DeviceSwitchCooldown() time.Duration {
	return store.cooldown
}

// CooldownUntil is owner-scoped metadata, never a permission bypass.
func (store *PostgresRepository) CooldownUntil(ctx context.Context, userID string) (time.Time, error) {
	var switched pgtype.Timestamptz
	err := store.db.QueryRow(ctx, `select last_switched_at from signalgen.account_device_state where user_id=$1::uuid`, userID).Scan(&switched)
	if err != nil || !switched.Valid {
		return time.Time{}, err
	}
	return switched.Time.Add(store.cooldown), nil
}

const sessionColumns = `id,user_id::text,installation_id,label,created_at,expires_at,last_seen_at,revoked_at`

func (store *PostgresRepository) Create(ctx context.Context, userID, installationID, label string) (Created, error) {
	userID, installationID, label = strings.TrimSpace(userID), strings.TrimSpace(installationID), strings.TrimSpace(label)
	if userID == "" || installationID == "" || label == "" || len(label) > 100 {
		return Created{}, ErrInvalidRequest
	}
	id, err := randomCredential("ses_", 16)
	if err != nil {
		return Created{}, err
	}
	token, err := randomCredential("sgs_", 32)
	if err != nil {
		return Created{}, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return Created{}, err
	}
	defer tx.Rollback(ctx)
	// This lock serializes session/device changes for one account, including
	// requests arriving at separate API replicas.
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return Created{}, err
	}
	_, err = tx.Exec(ctx, `insert into signalgen.account_device_state
(user_id,current_installation_id,updated_at) values ($1::uuid,$2,$3)
on conflict (user_id) do nothing`, userID, installationID, now)
	if err != nil {
		return Created{}, err
	}
	var current string
	var lastSwitch pgtype.Timestamptz
	err = tx.QueryRow(ctx, `select current_installation_id,last_switched_at
from signalgen.account_device_state where user_id=$1::uuid for update`, userID).Scan(&current, &lastSwitch)
	if err != nil {
		return Created{}, err
	}
	if current != installationID && lastSwitch.Valid && now.Before(lastSwitch.Time.Add(store.cooldown)) {
		return Created{}, ErrDeviceCooldown
	}
	if _, err := tx.Exec(ctx, `update signalgen.app_sessions set revoked_at=$2
where user_id=$1::uuid and revoked_at is null and expires_at>$2`, userID, now); err != nil {
		return Created{}, err
	}
	if current != installationID {
		_, err = tx.Exec(ctx, `update signalgen.account_device_state
set current_installation_id=$2,last_switched_at=$3,updated_at=$3 where user_id=$1::uuid`, userID, installationID, now)
		if err != nil {
			return Created{}, err
		}
	}
	hash := sha256.Sum256([]byte(token))
	item := Session{
		ID: id, UserID: userID, InstallationID: installationID, Label: label,
		CreatedAt: now, ExpiresAt: now.Add(store.ttl), LastSeenAt: now,
	}
	_, err = tx.Exec(ctx, `insert into signalgen.app_sessions
(id,user_id,installation_id,label,token_hash,created_at,expires_at,last_seen_at)
values ($1,$2::uuid,$3,$4,$5,$6,$7,$8)`,
		id, userID, installationID, label, hash[:], now, item.ExpiresAt, now)
	if err != nil {
		return Created{}, fmt.Errorf("create Postgres session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Created{}, err
	}
	return Created{Session: item, Token: token}, nil
}

func (store *PostgresRepository) Verify(ctx context.Context, userID, token string) (Session, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(token) == "" {
		return Session{}, ErrInvalid
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(token)))
	item, err := scanPostgresSession(store.db.QueryRow(ctx, `select `+sessionColumns+`
from signalgen.app_sessions where user_id=$1::uuid and token_hash=$2`, userID, hash[:]))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalid
	}
	if err != nil {
		return Session{}, err
	}
	if err := validSession(item); err != nil {
		return Session{}, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	if _, err := store.db.Exec(ctx, `update signalgen.app_sessions set last_seen_at=$3
where user_id=$1::uuid and id=$2`, userID, item.ID, now); err != nil {
		return Session{}, err
	}
	item.LastSeenAt = now
	return item, nil
}

func (store *PostgresRepository) VerifyByID(ctx context.Context, userID, sessionID string) (Session, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return Session{}, ErrInvalid
	}
	item, err := scanPostgresSession(store.db.QueryRow(ctx, `select `+sessionColumns+`
from signalgen.app_sessions where user_id=$1::uuid and id=$2`, userID, sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalid
	}
	if err != nil {
		return Session{}, err
	}
	return item, validSession(item)
}

func (store *PostgresRepository) Revoke(ctx context.Context, userID, token string) error {
	item, err := store.Verify(ctx, userID, token)
	if err != nil {
		return err
	}
	return store.RevokeByID(ctx, userID, item.ID)
}

func (store *PostgresRepository) List(ctx context.Context, userID string) ([]Session, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidRequest
	}
	rows, err := store.db.Query(ctx, `select `+sessionColumns+`
from signalgen.app_sessions where user_id=$1::uuid
order by created_at desc,id desc limit 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Session, 0)
	for rows.Next() {
		item, err := scanPostgresSession(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *PostgresRepository) RevokeByID(ctx context.Context, userID, sessionID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return ErrInvalidRequest
	}
	result, err := store.db.Exec(ctx, `update signalgen.app_sessions set revoked_at=now()
where user_id=$1::uuid and id=$2 and revoked_at is null`, userID, sessionID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 1 {
		return nil
	}
	var exists bool
	if err := store.db.QueryRow(ctx, `select exists(select 1 from signalgen.app_sessions
where user_id=$1::uuid and id=$2)`, userID, sessionID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func (store *PostgresRepository) ListDevices(ctx context.Context, userID string) ([]Device, error) {
	items, err := store.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	devices := make([]Device, 0)
	positions := make(map[string]int)
	now := time.Now().UTC()
	for _, item := range items {
		index, found := positions[item.InstallationID]
		status := "expired"
		if item.RevokedAt != nil {
			status = "revoked"
		} else if now.Before(item.ExpiresAt) {
			status = "active"
		}
		if !found {
			positions[item.InstallationID] = len(devices)
			devices = append(devices, Device{ID: item.InstallationID, Label: item.Label,
				Status: status, CreatedAt: item.CreatedAt, LastSeenAt: item.LastSeenAt})
			continue
		}
		device := &devices[index]
		if item.CreatedAt.Before(device.CreatedAt) {
			device.CreatedAt = item.CreatedAt
		}
		if item.LastSeenAt.After(device.LastSeenAt) {
			device.LastSeenAt = item.LastSeenAt
		}
		if status == "active" {
			device.Status = status
		}
	}
	return devices, nil
}

func (store *PostgresRepository) RenameDevice(ctx context.Context, userID, installationID, label string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(installationID) == "" ||
		strings.TrimSpace(label) == "" || len(label) > 100 {
		return ErrInvalidRequest
	}
	result, err := store.db.Exec(ctx, `update signalgen.app_sessions set label=$3
where user_id=$1::uuid and installation_id=$2`, userID, installationID, strings.TrimSpace(label))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (store *PostgresRepository) RevokeDevice(ctx context.Context, userID, installationID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(installationID) == "" {
		return ErrInvalidRequest
	}
	result, err := store.db.Exec(ctx, `update signalgen.app_sessions set revoked_at=now()
where user_id=$1::uuid and installation_id=$2 and revoked_at is null`, userID, installationID)
	if err != nil {
		return err
	}
	if result.RowsAffected() > 0 {
		return nil
	}
	var exists bool
	if err := store.db.QueryRow(ctx, `select exists(select 1 from signalgen.app_sessions
where user_id=$1::uuid and installation_id=$2)`, userID, installationID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func validSession(item Session) error {
	if item.RevokedAt != nil {
		return ErrRevoked
	}
	if !time.Now().UTC().Before(item.ExpiresAt) {
		return ErrExpired
	}
	return nil
}

type postgresSessionScanner interface{ Scan(dest ...any) error }

func scanPostgresSession(row postgresSessionScanner) (Session, error) {
	var item Session
	var revoked pgtype.Timestamptz
	err := row.Scan(&item.ID, &item.UserID, &item.InstallationID, &item.Label,
		&item.CreatedAt, &item.ExpiresAt, &item.LastSeenAt, &revoked)
	if err != nil {
		return Session{}, err
	}
	if revoked.Valid {
		value := revoked.Time.UTC()
		item.RevokedAt = &value
	}
	return item, nil
}

func randomCredential(prefix string, size int) (string, error) {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}
