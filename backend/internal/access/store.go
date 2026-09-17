package access

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	RoleUser        = "user"
	RoleOperator    = "operator"
	StatusActive    = "active"
	StatusSuspended = "suspended"
	FeatureScreener = "screener"
	FeatureBacktest = "backtest"
)

var (
	ErrAccountNotFound    = errors.New("account not found")
	ErrAccountSuspended   = errors.New("account is suspended")
	ErrEntitlementMissing = errors.New("feature entitlement is missing or expired")
	ErrInvalidValue       = errors.New("invalid access value")
)

var supportedFeatures = map[string]bool{
	FeatureScreener: true,
	FeatureBacktest: true,
}

type Account struct {
	UserID    string    `json:"id"`
	Email     string    `json:"email,omitempty"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Store struct {
	db  *sql.DB
	now func() time.Time
}

type Option func(*Store)

func WithClock(clock func() time.Time) Option {
	return func(store *Store) { store.now = clock }
}

func NewStore(db *sql.DB, options ...Option) (*Store, error) {
	if db == nil {
		return nil, fmt.Errorf("access database is required")
	}
	store := &Store{db: db, now: time.Now}
	for _, option := range options {
		option(store)
	}
	if store.now == nil {
		return nil, fmt.Errorf("access clock is required")
	}
	return store, nil
}

func OpenSQLite(path string, options ...Option) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("access database path is required")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open access database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store, err := NewStore(db, options...)
	if err != nil {
		db.Close()
		return nil, err
	}
	if err := store.Migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (store *Store) Close() error { return store.db.Close() }

func (store *Store) Ready(ctx context.Context) error {
	if err := store.db.PingContext(ctx); err != nil {
		return fmt.Errorf("access storage readiness: %w", err)
	}
	return nil
}

func (store *Store) Migrate(ctx context.Context) error {
	const schema = `
CREATE TABLE IF NOT EXISTS account_profiles (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'operator')),
    status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feature_grants (
    user_id TEXT NOT NULL,
    feature TEXT NOT NULL CHECK (feature IN ('screener', 'backtest')),
    valid_until INTEGER NOT NULL,
    reason TEXT NOT NULL,
    revoked_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, feature),
    FOREIGN KEY (user_id) REFERENCES account_profiles(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feature_grants_active
ON feature_grants(user_id, valid_until, revoked_at);
`
	if _, err := store.db.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("enable access foreign keys: %w", err)
	}
	if _, err := store.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("migrate access storage: %w", err)
	}
	return nil
}

// EnsureProfile provisions a safe default account and refreshes only its
// identity email. Existing role and status are deliberately preserved.
func (store *Store) EnsureProfile(ctx context.Context, userID, email string) (Account, error) {
	userID = strings.TrimSpace(userID)
	email = strings.TrimSpace(email)
	if userID == "" {
		return Account{}, ErrInvalidValue
	}
	now := store.now().UTC().Truncate(time.Second).Unix()
	_, err := store.db.ExecContext(ctx, `
INSERT INTO account_profiles (user_id, email, role, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`,
		userID, email, RoleUser, StatusActive, now, now,
	)
	if err != nil {
		return Account{}, fmt.Errorf("ensure account profile: %w", err)
	}
	return store.Account(ctx, userID)
}

func (store *Store) Account(ctx context.Context, userID string) (Account, error) {
	var account Account
	var createdAt, updatedAt int64
	err := store.db.QueryRowContext(ctx, `
SELECT user_id, email, role, status, created_at, updated_at
FROM account_profiles WHERE user_id = ?`, strings.TrimSpace(userID)).Scan(
		&account.UserID, &account.Email, &account.Role, &account.Status, &createdAt, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrAccountNotFound
	}
	if err != nil {
		return Account{}, fmt.Errorf("read account profile: %w", err)
	}
	account.CreatedAt = time.Unix(createdAt, 0).UTC()
	account.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return account, nil
}

func (store *Store) RequireActive(ctx context.Context, userID string) (Account, error) {
	account, err := store.Account(ctx, userID)
	if err != nil {
		return Account{}, err
	}
	if account.Status != StatusActive {
		return Account{}, ErrAccountSuspended
	}
	return account, nil
}

func (store *Store) Features(ctx context.Context, userID string) ([]string, error) {
	now := store.now().UTC().Truncate(time.Second).Unix()
	rows, err := store.db.QueryContext(ctx, `
SELECT feature FROM feature_grants
WHERE user_id = ? AND revoked_at IS NULL AND valid_until > ?
ORDER BY feature`, strings.TrimSpace(userID), now)
	if err != nil {
		return nil, fmt.Errorf("list feature grants: %w", err)
	}
	defer rows.Close()
	features := make([]string, 0)
	for rows.Next() {
		var feature string
		if err := rows.Scan(&feature); err != nil {
			return nil, fmt.Errorf("scan feature grant: %w", err)
		}
		features = append(features, feature)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feature grants: %w", err)
	}
	sort.Strings(features)
	return features, nil
}

func (store *Store) RequireFeature(ctx context.Context, userID, feature string) error {
	if _, err := store.RequireActive(ctx, userID); err != nil {
		return err
	}
	if !supportedFeatures[feature] {
		return ErrInvalidValue
	}
	features, err := store.Features(ctx, userID)
	if err != nil {
		return err
	}
	for _, granted := range features {
		if granted == feature {
			return nil
		}
	}
	return ErrEntitlementMissing
}

// GrantFeature is server-side operator plumbing. No public route calls it in
// this slice; future operator tooling must add role checks and audit records.
func (store *Store) GrantFeature(ctx context.Context, userID, feature string, validUntil time.Time, reason string) error {
	userID = strings.TrimSpace(userID)
	reason = strings.TrimSpace(reason)
	if userID == "" || !supportedFeatures[feature] || reason == "" || !validUntil.After(store.now()) {
		return ErrInvalidValue
	}
	now := store.now().UTC().Truncate(time.Second).Unix()
	_, err := store.db.ExecContext(ctx, `
INSERT INTO feature_grants (user_id, feature, valid_until, reason, revoked_at, updated_at)
VALUES (?, ?, ?, ?, NULL, ?)
ON CONFLICT(user_id, feature) DO UPDATE SET
    valid_until = excluded.valid_until,
    reason = excluded.reason,
    revoked_at = NULL,
    updated_at = excluded.updated_at`,
		userID, feature, validUntil.UTC().Truncate(time.Second).Unix(), reason, now,
	)
	if err != nil {
		return fmt.Errorf("grant feature: %w", err)
	}
	return nil
}

func (store *Store) RevokeFeature(ctx context.Context, userID, feature string) error {
	if !supportedFeatures[feature] {
		return ErrInvalidValue
	}
	now := store.now().UTC().Truncate(time.Second).Unix()
	result, err := store.db.ExecContext(ctx, `
UPDATE feature_grants SET revoked_at = ?, updated_at = ?
WHERE user_id = ? AND feature = ? AND revoked_at IS NULL`, now, now, strings.TrimSpace(userID), feature)
	if err != nil {
		return fmt.Errorf("revoke feature: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return ErrEntitlementMissing
	}
	return nil
}

func (store *Store) SetStatus(ctx context.Context, userID, status string) error {
	if status != StatusActive && status != StatusSuspended {
		return ErrInvalidValue
	}
	result, err := store.db.ExecContext(ctx,
		"UPDATE account_profiles SET status = ?, updated_at = ? WHERE user_id = ?",
		status, store.now().UTC().Truncate(time.Second).Unix(), strings.TrimSpace(userID),
	)
	if err != nil {
		return fmt.Errorf("update account status: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return ErrAccountNotFound
	}
	return nil
}
