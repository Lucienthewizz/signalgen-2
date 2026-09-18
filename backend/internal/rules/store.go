package rules

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

var (
	ErrNotFound        = errors.New("rule not found")
	ErrInvalid         = errors.New("invalid rule")
	ErrVersionConflict = errors.New("rule version conflict")
	ErrLimit           = errors.New("user rule limit reached")
)

const MaxRulesPerUser = 100

type Rule struct {
	ID             string            `json:"id"`
	OwnerUserID    string            `json:"-"`
	Name           string            `json:"name"`
	OwnerType      string            `json:"owner_type"`
	ReadOnly       bool              `json:"read_only"`
	Definition     core.RuleSnapshot `json:"definition"`
	DefinitionHash string            `json:"definition_hash"`
	SchemaVersion  string            `json:"schema_version"`
	EngineVersion  string            `json:"engine_version"`
	Version        int               `json:"version"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
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
		return nil, fmt.Errorf("rule database is required")
	}
	store := &Store{db: db, now: time.Now}
	for _, option := range options {
		option(store)
	}
	if store.now == nil {
		return nil, fmt.Errorf("rule clock is required")
	}
	return store, nil
}

func (store *Store) Ready(ctx context.Context) error {
	if err := store.db.PingContext(ctx); err != nil {
		return fmt.Errorf("rule storage readiness: %w", err)
	}
	return nil
}

func (store *Store) Migrate(ctx context.Context) error {
	const schema = `
CREATE TABLE IF NOT EXISTS user_rules (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES account_profiles(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_rules_owner_updated
ON user_rules(owner_user_id, updated_at DESC, id);
`
	if _, err := store.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("migrate rule storage: %w", err)
	}
	return nil
}

func (store *Store) Create(ctx context.Context, ownerUserID string, definition core.RuleSnapshot) (Rule, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	definition.Name = strings.TrimSpace(definition.Name)
	if ownerUserID == "" || core.ValidateRule(definition) != nil {
		return Rule{}, ErrInvalid
	}
	id, err := newRuleID()
	if err != nil {
		return Rule{}, fmt.Errorf("create rule id: %w", err)
	}
	encoded, hash, err := encodeDefinition(definition)
	if err != nil {
		return Rule{}, err
	}
	now := store.now().UTC().Truncate(time.Second)
	result, err := store.db.ExecContext(ctx, `
INSERT INTO user_rules (
    id, owner_user_id, name, definition_json, definition_hash,
    schema_version, engine_version, version, created_at, updated_at
) SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
WHERE (SELECT COUNT(*) FROM user_rules WHERE owner_user_id = ?) < ?`,
		id, ownerUserID, definition.Name, encoded, hash,
		core.SchemaVersion, core.EngineVersion, now.Unix(), now.Unix(), ownerUserID, MaxRulesPerUser,
	)
	if err != nil {
		return Rule{}, fmt.Errorf("create user rule: %w", err)
	}
	created, _ := result.RowsAffected()
	if created != 1 {
		return Rule{}, ErrLimit
	}
	return Rule{
		ID: id, OwnerUserID: ownerUserID, Name: definition.Name, OwnerType: "user", ReadOnly: false,
		Definition: definition, DefinitionHash: hash, SchemaVersion: core.SchemaVersion,
		EngineVersion: core.EngineVersion, Version: 1, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (store *Store) List(ctx context.Context, ownerUserID string) ([]Rule, error) {
	rows, err := store.db.QueryContext(ctx, `
SELECT id, owner_user_id, name, definition_json, definition_hash,
       schema_version, engine_version, version, created_at, updated_at
FROM user_rules
WHERE owner_user_id = ?
ORDER BY updated_at DESC, id
LIMIT ?`, strings.TrimSpace(ownerUserID), MaxRulesPerUser)
	if err != nil {
		return nil, fmt.Errorf("list user rules: %w", err)
	}
	defer rows.Close()
	items := make([]Rule, 0)
	for rows.Next() {
		rule, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, rule)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user rules: %w", err)
	}
	return items, nil
}

func (store *Store) Get(ctx context.Context, ownerUserID, id string) (Rule, error) {
	row := store.db.QueryRowContext(ctx, `
SELECT id, owner_user_id, name, definition_json, definition_hash,
       schema_version, engine_version, version, created_at, updated_at
FROM user_rules
WHERE owner_user_id = ? AND id = ?`, strings.TrimSpace(ownerUserID), strings.TrimSpace(id))
	rule, err := scanRule(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Rule{}, ErrNotFound
	}
	return rule, err
}

func (store *Store) Update(ctx context.Context, ownerUserID, id string, expectedVersion int, definition core.RuleSnapshot) (Rule, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	id = strings.TrimSpace(id)
	definition.Name = strings.TrimSpace(definition.Name)
	if ownerUserID == "" || id == "" || expectedVersion < 1 || core.ValidateRule(definition) != nil {
		return Rule{}, ErrInvalid
	}
	encoded, hash, err := encodeDefinition(definition)
	if err != nil {
		return Rule{}, err
	}
	now := store.now().UTC().Truncate(time.Second)
	result, err := store.db.ExecContext(ctx, `
UPDATE user_rules
SET name = ?, definition_json = ?, definition_hash = ?, schema_version = ?,
    engine_version = ?, version = version + 1, updated_at = ?
WHERE owner_user_id = ? AND id = ? AND version = ?`,
		definition.Name, encoded, hash, core.SchemaVersion, core.EngineVersion, now.Unix(),
		ownerUserID, id, expectedVersion,
	)
	if err != nil {
		return Rule{}, fmt.Errorf("update user rule: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		if _, err := store.Get(ctx, ownerUserID, id); errors.Is(err, ErrNotFound) {
			return Rule{}, ErrNotFound
		}
		return Rule{}, ErrVersionConflict
	}
	return store.Get(ctx, ownerUserID, id)
}

func (store *Store) Delete(ctx context.Context, ownerUserID, id string, expectedVersion int) error {
	ownerUserID = strings.TrimSpace(ownerUserID)
	id = strings.TrimSpace(id)
	if ownerUserID == "" || id == "" || expectedVersion < 1 {
		return ErrInvalid
	}
	result, err := store.db.ExecContext(ctx, `
DELETE FROM user_rules WHERE owner_user_id = ? AND id = ? AND version = ?`,
		ownerUserID, id, expectedVersion,
	)
	if err != nil {
		return fmt.Errorf("delete user rule: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed == 1 {
		return nil
	}
	if _, err := store.Get(ctx, ownerUserID, id); errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	return ErrVersionConflict
}

type rowScanner interface {
	Scan(dest ...interface{}) error
}

func scanRule(scanner rowScanner) (Rule, error) {
	var rule Rule
	var definitionJSON string
	var createdAt, updatedAt int64
	err := scanner.Scan(
		&rule.ID, &rule.OwnerUserID, &rule.Name, &definitionJSON, &rule.DefinitionHash,
		&rule.SchemaVersion, &rule.EngineVersion, &rule.Version, &createdAt, &updatedAt,
	)
	if err != nil {
		return Rule{}, err
	}
	if err := json.Unmarshal([]byte(definitionJSON), &rule.Definition); err != nil {
		return Rule{}, fmt.Errorf("decode user rule: %w", err)
	}
	rule.OwnerType = "user"
	rule.ReadOnly = false
	rule.CreatedAt = time.Unix(createdAt, 0).UTC()
	rule.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return rule, nil
}

func encodeDefinition(definition core.RuleSnapshot) (string, string, error) {
	encoded, err := json.Marshal(definition)
	if err != nil {
		return "", "", fmt.Errorf("encode user rule: %w", err)
	}
	hash := sha256.Sum256(encoded)
	return string(encoded), fmt.Sprintf("sha256:%x", hash), nil
}

func newRuleID() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "rule_" + hex.EncodeToString(raw), nil
}
