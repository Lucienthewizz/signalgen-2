-- SignalGen web application state. Supabase Auth owns identities; this schema
-- is deliberately not added to the Supabase Data API exposed schemas.
create schema if not exists signalgen;
revoke all on schema signalgen from public, anon, authenticated;

create table signalgen.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'operator')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table signalgen.feature_grants (
  user_id uuid not null references signalgen.account_profiles(user_id) on delete cascade,
  feature text not null check (feature in ('screener', 'backtest')),
  valid_until timestamptz not null,
  reason text not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, feature)
);
create index feature_grants_active_idx on signalgen.feature_grants (user_id, valid_until)
  where revoked_at is null;

create table signalgen.app_sessions (
  id text primary key,
  user_id uuid not null references signalgen.account_profiles(user_id) on delete cascade,
  installation_id text not null,
  label text not null,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index app_sessions_active_idx on signalgen.app_sessions (user_id, expires_at)
  where revoked_at is null;

create table signalgen.account_device_state (
  user_id uuid primary key references signalgen.account_profiles(user_id) on delete cascade,
  current_installation_id text not null,
  last_switched_at timestamptz,
  updated_at timestamptz not null default now()
);

create table signalgen.user_rules (
  id text primary key,
  owner_user_id uuid not null references signalgen.account_profiles(user_id) on delete cascade,
  name text not null,
  definition_json jsonb not null,
  definition_hash text not null,
  schema_version text not null,
  engine_version text not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_rules_owner_updated_idx on signalgen.user_rules
  (owner_user_id, updated_at desc, id);

create table signalgen.compute_grants (
  id text primary key,
  user_id uuid not null references signalgen.account_profiles(user_id) on delete cascade,
  session_id text not null references signalgen.app_sessions(id) on delete cascade,
  purpose text not null,
  dataset_id text not null,
  dataset_version text not null,
  dataset_checksum text not null,
  rule_id text not null,
  definition_hash text not null,
  engine_version text not null,
  schema_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index compute_grants_binding_idx on signalgen.compute_grants
  (user_id, session_id, expires_at);

create table signalgen.operator_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  operator_user_id uuid not null references signalgen.account_profiles(user_id),
  actor text not null,
  request_id text not null,
  bootstrapped_at timestamptz not null default now()
);

create table signalgen.audit_events (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null check (action in (
    'feature.grant', 'feature.revoke', 'account.bootstrap_operator', 'account.role_changed'
  )),
  target_user_id uuid not null references signalgen.account_profiles(user_id),
  feature text check (feature is null or feature in ('screener', 'backtest')),
  reason text not null,
  request_id text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_target_idx on signalgen.audit_events
  (target_user_id, created_at, id);

-- Every table has RLS, including tables accessible only to the backend.
alter table signalgen.account_profiles enable row level security;
alter table signalgen.feature_grants enable row level security;
alter table signalgen.app_sessions enable row level security;
alter table signalgen.account_device_state enable row level security;
alter table signalgen.user_rules enable row level security;
alter table signalgen.compute_grants enable row level security;
alter table signalgen.operator_bootstrap_state enable row level security;
alter table signalgen.audit_events enable row level security;

-- Users can read their own profile/grants and manage their own rules only.
-- No authenticated role can write roles, grants, sessions or audit events.
grant usage on schema signalgen to authenticated;
grant select on signalgen.account_profiles, signalgen.feature_grants to authenticated;
grant select, insert, update, delete on signalgen.user_rules to authenticated;

create policy account_profile_owner_read on signalgen.account_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy feature_grant_owner_read on signalgen.feature_grants
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_rule_owner_read on signalgen.user_rules
  for select to authenticated using ((select auth.uid()) = owner_user_id);
create policy user_rule_owner_insert on signalgen.user_rules
  for insert to authenticated with check ((select auth.uid()) = owner_user_id);
create policy user_rule_owner_update on signalgen.user_rules
  for update to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);
create policy user_rule_owner_delete on signalgen.user_rules
  for delete to authenticated using ((select auth.uid()) = owner_user_id);

-- Audits are append-only even for privileged application connections.
create function signalgen.reject_audit_mutation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'audit events are immutable';
end;
$$;
revoke all on function signalgen.reject_audit_mutation() from public;
create trigger reject_audit_update before update or delete on signalgen.audit_events
  for each row execute function signalgen.reject_audit_mutation();
