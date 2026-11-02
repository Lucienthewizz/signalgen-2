-- Separate manual fill ledger. Existing journal/backtest records are untouched.
create table signalgen.portfolio_transactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  book text not null check (length(btrim(book)) between 1 and 80),
  symbol text not null check (symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$'),
  market text not null,
  currency text not null,
  side text not null check (side in ('BUY','SELL')),
  quantity numeric(24,6) not null check (quantity > 0 and quantity <= 100000000),
  price numeric(24,6) not null check (price > 0 and price <= 1000000000),
  fee numeric(24,6) not null check (fee >= 0 and fee <= 1000000000000),
  executed_at timestamptz not null check (isfinite(executed_at)),
  note text not null default '' check (length(note) <= 2000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,id),
  check ((market='IDX' and currency='IDR') or (market='US' and currency='USD')),
  check (quantity * price <= 1000000000000),
  check (market <> 'IDX' or (quantity=trunc(quantity) and mod(quantity,100)=0))
);
create index portfolio_owner_execution on signalgen.portfolio_transactions(user_id,executed_at,id);
alter table signalgen.portfolio_transactions enable row level security;
alter table signalgen.portfolio_transactions force row level security;
revoke all on signalgen.portfolio_transactions from public,anon,authenticated;
grant select,insert,update,delete on signalgen.portfolio_transactions to signalgen_api;
create policy portfolio_owner on signalgen.portfolio_transactions to signalgen_api
using (user_id = nullif(current_setting('signalgen.owner_id',true),'')::uuid)
with check (user_id = nullif(current_setting('signalgen.owner_id',true),'')::uuid);
comment on table signalgen.portfolio_transactions is 'Private manual BUY/SELL records; weighted-average holdings computed by Go. Not broker fills, journal conversion, FX or corporate-action accounting.';
