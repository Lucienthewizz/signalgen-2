-- Private API-owned records. Never exposed through the Supabase Data API.
create table signalgen.user_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('backtest', 'journal')),
  id uuid not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id),
  constraint record_size check (octet_length(data::text) <= 12582912)
);
create index user_records_recent on signalgen.user_records(user_id, kind, created_at desc, id);
alter table signalgen.user_records enable row level security;
alter table signalgen.user_records force row level security;
revoke all on signalgen.user_records from public, anon, authenticated;
grant select, insert, update, delete on signalgen.user_records to signalgen_api;
-- Context is set transaction-locally by the Go API, never supplied by a client.
create policy records_owner on signalgen.user_records to signalgen_api
  using (user_id = nullif(current_setting('signalgen.owner_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('signalgen.owner_id', true), '')::uuid);
comment on table signalgen.user_records is 'Owner-scoped user-recorded trades and unverified client backtest archives. Not broker records or authorization data.';
