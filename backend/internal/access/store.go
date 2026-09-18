package access

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
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
	ErrRoleRequired       = errors.New("required account role is missing")
	ErrBootstrapClosed    = errors.New("operator bootstrap is already closed")
	ErrLastOperator       = errors.New("last active operator cannot be demoted")
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

type GrantState struct {
	Feature    string     `json:"feature"`
	ValidUntil time.Time  `json:"valid_until"`
	Reason     string     `json:"reason"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type FeatureGrant struct {
	UserID     string     `json:"user_id"`
	Feature    string     `json:"feature"`
	ValidUntil time.Time  `json:"valid_until"`
	Reason     string     `json:"reason"`
	RevokedAt  *time.Time `json:"revoked_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	Active     bool       `json:"active"`
}

type AuditEvent struct {
	ID           int64           `json:"id"`
	Actor        string          `json:"actor"`
	Action       string          `json:"action"`
	TargetUserID string          `json:"target_user_id"`
	Feature      string          `json:"feature,omitempty"`
	Reason       string          `json:"reason"`
	RequestID    string          `json:"request_id"`
	Before       json.RawMessage `json:"before,omitempty"`
	After        json.RawMessage `json:"after,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

type AccountRoleState struct {
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AccountRole struct {
	UserID    string    `json:"user_id"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
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
CREATE TABLE IF NOT EXISTS operator_bootstrap_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    operator_user_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    request_id TEXT NOT NULL,
    bootstrapped_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('feature.grant', 'feature.revoke', 'account.bootstrap_operator', 'account.role_changed')),
    target_user_id TEXT NOT NULL,
    feature TEXT CHECK (feature IS NULL OR feature IN ('screener', 'backtest')),
    reason TEXT NOT NULL,
    request_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_target
ON audit_events(target_user_id, created_at, id);
CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit events are immutable');
END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit events are immutable');
END;
`
	if _, err := store.db.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("enable access foreign keys: %w", err)
	}
	if _, err := store.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("migrate access storage: %w", err)
	}
	if err := store.migrateAuditEvents(ctx); err != nil {
		return err
	}
	if _, err := store.db.ExecContext(ctx, `
INSERT OR IGNORE INTO operator_bootstrap_state (
    singleton, operator_user_id, actor, request_id, bootstrapped_at
)
SELECT 1, user_id, 'system:migration', 'migration_existing_operator', updated_at
FROM account_profiles
WHERE role = ?
ORDER BY created_at, user_id
LIMIT 1`, RoleOperator); err != nil {
		return fmt.Errorf("seal existing operator bootstrap: %w", err)
	}
	return nil
}

// migrateAuditEvents upgrades databases created before current account events
// were supported. SQLite cannot alter CHECK constraints in place, so the table
// is rebuilt transactionally while preserving existing audit rows.
func (store *Store) migrateAuditEvents(ctx context.Context) error {
	var definition string
	if err := store.db.QueryRowContext(ctx, `
SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'`).Scan(&definition); err != nil {
		return fmt.Errorf("read audit schema: %w", err)
	}
	if strings.Contains(definition, "account.role_changed") {
		return nil
	}
	transaction, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin audit schema migration: %w", err)
	}
	defer transaction.Rollback()
	const migration = `
DROP TRIGGER IF EXISTS audit_events_no_update;
DROP TRIGGER IF EXISTS audit_events_no_delete;
CREATE TABLE audit_events_next (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('feature.grant', 'feature.revoke', 'account.bootstrap_operator', 'account.role_changed')),
    target_user_id TEXT NOT NULL,
    feature TEXT CHECK (feature IS NULL OR feature IN ('screener', 'backtest')),
    reason TEXT NOT NULL,
    request_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at INTEGER NOT NULL
);
INSERT INTO audit_events_next (
    id, actor, action, target_user_id, feature, reason, request_id,
    before_json, after_json, created_at
)
SELECT id, actor, action, target_user_id, feature, reason, request_id,
       before_json, after_json, created_at
FROM audit_events;
DROP TABLE audit_events;
ALTER TABLE audit_events_next RENAME TO audit_events;
CREATE INDEX idx_audit_events_target
ON audit_events(target_user_id, created_at, id);
CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit events are immutable');
END;
CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit events are immutable');
END;
`
	if _, err := transaction.ExecContext(ctx, migration); err != nil {
		return fmt.Errorf("upgrade audit schema: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit audit schema migration: %w", err)
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

// RequireOperator authorizes against SignalGen's server-side profile. The
// Supabase token establishes identity only; token claims and client payloads
// never decide the application role.
func (store *Store) RequireOperator(ctx context.Context, userID string) (Account, error) {
	account, err := store.RequireActive(ctx, userID)
	if err != nil {
		return Account{}, err
	}
	if account.Role != RoleOperator {
		return Account{}, ErrRoleRequired
	}
	return account, nil
}

// BootstrapOperator promotes the first operator through local trusted tooling.
// A successful bootstrap is permanently recorded; existing operator databases
// are sealed during migration. Later role management must use a separately
// protected operator workflow.
func (store *Store) BootstrapOperator(ctx context.Context, actor, requestID, userID, reason string) error {
	actor = strings.TrimSpace(actor)
	requestID = strings.TrimSpace(requestID)
	userID = strings.TrimSpace(userID)
	reason = strings.TrimSpace(reason)
	if actor == "" || requestID == "" || userID == "" || reason == "" {
		return ErrInvalidValue
	}
	now := store.now().UTC().Truncate(time.Second)
	transaction, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin operator bootstrap: %w", err)
	}
	defer transaction.Rollback()
	before, err := accountRoleState(ctx, transaction, userID)
	if err != nil {
		return err
	}
	if before.Status != StatusActive {
		return ErrAccountSuspended
	}
	result, err := transaction.ExecContext(ctx, `
INSERT INTO operator_bootstrap_state (
    singleton, operator_user_id, actor, request_id, bootstrapped_at
)
SELECT 1, ?, ?, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM operator_bootstrap_state WHERE singleton = 1)
  AND NOT EXISTS (SELECT 1 FROM account_profiles WHERE role = ?)`,
		userID, actor, requestID, now.Unix(), RoleOperator,
	)
	if err != nil {
		return fmt.Errorf("record operator bootstrap: %w", err)
	}
	reserved, _ := result.RowsAffected()
	if reserved != 1 {
		return ErrBootstrapClosed
	}
	result, err = transaction.ExecContext(ctx, `
UPDATE account_profiles
SET role = ?, updated_at = ?
WHERE user_id = ? AND role = ? AND status = ?`,
		RoleOperator, now.Unix(), userID, RoleUser, StatusActive,
	)
	if err != nil {
		return fmt.Errorf("bootstrap operator: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return ErrBootstrapClosed
	}
	after, err := accountRoleState(ctx, transaction, userID)
	if err != nil {
		return err
	}
	if err := insertAuditEvent(
		ctx, transaction, actor, "account.bootstrap_operator", userID, "", reason,
		requestID, before, after, now,
	); err != nil {
		return err
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit operator bootstrap: %w", err)
	}
	return nil
}

// SetRoleAudited changes an application role through a trusted operator path.
// Demoting an operator requires another active operator to remain available.
func (store *Store) SetRoleAudited(ctx context.Context, actor, requestID, userID, role, reason string) (AccountRole, error) {
	actor = strings.TrimSpace(actor)
	requestID = strings.TrimSpace(requestID)
	userID = strings.TrimSpace(userID)
	role = strings.TrimSpace(role)
	reason = strings.TrimSpace(reason)
	if actor == "" || requestID == "" || userID == "" || reason == "" ||
		(role != RoleUser && role != RoleOperator) {
		return AccountRole{}, ErrInvalidValue
	}
	now := store.now().UTC().Truncate(time.Second)
	transaction, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return AccountRole{}, fmt.Errorf("begin account role change: %w", err)
	}
	defer transaction.Rollback()
	before, err := accountRoleState(ctx, transaction, userID)
	if err != nil {
		return AccountRole{}, err
	}
	if before.Role == role {
		return AccountRole{
			UserID: userID, Role: before.Role, Status: before.Status, UpdatedAt: before.UpdatedAt,
		}, nil
	}
	var result sql.Result
	if before.Role == RoleOperator && role == RoleUser {
		result, err = transaction.ExecContext(ctx, `
UPDATE account_profiles
SET role = ?, updated_at = ?
WHERE user_id = ? AND role = ?
  AND EXISTS (
      SELECT 1 FROM account_profiles
      WHERE role = ? AND status = ? AND user_id <> ?
  )`, RoleUser, now.Unix(), userID, RoleOperator, RoleOperator, StatusActive, userID)
	} else {
		result, err = transaction.ExecContext(ctx, `
UPDATE account_profiles SET role = ?, updated_at = ?
WHERE user_id = ? AND role = ?`, role, now.Unix(), userID, before.Role)
	}
	if err != nil {
		return AccountRole{}, fmt.Errorf("change account role: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		if before.Role == RoleOperator && role == RoleUser {
			return AccountRole{}, ErrLastOperator
		}
		return AccountRole{}, ErrInvalidValue
	}
	after, err := accountRoleState(ctx, transaction, userID)
	if err != nil {
		return AccountRole{}, err
	}
	if err := insertAuditEvent(
		ctx, transaction, actor, "account.role_changed", userID, "", reason,
		requestID, before, after, now,
	); err != nil {
		return AccountRole{}, err
	}
	if err := transaction.Commit(); err != nil {
		return AccountRole{}, fmt.Errorf("commit account role change: %w", err)
	}
	return AccountRole{
		UserID: userID, Role: after.Role, Status: after.Status, UpdatedAt: after.UpdatedAt,
	}, nil
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

func (store *Store) FeatureGrants(ctx context.Context, userID string) ([]FeatureGrant, error) {
	userID = strings.TrimSpace(userID)
	if _, err := store.Account(ctx, userID); err != nil {
		return nil, err
	}
	rows, err := store.db.QueryContext(ctx, `
SELECT user_id, feature, valid_until, reason, revoked_at, updated_at
FROM feature_grants
WHERE user_id = ?
ORDER BY feature`, userID)
	if err != nil {
		return nil, fmt.Errorf("list feature grant records: %w", err)
	}
	defer rows.Close()
	now := store.now().UTC().Truncate(time.Second)
	grants := make([]FeatureGrant, 0)
	for rows.Next() {
		var grant FeatureGrant
		var validUntil, updatedAt int64
		var revokedAt sql.NullInt64
		if err := rows.Scan(
			&grant.UserID, &grant.Feature, &validUntil, &grant.Reason, &revokedAt, &updatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan feature grant record: %w", err)
		}
		grant.ValidUntil = time.Unix(validUntil, 0).UTC()
		grant.UpdatedAt = time.Unix(updatedAt, 0).UTC()
		if revokedAt.Valid {
			value := time.Unix(revokedAt.Int64, 0).UTC()
			grant.RevokedAt = &value
		}
		grant.Active = grant.RevokedAt == nil && now.Before(grant.ValidUntil)
		grants = append(grants, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feature grant records: %w", err)
	}
	return grants, nil
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

func (store *Store) GrantFeature(ctx context.Context, userID, feature string, validUntil time.Time, reason string) error {
	_, err := store.GrantFeatureAudited(ctx, "system:internal", "internal", userID, feature, validUntil, reason)
	return err
}

func (store *Store) GrantFeatureAudited(ctx context.Context, actor, requestID, userID, feature string, validUntil time.Time, reason string) (FeatureGrant, error) {
	actor = strings.TrimSpace(actor)
	requestID = strings.TrimSpace(requestID)
	userID = strings.TrimSpace(userID)
	reason = strings.TrimSpace(reason)
	if actor == "" || requestID == "" || userID == "" || !supportedFeatures[feature] || reason == "" || !validUntil.After(store.now()) {
		return FeatureGrant{}, ErrInvalidValue
	}
	now := store.now().UTC().Truncate(time.Second)
	transaction, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return FeatureGrant{}, fmt.Errorf("begin feature grant: %w", err)
	}
	defer transaction.Rollback()
	before, err := grantState(ctx, transaction, userID, feature)
	if err != nil && !errors.Is(err, ErrEntitlementMissing) {
		return FeatureGrant{}, err
	}
	_, err = transaction.ExecContext(ctx, `
INSERT INTO feature_grants (user_id, feature, valid_until, reason, revoked_at, updated_at)
VALUES (?, ?, ?, ?, NULL, ?)
ON CONFLICT(user_id, feature) DO UPDATE SET
    valid_until = excluded.valid_until,
    reason = excluded.reason,
    revoked_at = NULL,
    updated_at = excluded.updated_at`,
		userID, feature, validUntil.UTC().Truncate(time.Second).Unix(), reason, now.Unix(),
	)
	if err != nil {
		return FeatureGrant{}, fmt.Errorf("grant feature: %w", err)
	}
	after, err := grantState(ctx, transaction, userID, feature)
	if err != nil {
		return FeatureGrant{}, err
	}
	if err := insertAuditEvent(ctx, transaction, actor, "feature.grant", userID, feature, reason, requestID, before, after, now); err != nil {
		return FeatureGrant{}, err
	}
	if err := transaction.Commit(); err != nil {
		return FeatureGrant{}, fmt.Errorf("commit feature grant: %w", err)
	}
	return FeatureGrant{
		UserID: userID, Feature: after.Feature, ValidUntil: after.ValidUntil,
		Reason: after.Reason, RevokedAt: after.RevokedAt, UpdatedAt: after.UpdatedAt, Active: true,
	}, nil
}

func (store *Store) RevokeFeature(ctx context.Context, userID, feature string) error {
	return store.RevokeFeatureAudited(ctx, "system:internal", "internal", userID, feature, "internal revoke")
}

func (store *Store) RevokeFeatureAudited(ctx context.Context, actor, requestID, userID, feature, reason string) error {
	actor = strings.TrimSpace(actor)
	requestID = strings.TrimSpace(requestID)
	userID = strings.TrimSpace(userID)
	reason = strings.TrimSpace(reason)
	if actor == "" || requestID == "" || userID == "" || !supportedFeatures[feature] || reason == "" {
		return ErrInvalidValue
	}
	now := store.now().UTC().Truncate(time.Second)
	transaction, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin feature revoke: %w", err)
	}
	defer transaction.Rollback()
	before, err := grantState(ctx, transaction, userID, feature)
	if err != nil || before.RevokedAt != nil {
		if errors.Is(err, ErrEntitlementMissing) || (err == nil && before.RevokedAt != nil) {
			return ErrEntitlementMissing
		}
		return err
	}
	result, err := transaction.ExecContext(ctx, `
UPDATE feature_grants SET revoked_at = ?, updated_at = ?
WHERE user_id = ? AND feature = ? AND revoked_at IS NULL`, now.Unix(), now.Unix(), userID, feature)
	if err != nil {
		return fmt.Errorf("revoke feature: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return ErrEntitlementMissing
	}
	after, err := grantState(ctx, transaction, userID, feature)
	if err != nil {
		return err
	}
	if err := insertAuditEvent(ctx, transaction, actor, "feature.revoke", userID, feature, reason, requestID, before, after, now); err != nil {
		return err
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit feature revoke: %w", err)
	}
	return nil
}

type rowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

func accountRoleState(ctx context.Context, querier rowQuerier, userID string) (*AccountRoleState, error) {
	var state AccountRoleState
	var updatedAt int64
	err := querier.QueryRowContext(ctx, `
SELECT role, status, updated_at FROM account_profiles WHERE user_id = ?`, userID).Scan(
		&state.Role, &state.Status, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAccountNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read account role state: %w", err)
	}
	state.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return &state, nil
}

func grantState(ctx context.Context, querier rowQuerier, userID, feature string) (*GrantState, error) {
	var state GrantState
	var validUntil, updatedAt int64
	var revokedAt sql.NullInt64
	err := querier.QueryRowContext(ctx, `
SELECT feature, valid_until, reason, revoked_at, updated_at
FROM feature_grants WHERE user_id = ? AND feature = ?`, userID, feature).Scan(
		&state.Feature, &validUntil, &state.Reason, &revokedAt, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrEntitlementMissing
	}
	if err != nil {
		return nil, fmt.Errorf("read feature grant state: %w", err)
	}
	state.ValidUntil = time.Unix(validUntil, 0).UTC()
	state.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	if revokedAt.Valid {
		value := time.Unix(revokedAt.Int64, 0).UTC()
		state.RevokedAt = &value
	}
	return &state, nil
}

func insertAuditEvent(ctx context.Context, transaction *sql.Tx, actor, action, userID, feature, reason, requestID string, before, after interface{}, createdAt time.Time) error {
	beforeJSON, err := encodeAuditState(before)
	if err != nil {
		return fmt.Errorf("encode audit before state: %w", err)
	}
	afterJSON, err := encodeAuditState(after)
	if err != nil {
		return fmt.Errorf("encode audit after state: %w", err)
	}
	if _, err := transaction.ExecContext(ctx, `
INSERT INTO audit_events (
    actor, action, target_user_id, feature, reason, request_id,
    before_json, after_json, created_at
) VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?)`,
		actor, action, userID, feature, reason, requestID, beforeJSON, afterJSON, createdAt.Unix(),
	); err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}
	return nil
}

func encodeAuditState(value interface{}) (interface{}, error) {
	if value == nil {
		return nil, nil
	}
	reflected := reflect.ValueOf(value)
	if reflected.Kind() == reflect.Ptr && reflected.IsNil() {
		return nil, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return string(encoded), nil
}

func (store *Store) AuditEvents(ctx context.Context, userID string) ([]AuditEvent, error) {
	rows, err := store.db.QueryContext(ctx, `
SELECT id, actor, action, target_user_id, feature, reason, request_id,
       before_json, after_json, created_at
FROM audit_events
WHERE target_user_id = ?
ORDER BY created_at, id`, strings.TrimSpace(userID))
	if err != nil {
		return nil, fmt.Errorf("list audit events: %w", err)
	}
	defer rows.Close()
	events := make([]AuditEvent, 0)
	for rows.Next() {
		var event AuditEvent
		var feature, beforeJSON, afterJSON sql.NullString
		var createdAt int64
		if err := rows.Scan(
			&event.ID, &event.Actor, &event.Action, &event.TargetUserID, &feature,
			&event.Reason, &event.RequestID, &beforeJSON, &afterJSON, &createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan audit event: %w", err)
		}
		if feature.Valid {
			event.Feature = feature.String
		}
		event.CreatedAt = time.Unix(createdAt, 0).UTC()
		if beforeJSON.Valid {
			if !json.Valid([]byte(beforeJSON.String)) {
				return nil, fmt.Errorf("decode audit before state: invalid JSON")
			}
			event.Before = json.RawMessage(beforeJSON.String)
		}
		if afterJSON.Valid {
			if !json.Valid([]byte(afterJSON.String)) {
				return nil, fmt.Errorf("decode audit after state: invalid JSON")
			}
			event.After = json.RawMessage(afterJSON.String)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit events: %w", err)
	}
	return events, nil
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
