package compute

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const defaultTTL = 5 * time.Minute

var (
	ErrInvalid = errors.New("invalid compute grant")
	ErrExpired = errors.New("compute grant expired")
)

type CreateRequest struct {
	UserID          string
	SessionID       string
	Purpose         string
	DatasetID       string
	DatasetVersion  string
	DatasetChecksum string
	RuleID          string
	DefinitionHash  string
	EngineVersion   string
	SchemaVersion   string
}

type Grant struct {
	ID              string    `json:"id"`
	Purpose         string    `json:"purpose"`
	DatasetID       string    `json:"dataset_id"`
	DatasetVersion  string    `json:"dataset_version"`
	DatasetChecksum string    `json:"dataset_checksum"`
	RuleID          string    `json:"rule_id"`
	DefinitionHash  string    `json:"definition_hash"`
	EngineVersion   string    `json:"engine_version"`
	SchemaVersion   string    `json:"schema_version"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
	UserID          string    `json:"-"`
	SessionID       string    `json:"-"`
}

type Store struct {
	db     *sql.DB
	now    func() time.Time
	random io.Reader
	ttl    time.Duration
}

type Option func(*Store)

func WithClock(clock func() time.Time) Option { return func(store *Store) { store.now = clock } }
func WithRandom(reader io.Reader) Option      { return func(store *Store) { store.random = reader } }
func WithTTL(ttl time.Duration) Option        { return func(store *Store) { store.ttl = ttl } }

func NewStore(db *sql.DB, options ...Option) (*Store, error) {
	if db == nil {
		return nil, fmt.Errorf("compute database is required")
	}
	store := &Store{db: db, now: time.Now, random: rand.Reader, ttl: defaultTTL}
	for _, option := range options {
		option(store)
	}
	if store.now == nil || store.random == nil || store.ttl <= 0 {
		return nil, fmt.Errorf("invalid compute store configuration")
	}
	return store, nil
}

func OpenSQLite(path string, options ...Option) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("compute database path is required")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open compute database: %w", err)
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

func (store *Store) Migrate(ctx context.Context) error {
	const schema = `
CREATE TABLE IF NOT EXISTS compute_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    dataset_checksum TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compute_grants_binding
ON compute_grants(user_id, session_id, expires_at);
`
	if _, err := store.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("migrate compute grants: %w", err)
	}
	return nil
}

func (store *Store) Create(ctx context.Context, request CreateRequest) (Grant, error) {
	if !validRequest(request) {
		return Grant{}, ErrInvalid
	}
	raw := make([]byte, 16)
	if _, err := io.ReadFull(store.random, raw); err != nil {
		return Grant{}, fmt.Errorf("generate compute grant id: %w", err)
	}
	now := store.now().UTC().Truncate(time.Second)
	grant := Grant{
		ID: "cgr_" + base64.RawURLEncoding.EncodeToString(raw), UserID: request.UserID,
		SessionID: request.SessionID, Purpose: request.Purpose, DatasetID: request.DatasetID,
		DatasetVersion: request.DatasetVersion, DatasetChecksum: request.DatasetChecksum,
		RuleID: request.RuleID, DefinitionHash: request.DefinitionHash,
		EngineVersion: request.EngineVersion, SchemaVersion: request.SchemaVersion,
		CreatedAt: now, ExpiresAt: now.Add(store.ttl),
	}
	_, err := store.db.ExecContext(ctx, `
INSERT INTO compute_grants (
    id, user_id, session_id, purpose, dataset_id, dataset_version,
    dataset_checksum, rule_id, definition_hash, engine_version, schema_version,
    expires_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		grant.ID, grant.UserID, grant.SessionID, grant.Purpose, grant.DatasetID, grant.DatasetVersion,
		grant.DatasetChecksum, grant.RuleID, grant.DefinitionHash, grant.EngineVersion, grant.SchemaVersion,
		grant.ExpiresAt.Unix(), grant.CreatedAt.Unix(),
	)
	if err != nil {
		return Grant{}, fmt.Errorf("create compute grant: %w", err)
	}
	return grant, nil
}

func (store *Store) Verify(ctx context.Context, userID, sessionID, grantID string) (Grant, error) {
	var grant Grant
	var expiresAt, createdAt int64
	err := store.db.QueryRowContext(ctx, `
SELECT id, user_id, session_id, purpose, dataset_id, dataset_version,
       dataset_checksum, rule_id, definition_hash, engine_version, schema_version,
       expires_at, created_at
FROM compute_grants WHERE id = ?`, strings.TrimSpace(grantID)).Scan(
		&grant.ID, &grant.UserID, &grant.SessionID, &grant.Purpose, &grant.DatasetID, &grant.DatasetVersion,
		&grant.DatasetChecksum, &grant.RuleID, &grant.DefinitionHash, &grant.EngineVersion, &grant.SchemaVersion,
		&expiresAt, &createdAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Grant{}, ErrInvalid
	}
	if err != nil {
		return Grant{}, fmt.Errorf("read compute grant: %w", err)
	}
	if grant.UserID != userID || grant.SessionID != sessionID {
		return Grant{}, ErrInvalid
	}
	grant.ExpiresAt = time.Unix(expiresAt, 0).UTC()
	grant.CreatedAt = time.Unix(createdAt, 0).UTC()
	if !store.now().UTC().Before(grant.ExpiresAt) {
		return Grant{}, ErrExpired
	}
	return grant, nil
}

func validRequest(request CreateRequest) bool {
	return strings.TrimSpace(request.UserID) != "" && strings.TrimSpace(request.SessionID) != "" &&
		strings.TrimSpace(request.Purpose) != "" && strings.TrimSpace(request.DatasetID) != "" &&
		strings.TrimSpace(request.DatasetVersion) != "" && strings.HasPrefix(request.DatasetChecksum, "sha256:") &&
		strings.TrimSpace(request.RuleID) != "" && strings.HasPrefix(request.DefinitionHash, "sha256:") &&
		strings.TrimSpace(request.EngineVersion) != "" && strings.TrimSpace(request.SchemaVersion) != ""
}
