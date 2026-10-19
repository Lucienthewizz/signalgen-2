-- Separate the trusted Go API from the migration/administration connection.
-- NOLOGIN deliberately requires a separately provisioned secret, never a
-- password committed in a migration. No inherited Supabase service roles.
create role signalgen_api nologin noinherit nosuperuser nocreatedb
  nocreaterole noreplication nobypassrls connection limit 10;
grant signalgen_api to postgres;
grant usage on schema signalgen to signalgen_api;

grant select, insert, update on signalgen.account_profiles,
  signalgen.feature_grants, signalgen.app_sessions,
  signalgen.account_device_state, signalgen.subscriptions to signalgen_api;
grant select, insert, update, delete on signalgen.user_rules,
  signalgen.stock_universes to signalgen_api;
grant select, insert, delete on signalgen.stock_universe_members to signalgen_api;
grant select, insert on signalgen.compute_grants, signalgen.audit_events to signalgen_api;
grant insert on signalgen.subscription_events to signalgen_api;
grant select on signalgen.subscription_plans, signalgen.subscription_plan_features,
  signalgen.stock_catalog, signalgen.operator_bootstrap_state to signalgen_api;
grant usage on sequence signalgen.audit_events_id_seq,
  signalgen.subscription_events_id_seq to signalgen_api;

-- These are *trusted backend* policies, not tenant ownership policies: direct
-- pgx does not inherit auth.uid(). Explicit verified-owner predicates and
-- operator checks in Go remain mandatory. The role cannot bypass RLS on other
-- schemas/tables, perform DDL, bootstrap an operator, or mutate audit history.
-- Do not grant this role to anon/authenticated/authenticator/service_role.
do $$
declare
  table_name text;
  operation text;
begin
  for table_name, operation in
    select relation, verb from (values
      ('account_profiles', array['select','insert','update']),
      ('feature_grants', array['select','insert','update']),
      ('app_sessions', array['select','insert','update']),
      ('account_device_state', array['select','insert','update']),
      ('subscriptions', array['select','insert','update']),
      ('user_rules', array['select','insert','update','delete']),
      ('stock_universes', array['select','insert','update','delete']),
      ('stock_universe_members', array['select','insert','delete']),
      ('compute_grants', array['select','insert']),
      ('audit_events', array['select','insert']),
      ('subscription_events', array['insert']),
      ('subscription_plans', array['select']),
      ('subscription_plan_features', array['select']),
      ('stock_catalog', array['select']),
      ('operator_bootstrap_state', array['select'])
    ) as permissions(relation, verbs), unnest(verbs) verb
  loop
    execute format('create policy %I on signalgen.%I for %s to signalgen_api %s',
      'backend_' || operation, table_name, operation,
      case operation
        when 'insert' then 'with check (true)'
        when 'update' then 'using (true) with check (true)'
        else 'using (true)'
      end);
  end loop;
end;
$$;

-- Existing Supabase project triggers still run. Client RPC callers do not
-- need EXECUTE on these SECURITY DEFINER trigger/event-trigger helpers.
-- Local test databases may not have the Dashboard-created functions.
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    revoke execute on function public.handle_new_user() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
