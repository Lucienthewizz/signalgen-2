-- Paid plan checkout through Midtrans Snap. An order is created before the
-- payment page opens; only a verified Midtrans notification whose status is
-- confirmed with the Midtrans status API may mark it paid and activate access.
-- subscriptions already accepts source='payment_provider' with a provider ref.
create table signalgen.payment_orders (
  id text primary key check (id ~ '^sg-[a-z0-9-]{8,60}$'),
  user_id uuid not null references signalgen.account_profiles(user_id) on delete cascade,
  plan_code text not null references signalgen.subscription_plans(code),
  amount integer not null check (amount > 0),
  currency text not null check (currency = 'IDR'),
  provider text not null check (provider = 'midtrans'),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired')),
  snap_token text,
  provider_transaction_id text,
  provider_status text,
  payment_type text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null))
);
create index payment_orders_user_idx on signalgen.payment_orders
  (user_id, created_at desc);

alter table signalgen.payment_orders enable row level security;
alter table signalgen.payment_orders force row level security;
revoke all on signalgen.payment_orders from public, anon, authenticated;
grant select, insert, update on signalgen.payment_orders to signalgen_api;

-- Trusted backend policies, as for subscriptions: the webhook has no user
-- session, so Go verifies the Midtrans signature and status before any write
-- and scopes user-facing reads to the verified owner.
create policy backend_select on signalgen.payment_orders
  for select to signalgen_api using (true);
create policy backend_insert on signalgen.payment_orders
  for insert to signalgen_api with check (true);
create policy backend_update on signalgen.payment_orders
  for update to signalgen_api using (true) with check (true);

comment on table signalgen.payment_orders is 'Midtrans Snap checkout orders. Paid status comes only from a verified notification confirmed by the Midtrans status API.';
