package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	defaultTTL = 24 * time.Hour
	maxLabel   = 100
)

var (
	ErrInvalid        = errors.New("app session is invalid")
	ErrExpired        = errors.New("app session is expired")
	ErrRevoked        = errors.New("app session is revoked")
	ErrInvalidRequest = errors.New("invalid session request")
	ErrNotFound       = errors.New("app session was not found")
)

type Session struct {
	ID             string     `json:"id"`
	UserID         string     `json:"-"`
	InstallationID string     `json:"installation_id"`
	Label          string     `json:"label"`
	CreatedAt      time.Time  `json:"created_at"`
	ExpiresAt      time.Time  `json:"expires_at"`
	LastSeenAt     time.Time  `json:"last_seen_at"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
}

type Created struct {
	Session Session `json:"session"`
	Token   string  `json:"session_token"`
}

type Store struct {
	db     *sql.DB
	now    func() time.Time
	random io.Reader
	ttl    time.Duration
}

type Option func(*Store)

func WithClock(clock func() time.Time) Option {
	return func(store *Store) { store.now = clock }
}

func WithTTL(ttl time.Duration) Option {
	return func(store *Store) { store.ttl = ttl }
}

func WithRandom(reader io.Reader) Option {
	return func(store *Store) { store.random = reader }
}

func NewStore(db *sql.DB, options ...Option) (*Store, error) {
	if db == nil {
		return nil, fmt.Errorf("session database is required")
	}
	store := &Store{db: db, now: time.Now, random: rand.Reader, ttl: defaultTTL}
	for _, option := range options {
		option(store)
	}
	if store.now == nil || store.random == nil || store.ttl <= 0 {
		return nil, fmt.Errorf("invalid session store configuration")
	}
	return store, nil
}

func OpenSQLite(path string, options ...Option) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("session database path is required")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open session database: %w", err)
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

func (store *Store) Close() error {
	return store.db.Close()
}

func (store *Store) Migrate(ctx context.Context) error {
	const schema = `
CREATE TABLE IF NOT EXISTS app_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    label TEXT NOT NULL,
    token_hash BLOB NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_active
ON app_sessions(user_id, expires_at, revoked_at);
`
	if _, err := store.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("migrate app sessions: %w", err)
	}
	return nil
}

func (store *Store) Create(ctx context.Context, userID, installationID, label string) (Created, error) {
	userID = strings.TrimSpace(userID)
	installationID = strings.TrimSpace(installationID)
	label = strings.TrimSpace(label)
	if userID == "" || installationID == "" || label == "" || len(label) > maxLabel {
		return Created{}, ErrInvalidRequest
	}

	id, err := randomValue(store.random, "ses_", 16)
	if err != nil {
		return Created{}, fmt.Errorf("generate session id: %w", err)
	}
	token, err := randomValue(store.random, "sgs_", 32)
	if err != nil {
		return Created{}, fmt.Errorf("generate session token: %w", err)
	}
	now := store.now().UTC().Truncate(time.Second)
	session := Session{
		ID:             id,
		UserID:         userID,
		InstallationID: installationID,
		Label:          label,
		CreatedAt:      now,
		ExpiresAt:      now.Add(store.ttl),
		LastSeenAt:     now,
	}
	hash := tokenHash(token)
	_, err = store.db.ExecContext(ctx, `
INSERT INTO app_sessions (
    id, user_id, installation_id, label, token_hash,
    created_at, expires_at, last_seen_at, revoked_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
		session.ID, session.UserID, session.InstallationID, session.Label, hash[:],
		session.CreatedAt.Unix(), session.ExpiresAt.Unix(), session.LastSeenAt.Unix(),
	)
	if err != nil {
		return Created{}, fmt.Errorf("create app session: %w", err)
	}
	return Created{Session: session, Token: token}, nil
}

func (store *Store) Verify(ctx context.Context, userID, token string) (Session, error) {
	userID = strings.TrimSpace(userID)
	token = strings.TrimSpace(token)
	if userID == "" || token == "" {
		return Session{}, ErrInvalid
	}
	hash := tokenHash(token)
	session, err := store.findByHash(ctx, hash[:])
	if err != nil {
		return Session{}, err
	}
	if session.UserID != userID {
		return Session{}, ErrInvalid
	}
	if session.RevokedAt != nil {
		return Session{}, ErrRevoked
	}
	now := store.now().UTC().Truncate(time.Second)
	if !now.Before(session.ExpiresAt) {
		return Session{}, ErrExpired
	}
	if _, err := store.db.ExecContext(ctx,
		"UPDATE app_sessions SET last_seen_at = ? WHERE id = ?", now.Unix(), session.ID,
	); err != nil {
		return Session{}, fmt.Errorf("update app session activity: %w", err)
	}
	session.LastSeenAt = now
	return session, nil
}

func (store *Store) Revoke(ctx context.Context, userID, token string) error {
	session, err := store.Verify(ctx, userID, token)
	if err != nil {
		return err
	}
	now := store.now().UTC().Truncate(time.Second)
	result, err := store.db.ExecContext(ctx,
		"UPDATE app_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
		now.Unix(), session.ID,
	)
	if err != nil {
		return fmt.Errorf("revoke app session: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return ErrInvalid
	}
	return nil
}

func (store *Store) List(ctx context.Context, userID string) ([]Session, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalidRequest
	}
	rows, err := store.db.QueryContext(ctx, `
SELECT id, user_id, installation_id, label, created_at, expires_at, last_seen_at, revoked_at
FROM app_sessions
WHERE user_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 100`, userID)
	if err != nil {
		return nil, fmt.Errorf("list app sessions: %w", err)
	}
	defer rows.Close()

	sessions := make([]Session, 0)
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scan app session: %w", err)
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list app sessions: %w", err)
	}
	return sessions, nil
}

func (store *Store) RevokeByID(ctx context.Context, userID, sessionID string) error {
	userID = strings.TrimSpace(userID)
	sessionID = strings.TrimSpace(sessionID)
	if userID == "" || sessionID == "" {
		return ErrInvalidRequest
	}
	now := store.now().UTC().Truncate(time.Second)
	result, err := store.db.ExecContext(ctx, `
UPDATE app_sessions
SET revoked_at = ?
WHERE id = ? AND user_id = ? AND revoked_at IS NULL`, now.Unix(), sessionID, userID)
	if err != nil {
		return fmt.Errorf("revoke app session by id: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed == 1 {
		return nil
	}

	var exists int
	err = store.db.QueryRowContext(ctx,
		"SELECT 1 FROM app_sessions WHERE id = ? AND user_id = ?", sessionID, userID,
	).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("read app session owner: %w", err)
	}
	return nil
}

func (store *Store) findByHash(ctx context.Context, hash []byte) (Session, error) {
	row := store.db.QueryRowContext(ctx, `
SELECT id, user_id, installation_id, label, created_at, expires_at, last_seen_at, revoked_at
FROM app_sessions WHERE token_hash = ?`, hash)
	session, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrInvalid
	}
	if err != nil {
		return Session{}, fmt.Errorf("read app session: %w", err)
	}
	return session, nil
}

type sessionScanner interface {
	Scan(dest ...interface{}) error
}

func scanSession(scanner sessionScanner) (Session, error) {
	var session Session
	var createdAt, expiresAt, lastSeenAt int64
	var revokedAt sql.NullInt64
	if err := scanner.Scan(
		&session.ID, &session.UserID, &session.InstallationID, &session.Label,
		&createdAt, &expiresAt, &lastSeenAt, &revokedAt,
	); err != nil {
		return Session{}, err
	}
	session.CreatedAt = time.Unix(createdAt, 0).UTC()
	session.ExpiresAt = time.Unix(expiresAt, 0).UTC()
	session.LastSeenAt = time.Unix(lastSeenAt, 0).UTC()
	if revokedAt.Valid {
		value := time.Unix(revokedAt.Int64, 0).UTC()
		session.RevokedAt = &value
	}
	return session, nil
}

func randomValue(reader io.Reader, prefix string, size int) (string, error) {
	raw := make([]byte, size)
	if _, err := io.ReadFull(reader, raw); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func tokenHash(token string) [sha256.Size]byte {
	return sha256.Sum256([]byte(token))
}
