-- Presentation state only. Never used to authorize or score a run.
create table if not exists signalgen.workspace_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('rule-draft', 'screener-preferences', 'monitor-history', 'watchlist')),
  data jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind),
  constraint workspace_data_size check (octet_length(data::text) <= 180000)
);
alter table signalgen.workspace_state enable row level security;
revoke all on signalgen.workspace_state from public, anon, authenticated;
-- Private Go API uses its server connection and owner predicates. No Data API access.
comment on table signalgen.workspace_state is 'Owner-scoped UI state. Unverified snapshots, not authoritative trading records.';
-- Match the project's restricted trusted-backend role, if provisioned.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'signalgen_api') then
    grant select, insert, update on signalgen.workspace_state to signalgen_api;
    create policy backend_select on signalgen.workspace_state for select to signalgen_api using (true);
    create policy backend_insert on signalgen.workspace_state for insert to signalgen_api with check (true);
    create policy backend_update on signalgen.workspace_state for update to signalgen_api using (true) with check (true);
  end if;
end $$;
