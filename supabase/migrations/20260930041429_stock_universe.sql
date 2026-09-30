-- Three-instrument IDX catalog and owner-scoped stock-universe bundles.
-- Provider symbols are server metadata and can be changed without changing
-- the public SignalGen symbol used by rules and results.
create table signalgen.stock_catalog (
  symbol text primary key check (symbol ~ '^[A-Z0-9]+\.JK$'),
  provider text not null check (provider in ('yahoo_finance')),
  provider_symbol text not null unique,
  name text not null,
  exchange text not null default 'XIDX' check (exchange = 'XIDX'),
  currency text not null default 'IDR' check (currency = 'IDR'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into signalgen.stock_catalog
  (symbol,provider,provider_symbol,name) values
  ('BBCA.JK','yahoo_finance','BBCA.JK','Bank Central Asia Tbk'),
  ('BBRI.JK','yahoo_finance','BBRI.JK','Bank Rakyat Indonesia (Persero) Tbk'),
  ('TLKM.JK','yahoo_finance','TLKM.JK','Telkom Indonesia (Persero) Tbk');

create table signalgen.stock_universes (
  id text primary key default ('univ_' || replace(gen_random_uuid()::text, '-', '')),
  owner_user_id uuid not null references signalgen.account_profiles(user_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id,name)
);
create index stock_universes_owner_updated_idx on signalgen.stock_universes
  (owner_user_id,updated_at desc,id);

create table signalgen.stock_universe_members (
  universe_id text not null references signalgen.stock_universes(id) on delete cascade,
  symbol text not null references signalgen.stock_catalog(symbol),
  position smallint not null check (position between 0 and 2),
  primary key (universe_id,symbol),
  unique (universe_id,position)
);

alter table signalgen.stock_catalog enable row level security;
alter table signalgen.stock_universes enable row level security;
alter table signalgen.stock_universe_members enable row level security;

grant select on signalgen.stock_catalog to authenticated;
grant select,insert,update,delete on signalgen.stock_universes to authenticated;
grant select,insert,update,delete on signalgen.stock_universe_members to authenticated;

create policy stock_catalog_authenticated_read on signalgen.stock_catalog
  for select to authenticated using (active);
create policy stock_universe_owner_select on signalgen.stock_universes
  for select to authenticated using ((select auth.uid()) = owner_user_id);
create policy stock_universe_owner_insert on signalgen.stock_universes
  for insert to authenticated with check ((select auth.uid()) = owner_user_id);
create policy stock_universe_owner_update on signalgen.stock_universes
  for update to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);
create policy stock_universe_owner_delete on signalgen.stock_universes
  for delete to authenticated using ((select auth.uid()) = owner_user_id);
create policy stock_universe_member_owner_select on signalgen.stock_universe_members
  for select to authenticated using (exists (
    select 1 from signalgen.stock_universes universe
    where universe.id=universe_id and universe.owner_user_id=(select auth.uid())
  ));
create policy stock_universe_member_owner_insert on signalgen.stock_universe_members
  for insert to authenticated with check (exists (
    select 1 from signalgen.stock_universes universe
    where universe.id=universe_id and universe.owner_user_id=(select auth.uid())
  ));
create policy stock_universe_member_owner_update on signalgen.stock_universe_members
  for update to authenticated
  using (exists (
    select 1 from signalgen.stock_universes universe
    where universe.id=universe_id and universe.owner_user_id=(select auth.uid())
  ))
  with check (exists (
    select 1 from signalgen.stock_universes universe
    where universe.id=universe_id and universe.owner_user_id=(select auth.uid())
  ));
create policy stock_universe_member_owner_delete on signalgen.stock_universe_members
  for delete to authenticated using (exists (
    select 1 from signalgen.stock_universes universe
    where universe.id=universe_id and universe.owner_user_id=(select auth.uid())
  ));
