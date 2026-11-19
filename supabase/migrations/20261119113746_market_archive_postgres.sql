-- Shared public market data. No user-owned tables or subscriptions are changed.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='signalgen_market_writer') then
    create role signalgen_market_writer nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;

create table signalgen.market_sync_runs (
  id uuid primary key,
  revision bigint generated always as identity unique,
  scope text not null check (scope in ('production','smoke')),
  market text not null check (market in ('IDX','US')),
  external_id text not null check (length(external_id) between 1 and 160),
  trigger text not null check (trigger in ('manual','schedule','fixture')),
  catalog_sha256 text not null check (length(catalog_sha256)=64),
  requested_from timestamptz not null,
  requested_to timestamptz not null check (requested_to>requested_from),
  status text not null default 'running' check (status in ('running','published','partial','failed','cancelled','capacity_blocked')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  total integer not null check (total>0),
  successful integer not null default 0 check (successful>=0),
  failed integer not null default 0 check (failed>=0),
  inserted integer not null default 0 check (inserted>=0),
  changed integer not null default 0 check (changed>=0),
  unchanged integer not null default 0 check (unchanged>=0),
  preflight_bytes bigint,
  projected_bytes bigint,
  unique(scope,market,external_id),
  unique(id,scope,market)
);

create table signalgen.market_publications (
  scope text not null check (scope in ('production','smoke')),
  market text not null check (market in ('IDX','US')),
  revision bigint not null references signalgen.market_sync_runs(revision),
  run_id uuid not null,
  published_at timestamptz not null default clock_timestamp(),
  primary key(scope,market),
  foreign key(run_id,scope,market) references signalgen.market_sync_runs(id,scope,market)
);

create table signalgen.market_candles (
  scope text not null check (scope in ('production','smoke')),
  symbol text not null references signalgen.stock_catalog(symbol),
  provider text not null default 'yahoo_finance' check (provider='yahoo_finance'),
  timeframe text not null default '1d' check (timeframe='1d'),
  timestamp timestamptz not null,
  valid_from bigint not null references signalgen.market_sync_runs(revision),
  valid_to bigint references signalgen.market_sync_runs(revision),
  open double precision not null check (open>0 and open<'Infinity'::float8),
  high double precision not null check (high>0 and high<'Infinity'::float8),
  low double precision not null check (low>0 and low<'Infinity'::float8),
  close double precision not null check (close>0 and close<'Infinity'::float8),
  volume bigint not null check (volume>=0),
  primary key(scope,symbol,provider,timeframe,timestamp,valid_from),
  check (valid_to is null or valid_to>valid_from),
  check (high>=low and high>=open and high>=close and low<=open and low<=close)
);
create unique index market_candles_current on signalgen.market_candles(scope,symbol,provider,timeframe,timestamp) where valid_to is null;
create index market_candles_retired on signalgen.market_candles(valid_to) where valid_to is not null;

create table signalgen.market_sync_items (
  run_id uuid not null,
  scope text not null,
  market text not null,
  symbol text not null references signalgen.stock_catalog(symbol),
  status text not null default 'pending' check (status in ('pending','success','failed')),
  candle_count integer not null default 0 check (candle_count between 0 and 2500),
  inserted integer not null default 0 check (inserted>=0),
  changed integer not null default 0 check (changed>=0),
  unchanged integer not null default 0 check (unchanged>=0),
  attempts integer not null default 0 check (attempts between 0 and 2),
  error_code text check (length(error_code)<=80),
  quality jsonb not null default '{}'::jsonb check (jsonb_typeof(quality)='object'),
  payload jsonb check (payload is null or (jsonb_typeof(payload)='array' and jsonb_array_length(payload)<=2500)),
  checked_at timestamptz,
  primary key(run_id,symbol),
  foreign key(run_id,scope,market) references signalgen.market_sync_runs(id,scope,market) on delete cascade
);
create index market_sync_items_history on signalgen.market_sync_items(scope,market,symbol,checked_at desc);

create table signalgen.market_smoke_tests (
  id uuid primary key,
  deployment_ref text not null check (deployment_ref ~ '^[a-f0-9]{40}$'),
  armed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 6),
  successes integer not null default 0 check (successes between 0 and 3),
  state text not null default 'armed' check (state in ('armed','passed','expired','failed')),
  check (expires_at>armed_at and expires_at<=armed_at+interval '1 hour')
);

create table signalgen.market_smoke_events (
  test_id uuid not null references signalgen.market_smoke_tests(id),
  event_id text not null check(length(event_id) between 1 and 160),
  trigger text not null check(trigger in ('manual','schedule')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  success boolean,
  runs jsonb,
  primary key(test_id,event_id)
);

grant usage on schema signalgen to signalgen_market_writer;
grant select on signalgen.stock_catalog to signalgen_market_writer;
create policy market_writer_catalog_select on signalgen.stock_catalog for select to signalgen_market_writer using(true);

do $$ declare relation text; begin
  foreach relation in array array['market_sync_runs','market_publications','market_candles','market_sync_items','market_smoke_tests','market_smoke_events'] loop
    execute format('alter table signalgen.%I enable row level security',relation);
    execute format('revoke all on signalgen.%I from public, anon, authenticated',relation);
    execute format('grant select,insert,update,delete on signalgen.%I to signalgen_market_writer',relation);
    execute format('create policy market_writer_all on signalgen.%I for all to signalgen_market_writer using(true) with check(true)',relation);
    if relation not in ('market_smoke_tests','market_smoke_events') then
      execute format('grant select on signalgen.%I to signalgen_api',relation);
      execute format('create policy market_api_read on signalgen.%I for select to signalgen_api using(scope=''production'')',relation);
    end if;
  end loop;
end $$;
grant usage,select on sequence signalgen.market_sync_runs_revision_seq to signalgen_market_writer;
