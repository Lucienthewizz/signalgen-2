// Package account owns the durable profile, role, entitlement, and audit
// repository used by account and operator use cases.
package account

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Access keeps roles, account status, entitlements and audits authoritative in
// Postgres. The verified Supabase user ID is supplied by the HTTP boundary.
type PostgresRepository struct{ db *pgxpool.Pool }

func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (store *PostgresRepository) Ready(ctx context.Context) error { return store.db.Ping(ctx) }

func (store *PostgresRepository) EnsureProfile(ctx context.Context, userID, email string) (access.Account, error) {
	userID, email = strings.TrimSpace(userID), strings.TrimSpace(email)
	if userID == "" {
		return access.Account{}, access.ErrInvalidValue
	}
	_, err := store.db.Exec(ctx, `
insert into signalgen.account_profiles (user_id,email) values ($1::uuid,$2)
on conflict (user_id) do update set email=excluded.email, updated_at=now()`, userID, email)
	if err != nil {
		return access.Account{}, fmt.Errorf("ensure Postgres profile: %w", err)
	}
	return store.Account(ctx, userID)
}

func (store *PostgresRepository) Account(ctx context.Context, userID string) (access.Account, error) {
	var result access.Account
	err := store.db.QueryRow(ctx, `select user_id::text,email,role,status,created_at,updated_at
from signalgen.account_profiles where user_id=$1::uuid`, userID).Scan(
		&result.UserID, &result.Email, &result.Role, &result.Status, &result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return access.Account{}, access.ErrAccountNotFound
	}
	if err != nil {
		return access.Account{}, fmt.Errorf("read Postgres profile: %w", err)
	}
	return result, nil
}

func (store *PostgresRepository) RequireActive(ctx context.Context, userID string) (access.Account, error) {
	account, err := store.Account(ctx, userID)
	if err != nil {
		return account, err
	}
	if account.Status != access.StatusActive {
		return access.Account{}, access.ErrAccountSuspended
	}
	return account, nil
}

func (store *PostgresRepository) RequireOperator(ctx context.Context, userID string) (access.Account, error) {
	account, err := store.RequireActive(ctx, userID)
	if err != nil {
		return account, err
	}
	if account.Role != access.RoleOperator {
		return access.Account{}, access.ErrRoleRequired
	}
	return account, nil
}

func (store *PostgresRepository) Features(ctx context.Context, userID string) ([]string, error) {
	rows, err := store.db.Query(ctx, `select feature from signalgen.feature_grants
where user_id=$1::uuid and revoked_at is null and valid_until>now() order by feature`, userID)
	if err != nil {
		return nil, fmt.Errorf("list Postgres features: %w", err)
	}
	defer rows.Close()
	features := make([]string, 0)
	for rows.Next() {
		var feature string
		if err := rows.Scan(&feature); err != nil {
			return nil, err
		}
		features = append(features, feature)
	}
	return features, rows.Err()
}

func (store *PostgresRepository) FeatureGrants(ctx context.Context, userID string) ([]access.FeatureGrant, error) {
	if _, err := store.Account(ctx, userID); err != nil {
		return nil, err
	}
	rows, err := store.db.Query(ctx, `select user_id::text,feature,valid_until,reason,revoked_at,updated_at
from signalgen.feature_grants where user_id=$1::uuid order by feature`, userID)
	if err != nil {
		return nil, fmt.Errorf("list Postgres grants: %w", err)
	}
	defer rows.Close()
	grants := make([]access.FeatureGrant, 0)
	for rows.Next() {
		var grant access.FeatureGrant
		var revoked pgtype.Timestamptz
		if err := rows.Scan(&grant.UserID, &grant.Feature, &grant.ValidUntil, &grant.Reason, &revoked, &grant.UpdatedAt); err != nil {
			return nil, err
		}
		if revoked.Valid {
			value := revoked.Time.UTC()
			grant.RevokedAt = &value
		}
		grant.Active = grant.RevokedAt == nil && time.Now().UTC().Before(grant.ValidUntil)
		grants = append(grants, grant)
	}
	return grants, rows.Err()
}

func (store *PostgresRepository) RequireFeature(ctx context.Context, userID, feature string) error {
	if _, err := store.RequireActive(ctx, userID); err != nil {
		return err
	}
	if feature != access.FeatureScreener && feature != access.FeatureBacktest {
		return access.ErrInvalidValue
	}
	var enabled bool
	err := store.db.QueryRow(ctx, `select exists(select 1 from signalgen.feature_grants
where user_id=$1::uuid and feature=$2 and revoked_at is null and valid_until>now())`, userID, feature).Scan(&enabled)
	if err != nil {
		return fmt.Errorf("check Postgres feature: %w", err)
	}
	if !enabled {
		return access.ErrEntitlementMissing
	}
	return nil
}

func (store *PostgresRepository) GrantFeatureAudited(ctx context.Context, actor, requestID, userID, feature string, validUntil time.Time, reason string) (access.FeatureGrant, error) {
	if !validMutation(actor, requestID, userID, reason) || !validFeature(feature) || !validUntil.After(time.Now()) {
		return access.FeatureGrant{}, access.ErrInvalidValue
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return access.FeatureGrant{}, err
	}
	defer tx.Rollback(ctx)
	if err := requireActor(ctx, tx, actor); err != nil {
		return access.FeatureGrant{}, err
	}
	before, err := grantJSON(ctx, tx, userID, feature)
	if err != nil {
		return access.FeatureGrant{}, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	_, err = tx.Exec(ctx, `insert into signalgen.feature_grants
(user_id,feature,valid_until,reason,updated_at) values ($1::uuid,$2,$3,$4,$5)
on conflict (user_id,feature) do update set valid_until=excluded.valid_until,
reason=excluded.reason,revoked_at=null,updated_at=excluded.updated_at`, userID, feature, validUntil.UTC(), reason, now)
	if err != nil {
		return access.FeatureGrant{}, fmt.Errorf("grant Postgres feature: %w", err)
	}
	after, err := grantJSON(ctx, tx, userID, feature)
	if err != nil {
		return access.FeatureGrant{}, err
	}
	if err := insertAudit(ctx, tx, actor, "feature.grant", userID, feature, reason, requestID, before, after); err != nil {
		return access.FeatureGrant{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return access.FeatureGrant{}, err
	}
	return access.FeatureGrant{UserID: userID, Feature: feature, ValidUntil: validUntil.UTC(), Reason: reason, UpdatedAt: now, Active: true}, nil
}

func (store *PostgresRepository) RevokeFeatureAudited(ctx context.Context, actor, requestID, userID, feature, reason string) error {
	if !validMutation(actor, requestID, userID, reason) || !validFeature(feature) {
		return access.ErrInvalidValue
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := requireActor(ctx, tx, actor); err != nil {
		return err
	}
	before, err := grantJSON(ctx, tx, userID, feature)
	if err != nil {
		return err
	}
	if before == nil {
		return access.ErrEntitlementMissing
	}
	result, err := tx.Exec(ctx, `update signalgen.feature_grants set revoked_at=now(),updated_at=now()
where user_id=$1::uuid and feature=$2 and revoked_at is null`, userID, feature)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return access.ErrEntitlementMissing
	}
	after, err := grantJSON(ctx, tx, userID, feature)
	if err != nil {
		return err
	}
	if err := insertAudit(ctx, tx, actor, "feature.revoke", userID, feature, reason, requestID, before, after); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (store *PostgresRepository) SetRoleAudited(ctx context.Context, actor, requestID, userID, role, reason string) (access.AccountRole, error) {
	if !validMutation(actor, requestID, userID, reason) || (role != access.RoleUser && role != access.RoleOperator) {
		return access.AccountRole{}, access.ErrInvalidValue
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return access.AccountRole{}, err
	}
	defer tx.Rollback(ctx)
	// Serialize role changes so two concurrent demotions cannot remove the
	// final active operator in separate transactions.
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(68290134)`); err != nil {
		return access.AccountRole{}, err
	}
	if err := requireActor(ctx, tx, actor); err != nil {
		return access.AccountRole{}, err
	}
	var previousRole, status string
	err = tx.QueryRow(ctx, `select role,status from signalgen.account_profiles
where user_id=$1::uuid for update`, userID).Scan(&previousRole, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return access.AccountRole{}, access.ErrAccountNotFound
	}
	if err != nil {
		return access.AccountRole{}, err
	}
	if previousRole == access.RoleOperator && role == access.RoleUser {
		var others int
		if err := tx.QueryRow(ctx, `select count(*) from signalgen.account_profiles
where role='operator' and status='active' and user_id<>$1::uuid`, userID).Scan(&others); err != nil {
			return access.AccountRole{}, err
		}
		if others == 0 {
			return access.AccountRole{}, access.ErrLastOperator
		}
	}
	var updated time.Time
	if previousRole != role {
		err = tx.QueryRow(ctx, `update signalgen.account_profiles set role=$2,updated_at=now()
where user_id=$1::uuid returning updated_at`, userID, role).Scan(&updated)
		if err != nil {
			return access.AccountRole{}, err
		}
		before, _ := json.Marshal(map[string]string{"role": previousRole, "status": status})
		after, _ := json.Marshal(map[string]string{"role": role, "status": status})
		if err := insertAudit(ctx, tx, actor, "account.role_changed", userID, "", reason, requestID, before, after); err != nil {
			return access.AccountRole{}, err
		}
	} else {
		if err := tx.QueryRow(ctx, `select updated_at from signalgen.account_profiles where user_id=$1::uuid`, userID).Scan(&updated); err != nil {
			return access.AccountRole{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return access.AccountRole{}, err
	}
	return access.AccountRole{UserID: userID, Role: role, Status: status, UpdatedAt: updated}, nil
}

// BootstrapOperator is available only to the local administrator CLI. The
// singleton record and transaction lock make first-operator creation one-time.
func (store *PostgresRepository) BootstrapOperator(ctx context.Context, actor, requestID, userID, reason string) error {
	if !validMutation(actor, requestID, userID, reason) {
		return access.ErrInvalidValue
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(68290134)`); err != nil {
		return err
	}
	var role, status string
	err = tx.QueryRow(ctx, `select role,status from signalgen.account_profiles
where user_id=$1::uuid for update`, userID).Scan(&role, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return access.ErrAccountNotFound
	}
	if err != nil {
		return err
	}
	if status != access.StatusActive {
		return access.ErrAccountSuspended
	}
	var sealed bool
	if err := tx.QueryRow(ctx, `select exists(select 1 from signalgen.operator_bootstrap_state)
or exists(select 1 from signalgen.account_profiles where role='operator')`).Scan(&sealed); err != nil {
		return err
	}
	if sealed || role != access.RoleUser {
		return access.ErrBootstrapClosed
	}
	_, err = tx.Exec(ctx, `insert into signalgen.operator_bootstrap_state
(singleton,operator_user_id,actor,request_id) values (true,$1::uuid,$2,$3)`, userID, actor, requestID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `update signalgen.account_profiles set role='operator',updated_at=now()
where user_id=$1::uuid`, userID)
	if err != nil {
		return err
	}
	before, _ := json.Marshal(map[string]string{"role": role, "status": status})
	after, _ := json.Marshal(map[string]string{"role": access.RoleOperator, "status": status})
	if err := insertAudit(ctx, tx, actor, "account.bootstrap_operator", userID, "", reason, requestID, before, after); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func validFeature(feature string) bool {
	return feature == access.FeatureScreener || feature == access.FeatureBacktest
}

func validMutation(actor, requestID, userID, reason string) bool {
	return strings.TrimSpace(actor) != "" && strings.TrimSpace(requestID) != "" &&
		strings.TrimSpace(userID) != "" && strings.TrimSpace(reason) != ""
}

func requireActor(ctx context.Context, tx pgx.Tx, actor string) error {
	if actor == "system:internal" {
		return nil
	}
	var ok bool
	err := tx.QueryRow(ctx, `select exists(select 1 from signalgen.account_profiles
where user_id=$1::uuid and role='operator' and status='active')`, actor).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return access.ErrRoleRequired
	}
	return nil
}

func grantJSON(ctx context.Context, tx pgx.Tx, userID, feature string) ([]byte, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `select to_jsonb(f) from signalgen.feature_grants f
where user_id=$1::uuid and feature=$2`, userID, feature).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return raw, err
}

func insertAudit(ctx context.Context, tx pgx.Tx, actor, action, userID, feature, reason, requestID string, before, after []byte) error {
	_, err := tx.Exec(ctx, `insert into signalgen.audit_events
(actor,action,target_user_id,feature,reason,request_id,before_json,after_json)
values ($1,$2,$3::uuid,nullif($4,''),$5,$6,$7::jsonb,$8::jsonb)`,
		actor, action, userID, feature, reason, requestID, nullableJSON(before), nullableJSON(after))
	return err
}

func nullableJSON(raw []byte) any {
	if raw == nil {
		return nil
	}
	return string(raw)
}
