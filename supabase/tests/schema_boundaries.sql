-- Verify the SignalGen schema contract without changing persistent data.
-- Run after all migrations against a test/staging database.
begin;

do $$
declare
  misplaced_tables text;
  rls_disabled_tables text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
  into misplaced_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname = any (array[
      'account_profiles',
      'feature_grants',
      'app_sessions',
      'account_device_state',
      'user_rules',
      'compute_grants',
      'operator_bootstrap_state',
      'audit_events',
      'subscription_plans',
      'subscription_plan_features',
      'subscriptions',
      'subscription_events',
      'stock_catalog',
      'stock_universes',
      'stock_universe_members'
    ]);

  if misplaced_tables is not null then
    raise exception 'SignalGen application tables found in public: %', misplaced_tables;
  end if;

  if has_schema_privilege('anon', 'signalgen', 'usage') then
    raise exception 'anon must not have USAGE on signalgen';
  end if;
  if has_schema_privilege('anon', 'legacy', 'usage') then
    raise exception 'anon must not have USAGE on legacy';
  end if;
  if has_schema_privilege('authenticated', 'legacy', 'usage') then
    raise exception 'authenticated must not have USAGE on legacy';
  end if;

  if has_table_privilege('authenticated', 'signalgen.account_profiles', 'update')
    or has_table_privilege('anon', 'signalgen.account_profiles', 'update') then
    raise exception 'client roles must not update account role/status through profiles';
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
  into rls_disabled_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('signalgen', 'legacy')
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if rls_disabled_tables is not null then
    raise exception 'RLS is disabled on protected tables: %', rls_disabled_tables;
  end if;
end;
$$;

rollback;
