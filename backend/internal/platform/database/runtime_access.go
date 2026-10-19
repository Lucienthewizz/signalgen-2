package database

import (
	"context"
	"fmt"
)

// runtimeAccessReady verifies the *required* side of least privilege. A safe
// role with a missing GRANT or policy can still connect, but application writes
// fail or RLS reads silently return no rows. Do not report such a backend ready.
//
// This manifest mirrors the versioned backend_runtime_privileges migration.
// It checks our known trusted-server policies, not arbitrary SQL expressions.
// Verified-owner filters in repositories remain responsible for tenant isolation.
func runtimeAccessReady(ctx context.Context, db rowQuerier) error {
	var complete bool
	err := db.QueryRow(ctx, `with required as (
  select relation, operation from (values
    ('account_profiles', array['select','insert','update']),
    ('feature_grants', array['select','insert','update']),
    ('app_sessions', array['select','insert','update']),
    ('account_device_state', array['select','insert','update']),
    ('subscriptions', array['select','insert','update']),
    ('user_rules', array['select','insert','update','delete']),
    ('stock_universes', array['select','insert','update','delete']),
    ('stock_universe_members', array['select','insert','delete']),
    ('compute_grants', array['select','insert']),
    ('audit_events', array['select','insert']),
    ('subscription_events', array['insert']),
    ('subscription_plans', array['select']),
    ('subscription_plan_features', array['select']),
    ('stock_catalog', array['select']),
    ('operator_bootstrap_state', array['select'])
  ) as permissions(relation, operations), unnest(operations) operation
)
select
  has_schema_privilege(current_user,'signalgen','USAGE')
  and has_sequence_privilege(current_user,'signalgen.audit_events_id_seq','USAGE')
  and has_sequence_privilege(current_user,'signalgen.subscription_events_id_seq','USAGE')
  and (select bool_and(
    has_table_privilege(current_user, 'signalgen.' || relation, upper(operation))
    and exists (select 1 from pg_policy
      where polrelid=to_regclass('signalgen.' || relation)
        and polname='backend_' || operation and polpermissive
        and (select oid from pg_roles where rolname=current_user)=any(polroles)
        and polcmd=case operation
          when 'select' then 'r'::"char" when 'insert' then 'a'::"char"
          when 'update' then 'w'::"char" else 'd'::"char" end
        and (operation='insert' or pg_get_expr(polqual,polrelid)='true')
        and (operation not in ('insert','update')
          or pg_get_expr(polwithcheck,polrelid)='true'))
    -- Restrictive policies combine with AND. An extra backend/PUBLIC policy
    -- can silently hide rows even when our permissive policy is unchanged.
    -- None are part of the current runtime contract; require an explicit
    -- migration/readiness update before introducing one intentionally.
    and not exists (select 1 from pg_policy
      where polrelid=to_regclass('signalgen.' || relation) and not polpermissive
        and (0::oid=any(polroles)
          or (select oid from pg_roles where rolname=current_user)=any(polroles))
        and polcmd in ('*'::"char", case operation
          when 'select' then 'r'::"char" when 'insert' then 'a'::"char"
          when 'update' then 'w'::"char" else 'd'::"char" end))
  ) from required)`).Scan(&complete)
	if err != nil {
		return fmt.Errorf("inspect runtime access: %w", err)
	}
	if !complete {
		return fmt.Errorf("Postgres runtime grants or policies are incomplete")
	}
	return nil
}
