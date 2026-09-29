package compute

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Compute binds an exact user/session/dataset/rule context for private
// decisions. The grant ID is not a substitute for the checked app session.
type PostgresRepository struct{ db *pgxpool.Pool }

func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{db: db}
}
func (store *PostgresRepository) Ready(ctx context.Context) error { return store.db.Ping(ctx) }

func (store *PostgresRepository) Create(ctx context.Context, request CreateRequest) (Grant, error) {
	if strings.TrimSpace(request.UserID) == "" || strings.TrimSpace(request.SessionID) == "" ||
		strings.TrimSpace(request.Purpose) == "" || strings.TrimSpace(request.DatasetID) == "" ||
		strings.TrimSpace(request.DatasetVersion) == "" || !strings.HasPrefix(request.DatasetChecksum, "sha256:") ||
		strings.TrimSpace(request.RuleID) == "" || !strings.HasPrefix(request.DefinitionHash, "sha256:") ||
		strings.TrimSpace(request.EngineVersion) == "" || strings.TrimSpace(request.SchemaVersion) == "" {
		return Grant{}, ErrInvalid
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return Grant{}, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	grant := Grant{
		ID: "cgr_" + base64.RawURLEncoding.EncodeToString(raw), UserID: request.UserID,
		SessionID: request.SessionID, Purpose: request.Purpose, DatasetID: request.DatasetID,
		DatasetVersion: request.DatasetVersion, DatasetChecksum: request.DatasetChecksum,
		RuleID: request.RuleID, DefinitionHash: request.DefinitionHash,
		EngineVersion: request.EngineVersion, SchemaVersion: request.SchemaVersion,
		CreatedAt: now, ExpiresAt: now.Add(5 * time.Minute),
	}
	_, err := store.db.Exec(ctx, `insert into signalgen.compute_grants
(id,user_id,session_id,purpose,dataset_id,dataset_version,dataset_checksum,
rule_id,definition_hash,engine_version,schema_version,expires_at,created_at)
values ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		grant.ID, grant.UserID, grant.SessionID, grant.Purpose, grant.DatasetID,
		grant.DatasetVersion, grant.DatasetChecksum, grant.RuleID, grant.DefinitionHash,
		grant.EngineVersion, grant.SchemaVersion, grant.ExpiresAt, grant.CreatedAt)
	if err != nil {
		return Grant{}, fmt.Errorf("create Postgres compute grant: %w", err)
	}
	return grant, nil
}

func (store *PostgresRepository) Verify(ctx context.Context, userID, sessionID, grantID string) (Grant, error) {
	var grant Grant
	err := store.db.QueryRow(ctx, `select id,user_id::text,session_id,purpose,dataset_id,
dataset_version,dataset_checksum,rule_id,definition_hash,engine_version,
schema_version,expires_at,created_at
from signalgen.compute_grants where id=$1 and user_id=$2::uuid and session_id=$3`,
		grantID, userID, sessionID).Scan(&grant.ID, &grant.UserID, &grant.SessionID,
		&grant.Purpose, &grant.DatasetID, &grant.DatasetVersion, &grant.DatasetChecksum,
		&grant.RuleID, &grant.DefinitionHash, &grant.EngineVersion, &grant.SchemaVersion,
		&grant.ExpiresAt, &grant.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Grant{}, ErrInvalid
	}
	if err != nil {
		return Grant{}, err
	}
	if !time.Now().UTC().Before(grant.ExpiresAt) {
		return Grant{}, ErrExpired
	}
	return grant, nil
}
