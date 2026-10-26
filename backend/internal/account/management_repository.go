package account

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/jackc/pgx/v5"
)

const managementColumns = `user_id::text,email,role,status,created_at,updated_at`

func readManagedAccount(row pgx.Row) (ManagedAccount, error) {
	var item ManagedAccount
	err := row.Scan(&item.UserID, &item.Email, &item.Role, &item.Status, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

// Admin reads use a single repeatable-read snapshot for actor authorization and
// selected rows. They do not depend on Supabase auth.uid() in a direct pgx pool.
func (store *PostgresRepository) managementRead(ctx context.Context, actor string) (pgx.Tx, error) {
	if !ValidUserID(actor) {
		return nil, access.ErrInvalidValue
	}
	tx, err := store.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	if err := requireActor(ctx, tx, actor); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}

// ListAccounts uses the existing UUID primary-key index, not unbounded OFFSET.
func (store *PostgresRepository) ListAccounts(ctx context.Context, actor string, query AccountQuery) (AccountPage, error) {
	query, err := NormalizeAccountQuery(query)
	if err != nil {
		return AccountPage{}, err
	}
	tx, err := store.managementRead(ctx, actor)
	if err != nil {
		return AccountPage{}, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `select `+managementColumns+` from signalgen.account_profiles
where ($1='' or user_id>nullif($1,'')::uuid) and ($2='' or role=$2) and ($3='' or status=$3)
and ($5='' or position(lower($5) in lower(email))>0 or position(lower($5) in user_id::text)>0)
order by user_id limit $4`, query.After, query.Role, query.Status, query.Limit+1, query.Search)
	if err != nil {
		return AccountPage{}, err
	}
	defer rows.Close()
	page := AccountPage{Items: make([]ManagedAccount, 0, query.Limit)}
	for rows.Next() {
		item, err := readManagedAccount(rows)
		if err != nil {
			return AccountPage{}, err
		}
		if len(page.Items) == query.Limit {
			page.NextCursor = page.Items[len(page.Items)-1].UserID
			break
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return AccountPage{}, err
	}
	rows.Close()
	return page, tx.Commit(ctx)
}

// SetStatusAudited changes status, revokes app sessions and writes the audit in
// one transaction. The global operator lock is the SAME lock as role/bootstrap
// changes; the per-user lock is the SAME lock as session creation/rotation.
// Lock order is global -> user -> profile. Never acquire these in reverse order.
func (store *PostgresRepository) SetStatusAudited(ctx context.Context, actor, requestID, userID string, input StatusUpdate) (ManagedAccount, error) {
	input, err := NormalizeStatusUpdate(input)
	if err != nil || !ValidUserID(actor) || !ValidUserID(userID) || !validMutation(actor, requestID, userID, input.Reason) {
		return ManagedAccount{}, access.ErrInvalidValue
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return ManagedAccount{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(68290134)`); err != nil {
		return ManagedAccount{}, err
	}
	if err := requireActor(ctx, tx, actor); err != nil {
		return ManagedAccount{}, err
	}
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return ManagedAccount{}, err
	}
	previous, err := readManagedAccount(tx.QueryRow(ctx, `select `+managementColumns+` from signalgen.account_profiles where user_id=$1::uuid for update`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return ManagedAccount{}, access.ErrAccountNotFound
	}
	if err != nil {
		return ManagedAccount{}, err
	}
	if previous.Status != input.ExpectedStatus {
		return ManagedAccount{}, ErrStatusConflict
	}
	if previous.Status == input.Status {
		return previous, tx.Commit(ctx)
	}
	if previous.Role == access.RoleOperator && input.Status == access.StatusSuspended {
		var others int
		if err := tx.QueryRow(ctx, `select count(*) from signalgen.account_profiles where role='operator' and status='active' and user_id<>$1::uuid`, userID).Scan(&others); err != nil {
			return ManagedAccount{}, err
		}
		if others == 0 {
			return ManagedAccount{}, access.ErrLastOperator
		}
	}
	item, err := readManagedAccount(tx.QueryRow(ctx, `update signalgen.account_profiles set status=$2,updated_at=now() where user_id=$1::uuid returning `+managementColumns, userID, input.Status))
	if err != nil {
		return ManagedAccount{}, err
	}
	var revoked int64
	if input.Status == access.StatusSuspended {
		result, err := tx.Exec(ctx, `update signalgen.app_sessions set revoked_at=now() where user_id=$1::uuid and revoked_at is null`, userID)
		if err != nil {
			return ManagedAccount{}, err
		}
		revoked = result.RowsAffected()
	}
	before, _ := json.Marshal(map[string]string{"status": previous.Status, "role": previous.Role})
	after, _ := json.Marshal(map[string]any{"status": item.Status, "role": item.Role, "revoked_sessions": revoked})
	if err := insertAudit(ctx, tx, actor, "account.status_changed", userID, "", input.Reason, requestID, before, after); err != nil {
		return ManagedAccount{}, err
	}
	return item, tx.Commit(ctx)
}

// Audit listing requires a specific target and excludes raw before/after JSON.
// IDs are decimal strings to avoid JavaScript bigint precision loss.
func (store *PostgresRepository) ListAccountAudit(ctx context.Context, actor string, query AuditQuery) (AuditPage, error) {
	query, err := NormalizeAuditQuery(query)
	if err != nil {
		return AuditPage{}, err
	}
	tx, err := store.managementRead(ctx, actor)
	if err != nil {
		return AuditPage{}, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err := tx.QueryRow(ctx, `select exists(select 1 from signalgen.account_profiles where user_id=$1::uuid)`, query.UserID).Scan(&exists); err != nil {
		return AuditPage{}, err
	}
	if !exists {
		return AuditPage{}, access.ErrAccountNotFound
	}
	rows, err := tx.Query(ctx, `select id,actor,action,target_user_id::text,coalesce(feature,''),reason,request_id,created_at
from signalgen.audit_events where target_user_id=$1::uuid and ($2::bigint=0 or id<$2) order by id desc limit $3`, query.UserID, query.Before, query.Limit+1)
	if err != nil {
		return AuditPage{}, err
	}
	defer rows.Close()
	page := AuditPage{Items: make([]ManagementAudit, 0, query.Limit)}
	for rows.Next() {
		var item ManagementAudit
		var id int64
		if err := rows.Scan(&id, &item.Actor, &item.Action, &item.TargetUserID, &item.Feature, &item.Reason, &item.RequestID, &item.CreatedAt); err != nil {
			return AuditPage{}, err
		}
		if len(page.Items) == query.Limit {
			page.NextCursor = page.Items[len(page.Items)-1].ID
			break
		}
		item.ID = auditCursor(id)
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return AuditPage{}, err
	}
	rows.Close()
	return page, tx.Commit(ctx)
}
