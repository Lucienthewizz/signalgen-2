package rules

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Rules keeps user-defined rule snapshots in Postgres. Every read/write uses
// the verified owner ID; a guessed rule ID alone never grants access.
type PostgresRepository struct{ db *pgxpool.Pool }

func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{db: db}
}
func (store *PostgresRepository) Ready(ctx context.Context) error { return store.db.Ping(ctx) }

const ruleColumns = `id,owner_user_id::text,name,definition_json,definition_hash,
schema_version,engine_version,version,created_at,updated_at`

func (store *PostgresRepository) Create(ctx context.Context, owner string, definition core.RuleSnapshot) (Rule, error) {
	owner = strings.TrimSpace(owner)
	definition.Name = strings.TrimSpace(definition.Name)
	if owner == "" || core.ValidateRule(definition) != nil {
		return Rule{}, ErrInvalid
	}
	raw, err := json.Marshal(definition)
	if err != nil {
		return Rule{}, err
	}
	hash := sha256.Sum256(raw)
	idRaw := make([]byte, 12)
	if _, err := rand.Read(idRaw); err != nil {
		return Rule{}, err
	}
	id := "rule_" + hex.EncodeToString(idRaw)
	now := time.Now().UTC().Truncate(time.Second)
	// Serialize rule creation per owner across API replicas so concurrent
	// requests cannot both pass the 100-rule limit check.
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return Rule{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1))`, owner); err != nil {
		return Rule{}, err
	}
	command, err := tx.Exec(ctx, `insert into signalgen.user_rules
(id,owner_user_id,name,definition_json,definition_hash,schema_version,engine_version,version,created_at,updated_at)
select $1,$2::uuid,$3,$4::jsonb,$5,$6,$7,1,$8,$8
where (select count(*) from signalgen.user_rules where owner_user_id=$2::uuid)<$9`,
		id, owner, definition.Name, string(raw), fmt.Sprintf("sha256:%x", hash),
		core.SchemaVersion, core.EngineVersion, now, MaxRulesPerUser)
	if err != nil {
		return Rule{}, fmt.Errorf("create Postgres rule: %w", err)
	}
	if command.RowsAffected() != 1 {
		return Rule{}, ErrLimit
	}
	if err := tx.Commit(ctx); err != nil {
		return Rule{}, err
	}
	return store.Get(ctx, owner, id)
}

func (store *PostgresRepository) List(ctx context.Context, owner string) ([]Rule, error) {
	rows, err := store.db.Query(ctx, `select `+ruleColumns+`
from signalgen.user_rules where owner_user_id=$1::uuid
order by updated_at desc,id limit $2`, strings.TrimSpace(owner), MaxRulesPerUser)
	if err != nil {
		return nil, fmt.Errorf("list Postgres rules: %w", err)
	}
	defer rows.Close()
	result := make([]Rule, 0)
	for rows.Next() {
		item, err := scanPostgresRule(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (store *PostgresRepository) Get(ctx context.Context, owner, id string) (Rule, error) {
	item, err := scanPostgresRule(store.db.QueryRow(ctx, `select `+ruleColumns+`
from signalgen.user_rules where owner_user_id=$1::uuid and id=$2`,
		strings.TrimSpace(owner), strings.TrimSpace(id)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Rule{}, ErrNotFound
	}
	return item, err
}

func (store *PostgresRepository) Update(ctx context.Context, owner, id string, version int, definition core.RuleSnapshot) (Rule, error) {
	owner, id = strings.TrimSpace(owner), strings.TrimSpace(id)
	definition.Name = strings.TrimSpace(definition.Name)
	if owner == "" || id == "" || version < 1 || core.ValidateRule(definition) != nil {
		return Rule{}, ErrInvalid
	}
	raw, err := json.Marshal(definition)
	if err != nil {
		return Rule{}, err
	}
	hash := sha256.Sum256(raw)
	command, err := store.db.Exec(ctx, `update signalgen.user_rules
set name=$3,definition_json=$4::jsonb,definition_hash=$5,schema_version=$6,
engine_version=$7,version=version+1,updated_at=now()
where owner_user_id=$1::uuid and id=$2 and version=$8`, owner, id, definition.Name,
		string(raw), fmt.Sprintf("sha256:%x", hash), core.SchemaVersion, core.EngineVersion, version)
	if err != nil {
		return Rule{}, err
	}
	if command.RowsAffected() != 1 {
		if _, err := store.Get(ctx, owner, id); errors.Is(err, ErrNotFound) {
			return Rule{}, ErrNotFound
		}
		return Rule{}, ErrVersionConflict
	}
	return store.Get(ctx, owner, id)
}

func (store *PostgresRepository) Delete(ctx context.Context, owner, id string, version int) error {
	owner, id = strings.TrimSpace(owner), strings.TrimSpace(id)
	if owner == "" || id == "" || version < 1 {
		return ErrInvalid
	}
	command, err := store.db.Exec(ctx, `delete from signalgen.user_rules
where owner_user_id=$1::uuid and id=$2 and version=$3`, owner, id, version)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 1 {
		return nil
	}
	if _, err := store.Get(ctx, owner, id); errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	return ErrVersionConflict
}

type ruleScanner interface{ Scan(dest ...any) error }

func scanPostgresRule(row ruleScanner) (Rule, error) {
	var item Rule
	var raw []byte
	err := row.Scan(&item.ID, &item.OwnerUserID, &item.Name, &raw, &item.DefinitionHash,
		&item.SchemaVersion, &item.EngineVersion, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return Rule{}, err
	}
	if err := json.Unmarshal(raw, &item.Definition); err != nil {
		return Rule{}, fmt.Errorf("decode Postgres rule: %w", err)
	}
	item.OwnerType, item.ReadOnly = "user", false
	return item, nil
}
