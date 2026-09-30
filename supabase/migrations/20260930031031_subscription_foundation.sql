-- Provider-neutral subscription foundation. Payment checkout and webhook
-- verification are intentionally outside this migration; only trusted backend
-- or operator flows may mutate subscription state.
create table signalgen.subscription_plans (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table signalgen.subscription_plan_features (
  plan_code text not null references signalgen.subscription_plans(code) on delete cascade,
  feature text not null check (feature in ('screener', 'backtest')),
  primary key (plan_code, feature)
);

create table signalgen.subscriptions (
  id text primary key default ('sub_' || replace(gen_random_uuid()::text, '-', '')),
  user_id uuid not null unique references signalgen.account_profiles(user_id) on delete cascade,
  plan_code text not null references signalgen.subscription_plans(code),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'payment_provider')),
  provider text,
  provider_customer_ref text,
  provider_subscription_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start),
  check (
    (source = 'manual' and provider is null and provider_customer_ref is null and provider_subscription_ref is null)
    or
    (source = 'payment_provider' and provider is not null and provider_subscription_ref is not null)
  )
);
create index subscriptions_active_idx on signalgen.subscriptions
  (user_id, current_period_end)
  where status in ('trialing', 'active');

create table signalgen.subscription_events (
  id bigint generated always as identity primary key,
  subscription_id text not null references signalgen.subscriptions(id) on delete cascade,
  user_id uuid not null references signalgen.account_profiles(user_id) on delete cascade,
  actor text not null,
  action text not null check (action in (
    'subscription.activate',
    'subscription.change_plan',
    'subscription.cancel_scheduled',
    'subscription.cancel_now'
  )),
  reason text not null,
  request_id text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
create index subscription_events_user_idx on signalgen.subscription_events
  (user_id, created_at desc, id desc);

-- Pricing is deliberately absent: the landing-page prices are still a UI
-- simulation. These codes only define the current feature-access mapping.
insert into signalgen.subscription_plans (code, name, description) values
  ('free', 'Free', 'Demo access without paid server-controlled features.'),
  ('analyst', 'Analyst', 'Current full analysis feature set.'),
  ('pro', 'Pro', 'Analysis feature set with future higher limits.');

insert into signalgen.subscription_plan_features (plan_code, feature) values
  ('analyst', 'screener'),
  ('analyst', 'backtest'),
  ('pro', 'screener'),
  ('pro', 'backtest');

alter table signalgen.subscription_plans enable row level security;
alter table signalgen.subscription_plan_features enable row level security;
alter table signalgen.subscriptions enable row level security;
alter table signalgen.subscription_events enable row level security;

-- Browser access remains read-only and owner-scoped. The Go backend uses a
-- direct server connection and still applies explicit user_id filters.
grant select on signalgen.subscription_plans,
  signalgen.subscription_plan_features,
  signalgen.subscriptions to authenticated;

create policy subscription_plan_authenticated_read on signalgen.subscription_plans
  for select to authenticated using (active);
create policy subscription_plan_feature_authenticated_read on signalgen.subscription_plan_features
  for select to authenticated using (
    exists (
      select 1 from signalgen.subscription_plans plan
      where plan.code = plan_code and plan.active
    )
  );
create policy subscription_owner_read on signalgen.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

-- Subscription history is append-only even for privileged backend connections.
create trigger reject_subscription_event_mutation
  before update or delete on signalgen.subscription_events
  for each row execute function signalgen.reject_audit_mutation();
