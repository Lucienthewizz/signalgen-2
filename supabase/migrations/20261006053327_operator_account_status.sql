-- Operator account status is audited in the existing private append-only ledger.
-- No new Data API exposure, client grants, RLS policy or security-definer code.
alter table signalgen.audit_events drop constraint audit_events_action_check;
alter table signalgen.audit_events add constraint audit_events_action_check
  check (action in (
    'feature.grant', 'feature.revoke', 'account.bootstrap_operator',
    'account.role_changed', 'account.status_changed'
  ));

-- Target-scoped descending ID cursor avoids OFFSET and bigint JS rounding.
create index audit_events_target_id_idx on signalgen.audit_events (target_user_id, id desc);
